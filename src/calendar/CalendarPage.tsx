import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Settings2 } from "lucide-react";
import { Link, useParams } from "react-router";
import { ApiError, api } from "../api/client";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { hasPendingFor, mutate, onSyncEvent, syncEvents, type SyncedDetail } from "../data/sync";
import { ListIcon } from "../lists/listStyle";
import { cacheMeta, getCachedMeta } from "../offline";
import type { AgendaEntry, CalendarDetail, OfflineMutation } from "../types";
import { CalendarSection } from "./CalendarSection";
import { CalendarSettingsModal } from "./CalendarSettingsModal";
import { calendarOption, calendarSpaceName } from "./spaces";

// La ruta monta una página nueva por calendario para no arrastrar estado entre calendarios.
export function CalendarRoute() {
  const { calendarId = "" } = useParams();
  return <CalendarPage key={calendarId} calendarId={calendarId} />;
}

function CalendarPage({ calendarId }: { calendarId: string }) {
  const me = useMe();
  const [detail, setDetail] = useState<CalendarDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "offline">("loading");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const cacheId = `calendar:${calendarId}`;

  const load = useCallback(async () => {
    if (await hasPendingFor({ calendarId })) return;
    try {
      const fresh = await api<CalendarDetail>(`/api/calendars/${calendarId}`);
      setDetail(fresh);
      setStatus("ready");
      await cacheMeta(cacheId, fresh);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setStatus("missing");
        return;
      }
      if (!detailRef.current) setStatus("offline");
    }
  }, [calendarId, cacheId]);

  useEffect(() => {
    void getCachedMeta<CalendarDetail>(cacheId).then((cached) => {
      if (cached && !detailRef.current) {
        setDetail(cached);
        setStatus("ready");
      }
    });
    void load();
  }, [cacheId, load]);

  useEffect(() => {
    const offMe = onSyncEvent<{ listId?: string; calendarId?: string }>(syncEvents.meChanged, (data) => {
      if (data?.calendarId === calendarId || (!data?.calendarId && !data?.listId)) void load();
    });
    const offSynced = onSyncEvent<SyncedDetail>(syncEvents.synced, (data) => {
      if (data.calendarIds?.includes(calendarId)) void load();
    });
    const offResync = onSyncEvent(syncEvents.resync, () => void load());
    return () => {
      offMe();
      offSynced();
      offResync();
    };
  }, [calendarId, load]);

  // El calendario recién agregado sin conexión aún no existe en el servidor: se arma desde el menú.
  const summary = me.calendars.find((calendar) => calendar.id === calendarId);
  useEffect(() => {
    if (!detail && status === "offline" && summary) {
      setDetail({ calendar: summary, events: [] });
      setStatus("ready");
    }
  }, [detail, status, summary]);

  if (status === "missing" || (status === "offline" && !summary)) {
    return (
      <section className="content">
        <div className="empty-state animate-in">
          <div><CircleAlert size={28} /></div>
          <h3>{status === "missing" ? "No encontramos este calendario" : "Sin conexión"}</h3>
          <p>{status === "missing"
            ? "Puede que lo hayan quitado o que ya no tengas acceso."
            : "Necesitas conectarte una vez para ver este calendario sin internet."}</p>
          <Link className="secondary-button empty-state-action" to="/">Volver al inicio</Link>
        </div>
      </section>
    );
  }
  if (!detail) return <Loading />;

  // El menú (MeProvider) tiene el color más reciente.
  const calendar = summary ? { ...detail.calendar, ...summary } : detail.calendar;
  const spaceName = calendarSpaceName(calendar, me.families);
  const entries: AgendaEntry[] = detail.events.map((event) => ({ ...event, calendarId }));

  async function apply(events: AgendaEntry[], operation: OfflineMutation) {
    const next = { calendar, events };
    setDetail(next);
    await cacheMeta(cacheId, next);
    await mutate({ ...operation, calendarId });
  }

  return (
    <>
      <CalendarSection
        heading={(
          <div className="title-only list-title">
            <ListIcon icon="calendar" color={calendar.color} size={20} />
            <div>
              <span className="space-eyebrow">{spaceName}</span>
              <h2>Calendario</h2>
            </div>
          </div>
        )}
        actions={calendar.access === "owner" && (
          <button className="manage-locations-button" onClick={() => setSettingsOpen(true)} aria-label="Ajustes del calendario">
            <Settings2 size={17} />
          </button>
        )}
        calendars={[calendarOption(calendar, me.families)]}
        entries={entries}
        onMutate={apply}
      />
      {settingsOpen && (
        <CalendarSettingsModal
          calendar={calendar}
          spaceName={spaceName}
          eventCount={detail.events.length}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
