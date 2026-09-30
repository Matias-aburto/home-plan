import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../data/MeProvider";
import type { ListKind } from "../types";
import { ListAppearanceFields } from "./ListAppearanceFields";
import { ListIcon, listKinds } from "./listStyle";

export function NewListModal({ familyId = null, onClose }: { familyId?: string | null; onClose: () => void }) {
  const { createList, families } = useMe();
  const family = families.find(({ id }) => id === familyId);
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ListKind>("shopping");
  const [icon, setIcon] = useState("shopping-basket");
  const [iconTouched, setIconTouched] = useState(false);
  const [color, setColor] = useState("green");
  const [saving, setSaving] = useState(false);

  function chooseKind(next: ListKind) {
    setKind(next);
    // Mientras no elija un ícono a mano, se usa el del tipo.
    if (!iconTouched) setIcon(listKinds.find((option) => option.kind === next)!.icon);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const id = await createList({ name: name.trim(), kind, icon, color }, familyId);
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
          <div>
            {family && <div className="eyebrow">{family.name}</div>}
            <h2>Nueva lista</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <label>Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              placeholder="Ej. Supermercado, Viaje a la playa"
              autoFocus={!window.matchMedia("(max-width: 720px)").matches}
            />
          </label>
          <fieldset>
            <legend>Tipo</legend>
            <div className="kind-picker">
              {listKinds.map((option) => (
                <button
                  type="button"
                  key={option.kind}
                  className={kind === option.kind ? "selected" : ""}
                  onClick={() => chooseKind(option.kind)}
                  aria-pressed={kind === option.kind}
                >
                  <ListIcon icon={option.icon} color={kind === option.kind ? color : "neutral"} size={17} />
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                </button>
              ))}
            </div>
          </fieldset>
          <ListAppearanceFields
            icon={icon}
            color={color}
            onIconChange={(next) => {
              setIcon(next);
              setIconTouched(true);
            }}
            onColorChange={setColor}
          />
          <button className="primary-button" disabled={saving || !name.trim()}>
            {saving ? "Creando…" : "Crear lista"}
          </button>
        </form>
      </section>
    </div>
  );
}
