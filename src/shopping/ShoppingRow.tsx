import { useState, type ReactNode } from "react";
import { Check, MapPin, Pencil, Trash2 } from "lucide-react";
import { SwipeCard } from "../components/SwipeCard";
import type { Location, ShoppingItem } from "../types";

export function ShoppingRow({
  item,
  locations,
  dragHandle,
  onToggle,
  onEdit,
  onDelete
}: {
  item: ShoppingItem;
  locations: Location[];
  dragHandle?: ReactNode;
  onToggle: (item: ShoppingItem) => Promise<void>;
  onEdit: (item: ShoppingItem) => void;
  onDelete: (item: ShoppingItem) => Promise<void>;
}) {
  const [completing, setCompleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const location = locations.find(({ id }) => id === item.locationId);

  async function toggle() {
    if (completing || restoring || deleting) return;
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

  return (
    <SwipeCard label={item.name} onEdit={() => onEdit(item)} onDelete={remove}>
      <div className={`shopping-row ${item.completed ? "completed" : ""} ${completing ? "completing" : ""} ${restoring ? "restoring" : ""} ${deleting ? "deleting" : ""}`}>
        <button className="check-button" onClick={toggle} aria-label={item.completed ? "Marcar pendiente" : "Marcar comprado"}>
          {(item.completed || completing) && <Check size={16} strokeWidth={3} />}
        </button>
        <button className="item-copy item-copy-button" onClick={toggle}>
          <span>{item.name}</span>
          {location && (
            <small>
              <em><MapPin size={11} /> {location.name}</em>
            </small>
          )}
        </button>
        {dragHandle}
        <button className="edit-button direct-row-action" onClick={() => onEdit(item)} aria-label={`Editar ${item.name}`}>
          <Pencil size={16} />
        </button>
        <button className="delete-button direct-row-action" onClick={remove} aria-label={`Eliminar ${item.name}`}>
          <Trash2 size={17} />
        </button>
      </div>
    </SwipeCard>
  );
}
