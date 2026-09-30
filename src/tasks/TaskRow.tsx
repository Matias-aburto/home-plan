import { useState, type ReactNode } from "react";
import { Check, MapPin, Pencil, Trash2, UserRound } from "lucide-react";
import { SwipeCard } from "../components/SwipeCard";
import type { HouseholdTask, Location } from "../types";

export function TaskRow({
  task,
  locations,
  dragHandle,
  onToggle,
  onEdit,
  onDelete
}: {
  task: HouseholdTask;
  locations: Location[];
  dragHandle?: ReactNode;
  onToggle: (task: HouseholdTask) => Promise<void>;
  onEdit: (task: HouseholdTask) => void;
  onDelete: (task: HouseholdTask) => Promise<void>;
}) {
  const [completing, setCompleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const location = locations.find(({ id }) => id === task.locationId);

  async function toggle() {
    if (completing || restoring || deleting) return;
    if (task.completed) {
      setRestoring(true);
      await new Promise((resolve) => window.setTimeout(resolve, 460));
      await onToggle(task);
      setRestoring(false);
      return;
    }
    setCompleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    await onToggle(task);
    setCompleting(false);
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 360));
    await onDelete(task);
  }

  return (
    <SwipeCard label={task.title} onEdit={() => onEdit(task)} onDelete={remove}>
      <div className={`shopping-row ${task.completed ? "completed" : ""} ${completing ? "completing" : ""} ${restoring ? "restoring" : ""} ${deleting ? "deleting" : ""}`}>
        <button className="check-button" onClick={toggle} aria-label={task.completed ? "Marcar pendiente" : "Marcar completada"}>
          {(task.completed || completing) && <Check size={16} strokeWidth={3} />}
        </button>
        <button className="item-copy item-copy-button" onClick={toggle}>
          <span>{task.title}</span>
          {(task.assignee || location) && (
            <small>
              {task.assignee && <em><UserRound size={11} /> {task.assignee}</em>}
              {location && <em><MapPin size={11} /> {location.name}</em>}
            </small>
          )}
        </button>
        {dragHandle}
        <button className="edit-button direct-row-action" onClick={() => onEdit(task)} aria-label={`Editar ${task.title}`}>
          <Pencil size={16} />
        </button>
        <button className="delete-button direct-row-action" onClick={remove} aria-label={`Eliminar ${task.title}`}>
          <Trash2 size={17} />
        </button>
      </div>
    </SwipeCard>
  );
}
