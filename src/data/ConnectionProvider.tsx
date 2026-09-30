import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Realtime } from "ably";
import { api } from "../api/client";
import { getPendingOperations } from "../offline";
import type { User } from "../types";
import { emitSyncEvent, flushQueue, onSyncEvent, syncEvents } from "./sync";

type Connection = { online: boolean; connected: boolean; pendingCount: number };

const Context = createContext<Connection>({ online: true, connected: false, pendingCount: 0 });

// Mantiene la cola offline enviándose y escucha a Ably. Ably solo avisa qué cambió;
// cada vista vuelve a pedir sus datos a la API al recibir el evento correspondiente.
export function ConnectionProvider({ user, familyId, children }: { user: User; familyId: string; children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [connected, setConnected] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

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
    void getPendingOperations().then((operations) => setPendingCount(operations.length));
    void flushQueue();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      offPending();
    };
  }, []);

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
      const tokenUrl = `/api/realtime/token${familyId ? `?family=${encodeURIComponent(familyId)}` : ""}`;
      client = new Ably.Realtime({ authUrl: tokenUrl });
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
      if (familyId) {
        void client.channels.get(`family:${familyId.toUpperCase()}`).subscribe("family:changed", () => {
          emitSyncEvent(syncEvents.familyChanged);
        });
      }
    }

    const onOnline = () => void start();
    window.addEventListener("online", onOnline);
    void start();
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      client?.close();
    };
  }, [user.id, familyId]);

  const value = useMemo(() => ({ online, connected, pendingCount }), [online, connected, pendingCount]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useConnection() {
  return useContext(Context);
}
