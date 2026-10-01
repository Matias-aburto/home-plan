import { useState, type FormEvent } from "react";
import { UserRound, Users, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../data/MeProvider";
import { ListAppearanceFields } from "../lists/ListAppearanceFields";

// Crear una lista, personal o de uno de mis grupos. Los eventos se crean desde el calendario.
export function CreateModal({
  familyId = null,
  onClose
}: {
  // Dónde se propone crearla al abrir (null: personal).
  familyId?: string | null;
  onClose: () => void;
}) {
  const { createList, families } = useMe();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("list-checks");
  const [color, setColor] = useState("green");
  const [target, setTarget] = useState<string | null>(families.some(({ id }) => id === familyId) ? familyId : null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const id = await createList({ name: name.trim(), icon, color }, target);
      onClose();
      navigate(`/listas/${id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="entry-edit-modal list-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>Nueva lista</h2>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <label>Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              placeholder="Ej. Supermercado, Maleta, Pendientes"
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
                  ? "Solo tú la ves; después puedes compartirla con quien quieras."
                  : "La ven y editan todos los miembros del grupo."}
              </small>
            </fieldset>
          )}
          <ListAppearanceFields icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} />
          <button className="primary-button" disabled={saving || !name.trim()}>
            {saving ? "Creando…" : "Crear lista"}
          </button>
        </form>
      </section>
    </div>
  );
}
