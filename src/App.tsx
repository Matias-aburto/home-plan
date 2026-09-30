import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { LoginPage } from "./auth/LoginPage";
import { useSession } from "./auth/AuthProvider";
import type { Realtime } from "ably";
import { cacheFamily, enqueueOperation, getCachedFamily, getPendingOperations, removeOperation } from "./offline";
import { ApiError, api } from "./api/client";
import { IosInstallGuide } from "./components/IosInstallGuide";
import { Loading } from "./components/Loading";
import { FamilyHome } from "./family/FamilyHome";
import { useInstallApp } from "./hooks/useInstallApp";
import { initialFamilyId, normalizeFamily } from "./lib/family";
import { Onboarding } from "./onboarding/Onboarding";
import type { Family, OfflineMutation, User, View } from "./types";

export default function App() {
  const installApp = useInstallApp();
  const session = useSession();

  let screen;
  if (session.status === "loading") screen = <Loading />;
  else if (!session.user) {
    screen = <LoginPage canInstall={installApp.canInstall} onInstall={installApp.install} onSignedIn={session.signIn} />;
  } else {
    screen = <FamilyApp key={session.user.id} user={session.user} installApp={installApp} onLogout={session.logout} />;
  }

  return (
    <>
      {screen}
      {installApp.showGuide && <IosInstallGuide onClose={installApp.closeGuide} />}
    </>
  );
}

function FamilyApp({
  user,
  installApp,
  onLogout
}: {
  user: User;
  installApp: ReturnType<typeof useInstallApp>;
  onLogout: (everywhere?: boolean) => Promise<void>;
}) {
  const [family, setFamily] = useState<Family | null>(null);
  const [familyId, setFamilyId] = useState(initialFamilyId);
  const [view, setView] = useState<View>("welcome");
  const [loading, setLoading] = useState(Boolean(familyId));
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const navigate = useNavigate();
  // navigate cambia con cada navegación; la ref evita volver a cargar la familia por eso.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const syncQueue = useCallback(async () => {
    if (!familyId) return;
    const operations = await getPendingOperations(familyId);
    setPendingCount(operations.length);
    if (!navigator.onLine || operations.length === 0) return;

    for (const operation of operations) {
      try {
        await api(operation.url, {
          method: operation.method,
          body: operation.body ? JSON.stringify(operation.body) : undefined
        });
        await removeOperation(operation.id);
        setPendingCount((count) => Math.max(0, count - 1));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await removeOperation(operation.id);
          setPendingCount((count) => Math.max(0, count - 1));
          continue;
        }
        return;
      }
    }

    try {
      const freshFamily = normalizeFamily(await api<Family>(`/api/families/${familyId}`));
      setFamily(freshFamily);
      await cacheFamily(freshFamily);
    } catch {
      // La cola ya quedó enviada; se actualizará en la próxima reconexión.
    }
  }, [familyId]);

  const refreshFamily = useCallback(async () => {
    if (!familyId) return;
    if ((await getPendingOperations(familyId)).length > 0) return;
    try {
      const freshFamily = normalizeFamily(await api<Family>(`/api/families/${familyId}`));
      setFamily(freshFamily);
      await cacheFamily(freshFamily);
    } catch {
      // Se reintentará con el próximo aviso o reconexión.
    }
  }, [familyId]);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const onOffline = () => {
      setOnline(false);
      setConnected(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void syncQueue();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [syncQueue]);

  useEffect(() => {
    if (!familyId) return;
    let client: Realtime | null = null;
    let started = false;
    let cancelled = false;

    // Ably solo avisa que la familia cambió; los datos se vuelven a pedir a la API.
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
      client = new Ably.Realtime({ authUrl: `/api/families/${encodeURIComponent(familyId)}/realtime-token` });
      client.connection.on((change) => {
        const isConnected = change.current === "connected";
        setConnected(isConnected);
        if (isConnected) void syncQueue().then(refreshFamily);
      });
      void client.channels.get(`family:${familyId.toUpperCase()}`).subscribe("family:changed", () => {
        void refreshFamily();
      });
    }

    const onOnline = () => void start();
    window.addEventListener("online", onOnline);
    void start();
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      client?.close();
    };
  }, [familyId, syncQueue, refreshFamily]);

  useEffect(() => {
    if (!familyId) return;
    setLoading(true);
    api<Family>(`/api/families/${familyId}`)
      .then((nextFamily) => {
        const normalizedFamily = normalizeFamily(nextFamily);
        setFamily(normalizedFamily);
        void cacheFamily(normalizedFamily);
        setError("");
        localStorage.setItem("familyId", nextFamily.id);
        const params = new URLSearchParams(window.location.search);
        params.set("familia", nextFamily.id);
        navigateRef.current({ search: `?${params}` }, { replace: true });
      })
      .catch(async (requestError: Error) => {
        const cachedFamily = await getCachedFamily<Family>(familyId);
        if (cachedFamily) {
          setFamily(normalizeFamily(cachedFamily));
          setError("");
          return;
        }
        setError(navigator.onLine ? requestError.message : "Necesitas conectarte una vez antes de usar esta familia sin internet.");
        if (navigator.onLine) {
          localStorage.removeItem("familyId");
          setFamilyId("");
        }
      })
      .finally(() => setLoading(false));
  }, [familyId]);

  function enterFamily(nextFamily: Family) {
    const normalizedFamily = normalizeFamily(nextFamily);
    setFamily(normalizedFamily);
    setFamilyId(nextFamily.id);
    void cacheFamily(normalizedFamily);
  }

  async function mutateOffline(nextFamily: Family, operation: OfflineMutation) {
    setFamily(nextFamily);
    await cacheFamily(nextFamily);
    await enqueueOperation({ ...operation, familyId: nextFamily.id });
    setPendingCount((count) => count + 1);
    await syncQueue();
  }

  function leaveFamily() {
    setFamily(null);
    setFamilyId("");
    setView("welcome");
    localStorage.removeItem("familyId");
    navigate("/", { replace: true });
  }

  if (loading) return <Loading />;
  if (!family) {
    return (
      <Onboarding
        view={view}
        error={error}
        user={user}
        canInstall={installApp.canInstall}
        onInstall={installApp.install}
        onViewChange={(nextView) => {
          setError("");
          setView(nextView);
        }}
        onError={setError}
        onEnter={enterFamily}
        onLogout={onLogout}
      />
    );
  }

  return (
    <FamilyHome
      family={family}
      user={user}
      connected={connected}
      online={online}
      pendingCount={pendingCount}
      canInstall={installApp.canInstall}
      onInstall={installApp.install}
      onMutate={mutateOffline}
      onRefresh={refreshFamily}
      onLeave={leaveFamily}
      onLogout={onLogout}
    />
  );
}
