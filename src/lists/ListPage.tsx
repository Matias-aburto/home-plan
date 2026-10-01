import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArchiveRestore, CircleAlert, Eye, Plus, Settings2, Share2 } from "lucide-react";
import { Link, useParams } from "react-router";
import { ApiError, api } from "../api/client";
import { EntryEditModal } from "../components/EntryEditModal";
import { Loading } from "../components/Loading";
import { SortableList } from "../components/SortableList";
import { useMe } from "../data/MeProvider";
import { hasPendingFor, mutate, onSyncEvent, syncEvents, type SyncedDetail } from "../data/sync";
import {
  archiveCompletedLocally,
  mergeVisibleOrder,
  nextListPosition,
  sortCompleted,
  sortPending,
  withPendingPositions
} from "../lib/listOrder";
import { capitalizeFirst } from "../lib/text";
import { cacheList, getCachedList, removeCachedList } from "../offline";
import type { ListDetail, ListItem, OfflineMutation, SortMode } from "../types";
import { ListItemRow } from "./ListItemRow";
import { ListSettingsModal } from "./ListSettingsModal";
import { ShareListModal } from "./ShareListModal";
import { ListIcon } from "./listStyle";

// La ruta monta una página nueva por lista para no arrastrar estado entre listas.
export function ListRoute() {
  const { listId = "" } = useParams();
  return <ListPage key={listId} listId={listId} />;
}

function ListPage({ listId }: { listId: string }) {
  const me = useMe();
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "offline">("loading");
  const detailRef = useRef(detail);
  detailRef.current = detail;

  const load = useCallback(async () => {
    if (await hasPendingFor({ listId })) return;
    try {
      const fresh = await api<ListDetail>(`/api/lists/${listId}`);
      setDetail(fresh);
      setStatus("ready");
      await cacheList(fresh);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setStatus("missing");
        await removeCachedList(listId);
        return;
      }
      if (!detailRef.current) setStatus("offline");
    }
  }, [listId]);

  useEffect(() => {
    void getCachedList<ListDetail>(listId).then((cached) => {
      if (cached && !detailRef.current) {
        setDetail(cached);
        setStatus("ready");
      }
    });
    void load();
  }, [listId, load]);

  useEffect(() => {
    const offMe = onSyncEvent<{ listId?: string; calendarId?: string }>(syncEvents.meChanged, (data) => {
      if ((!data?.listId && !data?.calendarId) || data.listId === listId) void load();
    });
    const offSynced = onSyncEvent<SyncedDetail>(syncEvents.synced, (data) => {
      if (data.listIds.includes(listId)) void load();
    });
    const offResync = onSyncEvent(syncEvents.resync, () => void load());
    return () => {
      offMe();
      offSynced();
      offResync();
    };
  }, [listId, load]);

  // La lista recién creada sin conexión aún no existe en el servidor: se arma desde el menú.
  const summary = me.lists.find((list) => list.id === listId);
  useEffect(() => {
    if (!detail && status === "offline" && summary) {
      setDetail({ list: summary, items: [], sharedWith: [] });
      setStatus("ready");
    }
  }, [detail, status, summary]);

  if (status === "missing" || (status === "offline" && !summary)) {
    return (
      <section className="content">
        <div className="empty-state animate-in">
          <div><CircleAlert size={28} /></div>
          <h3>{status === "missing" ? "No encontramos esta lista" : "Sin conexión"}</h3>
          <p>{status === "missing"
            ? "Puede que la hayan eliminado o que ya no tengas acceso."
            : "Necesitas conectarte una vez para ver esta lista sin internet."}</p>
          <Link className="secondary-button empty-state-action" to="/">Volver al inicio</Link>
        </div>
      </section>
    );
  }
  if (!detail) return <Loading />;

  // El menú (MeProvider) tiene los cambios de nombre, color o archivado más recientes.
  const merged = summary ? { ...detail, list: { ...detail.list, ...summary, sort: detail.list.sort } } : detail;
  return <ListContent detail={merged} onDetailChange={setDetail} onReload={load} />;
}

function ListContent({
  detail,
  onDetailChange,
  onReload
}: {
  detail: ListDetail;
  onDetailChange: (detail: ListDetail) => void;
  onReload: () => Promise<void>;
}) {
  const { list, items } = detail;
  const me = useMe();
  const readOnly = list.access === "viewer";
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<ListItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const sharedCount = (detail.sharedWith ?? []).length;

  const visibleItems = useMemo(() => items.filter((item) => !item.archivedAt), [items]);
  const pendingItems = useMemo(
    () => sortPending(visibleItems.filter((item) => !item.completed), list.sort, (item) => item.title),
    [visibleItems, list.sort]
  );
  const completedItems = useMemo(
    () => sortCompleted(visibleItems.filter((item) => item.completed)),
    [visibleItems]
  );

  async function apply(nextItems: ListItem[], operation: OfflineMutation) {
    const next = { ...detail, items: nextItems };
    onDetailChange(next);
    me.patchListLocally(list.id, { pendingCount: nextItems.filter((item) => !item.completed).length });
    await cacheList(next);
    await mutate({ ...operation, listId: list.id });
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const now = new Date().toISOString();
      const item: ListItem = {
        id: crypto.randomUUID(),
        title: capitalizeFirst(title),
        completed: false,
        position: nextListPosition(items),
        createdBy: list.ownerUserId,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null
      };
      await apply([item, ...items], {
        url: `/api/lists/${list.id}/items`,
        method: "POST",
        body: { id: item.id, title: item.title }
      });
      setTitle("");
    } finally {
      setAdding(false);
    }
  }

  async function toggleItem(item: ListItem) {
    const completed = !item.completed;
    const now = new Date().toISOString();
    await apply(archiveCompletedLocally(items.map((candidate) =>
      candidate.id === item.id
        ? { ...candidate, completed, updatedAt: now, completedAt: completed ? now : null, archivedAt: null }
        : candidate
    )), { url: `/api/lists/${list.id}/items/${item.id}`, method: "PATCH", body: { completed } });
  }

  async function deleteItem(item: ListItem) {
    await apply(items.filter(({ id }) => id !== item.id), {
      url: `/api/lists/${list.id}/items/${item.id}`,
      method: "DELETE"
    });
  }

  async function editItem(item: ListItem, nextTitle: string) {
    const formatted = capitalizeFirst(nextTitle);
    await apply(items.map((candidate) =>
      candidate.id === item.id ? { ...candidate, title: formatted, updatedAt: new Date().toISOString() } : candidate
    ), {
      url: `/api/lists/${list.id}/items/${item.id}`,
      method: "PATCH",
      body: { title: formatted }
    });
    setEditingItem(null);
  }

  async function changeSort(sort: SortMode) {
    const next = { ...detail, list: { ...list, sort } };
    onDetailChange(next);
    me.patchListLocally(list.id, { sort });
    await cacheList(next);
    await mutate({ url: `/api/lists/${list.id}/prefs`, method: "PUT", body: { sort }, listId: list.id });
  }

  async function reorderItems(visibleIds: string[]) {
    const allPending = sortPending(items.filter((item) => !item.completed && !item.archivedAt), list.sort, (item) => item.title);
    if (list.sort !== "custom") await changeSort("custom");
    const merged = mergeVisibleOrder(allPending, visibleIds);
    await apply(withPendingPositions(items, merged), {
      url: `/api/lists/${list.id}/items/reorder`,
      method: "POST",
      body: { ids: merged.map((item) => item.id) }
    });
  }

  const row = (item: ListItem, dragHandle?: ReactNode) => (
    <ListItemRow
      key={item.id}
      item={item}
      readOnly={readOnly}
      dragHandle={dragHandle}
      onToggle={toggleItem}
      onEdit={setEditingItem}
      onDelete={deleteItem}
    />
  );

  return (
    <>
      <section className="content">
        <div className="content-heading">
          <div className="title-only list-title">
            <ListIcon icon={list.icon} color={list.color} size={20} />
            <h2>{list.name}</h2>
          </div>
          <div className="list-heading-actions">
            <span>{pendingItems.length} {pendingItems.length === 1 ? "pendiente" : "pendientes"}</span>
            {(list.access === "owner" || sharedCount > 0) && (
              <button className="share-list-button" onClick={() => setShareOpen(true)} aria-label="Compartir lista">
                <Share2 size={16} />
                <span>{sharedCount ? `Compartida · ${sharedCount}` : "Compartir"}</span>
              </button>
            )}
            <button className="manage-locations-button" onClick={() => setSettingsOpen(true)} aria-label="Ajustes de la lista">
              <Settings2 size={17} />
            </button>
          </div>
        </div>

        {readOnly && (
          <div className="archived-banner read-only-banner">
            <span><Eye size={15} /> Solo lectura: puedes ver la lista pero no modificarla.</span>
          </div>
        )}

        {list.archivedAt && (
          <div className="archived-banner">
            <span>Esta lista está archivada.</span>
            {list.access === "owner" && (
              <button onClick={() => me.updateList(list.id, { archived: false })}>
                <ArchiveRestore size={16} /> Restaurar
              </button>
            )}
          </div>
        )}

        {!readOnly && (
          <form className="add-item-form" onSubmit={addItem}>
            <div className="add-item-fields">
              <div className="item-input-wrap">
                <Plus size={20} />
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Agregar un ítem"
                  aria-label="Agregar un ítem"
                  maxLength={100}
                />
              </div>
              <button className="add-button" disabled={adding || !title.trim()}>
                <Plus size={19} /><span>Agregar</span>
              </button>
            </div>
          </form>
        )}

        <div className="shopping-list">
          {pendingItems.length === 0 && completedItems.length === 0 ? (
            <div className="empty-state animate-in">
              <div><ListIcon icon={list.icon} color={list.color} size={26} /></div>
              <h3>La lista está vacía</h3>
              <p>{readOnly ? "Todavía no hay nada en esta lista." : "Agrega el primer ítem para comenzar."}</p>
            </div>
          ) : (
            <>
              {readOnly ? (
                pendingItems.map((item) => row(item))
              ) : (
                <SortableList items={pendingItems} onReorder={reorderItems} renderItem={(item, dragHandle) => row(item, dragHandle)} />
              )}
              {completedItems.length > 0 && (
                <div className="completed-section">
                  <h3>Listos · {completedItems.length}</h3>
                  {completedItems.map((item) => row(item))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {editingItem && (
        <EntryEditModal
          title="Editar ítem"
          value={editingItem.title}
          onSave={(value) => editItem(editingItem, value)}
          onClose={() => setEditingItem(null)}
        />
      )}
      {shareOpen && (
        <ShareListModal detail={detail} onChanged={onReload} onClose={() => setShareOpen(false)} />
      )}
      {settingsOpen && (
        <ListSettingsModal
          detail={detail}
          onSortChange={changeSort}
          onChanged={onReload}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
