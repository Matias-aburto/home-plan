import { useState, type FormEvent } from "react";
import { CalendarDays, ListChecks, UserRound, Users, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { nextCalendarColor } from "../calendar/spaces";
import { useMe } from "../data/MeProvider";
import { ListAppearanceFields } from "../lists/ListAppearanceFields";

export type CreateKind = "list" | "calendar";

// Crear una lista, o agregar el calendario a lo personal o a un grupo (uno por espacio).
export function CreateModal({
  familyId = null,
  onClose
}: {
  // Dónde se propone crearlo al abrir (null: personal).
  familyId?: string | null;
  onClose: () => void;
}) {
  const { createList, createCalendar, families, calendars } = useMe();
  const { user } = useSession();
  const navigate = useNavigate();
  const hasCalendar = (space: string | null) => calendars.some((calendar) =>
    space ? calendar.familyId === space : calendar.ownerUserId === user?.id
  );
  const spaces: (string | null)[] = [null, ...families.map(({ id }) => id)];
  const freeSpaces = spaces.filter((space) => !hasCalendar(space));
  const [kind, setKind] = useState<CreateKind>("list");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("list-checks");
  const [listColor, setListColor] = useState("green");
  const [calendarColor, setCalendarColor] = useState(() => nextCalendarColor(calendars));
  const [target, setTarget] = useState<string | null>(families.some(({ id }) => id === familyId) ? familyId : null);
  const [saving, setSaving] = useState(false);
  const isCalendar = kind === "calendar";
  const color = isCalendar ? calendarColor : listColor;
  const blocked = isCalendar && hasCalendar(target);

  function chooseKind(next: CreateKind) {
    setKind(next);
    // Si el espacio elegido ya tiene calendario, se propone el primero que no tenga.
    if (next === "calendar" && hasCalendar(target) && freeSpaces.length) setTarget(freeSpaces[0]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || (!isCalendar && !name.trim())) return;
    setSaving(true);
    try {
      if (isCalendar) {
        const id = await createCalendar(color, target);
        onClose();
        navigate(`/calendarios/${id}`);
      } else {
        const id = await createList({ name: name.trim(), icon, color }, target);
        onClose();
        navigate(`/listas/${id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  const spaceLabel = (space: string | null) => space ? families.find(({ id }) => id === space)?.name ?? "" : "Personal";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="entry-edit-modal list-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>Nuevo</h2>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="kind-picker two-columns" role="group" aria-label="Qué quieres crear">
            <button type="button" className={!isCalendar ? "selected" : ""} onClick={() => chooseKind("list")} aria-pressed={!isCalendar}>
              <span className={`list-icon list-color-${!isCalendar ? color : "neutral"}`} aria-hidden="true"><ListChecks size={17} /></span>
              <span><strong>Lista</strong><small>Ítems para marcar</small></span>
            </button>
            <button
              type="button"
              className={isCalendar ? "selected" : ""}
              onClick={() => chooseKind("calendar")}
              aria-pressed={isCalendar}
              disabled={freeSpaces.length === 0}
            >
              <span className={`list-icon list-color-${isCalendar ? color : "neutral"}`} aria-hidden="true"><CalendarDays size={17} /></span>
              <span>
                <strong>Calendario</strong>
                <small>{freeSpaces.length ? "Uno por espacio" : "Ya está en todos tus espacios"}</small>
              </span>
            </button>
          </div>
          {!isCalendar && (
            <label>Nombre
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={40}
                placeholder="Ej. Supermercado, Maleta, Pendientes"
                autoFocus={!window.matchMedia("(max-width: 720px)").matches}
              />
            </label>
          )}
          {families.length > 0 && (
            <fieldset>
              <legend>¿Dónde?</legend>
              <div className="edit-option-chips">
                {spaces.map((space) => {
                  const taken = isCalendar && hasCalendar(space);
                  return (
                    <button
                      type="button"
                      key={space ?? "personal"}
                      className={target === space ? "selected" : ""}
                      onClick={() => setTarget(space)}
                      aria-pressed={target === space}
                      disabled={taken}
                      title={taken ? "Ya tiene calendario" : undefined}
                    >
                      {space ? <Users size={14} /> : <UserRound size={14} />} {spaceLabel(space)}
                    </button>
                  );
                })}
              </div>
              <small className="field-hint">
                {isCalendar
                  ? target === null
                    ? "Solo tú lo ves. Sus eventos también aparecen en tu agenda."
                    : "Lo ven y editan todos los miembros del grupo, y aparece en la agenda de cada uno."
                  : target === null
                    ? "Solo tú la ves; después puedes compartirla con quien quieras."
                    : "La ven y editan todos los miembros del grupo."}
              </small>
            </fieldset>
          )}
          {isCalendar ? (
            <ListAppearanceFields color={color} onColorChange={setCalendarColor} />
          ) : (
            <ListAppearanceFields icon={icon} color={color} onIconChange={setIcon} onColorChange={setListColor} />
          )}
          <button className="primary-button" disabled={saving || blocked || (!isCalendar && !name.trim())}>
            {saving ? "Creando…" : isCalendar ? `Agregar calendario a ${spaceLabel(target)}` : "Crear lista"}
          </button>
        </form>
      </section>
    </div>
  );
}
