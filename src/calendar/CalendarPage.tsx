import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Link, useParams } from "react-router";
import { ApiError, api } from "../api/client";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { hasPendingFor, mutate, onSyncEvent, syncEvents, type SyncedDetail } from "../data/sync";
import { cacheMeta, getCachedMeta } from "../offline";
import type { CalendarDetail, CalendarEntry, OfflineMutation } from "../types";
import { CalendarSection } from "./CalendarSection";
import { CalendarSettingsModal } from "./CalendarSettingsModal";

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

  // El calendario recién creado sin conexión aún no existe en el servidor: se arma desde el menú.
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
            ? "Puede que lo hayan eliminado o que ya no tengas acceso."
            : "Necesitas conectarte una vez para ver este calendario sin internet."}</p>
          <Link className="secondary-button empty-state-action" to="/">Volver al inicio</Link>
        </div>
      </section>
    );
  }
  if (!detail) return <Loading />;

  // El menú (MeProvider) tiene los cambios de nombre, color o archivado más recientes.
  const calendar = summary ? { ...detail.calendar, ...summary } : detail.calendar;

  async function apply(events: CalendarEntry[], operation: OfflineMutation) {
    const next = { calendar, events };
    setDetail(next);
    await cacheMeta(cacheId, next);
    await mutate({ ...operation, calendarId });
  }

  return (
    <>
      <CalendarSection
        calendar={calendar}
        entries={detail.events}
        onMutate={apply}
        onOpenSettings={() => setSettingsOpen(true)}
        onRestore={() => void me.updateCalendar(calendarId, { archived: false })}
      />
      {settingsOpen && (
        <CalendarSettingsModal calendar={calendar} eventCount={detail.events.length} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
