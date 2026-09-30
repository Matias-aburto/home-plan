import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArchiveRestore, Check, CircleAlert, House, MapPin, Plus, Settings2, UserRound, Users } from "lucide-react";
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
import type { ListDetail, ListItem, ListKind, OfflineMutation, SortMode, Suggestion } from "../types";
import { ListItemRow } from "./ListItemRow";
import { ListSettingsModal } from "./ListSettingsModal";
import { ListIcon } from "./listStyle";

const copy: Record<ListKind, {
  placeholder: string;
  complete: string;
  completedTitle: string;
  emptyTitle: string;
  emptyText: string;
}> = {
  shopping: {
    placeholder: "Agregar un producto",
    complete: "Marcar comprado",
    completedTitle: "Comprados",
    emptyTitle: "Tu lista está vacía",
    emptyText: "Agrega el primer producto para comenzar."
  },
  tasks: {
    placeholder: "Agregar una tarea",
    complete: "Marcar completada",
    completedTitle: "Completadas",
    emptyTitle: "No hay tareas por aquí",
    emptyText: "Agrega lo primero que haya que hacer."
  },
  checklist: {
    placeholder: "Agregar un ítem",
    complete: "Marcar listo",
    completedTitle: "Listos",
    emptyTitle: "Checklist vacía",
    emptyText: "Agrega el primer ítem para comenzar."
  }
};

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
    const offMe = onSyncEvent<{ listId?: string }>(syncEvents.meChanged, (data) => {
      if (!data?.listId || data.listId === listId) void load();
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
      setDetail({ list: summary, items: [], locations: [], members: [] });
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
  const { list, items, locations } = detail;
  const members = detail.members ?? [];
  const me = useMe();
  const text = copy[list.kind];
  const readOnly = list.access === "viewer";
  const usesLocations = list.kind !== "checklist";
  // Las tareas de una familia se pueden asignar a sus miembros; ahí los filtros son por responsable.
  const usesAssignees = list.kind === "tasks" && Boolean(list.familyId) && members.length > 0;
  const locationKey = `location:list:${list.id}`;
  const [title, setTitle] = useState("");
  const [locationId, setLocationId] = useState(() => localStorage.getItem(locationKey) || "");
  const [assigneeId, setAssigneeId] = useState("");
  const [filter, setFilter] = useState("all");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [editingItem, setEditingItem] = useState<ListItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const visibleItems = useMemo(
    () => items.filter((item) => {
      if (item.archivedAt) return false;
      if (filter === "all") return true;
      const value = usesAssignees ? item.assigneeUserId : item.locationId;
      return filter === "none" ? !value : value === filter;
    }),
    [items, filter, usesAssignees]
  );
  const pendingItems = useMemo(
    () => sortPending(visibleItems.filter((item) => !item.completed), list.sort, (item) => item.title),
    [visibleItems, list.sort]
  );
  const completedItems = useMemo(
    () => sortCompleted(visibleItems.filter((item) => item.completed)),
    [visibleItems]
  );
  const selectedLocation = locations.find(({ id }) => id === locationId);
  const selectedAssignee = members.find(({ userId }) => userId === assigneeId);
  const assigneeName = (item: ListItem) =>
    members.find(({ userId }) => userId === item.assigneeUserId)?.name ?? item.legacyAssignee;

  useEffect(() => {
    if (list.kind !== "shopping" || title.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<Suggestion[]>(`/api/lists/${list.id}/suggestions?q=${encodeURIComponent(title)}`, { signal: controller.signal })
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [list.id, list.kind, title]);

  useEffect(() => setActiveSuggestion(-1), [suggestions]);

  useEffect(() => {
    if (locationId && !locations.some(({ id }) => id === locationId)) {
      setLocationId("");
      localStorage.removeItem(locationKey);
    }
    if (assigneeId && !members.some(({ userId }) => userId === assigneeId)) setAssigneeId("");
    const options = usesAssignees ? members.map(({ userId }) => userId) : locations.map(({ id }) => id);
    if (filter !== "all" && filter !== "none" && !options.includes(filter)) setFilter("all");
  }, [locations, members, usesAssignees, filter, locationId, assigneeId, locationKey]);

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
        locationId: usesLocations ? locationId || null : null,
        assigneeUserId: usesAssignees ? assigneeId || null : null,
        legacyAssignee: null,
        createdBy: list.ownerUserId,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null
      };
      await apply([item, ...items], {
        url: `/api/lists/${list.id}/items`,
        method: "POST",
        body: { id: item.id, title: item.title, locationId: item.locationId, assigneeUserId: item.assigneeUserId }
      });
      setTitle("");
      setSuggestions([]);
      setSuggestionsOpen(false);
      if (locationId) localStorage.setItem(locationKey, locationId);
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

  // nextAssignee undefined: no se tocó el responsable (se conserva, incluido el del modelo anterior).
  async function editItem(item: ListItem, nextTitle: string, nextLocationId: string | null, nextAssignee?: string | null) {
    const formatted = capitalizeFirst(nextTitle);
    const locationValue = usesLocations ? nextLocationId : null;
    const assigneeChanged = usesAssignees && nextAssignee !== undefined;
    await apply(items.map((candidate) =>
      candidate.id === item.id
        ? {
            ...candidate,
            title: formatted,
            locationId: locationValue,
            ...(assigneeChanged ? { assigneeUserId: nextAssignee ?? null, legacyAssignee: null } : {}),
            updatedAt: new Date().toISOString()
          }
        : candidate
    ), {
      url: `/api/lists/${list.id}/items/${item.id}`,
      method: "PATCH",
      body: { title: formatted, locationId: locationValue, ...(assigneeChanged ? { assigneeUserId: nextAssignee } : {}) }
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

  function selectSuggestion(suggestion: Suggestion) {
    setTitle(suggestion.name);
    setSuggestionsOpen(false);
  }

  return (
    <>
      <section className="content">
        <div className="content-heading">
          <div className="title-only list-title">
            <ListIcon icon={list.icon} color={list.color} size={20} />
            <h2>{list.name}</h2>
          </div>
          <span>{pendingItems.length} {pendingItems.length === 1 ? "pendiente" : "pendientes"}</span>
        </div>

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
              {usesLocations && (
                <button className="mobile-location-button" type="button" onClick={() => setChoosingLocation(true)}>
                  {usesAssignees ? <Settings2 size={15} /> : <MapPin size={15} />}
                  <span>
                    {usesAssignees
                      ? selectedAssignee?.name || selectedLocation?.name || "Detalles"
                      : selectedLocation?.name || "General"}
                  </span>
                </button>
              )}
              <div className="item-input-wrap">
                <Plus size={20} />
                <input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setSuggestionsOpen(true);
                  }}
                  onFocus={() => setSuggestionsOpen(true)}
                  onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
                  onKeyDown={(event) => {
                    if (!suggestionsOpen || suggestions.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveSuggestion((current) => Math.max(current - 1, 0));
                    } else if (event.key === "Enter" && activeSuggestion >= 0) {
                      event.preventDefault();
                      selectSuggestion(suggestions[activeSuggestion]);
                    } else if (event.key === "Escape") {
                      setSuggestionsOpen(false);
                    }
                  }}
                  placeholder={text.placeholder}
                  aria-label={text.placeholder}
                  role={list.kind === "shopping" ? "combobox" : undefined}
                  aria-autocomplete={list.kind === "shopping" ? "list" : undefined}
                  aria-expanded={list.kind === "shopping" ? suggestionsOpen && suggestions.length > 0 : undefined}
                  maxLength={100}
                />
                {suggestionsOpen && suggestions.length > 0 && (
                  <div className="suggestions-menu" role="listbox">
                    {suggestions.map((suggestion, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestion}
                        className={index === activeSuggestion ? "active" : ""}
                        key={suggestion.name}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectSuggestion(suggestion)}
                      >
                        <span>{suggestion.name}</span>
                        <small>{suggestion.category}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="add-button" disabled={adding || !title.trim()}>
                <Plus size={19} /><span>Agregar</span>
              </button>
            </div>
            {usesAssignees && (
              <div className="location-picker">
                <span>Asignar a</span>
                <button type="button" className={!assigneeId ? "selected" : ""} onClick={() => setAssigneeId("")}>
                  Sin asignar
                </button>
                {members.map((member) => (
                  <button
                    type="button"
                    key={member.userId}
                    className={assigneeId === member.userId ? "selected" : ""}
                    onClick={() => setAssigneeId(member.userId)}
                  >
                    <UserRound size={13} /> {member.name}
                  </button>
                ))}
              </div>
            )}
            {usesLocations && locations.length > 0 && (
              <div className="location-picker">
                <span>{list.kind === "shopping" ? "Para" : "En"}</span>
                <button type="button" className={!locationId ? "selected" : ""} onClick={() => setLocationId("")}>
                  General
                </button>
                {locations.map((location) => (
                  <button
                    type="button"
                    key={location.id}
                    className={locationId === location.id ? "selected" : ""}
                    onClick={() => setLocationId(location.id)}
                  >
                    <MapPin size={13} /> {location.name}
                  </button>
                ))}
              </div>
            )}
          </form>
        )}

        <div className="list-toolbar">
          <div className="filter-chips">
            {usesAssignees && (
              <>
                <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button>
                {members.map((member) => (
                  <button
                    key={member.userId}
                    className={filter === member.userId ? "selected" : ""}
                    onClick={() => setFilter(member.userId)}
                  >
                    {member.name}
                  </button>
                ))}
                <button className={filter === "none" ? "selected" : ""} onClick={() => setFilter("none")}>Sin asignar</button>
              </>
            )}
            {!usesAssignees && usesLocations && locations.length > 0 && (
              <>
                <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button>
                {locations.map((location) => (
                  <button
                    key={location.id}
                    className={filter === location.id ? "selected" : ""}
                    onClick={() => setFilter(location.id)}
                  >
                    {location.name}
                  </button>
                ))}
                <button className={filter === "none" ? "selected" : ""} onClick={() => setFilter("none")}>General</button>
              </>
            )}
          </div>
          <button className="manage-locations-button" onClick={() => setSettingsOpen(true)} aria-label="Ajustes de la lista">
            <Settings2 size={17} />
          </button>
        </div>

        <div className="shopping-list">
          {pendingItems.length === 0 && completedItems.length === 0 ? (
            <div className="empty-state animate-in">
              <div><ListIcon icon={list.icon} color={list.color} size={26} /></div>
              <h3>{text.emptyTitle}</h3>
              <p>{readOnly ? "Todavía no hay nada en esta lista." : text.emptyText}</p>
            </div>
          ) : (
            <>
              {readOnly ? (
                pendingItems.map((item) => (
                  <ListItemRow key={item.id} item={item} locations={locations} assigneeName={assigneeName(item)} completeLabel={text.complete} readOnly onToggle={toggleItem} onEdit={setEditingItem} onDelete={deleteItem} />
                ))
              ) : (
                <SortableList
                  items={pendingItems}
                  onReorder={reorderItems}
                  renderItem={(item, dragHandle) => (
                    <ListItemRow
                      item={item}
                      locations={locations}
                      assigneeName={assigneeName(item)}
                      completeLabel={text.complete}
                      dragHandle={dragHandle}
                      onToggle={toggleItem}
                      onEdit={setEditingItem}
                      onDelete={deleteItem}
                    />
                  )}
                />
              )}
              {completedItems.length > 0 && (
                <div className="completed-section">
                  <h3>{text.completedTitle} · {completedItems.length}</h3>
                  {completedItems.map((item) => (
                    <ListItemRow
                      key={item.id}
                      item={item}
                      locations={locations}
                      assigneeName={assigneeName(item)}
                      completeLabel={text.complete}
                      readOnly={readOnly}
                      onToggle={toggleItem}
                      onEdit={setEditingItem}
                      onDelete={deleteItem}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {choosingLocation && (
        <div className="location-sheet-backdrop" onMouseDown={() => setChoosingLocation(false)}>
          <section className="mobile-location-sheet animate-in" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <h2>{list.kind === "shopping" ? "¿Para dónde?" : "¿Dónde?"}</h2>
            <button
              className={!locationId ? "selected" : ""}
              onClick={() => {
                setLocationId("");
                setChoosingLocation(false);
              }}
            >
              <House size={19} />
              <span><strong>General</strong><small>Sin una ubicación específica</small></span>
              {!locationId && <Check size={18} />}
            </button>
            {locations.map((location) => (
              <button
                key={location.id}
                className={locationId === location.id ? "selected" : ""}
                onClick={() => {
                  setLocationId(location.id);
                  localStorage.setItem(locationKey, location.id);
                  setChoosingLocation(false);
                }}
              >
                <MapPin size={19} />
                <span><strong>{location.name}</strong></span>
                {locationId === location.id && <Check size={18} />}
              </button>
            ))}
            {!readOnly && (
              <button className="sheet-manage-button" onClick={() => {
                setChoosingLocation(false);
                setSettingsOpen(true);
              }}>
                <Settings2 size={19} />
                <span><strong>Administrar ubicaciones</strong></span>
              </button>
            )}
            {usesAssignees && (
              <>
                <h3>Asignar a</h3>
                <button className={!assigneeId ? "selected" : ""} onClick={() => setAssigneeId("")}>
                  <Users size={19} />
                  <span><strong>Sin asignar</strong><small>Cualquiera puede hacerla</small></span>
                  {!assigneeId && <Check size={18} />}
                </button>
                {members.map((member) => (
                  <button key={member.userId} className={assigneeId === member.userId ? "selected" : ""} onClick={() => setAssigneeId(member.userId)}>
                    <UserRound size={19} />
                    <span><strong>{member.name}</strong></span>
                    {assigneeId === member.userId && <Check size={18} />}
                  </button>
                ))}
                <button className="sheet-done-button" onClick={() => setChoosingLocation(false)}>Listo</button>
              </>
            )}
          </section>
        </div>
      )}
      {editingItem && (
        <EntryEditModal
          title="Editar ítem"
          value={editingItem.title}
          locationId={editingItem.locationId}
          assigneeId={editingItem.assigneeUserId}
          legacyAssignee={editingItem.legacyAssignee}
          locations={usesLocations ? locations : []}
          assignees={usesAssignees ? members : []}
          onSave={(value, nextLocationId, nextAssignee) => editItem(editingItem, value, nextLocationId, nextAssignee)}
          onClose={() => setEditingItem(null)}
        />
      )}
      {settingsOpen && (
        <ListSettingsModal
          detail={detail}
          onSortChange={changeSort}
          onLocationsChanged={onReload}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </>
  );
}
