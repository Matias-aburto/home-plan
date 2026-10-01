import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Link } from "react-router";
import { api } from "../api/client";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { mutate, onSyncEvent, syncEvents, type SyncedDetail } from "../data/sync";
import { cacheMeta, getCachedMeta, getPendingOperations } from "../offline";
import type { AgendaData, AgendaEntry, OfflineMutation } from "../types";
import { CalendarSection } from "./CalendarSection";
import { calendarOption, sortBySpace } from "./spaces";

const cacheId = "agenda";
const hiddenKey = "casa:agenda-hidden";

function readHidden() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(hiddenKey) || "[]"));
  } catch {
    return new Set<string>();
  }
}

// Todos mis calendarios juntos: el personal y los de mis grupos, cada uno con su color.
export function AgendaPage() {
  const me = useMe();
  const [events, setEvents] = useState<AgendaEntry[] | null>(null);
  const [hidden, setHidden] = useState(readHidden);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const load = useCallback(async () => {
    // No pisa eventos que todavía no llegan al servidor.
    if ((await getPendingOperations()).some((operation) => operation.calendarId)) return;
    try {
      const fresh = await api<AgendaData>("/api/calendars");
      setEvents(fresh.events);
      await cacheMeta(cacheId, fresh);
    } catch {
      if (!eventsRef.current) setEvents([]);
    }
  }, []);

  useEffect(() => {
    void getCachedMeta<AgendaData>(cacheId).then((cached) => {
      if (cached && !eventsRef.current) setEvents(cached.events);
    });
    void load();
  }, [load]);

  useEffect(() => {
    const offMe = onSyncEvent<{ listId?: string }>(syncEvents.meChanged, (data) => {
      if (!data?.listId) void load();
    });
    const offSynced = onSyncEvent<SyncedDetail>(syncEvents.synced, (data) => {
      if (data.calendarIds?.length) void load();
    });
    const offResync = onSyncEvent(syncEvents.resync, () => void load());
    return () => {
      offMe();
      offSynced();
      offResync();
    };
  }, [load]);

  // Si cambian los calendarios (se agrega o se quita uno), se recargan los eventos.
  const calendarKey = me.calendars.map(({ id }) => id).join(",");
  useEffect(() => {
    void load();
  }, [calendarKey, load]);

  const calendars = useMemo(() => sortBySpace(me.calendars, me.families), [me.calendars, me.families]);
  const options = calendars.map((calendar) => calendarOption(calendar, me.families));
  const visibleIds = new Set(options.filter(({ id }) => !hidden.has(id)).map(({ id }) => id));

  function toggle(calendarId: string) {
    const next = new Set(hidden);
    if (next.has(calendarId)) next.delete(calendarId);
    else next.add(calendarId);
    setHidden(next);
    try {
      localStorage.setItem(hiddenKey, JSON.stringify([...next]));
    } catch {
      // Sin almacenamiento, el filtro dura solo esta visita.
    }
  }

  if (calendars.length === 0) {
    return (
      <section className="content">
        <div className="content-heading">
          <div className="title-only"><h2>Agenda</h2></div>
        </div>
        <div className="empty-state animate-in">
          <div><CalendarRange size={28} /></div>
          <h3>Todavía no tienes calendarios</h3>
          <p>Agrega un calendario a lo personal o a un grupo. Aquí verás todos sus eventos juntos.</p>
          <Link className="secondary-button empty-state-action" to="/personal">Ir a Personal</Link>
        </div>
      </section>
    );
  }
  if (!events) return <Loading />;

  const known = new Set(options.map(({ id }) => id));
  const entries = events.filter((event) => known.has(event.calendarId) && visibleIds.has(event.calendarId));

  async function apply(next: AgendaEntry[], operation: OfflineMutation, calendarId: string) {
    // `next` solo trae lo visible: se conservan los eventos de los calendarios ocultos.
    const merged = [...(eventsRef.current ?? []).filter((event) => !visibleIds.has(event.calendarId)), ...next];
    setEvents(merged);
    await cacheMeta(cacheId, { calendars, events: merged } satisfies AgendaData);
    await mutate({ ...operation, calendarId });
  }

  return (
    <CalendarSection
      heading={(
        <div className="title-only list-title">
          <span className="list-icon list-color-neutral" aria-hidden="true"><CalendarRange size={20} /></span>
          <h2>Agenda</h2>
        </div>
      )}
      banner={options.length > 1 && (
        <div className="agenda-legend" role="group" aria-label="Calendarios visibles">
          {options.map((option) => (
            <button
              key={option.id}
              className={hidden.has(option.id) ? "off" : ""}
              onClick={() => toggle(option.id)}
              aria-pressed={!hidden.has(option.id)}
            >
              <i className={`chip-dot dot-${option.color}`} /> {option.label}
            </button>
          ))}
        </div>
      )}
      calendars={options.filter(({ id }) => visibleIds.has(id))}
      combined={options.length > 1}
      entries={entries}
      onMutate={apply}
    />
  );
}
