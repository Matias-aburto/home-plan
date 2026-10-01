import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../data/MeProvider";
import { ListAppearanceFields } from "../lists/ListAppearanceFields";
import type { CalendarSummary } from "../types";

// Solo quien administra el calendario (su dueño, o owner/admin del grupo) llega a estos ajustes.
export function CalendarSettingsModal({
  calendar,
  eventCount,
  onClose
}: {
  calendar: CalendarSummary;
  eventCount: number;
  onClose: () => void;
}) {
  const { updateCalendar, deleteCalendar } = useMe();
  const navigate = useNavigate();
  const [name, setName] = useState(calendar.name);
  const [icon, setIcon] = useState(calendar.icon);
  const [color, setColor] = useState(calendar.color);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const appearanceChanged = name.trim() !== calendar.name || icon !== calendar.icon || color !== calendar.color;

  async function saveAppearance(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await updateCalendar(calendar.id, { name: name.trim(), icon, color });
    onClose();
  }

  async function remove() {
    await deleteCalendar(calendar.id);
    onClose();
    navigate("/", { replace: true });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal list-settings-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Ajustes</div>
            <h2>{calendar.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>

        <form className="list-settings-block list-appearance-form" onSubmit={saveAppearance}>
          <label>Nombre
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
          </label>
          <ListAppearanceFields icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} />
          {appearanceChanged && (
            <button className="primary-button" disabled={!name.trim()}>Guardar cambios</button>
          )}
        </form>

        <div className="list-danger-zone">
          <button
            onClick={async () => {
              await updateCalendar(calendar.id, { archived: !calendar.archivedAt });
              onClose();
            }}
          >
            {calendar.archivedAt
              ? <><ArchiveRestore size={17} /> Restaurar calendario</>
              : <><Archive size={17} /> Archivar calendario</>}
          </button>
          {confirmingDelete ? (
            <div className="delete-confirm">
              <span>
                ¿Eliminar "{calendar.name}"{eventCount ? ` y sus ${eventCount} evento${eventCount === 1 ? "" : "s"}` : ""}? No se puede deshacer.
              </span>
              <div>
                <button onClick={() => setConfirmingDelete(false)}>Cancelar</button>
                <button className="danger" onClick={remove}>Eliminar</button>
              </div>
            </div>
          ) : (
            <button className="danger" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={17} /> Eliminar calendario
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
