import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Realtime } from "ably";
import { api } from "../api/client";
import { getPendingOperations } from "../offline";
import type { User } from "../types";
import { emitSyncEvent, flushQueue, onSyncEvent, syncEvents } from "./sync";

type Connection = {
  online: boolean;
  connected: boolean;
  // Si ya hubo conexión alguna vez en esta sesión ("Reconectando" en vez de "Conectando").
  everConnected: boolean;
  pendingCount: number;
  // Aviso para el usuario sobre cambios que no se pudieron guardar.
  notice: string;
  dismissNotice: () => void;
};

const Context = createContext<Connection>({
  online: true, connected: false, everConnected: false, pendingCount: 0, notice: "", dismissNotice: () => undefined
});

export const noticeKey = "casa:notice";
const retryIntervalMs = 30_000;

// Mantiene la cola offline enviándose y escucha a Ably. Ably solo avisa qué cambió;
// cada vista vuelve a pedir sus datos a la API al recibir el evento correspondiente.
export function ConnectionProvider({ user, familyIds, children }: { user: User; familyIds: string[]; children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  useEffect(() => {
    if (connected) setEverConnected(true);
  }, [connected]);
  const [pendingCount, setPendingCount] = useState(0);
  const [notice, setNotice] = useState(() => sessionStorage.getItem(noticeKey) || "");
  const pendingRef = useRef(pendingCount);
  pendingRef.current = pendingCount;

  const dismissNotice = useCallback(() => {
    sessionStorage.removeItem(noticeKey);
    setNotice("");
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => {
      setOnline(false);
      setConnected(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const offPending = onSyncEvent<number>(syncEvents.pending, setPendingCount);
    const offDropped = onSyncEvent<number>(syncEvents.dropped, (count) => {
      setNotice(count === 1
        ? "Un cambio no se pudo guardar: ya no tienes permiso o los datos cambiaron."
        : `${count} cambios no se pudieron guardar: ya no tienes permiso o los datos cambiaron.`);
    });
    // Si el servidor falló, se reintenta cada cierto tiempo mientras queden cambios pendientes.
    const retry = window.setInterval(() => {
      if (navigator.onLine && pendingRef.current > 0) void flushQueue();
    }, retryIntervalMs);
    void getPendingOperations().then((operations) => setPendingCount(operations.length));
    void flushQueue();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      offPending();
      offDropped();
      window.clearInterval(retry);
    };
  }, []);

  // El token incluye los canales de las familias actuales: si cambian, se reconecta.
  const familyKey = familyIds.join(",");

  useEffect(() => {
    let client: Realtime | null = null;
    let started = false;
    let cancelled = false;

    async function start() {
      if (started || cancelled) return;
      let enabled: boolean;
      try {
        enabled = (await api<{ realtime?: boolean }>("/api/health")).realtime !== false;
      } catch {
        return;
      }
      if (started || cancelled) return;
      started = true;
      if (!enabled) {
        setConnected(true);
        return;
      }
      const Ably = await import("ably");
      if (cancelled) return;
      client = new Ably.Realtime({ authUrl: "/api/realtime/token" });
      let firstConnection = true;
      client.connection.on((change) => {
        const isConnected = change.current === "connected";
        setConnected(isConnected);
        if (!isConnected) return;
        // Al reconectar pudieron perderse avisos: se envía la cola y se recarga todo lo visible.
        void flushQueue().then(() => {
          if (!firstConnection) emitSyncEvent(syncEvents.resync);
          firstConnection = false;
        });
      });
      void client.channels.get(`user:${user.id}`).subscribe("me:changed", (message) => {
        emitSyncEvent(syncEvents.meChanged, message.data ?? {});
      });
      for (const familyId of familyKey ? familyKey.split(",") : []) {
        void client.channels.get(`family:${familyId}`).subscribe("family:changed", (message) => {
          const data = (message.data ?? {}) as { listId?: string; calendarId?: string };
          // Con listId o calendarId es un cambio en una lista o un calendario; sin ellos, del grupo (miembros, nombre).
          if (data.listId || data.calendarId) emitSyncEvent(syncEvents.meChanged, data);
          else emitSyncEvent(syncEvents.familyChanged, { familyId });
        });
      }
    }

    // Sin tiempo real no hay cliente de Ably que avise la reconexión: basta con volver a tener red.
    const onOnline = () => {
      if (started && !client) setConnected(true);
      else void start();
    };
    window.addEventListener("online", onOnline);
    void start();
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      client?.close();
    };
  }, [user.id, familyKey]);

  const value = useMemo(
    () => ({ online, connected, everConnected, pendingCount, notice, dismissNotice }),
    [online, connected, everConnected, pendingCount, notice, dismissNotice]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnection() {
  return useContext(Context);
}
