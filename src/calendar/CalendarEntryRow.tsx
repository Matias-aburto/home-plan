import { Bell, CalendarDays, Clock3, Pencil, Repeat2 } from "lucide-react";
import type { CalendarEntry } from "../types";

export function CalendarEntryRow({
  entry,
  onEdit
}: {
  entry: CalendarEntry;
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
        </small>
      </span>
      <Pencil size={15} />
    </button>
  );
}
