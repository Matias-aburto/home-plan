import { useState } from "react";
import { CalendarPlus, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { nextCalendarColor } from "../calendar/spaces";
import { useMe } from "../data/MeProvider";
import { ListIcon } from "../lists/listStyle";
import type { CalendarSummary, ListSummary } from "../types";

export function pendingLabel(count: number) {
  return count ? `${count} pendiente${count === 1 ? "" : "s"}` : "Al día";
}

// Tarjetas de un espacio (lo personal o un grupo): sus listas, su calendario o la opción de agregarlo, y crear.
export function SpaceCards({
  familyId,
  lists,
  calendar,
  onCreate
}: {
  familyId: string | null;
  lists: ListSummary[];
  calendar: CalendarSummary | null;
  onCreate: () => void;
}) {
  const { createCalendar, calendars } = useMe();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  async function addCalendar() {
    setAdding(true);
    try {
      navigate(`/calendarios/${await createCalendar(nextCalendarColor(calendars), familyId)}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="list-cards">
      {calendar && (
        <Link className="list-card" to={`/calendarios/${calendar.id}`}>
          <ListIcon icon="calendar" color={calendar.color} size={20} />
          <strong>Calendario</strong>
          <small>Eventos y recordatorios</small>
        </Link>
      )}
      {lists.map((list) => (
        <Link key={list.id} className="list-card" to={`/listas/${list.id}`}>
          <ListIcon icon={list.icon} color={list.color} size={20} />
          <strong>{list.name}</strong>
          <small>{pendingLabel(list.pendingCount)}</small>
        </Link>
      ))}
      <button className="list-card new" onClick={onCreate}>
        <Plus size={20} />
        <strong>Nueva lista</strong>
      </button>
      {!calendar && (
        <button className="list-card new" onClick={() => void addCalendar()} disabled={adding}>
          <CalendarPlus size={20} />
          <strong>Agregar calendario</strong>
        </button>
      )}
    </div>
  );
}
