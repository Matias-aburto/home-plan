import { openDB, type DBSchema } from "idb";

export type QueuedOperation = {
  id: string;
  familyId: string;
  url: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  createdAt: string;
};

interface HomePlanDatabase extends DBSchema {
  families: {
    key: string;
    value: { id: string; data: unknown; cachedAt: string };
  };
  outbox: {
    key: string;
    value: QueuedOperation;
    indexes: { familyId: string };
  };
}

const database = openDB<HomePlanDatabase>("casa-offline", 1, {
  upgrade(db) {
    db.createObjectStore("families", { keyPath: "id" });
    const outbox = db.createObjectStore("outbox", { keyPath: "id" });
    outbox.createIndex("familyId", "familyId");
  }
});

export async function cacheFamily<T extends { id: string }>(family: T) {
  await (await database).put("families", {
    id: family.id,
    data: family,
    cachedAt: new Date().toISOString()
  });
}

export async function getCachedFamily<T>(familyId: string) {
  const cached = await (await database).get("families", familyId.toUpperCase());
  return cached?.data as T | undefined;
}

export async function enqueueOperation(
  operation: Omit<QueuedOperation, "id" | "createdAt">
) {
  const queued: QueuedOperation = {
    ...operation,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  await (await database).put("outbox", queued);
  return queued;
}

export async function removeOperation(id: string) {
  await (await database).delete("outbox", id);
}

export async function getPendingOperations(familyId?: string) {
  const db = await database;
  const operations = familyId
    ? await db.getAllFromIndex("outbox", "familyId", familyId.toUpperCase())
    : await db.getAll("outbox");
  return operations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
