import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { CalendarEntryModal } from "./CalendarEntryModal";
import { CalendarEntryRow } from "./CalendarEntryRow";
import { spaceKey, type Space } from "./spaces";
import { compactDateFormatter, dateKey, dayFormatter, entriesOnDate, localDate, monthFormatter, occurrenceKey } from "../lib/calendar";
import type { CalendarEvent, CalendarEventInput, OfflineMutation } from "../types";

const lastSpaceKey = "casa:last-event-space";

export function CalendarSection({
  heading,
  banner,
  spaces,
  visibleSpaces,
  events,
  onMutate
}: {
  heading: ReactNode;
  banner?: ReactNode;
  // Todos mis espacios (para elegir dónde va un evento) y los que se están mostrando.
  spaces: Space[];
  visibleSpaces: Space[];
  events: CalendarEvent[];
  onMutate: (events: CalendarEvent[], operation: OfflineMutation) => Promise<void>;
}) {
  const today = dateKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);
  // Con un solo espacio (sin grupos) no hace falta mostrar de cuál es cada evento.
  const showSpace = spaces.length > 1;
  const spaceOf = (event: CalendarEvent) => spaces.find(({ key }) => key === spaceKey(event.familyId));

  // Al crear: el espacio que se usó la última vez, si se está mostrando; si no, el primero visible.
  function defaultSpace() {
    let last: string | null = null;
    try {
      last = localStorage.getItem(lastSpaceKey);
    } catch {
      // Sin almacenamiento se usa el primero visible.
    }
    return (visibleSpaces.find(({ key }) => key === last) ?? visibleSpaces[0] ?? spaces[0]).key;
  }

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);

  const selectedEvents = useMemo(() => entriesOnDate(events, selectedDate), [events, selectedDate]);

  const upcoming = useMemo(() => {
    const start = localDate(today);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    return events.flatMap((event) => {
      if (event.recurrence === "none") {
        return event.date >= today && localDate(event.date) <= end ? [{ event, key: event.date }] : [];
      }
      let key = occurrenceKey(event, start.getFullYear());
      if (!key || key < today) key = occurrenceKey(event, start.getFullYear() + 1);
      return key && localDate(key) <= end ? [{ event, key }] : [];
    }).sort((a, b) =>
      a.key.localeCompare(b.key) || (a.event.time || "99:99").localeCompare(b.event.time || "99:99")
    ).slice(0, 8);
  }, [events, today]);

  function changeMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(dateKey(next));
  }

  function selectDay(day: Date) {
    setSelectedDate(dateKey(day));
    if (day.getMonth() !== month.getMonth()) setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  }

  async function saveEvent(data: CalendarEventInput, space: string) {
    const familyId = space === "personal" ? null : space;
    const now = new Date().toISOString();
    try {
      localStorage.setItem(lastSpaceKey, space);
    } catch {
      // Sin almacenamiento no se recuerda.
    }
    if (editing) {
      const updated = { ...editing, ...data, familyId, updatedAt: now };
      await onMutate(events.map((event) => event.id === editing.id ? updated : event), {
        url: `/api/calendar/events/${editing.id}`,
        method: "PATCH",
        body: { ...data, familyId }
      });
    } else {
      const event: CalendarEvent = { id: crypto.randomUUID(), familyId, ...data, createdBy: null, createdAt: now, updatedAt: now };
      await onMutate([...events, event], {
        url: "/api/calendar/events",
        method: "POST",
        body: { id: event.id, ...data, familyId }
      });
    }
    setCreating(false);
    setEditing(null);
  }

  async function deleteEvent(event: CalendarEvent) {
    await onMutate(events.filter(({ id }) => id !== event.id), { url: `/api/calendar/events/${event.id}`, method: "DELETE" });
    setEditing(null);
  }

  return (
    <section className="content calendar-content">
      <div className="content-heading calendar-heading">
        {heading}
        <div className="list-heading-actions">
          <button className="calendar-add-button" onClick={() => setCreating(true)}>
            <Plus size={18} /> Nuevo
          </button>
        </div>
      </div>

      {banner}

      <div className="calendar-layout">
        <div className="calendar-card">
          <header className="calendar-month-header">
            <button onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={20} /></button>
            <h3>{monthFormatter.format(month)}</h3>
            <button onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight size={20} /></button>
          </header>
          <div className="calendar-weekdays" aria-hidden="true">
            {["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
          </div>
          <div className="calendar-grid">
            {days.map((day) => {
              const key = dateKey(day);
              const dayEvents = entriesOnDate(events, key);
              return (
                <button
                  key={key}
                  className={`calendar-day ${day.getMonth() !== month.getMonth() ? "outside" : ""} ${key === today ? "today" : ""} ${key === selectedDate ? "selected" : ""}`}
                  onClick={() => selectDay(day)}
                  aria-label={dayFormatter.format(day)}
                >
                  <span>{day.getDate()}</span>
                  <i className="calendar-dots">
                    {dayEvents.slice(0, 3).map((event) => (
                      <b key={event.id} className={showSpace ? `dot-${spaceOf(event)?.color ?? "neutral"}` : ""} />
                    ))}
                  </i>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="calendar-agenda">
          <div className="agenda-heading">
            <span>{selectedDate === today ? "Hoy" : dayFormatter.format(localDate(selectedDate))}</span>
            <button onClick={() => setCreating(true)} aria-label="Agregar en este día"><Plus size={17} /></button>
          </div>
          <div className="agenda-list">
            {selectedEvents.length ? selectedEvents.map((event) => (
              <CalendarEntryRow key={event.id} event={event} space={showSpace ? spaceOf(event) : undefined} onEdit={setEditing} />
            )) : (
              <div className="agenda-empty">Nada agendado para este día.</div>
            )}
          </div>

          <h4>Próximos</h4>
          <div className="upcoming-list">
            {upcoming.length ? upcoming.map(({ event, key }) => (
              <button key={`${event.id}-${key}`} onClick={() => {
                setSelectedDate(key);
                const date = localDate(key);
                setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
              }}>
                <time>{compactDateFormatter.format(localDate(key))}</time>
                <span>{event.title}</span>
                {showSpace && <i className={`upcoming-source dot-${spaceOf(event)?.color ?? "neutral"}`} title={spaceOf(event)?.label} />}
                {event.time && <small>{event.time}</small>}
              </button>
            )) : <span className="agenda-empty">No hay eventos próximos.</span>}
          </div>
        </aside>
      </div>

      {(creating || editing) && (
        <CalendarEntryModal
          event={editing}
          defaultDate={selectedDate}
          spaces={spaces}
          defaultSpace={editing ? spaceKey(editing.familyId) : defaultSpace()}
          onSave={saveEvent}
          onDelete={editing ? () => deleteEvent(editing) : undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
