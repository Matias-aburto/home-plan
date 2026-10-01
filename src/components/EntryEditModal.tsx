import { useState, type FormEvent } from "react";
import { X } from "lucide-react";

export function EntryEditModal({
  title,
  value,
  onSave,
  onClose
}: {
  title: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [nextValue, setNextValue] = useState(value);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!nextValue.trim()) return;
    setSaving(true);
    try {
      await onSave(nextValue);
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
          <button className="primary-button" disabled={saving || !nextValue.trim()}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </form>
      </section>
    </div>
  );
}
