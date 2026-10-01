import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { cacheMeta, getCachedMeta, getPendingOperations } from "../offline";
import type { FamilySummary, Invitation, ListSummary, Me, User } from "../types";
import { mutate, onSyncEvent, syncEvents } from "./sync";

// Lo que se elige al crear una lista.
export type AppearanceInput = { name: string; icon: string; color: string };
type Changes = Partial<AppearanceInput> & { archived?: boolean };

type MeContext = {
  lists: ListSummary[];
  spaceColors: Record<string, string>;
  families: FamilySummary[];
  invitations: Invitation[];
  loaded: boolean;
  // Responder desde la bandeja requiere conexión.
  respondInvitation: (invitationId: string, action: "accept" | "decline") => Promise<Invitation>;
  refresh: () => Promise<void>;
  // Requiere conexión: el servidor crea el id de la familia.
  createFamily: (name: string) => Promise<FamilySummary>;
  createList: (input: AppearanceInput, familyId?: string | null) => Promise<string>;
  updateList: (listId: string, changes: Changes) => Promise<void>;
  deleteList: (listId: string) => Promise<void>;
  reorderLists: (ids: string[]) => Promise<void>;
  // Color con que veo un espacio ("personal" o id del grupo) en el calendario.
  setSpaceColor: (space: string, color: string) => Promise<void>;
  // Actualiza solo en este dispositivo (por ejemplo, el contador de pendientes tras editar ítems).
  patchListLocally: (listId: string, changes: Partial<ListSummary>) => void;
};

const Context = createContext<MeContext | null>(null);
const cacheKey = "me";

export function MeProvider({ user, children }: { user: User; children: ReactNode }) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [spaceColors, setSpaceColors] = useState<Record<string, string>>({});
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const spaceColorsRef = useRef(spaceColors);
  spaceColorsRef.current = spaceColors;
  const familiesRef = useRef(families);
  familiesRef.current = families;

  const invitationsRef = useRef(invitations);
  invitationsRef.current = invitations;

  const store = useCallback((changes: Partial<Omit<Me, "user">>) => {
    const next = {
      lists: changes.lists ?? listsRef.current,
      spaceColors: changes.spaceColors ?? spaceColorsRef.current,
      families: changes.families ?? familiesRef.current,
      invitations: changes.invitations ?? invitationsRef.current
    };
    setLists(next.lists);
    setSpaceColors(next.spaceColors);
    setFamilies(next.families);
    setInvitations(next.invitations);
    listsRef.current = next.lists;
    spaceColorsRef.current = next.spaceColors;
    familiesRef.current = next.families;
    invitationsRef.current = next.invitations;
    void cacheMeta(cacheKey, { user, ...next } satisfies Me);
  }, [user]);

  // No pisa cambios locales que todavía no llegan al servidor.
  const refresh = useCallback(async () => {
    if ((await getPendingOperations()).length > 0) return;
    try {
      store(await api<Me>("/api/me"));
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
        setSpaceColors(cached.spaceColors ?? {});
        setFamilies(cached.families ?? []);
        setInvitations(cached.invitations ?? []);
        setLoaded(true);
      }
    });
    void refresh();
  }, [refresh, user.id]);

  useEffect(() => {
    const offMe = onSyncEvent(syncEvents.meChanged, () => void refresh());
    const offFamily = onSyncEvent(syncEvents.familyChanged, () => void refresh());
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
    store(await api<Me>("/api/me"));
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

  const createList = useCallback(async (input: AppearanceInput, familyId: string | null = null) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const position = listsRef.current.reduce((max, list) => Math.max(max, list.position + 1), 0);
    const role = familyId ? familiesRef.current.find((family) => family.id === familyId)?.role : null;
    store({ lists: [...listsRef.current, {
      id, ownerUserId: familyId ? null : user.id, familyId, ...input, createdBy: user.id, createdAt: now, updatedAt: now,
      archivedAt: null, access: !familyId || role === "owner" || role === "admin" ? "owner" : "editor",
      position, sort: "custom", pendingCount: 0
    }] });
    await mutate({ url: "/api/lists", method: "POST", body: { id, ...input, familyId }, listId: id });
    return id;
  }, [store, user.id]);

  const updateList = useCallback(async (listId: string, changes: Changes) => {
    const { archived, ...fields } = changes;
    store({ lists: listsRef.current.map((list) => list.id === listId
      ? { ...list, ...fields, archivedAt: archivedAt(list.archivedAt, archived) }
      : list) });
    await mutate({ url: `/api/lists/${listId}`, method: "PATCH", body: changes, listId });
  }, [store]);

  const deleteList = useCallback(async (listId: string) => {
    store({ lists: listsRef.current.filter((list) => list.id !== listId) });
    await mutate({ url: `/api/lists/${listId}`, method: "DELETE", listId });
  }, [store]);

  const reorderLists = useCallback(async (ids: string[]) => {
    const positions = new Map(ids.map((id, index) => [id, index]));
    store({ lists: [...listsRef.current]
      .map((list) => positions.has(list.id) ? { ...list, position: positions.get(list.id)! } : list)
      .sort((a, b) => a.position - b.position) });
    await mutate({ url: "/api/me/list-order", method: "PUT", body: { ids } });
  }, [store]);

  const patchListLocally = useCallback((listId: string, changes: Partial<ListSummary>) => {
    store({ lists: listsRef.current.map((list) => list.id === listId ? { ...list, ...changes } : list) });
  }, [store]);

  const setSpaceColor = useCallback(async (space: string, color: string) => {
    store({ spaceColors: { ...spaceColorsRef.current, [space]: color } });
    await mutate({ url: "/api/me/space-colors", method: "PUT", body: { space, color } });
  }, [store]);

  const value = useMemo(
    () => ({
      lists, spaceColors, families, invitations, loaded, refresh, respondInvitation, createFamily,
      createList, updateList, deleteList, reorderLists, patchListLocally, setSpaceColor
    }),
    [
      lists, spaceColors, families, invitations, loaded, refresh, respondInvitation, createFamily,
      createList, updateList, deleteList, reorderLists, patchListLocally, setSpaceColor
    ]
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

// Fecha de archivado tras un cambio: se conserva la que había si ya estaba archivado.
function archivedAt(current: string | null, archived: boolean | undefined) {
  if (archived === undefined) return current;
  return archived ? current || new Date().toISOString() : null;
}

export function useMe() {
  const context = useContext(Context);
  if (!context) throw new Error("useMe debe usarse dentro de MeProvider");
  return context;
}
