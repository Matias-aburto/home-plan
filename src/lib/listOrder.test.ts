import { describe, expect, it } from "vitest";
import {
  archiveCompletedLocally,
  mergeVisibleOrder,
  nextListPosition,
  sortPending,
  withPendingPositions
} from "./listOrder";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe("nextListPosition", () => {
  it("queda arriba de los pendientes e ignora los completados", () => {
    expect(nextListPosition([])).toBe(0);
    expect(nextListPosition([
      { completed: false, position: 2 },
      { completed: true, position: -10 },
      { completed: false, position: -1 }
    ])).toBe(-2);
  });
});

describe("sortPending", () => {
  const items = [
    { id: "b", name: "banana", position: 1, createdAt: "2026-01-02" },
    { id: "a", name: "Árbol", position: 2, createdAt: "2026-01-01" },
    { id: "c", name: "cebolla", position: 0, createdAt: "2026-01-03" }
  ];

  it("respeta el orden personalizado", () => {
    expect(sortPending(items, "custom", (item) => item.name).map(({ id }) => id)).toEqual(["c", "b", "a"]);
  });

  it("ordena alfabéticamente sin considerar tildes ni mayúsculas", () => {
    expect(sortPending(items, "alpha", (item) => item.name).map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeVisibleOrder", () => {
  it("reordena solo los visibles y deja los filtrados en su lugar", () => {
    const all = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(mergeVisibleOrder(all, ["d", "b"]).map(({ id }) => id)).toEqual(["a", "d", "c", "b"]);
  });
});

describe("withPendingPositions", () => {
  it("asigna posiciones según el nuevo orden", () => {
    const entries = [
      { id: "a", completed: false, position: 5 },
      { id: "b", completed: false, position: 6 },
      { id: "x", completed: true, position: 9 }
    ];
    const result = withPendingPositions(entries, [entries[1], entries[0]]);
    expect(result.map(({ id, position }) => [id, position])).toEqual([["a", 1], ["b", 0], ["x", 9]]);
  });
});

describe("archiveCompletedLocally", () => {
  it("deja visibles los 5 completados más recientes de las últimas 24 horas", () => {
    const entries = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `c${index}`, completed: true, completedAt: minutesAgo(index + 1), updatedAt: minutesAgo(index + 1), archivedAt: null
      })),
      { id: "viejo", completed: true, completedAt: minutesAgo(60 * 30), updatedAt: minutesAgo(60 * 30), archivedAt: null },
      { id: "pendiente", completed: false, completedAt: null, updatedAt: minutesAgo(1), archivedAt: "2026-01-01" }
    ];
    const archived = Object.fromEntries(archiveCompletedLocally(entries).map(({ id, archivedAt }) => [id, archivedAt]));
    expect(["c0", "c1", "c2", "c3", "c4"].every((id) => archived[id] === null)).toBe(true);
    expect(archived.c5).not.toBeNull();
    expect(archived.viejo).not.toBeNull();
    expect(archived.pendiente).toBeNull();
  });
});
