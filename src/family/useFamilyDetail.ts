import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../api/client";
import { onSyncEvent, syncEvents } from "../data/sync";
import { cacheFamily, getCachedFamily } from "../offline";
import type { FamilyDetail } from "../types";

// Miembros de un grupo, con caché para usar sin conexión.
export function useFamilyDetail(familyId: string | null) {
  const [detail, setDetail] = useState<FamilyDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!familyId) return;
    try {
      const fresh = await api<FamilyDetail>(`/api/families/${familyId}`);
      setDetail(fresh);
      setMissing(false);
      await cacheFamily({ id: `detail:${familyId}`, ...fresh });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setMissing(true);
    }
  }, [familyId]);

  useEffect(() => {
    setDetail(null);
    setMissing(false);
    if (!familyId) return;
    void getCachedFamily<FamilyDetail>(`detail:${familyId}`).then((cached) => {
      if (cached) setDetail((current) => current ?? cached);
    });
    void load();
  }, [familyId, load]);

  useEffect(() => {
    const offFamily = onSyncEvent<{ familyId?: string }>(syncEvents.familyChanged, (data) => {
      if (data?.familyId === familyId) void load();
    });
    const offResync = onSyncEvent(syncEvents.resync, () => void load());
    return () => {
      offFamily();
      offResync();
    };
  }, [familyId, load]);

  return { detail, missing, reload: load };
}
