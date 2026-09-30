import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { hasPendingFor, mutate, onSyncEvent, syncEvents, type SyncedDetail } from "../data/sync";
import { initialFamilyId, normalizeFamily } from "../lib/family";
import { cacheFamily, getCachedFamily } from "../offline";
import type { Family, OfflineMutation } from "../types";

// Familia a la que se entra con código (modelo anterior a las familias con cuentas).
type LegacyFamilyContext = {
  familyId: string;
  family: Family | null;
  loading: boolean;
  error: string;
  enter: (family: Family) => void;
  leave: () => void;
  mutate: (family: Family, operation: OfflineMutation) => Promise<void>;
  refresh: () => Promise<void>;
};

const Context = createContext<LegacyFamilyContext | null>(null);

export function LegacyFamilyProvider({ children }: { children: ReactNode }) {
  const [familyId, setFamilyId] = useState(initialFamilyId);
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState(Boolean(familyId));
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!familyId || await hasPendingFor({ familyId })) return;
    try {
      const fresh = normalizeFamily(await api<Family>(`/api/families/${familyId}`));
      setFamily(fresh);
      await cacheFamily(fresh);
    } catch {
      // Se reintentará con el próximo aviso o reconexión.
    }
  }, [familyId]);

  useEffect(() => {
    if (!familyId) {
      setFamily(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api<Family>(`/api/families/${familyId}`)
      .then((nextFamily) => {
        const normalized = normalizeFamily(nextFamily);
        setFamily(normalized);
        void cacheFamily(normalized);
        setError("");
        localStorage.setItem("familyId", nextFamily.id);
      })
      .catch(async (requestError: Error) => {
        const cached = await getCachedFamily<Family>(familyId);
        if (cached) {
          setFamily(normalizeFamily(cached));
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

  useEffect(() => {
    const offChanged = onSyncEvent(syncEvents.familyChanged, () => void refresh());
    const offResync = onSyncEvent(syncEvents.resync, () => void refresh());
    const offSynced = onSyncEvent<SyncedDetail>(syncEvents.synced, (detail) => {
      if (detail.familyIds.includes(familyId)) void refresh();
    });
    return () => {
      offChanged();
      offResync();
      offSynced();
    };
  }, [familyId, refresh]);

  const enter = useCallback((nextFamily: Family) => {
    const normalized = normalizeFamily(nextFamily);
    setFamily(normalized);
    setFamilyId(nextFamily.id);
    setError("");
    void cacheFamily(normalized);
  }, []);

  const leave = useCallback(() => {
    setFamily(null);
    setFamilyId("");
    localStorage.removeItem("familyId");
  }, []);

  const mutateFamily = useCallback(async (nextFamily: Family, operation: OfflineMutation) => {
    setFamily(nextFamily);
    await cacheFamily(nextFamily);
    await mutate({ ...operation, familyId: nextFamily.id });
  }, []);

  const value = useMemo(
    () => ({ familyId, family, loading, error, enter, leave, mutate: mutateFamily, refresh }),
    [familyId, family, loading, error, enter, leave, mutateFamily, refresh]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLegacyFamily() {
  const context = useContext(Context);
  if (!context) throw new Error("useLegacyFamily debe usarse dentro de LegacyFamilyProvider");
  return context;
}
