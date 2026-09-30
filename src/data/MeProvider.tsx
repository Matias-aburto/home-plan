import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { cacheMeta, getCachedMeta, getPendingOperations } from "../offline";
import type { FamilySummary, Invitation, ListKind, ListSummary, Me, User } from "../types";
import { mutate, onSyncEvent, syncEvents } from "./sync";

export type NewListInput = { name: string; kind: ListKind; icon: string; color: string };
type ListChanges = Partial<Pick<ListSummary, "name" | "icon" | "color">> & { archived?: boolean };

type MeContext = {
  lists: ListSummary[];
  families: FamilySummary[];
  invitations: Invitation[];
  loaded: boolean;
  // Responder desde la bandeja requiere conexión.
  respondInvitation: (invitationId: string, action: "accept" | "decline") => Promise<Invitation>;
  refresh: () => Promise<void>;
  // Requieren conexión: el servidor crea el id de la familia o valida el código.
  createFamily: (name: string) => Promise<FamilySummary>;
  claimFamily: (code: string) => Promise<FamilySummary>;
  createList: (input: NewListInput, familyId?: string | null) => Promise<string>;
  updateList: (listId: string, changes: ListChanges) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  reorderLists: (ids: string[]) => Promise<void>;
  // Actualiza solo en este dispositivo (por ejemplo, el contador de pendientes tras editar ítems).
  patchListLocally: (listId: string, changes: Partial<ListSummary>) => void;
};

const Context = createContext<MeContext | null>(null);
const cacheKey = "me";

export function MeProvider({ user, children }: { user: User; children: ReactNode }) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const familiesRef = useRef(families);
  familiesRef.current = families;

  const invitationsRef = useRef(invitations);
  invitationsRef.current = invitations;

  const store = useCallback((
    next: ListSummary[],
    nextFamilies = familiesRef.current,
    nextInvitations = invitationsRef.current
  ) => {
    setLists(next);
    setFamilies(nextFamilies);
    setInvitations(nextInvitations);
    familiesRef.current = nextFamilies;
    invitationsRef.current = nextInvitations;
    void cacheMeta(cacheKey, { user, families: nextFamilies, lists: next, invitations: nextInvitations } satisfies Me);
  }, [user]);

  // No pisa cambios locales que todavía no llegan al servidor.
  const refresh = useCallback(async () => {
    if ((await getPendingOperations()).length > 0) return;
    try {
      const me = await api<Me>("/api/me");
      store(me.lists, me.families, me.invitations);
    } catch {
      // Sin conexión se mantiene lo que había.
    } finally {
      setLoaded(true);
    }
  }, [store]);

  useEffect(() => {
    void getCachedMeta<Me>(cacheKey).then((cached) => {
      if (cached && cached.user.id === user.id) {
        setLists(cached.lists);
        setFamilies(cached.families ?? []);
        setInvitations(cached.invitations ?? []);
        setLoaded(true);
      }
    });
    void refresh();
  }, [refresh, user.id]);

  useEffect(() => {
    const offMe = onSyncEvent(syncEvents.meChanged, () => void refresh());
    const offFamily = onSyncEvent<{ calendar?: boolean }>(syncEvents.familyChanged, (data) => {
      if (!data?.calendar) void refresh();
    });
    const offSynced = onSyncEvent(syncEvents.synced, () => void refresh());
    const offResync = onSyncEvent(syncEvents.resync, () => void refresh());
    return () => {
      offMe();
      offFamily();
      offSynced();
      offResync();
    };
  }, [refresh]);

  const forceRefresh = useCallback(async () => {
    const me = await api<Me>("/api/me");
    store(me.lists, me.families, me.invitations);
  }, [store]);

  const respondInvitation = useCallback(async (invitationId: string, action: "accept" | "decline") => {
    try {
      return await api<Invitation>(`/api/invitations/${invitationId}/${action}`, { method: "POST" });
    } finally {
      await forceRefresh().catch(() => undefined);
    }
  }, [forceRefresh]);

  const createFamily = useCallback(async (name: string) => {
    const family = await api<FamilySummary>("/api/families", { method: "POST", body: JSON.stringify({ name }) });
    await forceRefresh();
    return family;
  }, [forceRefresh]);

  const claimFamily = useCallback(async (code: string) => {
    const family = await api<FamilySummary>("/api/families/claim", { method: "POST", body: JSON.stringify({ code }) });
    await forceRefresh();
    return family;
  }, [forceRefresh]);

  const createList = useCallback(async (input: NewListInput, familyId: string | null = null) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = listsRef.current.reduce((max, list) => Math.max(max, list.position + 1), 0);
    const role = familyId ? familiesRef.current.find((family) => family.id === familyId)?.role : null;
    store([...listsRef.current, {
      id, ownerUserId: familyId ? null : user.id, familyId, ...input, createdBy: user.id, createdAt: now, updatedAt: now,
      archivedAt: null, access: !familyId || role === "owner" || role === "admin" ? "owner" : "editor",
      position, sort: "custom", pendingCount: 0
    }]);
    await mutate({ url: "/api/lists", method: "POST", body: { id, ...input, familyId }, listId: id });
    return id;
  }, [store, user.id]);

  const updateList = useCallback(async (listId: string, changes: ListChanges) => {
    const { archived, ...fields } = changes;
    store(listsRef.current.map((list) => list.id === listId
      ? {
          ...list,
          ...fields,
          archivedAt: archived === undefined ? list.archivedAt : archived ? list.archivedAt || new Date().toISOString() : null
        }
      : list));
    await mutate({ url: `/api/lists/${listId}`, method: "PATCH", body: changes, listId });
  }, [store]);

  const deleteList = useCallback(async (listId: string) => {
    store(listsRef.current.filter((list) => list.id !== listId));
    await mutate({ url: `/api/lists/${listId}`, method: "DELETE", listId });
  }, [store]);

  const reorderLists = useCallback(async (ids: string[]) => {
    const positions = new Map(ids.map((id, index) => [id, index]));
    store([...listsRef.current]
      .map((list) => positions.has(list.id) ? { ...list, position: positions.get(list.id)! } : list)
      .sort((a, b) => a.position - b.position));
    await mutate({ url: "/api/me/list-order", method: "PUT", body: { ids } });
  }, [store]);

  const patchListLocally = useCallback((listId: string, changes: Partial<ListSummary>) => {
    store(listsRef.current.map((list) => list.id === listId ? { ...list, ...changes } : list));
  }, [store]);

  const value = useMemo(
    () => ({
      lists, families, invitations, loaded, refresh, respondInvitation, createFamily, claimFamily,
      createList, updateList, deleteList, reorderLists, patchListLocally
    }),
    [
      lists, families, invitations, loaded, refresh, respondInvitation, createFamily, claimFamily,
      createList, updateList, deleteList, reorderLists, patchListLocally
    ]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMe() {
  const context = useContext(Context);
  if (!context) throw new Error("useMe debe usarse dentro de MeProvider");
  return context;
}
