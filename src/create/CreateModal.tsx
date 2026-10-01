import { useState, type FormEvent } from "react";
import { CalendarDays, ListChecks, UserRound, Users, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../data/MeProvider";
import { ListAppearanceFields } from "../lists/ListAppearanceFields";

export type CreateKind = "list" | "calendar";

const kinds = {
  list: {
    label: "Lista",
    description: "Ítems para marcar",
    icon: "list-checks",
    color: "green",
    placeholder: "Ej. Supermercado, Maleta, Pendientes"
  },
  calendar: {
    label: "Calendario",
    description: "Eventos y recordatorios",
    icon: "calendar",
    color: "blue",
    placeholder: "Ej. Cumpleaños, Trabajo, Casa"
  }
} as const;

// Crear una lista o un calendario, personal o de uno de mis grupos.
export function CreateModal({
  familyId = null,
  onClose
}: {
  // Dónde se propone crearlo al abrir (null: personal).
  familyId?: string | null;
  onClose: () => void;
}) {
  const { createList, createCalendar, families } = useMe();
  const navigate = useNavigate();
  const [kind, setKind] = useState<CreateKind>("list");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>(kinds.list.icon);
  const [color, setColor] = useState<string>(kinds.list.color);
  const [appearanceTouched, setAppearanceTouched] = useState(false);
  const [target, setTarget] = useState<string | null>(families.some(({ id }) => id === familyId) ? familyId : null);
  const [saving, setSaving] = useState(false);

  function chooseKind(next: CreateKind) {
    setKind(next);
    // Mientras no elija ícono o color a mano, se usan los del tipo.
    if (!appearanceTouched) {
      setIcon(kinds[next].icon);
      setColor(kinds[next].color);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const input = { name: name.trim(), icon, color };
      if (kind === "list") {
        const id = await createList(input, target);
        onClose();
        navigate(`/listas/${id}`);
      } else {
        const id = await createCalendar(input, target);
        onClose();
        navigate(`/calendarios/${id}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="entry-edit-modal list-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>Nuevo</h2>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <div className="kind-picker two-columns" role="group" aria-label="Qué quieres crear">
            {(Object.keys(kinds) as CreateKind[]).map((option) => {
              const Icon = option === "list" ? ListChecks : CalendarDays;
              return (
                <button
                  type="button"
                  key={option}
                  className={kind === option ? "selected" : ""}
                  onClick={() => chooseKind(option)}
                  aria-pressed={kind === option}
                >
                  <span className={`list-icon list-color-${kind === option ? color : "neutral"}`} aria-hidden="true">
                    <Icon size={17} />
                  </span>
                  <span><strong>{kinds[option].label}</strong><small>{kinds[option].description}</small></span>
                </button>
              );
            })}
          </div>
          <label>Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              placeholder={kinds[kind].placeholder}
              autoFocus={!window.matchMedia("(max-width: 720px)").matches}
            />
          </label>
          {families.length > 0 && (
            <fieldset>
              <legend>¿Dónde?</legend>
              <div className="edit-option-chips">
                <button type="button" className={target === null ? "selected" : ""} onClick={() => setTarget(null)} aria-pressed={target === null}>
                  <UserRound size={14} /> Personal
                </button>
                {families.map((family) => (
                  <button
                    type="button"
                    key={family.id}
                    className={target === family.id ? "selected" : ""}
                    onClick={() => setTarget(family.id)}
                    aria-pressed={target === family.id}
                  >
                    <Users size={14} /> {family.name}
                  </button>
                ))}
              </div>
              <small className="field-hint">
                {target === null
                  ? `Solo tú ${kind === "list" ? "la" : "lo"} ves${kind === "list" ? "; después puedes compartirla con quien quieras" : ""}.`
                  : `${kind === "list" ? "La" : "Lo"} ven y editan todos los miembros del grupo.`}
              </small>
            </fieldset>
          )}
          <ListAppearanceFields
            icon={icon}
            color={color}
            onIconChange={(next) => {
              setIcon(next);
              setAppearanceTouched(true);
            }}
            onColorChange={(next) => {
              setColor(next);
              setAppearanceTouched(true);
            }}
          />
          <button className="primary-button" disabled={saving || !name.trim()}>
            {saving ? "Creando…" : `Crear ${kind === "list" ? "lista" : "calendario"}`}
          </button>
        </form>
      </section>
    </div>
  );
}
