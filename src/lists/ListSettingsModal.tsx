import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ArrowRightLeft, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { SortChips } from "../components/SortChips";
import { useMe } from "../data/MeProvider";
import type { ListDetail, SortMode } from "../types";
import { ListAppearanceFields } from "./ListAppearanceFields";

export function ListSettingsModal({
  detail,
  onSortChange,
  onChanged,
  onClose
}: {
  detail: ListDetail;
  onSortChange: (mode: SortMode) => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { list } = detail;
  const { updateList, deleteList, families, refresh } = useMe();
  const navigate = useNavigate();
  const isOwner = list.access === "owner";
  const [name, setName] = useState(list.name);
  const [icon, setIcon] = useState(list.icon);
  const [color, setColor] = useState(list.color);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [moving, setMoving] = useState(false);
  // Destinos posibles: lo personal y cada grupo propio, salvo donde ya está.
  const moveOptions = [
    ...(list.familyId ? [{ value: "personal", label: "Personal" }] : []),
    ...families.filter(({ id }) => id !== list.familyId).map(({ id, name }) => ({ value: id, label: name }))
  ];

  // Requiere conexión: el servidor valida el grupo de destino.
  async function moveList() {
    if (!moveTarget) return;
    setMoving(true);
    setError("");
    try {
      await api(`/api/lists/${list.id}/move`, {
        method: "POST",
        body: JSON.stringify({ familyId: moveTarget === "personal" ? null : moveTarget })
      });
      await Promise.all([refresh(), onChanged()]);
      onClose();
    } catch (requestError) {
      setError(navigator.onLine ? (requestError as Error).message : "Necesitas conexión para mover la lista.");
    } finally {
      setMoving(false);
    }
  }
  const appearanceChanged = name.trim() !== list.name || icon !== list.icon || color !== list.color;
  const itemCount = detail.items.length;

  async function saveAppearance(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    await updateList(list.id, { name: name.trim(), icon, color });
    onClose();
  }

  async function removeList() {
    await deleteList(list.id);
    onClose();
    navigate("/", { replace: true });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal list-settings-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Ajustes</div>
            <h2>{list.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>

        {isOwner && (
          <form className="list-settings-block list-appearance-form" onSubmit={saveAppearance}>
            <label>Nombre
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
            </label>
            <ListAppearanceFields icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} />
            {appearanceChanged && (
              <button className="primary-button" disabled={!name.trim()}>Guardar cambios</button>
            )}
          </form>
        )}

        <div className="list-settings-sort">
          <h3>Orden</h3>
          <SortChips value={list.sort} onChange={onSortChange} />
          <p>Arrastra los ítems para armar el orden personalizado.</p>
        </div>

        {error && <div className="form-error">{error}</div>}

        {isOwner && moveOptions.length > 0 && (
          <div className="list-move">
            <h3 className="list-settings-heading">Mover a</h3>
            {moveTarget && (
              <p>
                {moveTarget === "personal"
                  ? "Pasará a ser tuya: dejan de verla los miembros del grupo, salvo quienes la tengan compartida."
                  : "La verán y editarán todos los miembros del grupo de destino."}
              </p>
            )}
            <div className="inline-form">
              <select value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} aria-label="Destino">
                <option value="">Elegir destino</option>
                {moveOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button className="secondary-button" disabled={!moveTarget || moving} onClick={() => void moveList()}>
                <ArrowRightLeft size={16} /> Mover
              </button>
            </div>
          </div>
        )}

        {isOwner && (
          <div className="list-danger-zone">
            <button
              onClick={async () => {
                await updateList(list.id, { archived: !list.archivedAt });
                onClose();
              }}
            >
              {list.archivedAt ? <><ArchiveRestore size={17} /> Restaurar lista</> : <><Archive size={17} /> Archivar lista</>}
            </button>
            {confirmingDelete ? (
              <div className="delete-confirm">
                <span>
                  ¿Eliminar "{list.name}"{itemCount ? ` y sus ${itemCount} ítem${itemCount === 1 ? "" : "s"}` : ""}? No se puede deshacer.
                </span>
                <div>
                  <button onClick={() => setConfirmingDelete(false)}>Cancelar</button>
                  <button className="danger" onClick={removeList}>Eliminar</button>
                </div>
              </div>
            ) : (
              <button className="danger" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={17} /> Eliminar lista
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
