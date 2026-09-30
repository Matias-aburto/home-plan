import { openDB, type DBSchema } from "idb";

export type QueuedOperation = {
  id: string;
  url: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  // Qué hay que recargar cuando la operación se envía.
  familyId?: string;
  listId?: string;
  createdAt: string;
  // Orden estricto de encolado: dos cambios pueden caer en el mismo milisegundo.
  seq?: number;
};

interface HomePlanDatabase extends DBSchema {
  families: {
    key: string;
    value: { id: string; data: unknown; cachedAt: string };
  };
  lists: {
    key: string;
    value: { id: string; data: unknown; cachedAt: string };
  };
  meta: {
    key: string;
    value: { id: string; data: unknown; cachedAt: string };
  };
  outbox: {
    key: string;
    value: QueuedOperation;
    indexes: { familyId: string };
  };
}

const database = openDB<HomePlanDatabase>("casa-offline", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore("families", { keyPath: "id" });
      const outbox = db.createObjectStore("outbox", { keyPath: "id" });
      outbox.createIndex("familyId", "familyId");
    }
    if (oldVersion < 2) {
      db.createObjectStore("lists", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "id" });
    }
  }
});

type CacheStore = "families" | "lists" | "meta";

async function cachePut(store: CacheStore, id: string, data: unknown) {
  await (await database).put(store, { id, data, cachedAt: new Date().toISOString() });
}

async function cacheGet<T>(store: CacheStore, id: string) {
  return (await (await database).get(store, id))?.data as T | undefined;
}

export async function cacheFamily<T extends { id: string }>(family: T) {
  await cachePut("families", family.id, family);
}

export async function getCachedFamily<T>(id: string) {
  return cacheGet<T>("families", id);
}

export async function cacheList<T extends { list: { id: string } }>(detail: T) {
  await cachePut("lists", detail.list.id, detail);
}

export async function getCachedList<T>(listId: string) {
  return cacheGet<T>("lists", listId);
}

export async function removeCachedList(listId: string) {
  await (await database).delete("lists", listId);
}

export async function cacheMeta(id: string, data: unknown) {
  await cachePut("meta", id, data);
}

export async function getCachedMeta<T>(id: string) {
  return cacheGet<T>("meta", id);
}

let lastSeq = 0;

export async function enqueueOperation(operation: Omit<QueuedOperation, "id" | "createdAt" | "seq">) {
  // Creciente aunque se llame varias veces en el mismo milisegundo o se recargue la página.
  lastSeq = Math.max(lastSeq + 1, Date.now() * 1000);
  const queued: QueuedOperation = {
    ...operation,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    seq: lastSeq
  };
  await (await database).put("outbox", queued);
  return queued;
}

export async function removeOperation(id: string) {
  await (await database).delete("outbox", id);
}

// Al cerrar sesión no deben quedar datos ni cambios pendientes en el dispositivo.
export async function clearOfflineData() {
  const db = await database;
  await Promise.all([db.clear("families"), db.clear("lists"), db.clear("meta"), db.clear("outbox")]);
}

export async function getPendingOperations() {
  const operations = await (await database).getAll("outbox");
  return operations.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.createdAt.localeCompare(b.createdAt));
}
