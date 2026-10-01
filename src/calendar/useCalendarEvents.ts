import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { hasPendingFor, mutate, onSyncEvent, syncEvents, type SyncedDetail } from "../data/sync";
import { cacheMeta, getCachedMeta } from "../offline";
import type { CalendarEvent, OfflineMutation } from "../types";

const cacheId = "calendar";
// Marca de las operaciones del calendario en la cola offline.
export const calendarQueueKey = "calendar";

// Todos los eventos del usuario (personales y de sus grupos), con caché para usar sin conexión.
export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const load = useCallback(async () => {
    // No pisa eventos que todavía no llegan al servidor.
    if (await hasPendingFor({ calendarId: calendarQueueKey })) return;
    try {
      const fresh = (await api<{ events: CalendarEvent[] }>("/api/calendar")).events;
      setEvents(fresh);
      await cacheMeta(cacheId, fresh);
    } catch {
      if (!eventsRef.current) setEvents([]);
    }
  }, []);

  useEffect(() => {
    void getCachedMeta<CalendarEvent[]>(cacheId).then((cached) => {
      if (cached && !eventsRef.current) setEvents(cached);
    });
    void load();
  }, [load]);

  useEffect(() => {
    // Cambios del calendario, o de grupos (al salir de uno dejan de verse sus eventos).
    const offMe = onSyncEvent<{ listId?: string }>(syncEvents.meChanged, (data) => {
      if (!data?.listId) void load();
    });
    const offFamily = onSyncEvent(syncEvents.familyChanged, () => void load());
    const offSynced = onSyncEvent<SyncedDetail>(syncEvents.synced, (data) => {
      if (data.calendarIds?.length || data.familyIds?.length) void load();
    });
    const offResync = onSyncEvent(syncEvents.resync, () => void load());
    return () => {
      offMe();
      offFamily();
      offSynced();
      offResync();
    };
  }, [load]);

  // Aplica el cambio en pantalla y lo encola para el servidor.
  const apply = useCallback(async (next: CalendarEvent[], operation: OfflineMutation) => {
    setEvents(next);
    await cacheMeta(cacheId, next);
    await mutate({ ...operation, calendarId: calendarQueueKey });
  }, []);

  return { events, apply };
}
