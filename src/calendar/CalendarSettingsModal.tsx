import { useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../data/MeProvider";
import { listColorNames, listColors } from "../lists/listStyle";
import type { CalendarSummary } from "../types";

// Solo quien administra el calendario (su dueño, o owner/admin del grupo) llega a estos ajustes.
export function CalendarSettingsModal({
  calendar,
  spaceName,
  eventCount,
  onClose
}: {
  calendar: CalendarSummary;
  spaceName: string;
  eventCount: number;
  onClose: () => void;
}) {
  const { updateCalendar, deleteCalendar } = useMe();
  const navigate = useNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function remove() {
    await deleteCalendar(calendar.id);
    onClose();
    navigate(calendar.familyId ? `/grupos/${calendar.familyId}` : "/personal", { replace: true });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal list-settings-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Ajustes</div>
            <h2>Calendario · {spaceName}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>

        <div className="list-settings-block list-appearance-form">
          <fieldset>
            <legend>Color</legend>
            <div className="color-picker">
              {listColors.map((name) => (
                <button
                  type="button"
                  key={name}
                  className={`list-color-${name} ${calendar.color === name ? "selected" : ""}`}
                  onClick={() => void updateCalendar(calendar.id, { color: name })}
                  aria-label={listColorNames[name]}
                  aria-pressed={calendar.color === name}
                >
                  {calendar.color === name && <Check size={15} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </fieldset>
          <p className="field-hint">Con este color se distinguen sus eventos en la agenda.</p>
        </div>

        <div className="list-danger-zone">
          {confirmingDelete ? (
            <div className="delete-confirm">
              <span>
                ¿Quitar el calendario{eventCount ? ` y sus ${eventCount} evento${eventCount === 1 ? "" : "s"}` : ""}
                {calendar.familyId ? " para todo el grupo" : ""}? No se puede deshacer.
              </span>
              <div>
                <button onClick={() => setConfirmingDelete(false)}>Cancelar</button>
                <button className="danger" onClick={remove}>Quitar</button>
              </div>
            </div>
          ) : (
            <button className="danger" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={17} /> Quitar calendario
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
