import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { api } from "../api/client";
import { CalendarSection } from "../calendar/CalendarSection";
import { Loading } from "../components/Loading";
import { hasPendingFor, mutate, onSyncEvent, syncEvents, type SyncedDetail } from "../data/sync";
import { cacheFamily, getCachedFamily } from "../offline";
import type { CalendarEntry, OfflineMutation } from "../types";

type CachedCalendar = { id: string; entries: CalendarEntry[] };

export function FamilyCalendarRoute() {
  const { familyId = "" } = useParams();
  return <FamilyCalendarPage key={familyId} familyId={familyId} />;
}

function FamilyCalendarPage({ familyId }: { familyId: string }) {
  const [entries, setEntries] = useState<CalendarEntry[] | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const cacheId = `calendar:${familyId}`;

  const load = useCallback(async () => {
    if (await hasPendingFor({ familyId })) return;
    try {
      const fresh = await api<CalendarEntry[]>(`/api/families/${familyId}/calendar`);
      setEntries(fresh);
      await cacheFamily({ id: cacheId, entries: fresh } satisfies CachedCalendar);
    } catch {
      if (!entriesRef.current) setEntries([]);
    }
  }, [familyId, cacheId]);

  useEffect(() => {
    void getCachedFamily<CachedCalendar>(cacheId).then((cached) => {
      if (cached && !entriesRef.current) setEntries(cached.entries);
    });
    void load();
  }, [cacheId, load]);

  useEffect(() => {
    const offFamily = onSyncEvent<{ familyId?: string; calendar?: boolean }>(syncEvents.familyChanged, (data) => {
      if (data?.familyId === familyId && data.calendar) void load();
    });
    const offSynced = onSyncEvent<SyncedDetail>(syncEvents.synced, (data) => {
      if (data.familyIds.includes(familyId)) void load();
    });
    const offResync = onSyncEvent(syncEvents.resync, () => void load());
    return () => {
      offFamily();
      offSynced();
      offResync();
    };
  }, [familyId, load]);

  async function apply(next: CalendarEntry[], operation: OfflineMutation) {
    setEntries(next);
    await cacheFamily({ id: cacheId, entries: next } satisfies CachedCalendar);
    await mutate({ ...operation, familyId });
  }

  if (!entries) return <Loading />;
  return <CalendarSection familyId={familyId} entries={entries} onMutate={apply} />;
}
