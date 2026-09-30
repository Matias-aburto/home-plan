import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, MapPin, Plus, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { SortChips } from "../components/SortChips";
import { useMe } from "../data/MeProvider";
import type { ListDetail, Location, SortMode } from "../types";
import { ListAppearanceFields } from "./ListAppearanceFields";

export function ListSettingsModal({
  detail,
  onSortChange,
  onLocationsChanged,
  onClose
}: {
  detail: ListDetail;
  onSortChange: (mode: SortMode) => void;
  onLocationsChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { list } = detail;
  const { updateList, deleteList } = useMe();
  const navigate = useNavigate();
  const isOwner = list.access === "owner";
  const [name, setName] = useState(list.name);
  const [icon, setIcon] = useState(list.icon);
  const [color, setColor] = useState(list.color);
  const [newLocation, setNewLocation] = useState("");
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const appearanceChanged = name.trim() !== list.name || icon !== list.icon || color !== list.color;
  const itemCount = detail.items.length;

  async function saveAppearance(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await updateList(list.id, { name: name.trim(), icon, color });
    onClose();
  }

  // Las ubicaciones requieren conexión: validan nombres repetidos en el servidor.
  async function locationRequest(url: string, options: RequestInit) {
    try {
      await api(url, options);
      setError("");
      await onLocationsChanged();
      return true;
    } catch (requestError) {
      setError((requestError as Error).message);
      return false;
    }
  }

  async function addLocation(event: FormEvent) {
    event.preventDefault();
    const created = await locationRequest(`/api/lists/${list.id}/locations`, {
      method: "POST",
      body: JSON.stringify({ name: newLocation })
    });
    if (created) setNewLocation("");
  }

  async function renameLocation(location: Location, nextName: string) {
    if (!nextName.trim() || nextName.trim() === location.name) return;
    await locationRequest(`/api/lists/${list.id}/locations/${location.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: nextName })
    });
  }

  async function removeList() {
    await deleteList(list.id);
    onClose();
    navigate("/", { replace: true });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal list-settings-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Ajustes</div>
            <h2>{list.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>

        {isOwner && (
          <form className="list-settings-block list-appearance-form" onSubmit={saveAppearance}>
            <label>Nombre
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
            </label>
            <ListAppearanceFields icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} />
            {appearanceChanged && (
              <button className="primary-button" disabled={!name.trim()}>Guardar cambios</button>
            )}
          </form>
        )}

        <div className="list-settings-sort">
          <h3>Orden</h3>
          <SortChips value={list.sort} onChange={onSortChange} />
          <p>Arrastra los ítems para armar el orden personalizado.</p>
        </div>

        {list.access !== "viewer" && list.kind !== "checklist" && (
          <>
            <h3 className="list-settings-heading">Ubicaciones</h3>
            <p>{list.familyId ? "Se comparten entre las listas de la familia." : "Se comparten entre tus listas."} Si eliminas una, sus ítems quedan como generales.</p>
            <div className="locations-list">
              {detail.locations.map((location) => (
                <div className="location-edit-row" key={location.id}>
                  <MapPin size={17} />
                  <input
                    defaultValue={location.name}
                    maxLength={30}
                    aria-label={`Nombre de ${location.name}`}
                    onBlur={(event) => renameLocation(location, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                  <button
                    onClick={() => locationRequest(`/api/lists/${list.id}/locations/${location.id}`, { method: "DELETE" })}
                    aria-label={`Eliminar ${location.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <form className="new-location-form" onSubmit={addLocation}>
              <input
                value={newLocation}
                onChange={(event) => setNewLocation(event.target.value)}
                placeholder="Nueva ubicación"
                maxLength={30}
              />
              <button disabled={!newLocation.trim()}><Plus size={18} /> Agregar</button>
            </form>
            {error && <div className="form-error">{error}</div>}
          </>
        )}

        {isOwner && (
          <div className="list-danger-zone">
            <button
              onClick={async () => {
                await updateList(list.id, { archived: !list.archivedAt });
                onClose();
              }}
            >
              {list.archivedAt ? <><ArchiveRestore size={17} /> Restaurar lista</> : <><Archive size={17} /> Archivar lista</>}
            </button>
            {confirmingDelete ? (
              <div className="delete-confirm">
                <span>
                  ¿Eliminar "{list.name}"{itemCount ? ` y sus ${itemCount} ítem${itemCount === 1 ? "" : "s"}` : ""}? No se puede deshacer.
                </span>
                <div>
                  <button onClick={() => setConfirmingDelete(false)}>Cancelar</button>
                  <button className="danger" onClick={removeList}>Eliminar</button>
                </div>
              </div>
            ) : (
              <button className="danger" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={17} /> Eliminar lista
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
