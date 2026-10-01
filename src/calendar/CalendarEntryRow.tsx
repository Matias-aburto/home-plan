import { Bell, CalendarDays, Clock3, Pencil, Repeat2 } from "lucide-react";
import type { CalendarEntry } from "../types";
import type { CalendarOption } from "./CalendarSection";

export function CalendarEntryRow({
  entry,
  source,
  onEdit
}: {
  entry: CalendarEntry;
  // En la agenda, de qué calendario es.
  source?: CalendarOption;
  onEdit: (entry: CalendarEntry) => void;
}) {
  return (
    <button className={`calendar-entry-row ${entry.kind}`} onClick={() => onEdit(entry)}>
      <span className="entry-kind-icon">{entry.kind === "reminder" ? <Bell size={16} /> : <CalendarDays size={16} />}</span>
      <span className="entry-copy">
        <strong>{entry.title}</strong>
        <small>
          {entry.time ? <><Clock3 size={12} /> {entry.time}</> : "Todo el día"}
          {entry.recurrence === "yearly" && <><Repeat2 size={12} /> Anual</>}
          {source && <em className={`entry-source list-color-${source.color}`}>{source.label}</em>}
        </small>
      </span>
      <Pencil size={15} />
    </button>
  );
}
