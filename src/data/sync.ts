import { ApiError, api } from "../api/client";
import { enqueueOperation, getPendingOperations, removeOperation, type QueuedOperation } from "../offline";

// Eventos de la app para avisar que hay datos nuevos en el servidor.
export const syncEvents = {
  // La cola terminó de enviarse (detail: { familyIds, listIds }).
  synced: "casa:synced",
  // Cambió el número de operaciones pendientes (detail: número).
  pending: "casa:pending",
  // Ably avisó cambios del usuario (detail: { listId? }).
  meChanged: "casa:me-changed",
  // Ably avisó cambios de la familia antigua.
  familyChanged: "casa:family-changed",
  // Se recuperó la conexión: todo lo visible debe recargarse.
  resync: "casa:resync"
} as const;

export type SyncedDetail = { familyIds: string[]; listIds: string[] };
export type Mutation = Omit<QueuedOperation, "id" | "createdAt">;

function emit(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function emitPending() {
  emit(syncEvents.pending, (await getPendingOperations()).length);
}

let flushing: Promise<void> | null = null;

// Envía la cola en orden. Un 404 descarta la operación (el recurso ya no existe o no hay acceso);
// cualquier otro error detiene el envío para reintentar después sin alterar el orden.
export function flushQueue() {
  flushing ??= (async () => {
    const familyIds = new Set<string>();
    const listIds = new Set<string>();
    try {
      if (!navigator.onLine) return;
      for (const operation of await getPendingOperations()) {
        try {
          await api(operation.url, {
            method: operation.method,
            body: operation.body ? JSON.stringify(operation.body) : undefined
          });
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) break;
        }
        await removeOperation(operation.id);
        if (operation.familyId) familyIds.add(operation.familyId);
        if (operation.listId) listIds.add(operation.listId);
        await emitPending();
      }
    } finally {
      flushing = null;
      await emitPending();
      if (familyIds.size || listIds.size) {
        emit(syncEvents.synced, { familyIds: [...familyIds], listIds: [...listIds] } satisfies SyncedDetail);
      }
    }
  })();
  return flushing;
}

export async function mutate(operation: Mutation) {
  await enqueueOperation(operation);
  await emitPending();
  await flushQueue();
}

export async function hasPendingFor(filter: { familyId?: string; listId?: string }) {
  return (await getPendingOperations()).some((operation) =>
    (filter.familyId !== undefined && operation.familyId === filter.familyId)
    || (filter.listId !== undefined && operation.listId === filter.listId)
  );
}

export function onSyncEvent<T>(name: string, handler: (detail: T) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<T>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

export function emitSyncEvent(name: string, detail?: unknown) {
  emit(name, detail);
}
