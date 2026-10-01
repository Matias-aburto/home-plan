import { ApiError, api } from "../api/client";
import { enqueueOperation, getPendingOperations, removeOperation, type QueuedOperation } from "../offline";

// Eventos de la app para avisar que hay datos nuevos en el servidor.
export const syncEvents = {
  // La cola terminó de enviarse (detail: { familyIds, listIds, calendarIds }).
  synced: "casa:synced",
  // Cambió el número de operaciones pendientes (detail: número).
  pending: "casa:pending",
  // Ably avisó cambios en las listas o calendarios del usuario (detail: { listId?, calendarId? }).
  meChanged: "casa:me-changed",
  // Ably avisó cambios en un grupo: nombre o miembros (detail: { familyId }).
  familyChanged: "casa:family-changed",
  // Se recuperó la conexión: todo lo visible debe recargarse.
  resync: "casa:resync",
  // Se descartaron cambios que el servidor rechazó de forma permanente (detail: cantidad).
  dropped: "casa:dropped"
} as const;

export type SyncedDetail = { familyIds: string[]; listIds: string[]; calendarIds: string[] };
export type Mutation = Omit<QueuedOperation, "id" | "createdAt">;

function emit(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function emitPending() {
  emit(syncEvents.pending, (await getPendingOperations()).length);
}

let flushing: Promise<void> | null = null;
let lastResult: "drained" | "stopped" = "drained";

// Rechazos que no se arreglan reintentando: el recurso ya no existe, no hay permiso o los datos
// no son válidos. Se descartan para no bloquear la cola y se avisa al usuario.
const permanentStatuses = new Set([400, 403, 404, 409, 410, 422]);

// Envía la cola en orden, de a una operación y volviendo a leerla cada vez para incluir las que se
// agregan mientras tanto. Sin red, con 401 (sesión vencida), 429 o errores del servidor se detiene
// sin alterar el orden, para reintentar después.
export function flushQueue() {
  // La referencia se limpia en .finally: si se hiciera dentro de la función, una pasada que termina
  // sin esperar nada (por ejemplo, sin conexión) la limpiaría antes de asignarla y quedaría pegada.
  flushing ??= runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function runFlush() {
  const familyIds = new Set<string>();
  const listIds = new Set<string>();
  const calendarIds = new Set<string>();
  let dropped = 0;
  lastResult = "stopped";
  try {
    while (navigator.onLine) {
      const [operation] = await getPendingOperations();
      if (!operation) {
        lastResult = "drained";
        break;
      }
      try {
        await api(operation.url, {
          method: operation.method,
          body: operation.body ? JSON.stringify(operation.body) : undefined
        });
      } catch (error) {
        if (!(error instanceof ApiError && permanentStatuses.has(error.status))) break;
        // 404 suele ser algo que otra persona ya borró: no vale la pena avisar.
        if (error.status !== 404) dropped += 1;
      }
      await removeOperation(operation.id);
      if (operation.familyId) familyIds.add(operation.familyId);
      if (operation.listId) listIds.add(operation.listId);
      if (operation.calendarId) calendarIds.add(operation.calendarId);
      await emitPending();
    }
  } finally {
    await emitPending();
    if (dropped) emit(syncEvents.dropped, dropped);
    // Lo enviado (o descartado) se recarga desde el servidor para reemplazar lo optimista.
    if (familyIds.size || listIds.size || calendarIds.size) {
      emit(syncEvents.synced, {
        familyIds: [...familyIds], listIds: [...listIds], calendarIds: [...calendarIds]
      } satisfies SyncedDetail);
    }
  }
}

export async function mutate(operation: Mutation) {
  const queued = await enqueueOperation(operation);
  await emitPending();
  await flushQueue();
  // Si se agregó justo cuando una pasada anterior terminaba, se envía en una pasada nueva.
  if (lastResult === "drained" && (await getPendingOperations()).some(({ id }) => id === queued.id)) {
    await flushQueue();
  }
}

export async function hasPendingFor(filter: { familyId?: string; listId?: string; calendarId?: string }) {
  return (await getPendingOperations()).some((operation) =>
    (filter.familyId !== undefined && operation.familyId === filter.familyId)
    || (filter.listId !== undefined && operation.listId === filter.listId)
    || (filter.calendarId !== undefined && operation.calendarId === filter.calendarId)
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
