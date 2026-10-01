import { CalendarDays, Clock3, Pencil, Repeat2 } from "lucide-react";
import type { CalendarEvent } from "../types";
import type { Space } from "./spaces";

export function CalendarEntryRow({
  event,
  space,
  detail,
  onEdit
}: {
  event: CalendarEvent;
  // De qué espacio es, si hay más de uno.
  space?: Space;
  // Texto antes de la hora (por ejemplo, la fecha en la portada del grupo).
  detail?: string;
  onEdit: (event: CalendarEvent) => void;
}) {
  return (
    <button className="calendar-entry-row" onClick={() => onEdit(event)}>
      <span className="entry-kind-icon"><CalendarDays size={16} /></span>
      <span className="entry-copy">
        <strong>{event.title}</strong>
        <small>
          {detail && <>{detail} ·{" "}</>}
          {event.time ? <><Clock3 size={12} /> {event.time}</> : "Todo el día"}
          {event.recurrence === "yearly" && <><Repeat2 size={12} /> Anual</>}
          {space && <em className={`entry-source list-color-${space.color}`}>{space.label}</em>}
        </small>
      </span>
      <Pencil size={15} />
    </button>
  );
}
