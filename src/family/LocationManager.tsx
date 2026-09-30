import { useState, type FormEvent } from "react";
import { MapPin, Plus, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import { SortChips } from "../components/SortChips";
import type { Family, Location, SortMode } from "../types";

export function LocationManager({
  family,
  sortMode,
  onSortChange,
  onChanged,
  onClose
}: {
  family: Family;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [newLocation, setNewLocation] = useState("");
  const [error, setError] = useState("");

  async function addLocation(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/families/${family.id}/locations`, {
        method: "POST",
        body: JSON.stringify({ name: newLocation })
      });
      setNewLocation("");
      setError("");
      await onChanged();
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }

  async function renameLocation(location: Location, name: string) {
    if (!name.trim() || name.trim() === location.name) return;
    try {
      await api(`/api/families/${family.id}/locations/${location.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      });
      setError("");
      await onChanged();
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }

  async function deleteLocation(location: Location) {
    await api(`/api/families/${family.id}/locations/${location.id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Tu hogar</div>
            <h2>Ajustes</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <div className="list-settings-sort">
          <h3>Orden</h3>
          <SortChips value={sortMode} onChange={onSortChange} />
          <p>Arrastrá los ítems para armar el orden personalizado.</p>
        </div>
        <h3 className="list-settings-heading">Ubicaciones</h3>
        <p>Usa las que necesites. Si eliminas una, sus productos quedarán como generales.</p>
        <div className="locations-list">
          {family.locations.map((location) => (
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
              <button onClick={() => deleteLocation(location)} aria-label={`Eliminar ${location.name}`}>
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
      </section>
    </div>
  );
}
