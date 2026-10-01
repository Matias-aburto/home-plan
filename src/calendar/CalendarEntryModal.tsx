import { useState, type FormEvent } from "react";
import { Trash2, X } from "lucide-react";
import type { CalendarEvent, CalendarEventInput } from "../types";
import type { Space } from "./spaces";

export function CalendarEntryModal({
  event,
  defaultDate,
  spaces,
  defaultSpace,
  onSave,
  onDelete,
  onClose
}: {
  event: CalendarEvent | null;
  defaultDate: string;
  // Dónde puede ir el evento; al editar, cambiarlo lo mueve de espacio.
  spaces: Space[];
  defaultSpace: string;
  onSave: (input: CalendarEventInput, space: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(event?.title || "");
  const [date, setDate] = useState(event?.date || defaultDate);
  const [time, setTime] = useState(event?.time || "");
  const [recurrence, setRecurrence] = useState<CalendarEvent["recurrence"]>(event?.recurrence || "none");
  const [notes, setNotes] = useState(event?.notes || "");
  const [space, setSpace] = useState(defaultSpace);
  const [saving, setSaving] = useState(false);

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), date, time: time || null, recurrence, notes: notes.trim() || null }, space);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop calendar-modal-backdrop" onMouseDown={onClose}>
      <section className="calendar-modal animate-in" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">{event ? "Editar" : "Nuevo"}</div>
            <h2>Evento</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <label>Título
            <input
              value={title}
              onChange={(changeEvent) => setTitle(changeEvent.target.value)}
              maxLength={100}
              autoFocus={!window.matchMedia("(max-width: 720px)").matches}
              placeholder="Ej. Cumpleaños de mamá"
            />
          </label>
          {spaces.length > 1 && (
            <fieldset className="calendar-choice">
              <legend>¿Dónde?</legend>
              <div className="edit-option-chips">
                {spaces.map((option) => (
                  <button
                    type="button"
                    key={option.key}
                    className={space === option.key ? "selected" : ""}
                    onClick={() => setSpace(option.key)}
                    aria-pressed={space === option.key}
                  >
                    <i className={`chip-dot dot-${option.color}`} /> {option.label}
                  </button>
                ))}
              </div>
              <small className="field-hint">
                {space === "personal" ? "Solo tú lo ves." : "Lo ven y editan todos los miembros del grupo."}
              </small>
            </fieldset>
          )}
          <div className="calendar-form-row">
            <label>
              <span className="calendar-field-label">Fecha</span>
              <input type="date" value={date} onChange={(changeEvent) => setDate(changeEvent.target.value)} />
            </label>
            <label>
              <span className="calendar-field-label">Hora <small>Opcional</small></span>
              <input type="time" value={time} onChange={(changeEvent) => setTime(changeEvent.target.value)} />
            </label>
          </div>
          <label>Repetición
            <select value={recurrence} onChange={(changeEvent) => setRecurrence(changeEvent.target.value as CalendarEvent["recurrence"])}>
              <option value="none">No repetir</option>
              <option value="yearly">Cada año</option>
            </select>
          </label>
          <label>Notas <small>Opcional</small>
            <textarea value={notes} onChange={(changeEvent) => setNotes(changeEvent.target.value)} maxLength={300} rows={3} placeholder="Detalles útiles" />
          </label>
          <div className="calendar-modal-actions">
            {onDelete && (
              <button type="button" className="calendar-delete-button" onClick={onDelete}>
                <Trash2 size={17} /> Eliminar
              </button>
            )}
            <button className="primary-button" disabled={saving || !title.trim() || !date}>
              {saving ? "Guardando…" : event ? "Guardar cambios" : "Agregar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
