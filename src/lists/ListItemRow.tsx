import { useState, type ReactNode } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { SwipeCard } from "../components/SwipeCard";
import type { ListItem } from "../types";

export function ListItemRow({
  item,
  readOnly = false,
  dragHandle,
  onToggle,
  onEdit,
  onDelete
}: {
  item: ListItem;
  readOnly?: boolean;
  dragHandle?: ReactNode;
  onToggle: (item: ListItem) => Promise<void>;
  onEdit: (item: ListItem) => void;
  onDelete: (item: ListItem) => Promise<void>;
}) {
  const [completing, setCompleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Espera a que termine la animación antes de mover el ítem de sección.
  async function toggle() {
    if (readOnly || completing || restoring || deleting) return;
    if (item.completed) {
      setRestoring(true);
      await new Promise((resolve) => window.setTimeout(resolve, 460));
      await onToggle(item);
      setRestoring(false);
      return;
    }
    setCompleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    await onToggle(item);
    setCompleting(false);
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 360));
    await onDelete(item);
  }

  const row = (
    <div className={`shopping-row ${item.completed ? "completed" : ""} ${completing ? "completing" : ""} ${restoring ? "restoring" : ""} ${deleting ? "deleting" : ""} ${readOnly ? "read-only" : ""}`}>
      <button className="check-button" onClick={toggle} disabled={readOnly} aria-label={item.completed ? "Marcar pendiente" : "Marcar listo"}>
        {(item.completed || completing) && <Check size={16} strokeWidth={3} />}
      </button>
      <button className="item-copy item-copy-button" onClick={toggle} disabled={readOnly}>
        <span>{item.title}</span>
      </button>
      {!readOnly && (
        <>
          {dragHandle}
          <button className="edit-button direct-row-action" onClick={() => onEdit(item)} aria-label={`Editar ${item.title}`}>
            <Pencil size={16} />
          </button>
          <button className="delete-button direct-row-action" onClick={remove} aria-label={`Eliminar ${item.title}`}>
            <Trash2 size={17} />
          </button>
        </>
      )}
    </div>
  );

  if (readOnly) return <div className="swipe-card">{row}</div>;
  return (
    <SwipeCard label={item.title} onEdit={() => onEdit(item)} onDelete={remove}>
      {row}
    </SwipeCard>
  );
}
