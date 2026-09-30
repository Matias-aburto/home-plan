import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, House, MapPin, Plus, Settings2, ShoppingBasket } from "lucide-react";
import { api } from "../api/client";
import { EntryEditModal } from "../components/EntryEditModal";
import { SortableList } from "../components/SortableList";
import {
  archiveCompletedLocally,
  mergeVisibleOrder,
  nextListPosition,
  sortCompleted,
  sortPending,
  withPendingPositions
} from "../lib/listOrder";
import { capitalizeFirst } from "../lib/text";
import type { Family, OfflineMutation, ShoppingItem, SortMode, Suggestion } from "../types";
import { ShoppingRow } from "./ShoppingRow";

export function ShoppingSection({
  family,
  hidden,
  sortMode,
  onSortChange,
  onMutate,
  onManageLocations
}: {
  family: Family;
  hidden: boolean;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onMutate: (family: Family, operation: OfflineMutation) => Promise<void>;
  onManageLocations: () => void;
}) {
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState(() => localStorage.getItem(`location:${family.id}`) || "");
  const [filter, setFilter] = useState("all");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const visibleItems = useMemo(
    () => family.items.filter((item) =>
      !item.archivedAt && (filter === "all" || (filter === "none" ? !item.locationId : item.locationId === filter))
    ),
    [family.items, filter]
  );
  const pendingItems = useMemo(
    () => sortPending(visibleItems.filter((item) => !item.completed), sortMode, (item) => item.name),
    [visibleItems, sortMode]
  );
  const completedItems = useMemo(
    () => sortCompleted(visibleItems.filter((item) => item.completed)),
    [visibleItems]
  );
  const selectedLocation = family.locations.find(({ id }) => id === locationId);

  useEffect(() => {
    if (name.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<Suggestion[]>(`/api/families/${family.id}/suggestions?q=${encodeURIComponent(name)}`, {
        signal: controller.signal
      })
        .then(setSuggestions)
        .catch((requestError) => {
          if ((requestError as Error).name !== "AbortError") setSuggestions([]);
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [family.id, name]);

  useEffect(() => setActiveSuggestion(-1), [suggestions]);

  useEffect(() => {
    if (locationId && !family.locations.some(({ id }) => id === locationId)) {
      setLocationId("");
      localStorage.removeItem(`location:${family.id}`);
    }
    if (filter !== "all" && filter !== "none" && !family.locations.some(({ id }) => id === filter)) {
      setFilter("all");
    }
  }, [family.id, family.locations, filter, locationId]);

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      const now = new Date().toISOString();
      const formattedName = capitalizeFirst(name);
      const item: ShoppingItem = {
        id: crypto.randomUUID(),
        name: formattedName,
        locationId: locationId || null,
        completed: false,
        position: nextListPosition(family.items),
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null
      };
      await onMutate({ ...family, items: [item, ...family.items] }, {
        url: `/api/families/${family.id}/items`,
        method: "POST",
        body: { id: item.id, name: item.name, locationId: item.locationId }
      });
      setName("");
      setSuggestions([]);
      setSuggestionsOpen(false);
      if (locationId) localStorage.setItem(`location:${family.id}`, locationId);
    } finally {
      setAdding(false);
    }
  }

  async function toggleItem(item: ShoppingItem) {
    const completed = !item.completed;
    const now = new Date().toISOString();
    const items = archiveCompletedLocally(family.items.map((candidate) =>
      candidate.id === item.id
        ? { ...candidate, completed, updatedAt: now, completedAt: completed ? now : null, archivedAt: null }
        : candidate
    ));
    await onMutate({ ...family, items }, {
      url: `/api/families/${family.id}/items/${item.id}`,
      method: "PATCH",
      body: { completed }
    });
  }

  async function deleteItem(item: ShoppingItem) {
    await onMutate({ ...family, items: family.items.filter(({ id }) => id !== item.id) }, {
      url: `/api/families/${family.id}/items/${item.id}`,
      method: "DELETE"
    });
  }

  async function editItem(item: ShoppingItem, title: string, nextLocationId: string | null) {
    const name = capitalizeFirst(title);
    const updatedAt = new Date().toISOString();
    await onMutate({
      ...family,
      items: family.items.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, name, locationId: nextLocationId, updatedAt }
          : candidate
      )
    }, {
      url: `/api/families/${family.id}/items/${item.id}`,
      method: "PATCH",
      body: { name, locationId: nextLocationId }
    });
    setEditingItem(null);
  }

  async function reorderItems(visibleIds: string[]) {
    const allPending = sortPending(
      family.items.filter((item) => !item.completed && !item.archivedAt),
      sortMode,
      (item) => item.name
    );
    onSortChange("custom");
    const merged = mergeVisibleOrder(allPending, visibleIds);
    await onMutate({ ...family, items: withPendingPositions(family.items, merged) }, {
      url: `/api/families/${family.id}/items/reorder`,
      method: "POST",
      body: { ids: merged.map((item) => item.id) }
    });
  }

  function selectSuggestion(suggestion: Suggestion) {
    setName(suggestion.name);
    setSuggestionsOpen(false);
  }

  return (
    <>
      <section className={`content ${hidden ? "section-hidden" : ""}`}>
        <div className="content-heading">
          <div className="title-only">
            <h2>Lista de compras</h2>
          </div>
          <span>{pendingItems.length} {pendingItems.length === 1 ? "pendiente" : "pendientes"}</span>
        </div>

        <form className="add-item-form" onSubmit={addItem}>
          <div className="add-item-fields">
            <button className="mobile-location-button" type="button" onClick={() => setChoosingLocation(true)}>
              <MapPin size={15} />
              <span>{selectedLocation?.name || "General"}</span>
            </button>
            <div className="item-input-wrap">
              <Plus size={20} />
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
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
                placeholder="Agregar un producto"
                aria-label="Producto"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestionsOpen && suggestions.length > 0}
                maxLength={80}
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
            <button className="add-button" disabled={adding || !name.trim()}>
              <Plus size={19} /><span>Agregar</span>
            </button>
          </div>
          <div className="location-picker">
            <span>Para</span>
            <button type="button" className={!locationId ? "selected" : ""} onClick={() => setLocationId("")}>
              General
            </button>
            {family.locations.map((location) => (
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
        </form>

        <div className="list-toolbar">
          <div className="filter-chips">
            <button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Todos</button>
            {family.locations.map((location) => (
              <button
                key={location.id}
                className={filter === location.id ? "selected" : ""}
                onClick={() => setFilter(location.id)}
              >
                {location.name}
              </button>
            ))}
            <button className={filter === "none" ? "selected" : ""} onClick={() => setFilter("none")}>General</button>
          </div>
          <button className="manage-locations-button" onClick={onManageLocations} aria-label="Ajustes de la lista">
            <Settings2 size={17} />
          </button>
        </div>

        <div className="shopping-list">
          {pendingItems.length === 0 && completedItems.length === 0 ? (
            <div className="empty-state animate-in">
              <div><ShoppingBasket size={28} /></div>
              <h3>Tu lista está vacía</h3>
              <p>Agrega el primer producto para comenzar.</p>
            </div>
          ) : (
            <>
              <SortableList
                items={pendingItems}
                onReorder={reorderItems}
                renderItem={(item, dragHandle) => (
                  <ShoppingRow
                    item={item}
                    locations={family.locations}
                    dragHandle={dragHandle}
                    onToggle={toggleItem}
                    onEdit={setEditingItem}
                    onDelete={deleteItem}
                  />
                )}
              />
              {completedItems.length > 0 && (
                <div className="completed-section">
                  <h3>Comprados · {completedItems.length}</h3>
                  {completedItems.map((item) => (
                    <ShoppingRow key={item.id} item={item} locations={family.locations} onToggle={toggleItem} onEdit={setEditingItem} onDelete={deleteItem} />
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
            <h2>¿Para dónde?</h2>
            <button
              className={!locationId ? "selected" : ""}
              onClick={() => {
                setLocationId("");
                setChoosingLocation(false);
              }}
            >
              <House size={19} />
              <span><strong>General</strong><small>Sirve para cualquier ubicación</small></span>
              {!locationId && <Check size={18} />}
            </button>
            {family.locations.map((location) => (
              <button
                key={location.id}
                className={locationId === location.id ? "selected" : ""}
                onClick={() => {
                  setLocationId(location.id);
                  localStorage.setItem(`location:${family.id}`, location.id);
                  setChoosingLocation(false);
                }}
              >
                <MapPin size={19} />
                <span><strong>{location.name}</strong></span>
                {locationId === location.id && <Check size={18} />}
              </button>
            ))}
          </section>
        </div>
      )}
      {editingItem && (
        <EntryEditModal
          title="Editar producto"
          value={editingItem.name}
          locationId={editingItem.locationId}
          locations={family.locations}
          onSave={(value, nextLocationId) => editItem(editingItem, value, nextLocationId)}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}
