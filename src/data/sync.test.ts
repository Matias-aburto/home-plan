// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: apiMock };
});

const { ApiError } = await import("../api/client");
const { clearOfflineData, getPendingOperations } = await import("../offline");
const { flushQueue, mutate, onSyncEvent, syncEvents } = await import("./sync");

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

const operation = (title: string, listId = "lista") => ({
  url: `/api/lists/${listId}/items`,
  method: "POST" as const,
  body: { title },
  listId
});

async function pendingTitles() {
  return (await getPendingOperations()).map((queued) => queued.body?.title);
}

beforeEach(async () => {
  apiMock.mockReset();
  setOnline(true);
  await clearOfflineData();
});

describe("cola offline", () => {
  it("sin conexión guarda los cambios y los envía en orden al volver", async () => {
    setOnline(false);
    await mutate(operation("uno"));
    await mutate(operation("dos"));
    expect(apiMock).not.toHaveBeenCalled();
    expect(await pendingTitles()).toEqual(["uno", "dos"]);

    setOnline(true);
    apiMock.mockResolvedValue({});
    await flushQueue();
    expect(apiMock.mock.calls.map(([, options]) => JSON.parse(options.body).title)).toEqual(["uno", "dos"]);
    expect(await getPendingOperations()).toEqual([]);
  });

  it("se detiene ante errores temporales y conserva el orden", async () => {
    apiMock.mockRejectedValue(new ApiError("Caído", 503));
    await mutate(operation("uno"));
    await mutate(operation("dos"));
    expect(await pendingTitles()).toEqual(["uno", "dos"]);

    apiMock.mockReset();
    apiMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await flushQueue();
    expect(await pendingTitles()).toEqual(["uno", "dos"]);

    apiMock.mockReset();
    apiMock.mockResolvedValue({});
    await flushQueue();
    expect(await getPendingOperations()).toEqual([]);
  });

  it("con sesión vencida (401) conserva la cola para retomarla después", async () => {
    apiMock.mockRejectedValue(new ApiError("Inicia sesión", 401));
    await mutate(operation("uno"));
    expect(await pendingTitles()).toEqual(["uno"]);
  });

  it("descarta rechazos permanentes, avisa y sigue con el resto", async () => {
    const dropped: number[] = [];
    const synced: unknown[] = [];
    const offDropped = onSyncEvent<number>(syncEvents.dropped, (count) => dropped.push(count));
    const offSynced = onSyncEvent(syncEvents.synced, (detail) => synced.push(detail));
    setOnline(false);
    await mutate(operation("sin permiso", "a"));
    await mutate(operation("ya borrado", "b"));
    await mutate(operation("válido", "c"));
    setOnline(true);
    apiMock
      .mockRejectedValueOnce(new ApiError("Sin permiso", 403))
      .mockRejectedValueOnce(new ApiError("No existe", 404))
      .mockResolvedValueOnce({});
    await flushQueue();
    offDropped();
    offSynced();

    expect(apiMock).toHaveBeenCalledTimes(3);
    expect(await getPendingOperations()).toEqual([]);
    // El 404 no se cuenta: suele ser algo que otra persona ya borró.
    expect(dropped).toEqual([1]);
    expect(synced).toEqual([{ familyIds: [], listIds: ["a", "b", "c"] }]);
  });

  it("envía lo que se agrega mientras la cola se está enviando", async () => {
    let release!: () => void;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({});
    }));
    apiMock.mockResolvedValue({});
    const first = mutate(operation("uno"));
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const second = mutate(operation("dos"));
    release();
    await Promise.all([first, second]);
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(await getPendingOperations()).toEqual([]);
  });
});
