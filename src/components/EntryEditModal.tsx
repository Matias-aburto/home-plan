import { useState, type FormEvent } from "react";
import { House, MapPin, UserRound, X } from "lucide-react";
import type { Assignable, Location } from "../types";

export function EntryEditModal({
  title,
  value,
  locationId,
  assigneeId = null,
  locations,
  assignees = [],
  onSave,
  onClose
}: {
  title: string;
  value: string;
  locationId: string | null;
  assigneeId?: string | null;
  locations: Location[];
  // Vacío: la lista no usa responsables.
  assignees?: Assignable[];
  onSave: (value: string, locationId: string | null, assigneeId: string | null | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const [nextValue, setNextValue] = useState(value);
  const [nextLocationId, setNextLocationId] = useState(locationId || "");
  // undefined: no se tocó (se conserva el responsable actual).
  const [nextAssignee, setNextAssignee] = useState<string | null | undefined>(undefined);
  const shownAssignee = nextAssignee === undefined ? assigneeId : nextAssignee;
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!nextValue.trim()) return;
    setSaving(true);
    try {
      await onSave(nextValue, nextLocationId || null, nextAssignee);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop entry-edit-backdrop" onMouseDown={onClose}>
      <section className="entry-edit-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <label>Nombre
            <input
              value={nextValue}
              onChange={(event) => setNextValue(event.target.value)}
              maxLength={100}
              autoFocus={!window.matchMedia("(max-width: 720px)").matches}
            />
          </label>
          {locations.length > 0 && (
            <fieldset>
              <legend>Ubicación</legend>
              <div className="edit-option-chips">
                <button type="button" className={!nextLocationId ? "selected" : ""} onClick={() => setNextLocationId("")}>
                  <House size={14} /> General
                </button>
                {locations.map((location) => (
                  <button
                    type="button"
                    key={location.id}
                    className={nextLocationId === location.id ? "selected" : ""}
                    onClick={() => setNextLocationId(location.id)}
                  >
                    <MapPin size={14} /> {location.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {assignees.length > 0 && (
            <fieldset>
              <legend>Asignar a</legend>
              <div className="edit-option-chips">
                <button
                  type="button"
                  className={!shownAssignee ? "selected" : ""}
                  onClick={() => setNextAssignee(null)}
                >
                  Sin asignar
                </button>
                {assignees.map((member) => (
                  <button
                    type="button"
                    key={member.userId}
                    className={shownAssignee === member.userId ? "selected" : ""}
                    onClick={() => setNextAssignee(member.userId)}
                  >
                    <UserRound size={14} /> {member.name}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button className="primary-button" disabled={saving || !nextValue.trim()}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </form>
      </section>
    </div>
  );
}
