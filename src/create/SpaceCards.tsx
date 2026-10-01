import { Plus } from "lucide-react";
import { Link } from "react-router";
import { ListIcon } from "../lists/listStyle";
import type { CalendarSummary, ListSummary } from "../types";

export function pendingLabel(count: number) {
  return count ? `${count} pendiente${count === 1 ? "" : "s"}` : "Al día";
}

// Tarjetas de las listas y calendarios de un espacio (lo personal o un grupo), más la de crear.
export function SpaceCards({
  lists,
  calendars,
  onCreate
}: {
  lists: ListSummary[];
  calendars: CalendarSummary[];
  onCreate: () => void;
}) {
  return (
    <div className="list-cards">
      {lists.map((list) => (
        <Link key={list.id} className="list-card" to={`/listas/${list.id}`}>
          <ListIcon icon={list.icon} color={list.color} size={20} />
          <strong>{list.name}</strong>
          <small>{pendingLabel(list.pendingCount)}</small>
        </Link>
      ))}
      {calendars.map((calendar) => (
        <Link key={calendar.id} className="list-card" to={`/calendarios/${calendar.id}`}>
          <ListIcon icon={calendar.icon} color={calendar.color} size={20} />
          <strong>{calendar.name}</strong>
          <small>Calendario</small>
        </Link>
      ))}
      <button className="list-card new" onClick={onCreate}>
        <Plus size={20} />
        <strong>Nuevo</strong>
      </button>
    </div>
  );
}
