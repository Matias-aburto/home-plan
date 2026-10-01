import { useState, type FormEvent } from "react";
import { Bell, CalendarDays, Trash2, X } from "lucide-react";
import type { CalendarEntry } from "../types";

export function CalendarEntryModal({
  entry,
  defaultDate,
  onSave,
  onDelete,
  onClose
}: {
  entry: CalendarEntry | null;
  defaultDate: string;
  onSave: (entry: Omit<CalendarEntry, "id" | "createdAt" | "updatedAt">) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(entry?.title || "");
  const [kind, setKind] = useState<CalendarEntry["kind"]>(entry?.kind || "event");
  const [date, setDate] = useState(entry?.date || defaultDate);
  const [time, setTime] = useState(entry?.time || "");
  const [recurrence, setRecurrence] = useState<CalendarEntry["recurrence"]>(entry?.recurrence || "none");
  const [notes, setNotes] = useState(entry?.notes || "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !date) return;
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        kind,
        date,
        time: time || null,
        recurrence,
        notes: notes.trim() || null
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop calendar-modal-backdrop" onMouseDown={onClose}>
      <section className="calendar-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">{entry ? "Editar" : "Nuevo"}</div>
            <h2>{kind === "event" ? "Evento" : "Recordatorio"}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="entry-type-picker">
            <button type="button" className={kind === "event" ? "selected" : ""} onClick={() => setKind("event")}>
              <CalendarDays size={16} /> Evento
            </button>
            <button type="button" className={kind === "reminder" ? "selected" : ""} onClick={() => setKind("reminder")}>
              <Bell size={16} /> Recordatorio
            </button>
          </div>
          <label>Título
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={100}
              autoFocus={!window.matchMedia("(max-width: 720px)").matches}
              placeholder="Ej. Cumpleaños de mamá"
            />
          </label>
          <div className="calendar-form-row">
            <label>
              <span className="calendar-field-label">Fecha</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label>
              <span className="calendar-field-label">Hora <small>Opcional</small></span>
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
          </div>
          <label>Repetición
            <select value={recurrence} onChange={(event) => setRecurrence(event.target.value as CalendarEntry["recurrence"])}>
              <option value="none">No repetir</option>
              <option value="yearly">Cada año</option>
            </select>
          </label>
          <label>Notas <small>Opcional</small>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} rows={3} placeholder="Detalles útiles" />
          </label>
          <div className="calendar-modal-actions">
            {onDelete && (
              <button type="button" className="calendar-delete-button" onClick={onDelete}>
                <Trash2 size={17} /> Eliminar
              </button>
            )}
            <button className="primary-button" disabled={saving || !title.trim() || !date}>
              {saving ? "Guardando…" : entry ? "Guardar cambios" : "Agregar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
