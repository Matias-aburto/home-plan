import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { compactDateFormatter, dateKey, localDate, occurrenceKey } from "../lib/calendar";
import { CalendarEntryRow } from "./CalendarEntryRow";
import { useCalendarEvents } from "./useCalendarEvents";

// Próximos eventos de un espacio, para su portada. Se editan en el calendario.
export function UpcomingEvents({ familyId }: { familyId: string }) {
  const { events } = useCalendarEvents();
  const navigate = useNavigate();
  const calendarLink = `/calendario?espacio=${familyId}`;

  const upcoming = useMemo(() => {
    const today = dateKey(new Date());
    const year = new Date().getFullYear();
    return (events ?? []).filter((event) => event.familyId === familyId).flatMap((event) => {
      let key = occurrenceKey(event, year);
      if (event.recurrence !== "none" && (!key || key < today)) key = occurrenceKey(event, year + 1);
      return key && key >= today ? [{ event, key }] : [];
    }).sort((a, b) => a.key.localeCompare(b.key) || (a.event.time || "99:99").localeCompare(b.event.time || "99:99"))
      .slice(0, 4);
  }, [events, familyId]);

  if (!events) return null;
  return (
    <div className="group-upcoming">
      <h3>Próximos eventos</h3>
      {upcoming.length ? (
        <div className="agenda-list">
          {upcoming.map(({ event, key }) => (
            <CalendarEntryRow
              key={`${event.id}-${key}`}
              event={event}
              detail={key === dateKey(new Date()) ? "Hoy" : compactDateFormatter.format(localDate(key))}
              onEdit={() => navigate(calendarLink)}
            />
          ))}
        </div>
      ) : (
        <p className="space-intro">No hay eventos próximos en el grupo.</p>
      )}
      <Link className="see-all" to={calendarLink}>
        {upcoming.length ? "Ver en el calendario" : "Agregar un evento en el calendario"} <ArrowRight size={14} />
      </Link>
    </div>
  );
}
