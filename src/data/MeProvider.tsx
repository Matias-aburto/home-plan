import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { cacheMeta, getCachedMeta, getPendingOperations } from "../offline";
import type { ListKind, ListSummary, Me, User } from "../types";
import { mutate, onSyncEvent, syncEvents } from "./sync";

export type NewListInput = { name: string; kind: ListKind; icon: string; color: string };
type ListChanges = Partial<Pick<ListSummary, "name" | "icon" | "color">> & { archived?: boolean };

type MeContext = {
  lists: ListSummary[];
  loaded: boolean;
  refresh: () => Promise<void>;
  createList: (input: NewListInput) => Promise<string>;
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
  const [loaded, setLoaded] = useState(false);
  const listsRef = useRef(lists);
  listsRef.current = lists;

  const store = useCallback((next: ListSummary[]) => {
    setLists(next);
    void cacheMeta(cacheKey, { user, lists: next } satisfies Me);
  }, [user]);

  // No pisa cambios locales que todavía no llegan al servidor.
  const refresh = useCallback(async () => {
    if ((await getPendingOperations()).length > 0) return;
    try {
      const me = await api<Me>("/api/me");
      store(me.lists);
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
        setLoaded(true);
      }
    });
    void refresh();
  }, [refresh, user.id]);

  useEffect(() => {
    const offMe = onSyncEvent(syncEvents.meChanged, () => void refresh());
    const offSynced = onSyncEvent(syncEvents.synced, () => void refresh());
    const offResync = onSyncEvent(syncEvents.resync, () => void refresh());
    return () => {
      offMe();
      offSynced();
      offResync();
    };
  }, [refresh]);

  const createList = useCallback(async (input: NewListInput) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = listsRef.current.reduce((max, list) => Math.max(max, list.position + 1), 0);
    store([...listsRef.current, {
      id, ownerUserId: user.id, familyId: null, ...input, createdBy: user.id, createdAt: now, updatedAt: now,
      archivedAt: null, access: "owner", position, sort: "custom", pendingCount: 0
    }]);
    await mutate({ url: "/api/lists", method: "POST", body: { id, ...input }, listId: id });
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
    () => ({ lists, loaded, refresh, createList, updateList, deleteList, reorderLists, patchListLocally }),
    [lists, loaded, refresh, createList, updateList, deleteList, reorderLists, patchListLocally]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMe() {
  const context = useContext(Context);
  if (!context) throw new Error("useMe debe usarse dentro de MeProvider");
  return context;
}
