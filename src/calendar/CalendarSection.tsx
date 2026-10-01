import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { CalendarEntryModal } from "./CalendarEntryModal";
import { CalendarEntryRow } from "./CalendarEntryRow";
import { compactDateFormatter, dateKey, dayFormatter, entriesOnDate, localDate, monthFormatter, occurrenceKey } from "../lib/calendar";
import type { AgendaEntry, CalendarEntry, OfflineMutation } from "../types";

// Un calendario donde se pueden agregar eventos. Con más de uno (la agenda), cada evento muestra de cuál es.
export type CalendarOption = { id: string; label: string; color: string };

export function CalendarSection({
  heading,
  actions,
  banner,
  calendars,
  combined = calendars.length > 1,
  entries,
  onMutate
}: {
  heading: ReactNode;
  actions?: ReactNode;
  banner?: ReactNode;
  calendars: CalendarOption[];
  // Si se mezclan varios calendarios: cada evento muestra de cuál es.
  combined?: boolean;
  entries: AgendaEntry[];
  onMutate: (entries: AgendaEntry[], operation: OfflineMutation, calendarId: string) => Promise<void>;
}) {
  const today = dateKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [editing, setEditing] = useState<AgendaEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const calendarOf = (entry: AgendaEntry) => calendars.find(({ id }) => id === entry.calendarId);

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

  const selectedEntries = useMemo(
    () => entriesOnDate(entries, selectedDate),
    [entries, selectedDate]
  );

  const upcoming = useMemo(() => {
    const start = localDate(today);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    return entries.flatMap((entry) => {
      if (entry.recurrence === "none") {
        return entry.date >= today && localDate(entry.date) <= end
          ? [{ entry, key: entry.date }]
          : [];
      }
      let key = occurrenceKey(entry, start.getFullYear());
      if (!key || key < today) key = occurrenceKey(entry, start.getFullYear() + 1);
      return key && localDate(key) <= end ? [{ entry, key }] : [];
    }).sort((a, b) =>
      a.key.localeCompare(b.key) || (a.entry.time || "99:99").localeCompare(b.entry.time || "99:99")
    ).slice(0, combined ? 8 : 6);
  }, [entries, today, combined]);

  function changeMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(dateKey(next));
  }

  function selectDay(day: Date) {
    setSelectedDate(dateKey(day));
    if (day.getMonth() !== month.getMonth()) {
      setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }

  async function saveEntry(data: Omit<CalendarEntry, "id" | "createdAt" | "updatedAt">, calendarId: string) {
    const now = new Date().toISOString();
    if (editing) {
      const updated = { ...editing, ...data, updatedAt: now };
      await onMutate(entries.map((entry) => entry.id === editing.id ? updated : entry), {
        url: `/api/calendars/${editing.calendarId}/events/${editing.id}`,
        method: "PATCH",
        body: data
      }, editing.calendarId);
    } else {
      const entry: AgendaEntry = { id: crypto.randomUUID(), calendarId, ...data, createdAt: now, updatedAt: now };
      await onMutate([...entries, entry], {
        url: `/api/calendars/${calendarId}/events`,
        method: "POST",
        body: { id: entry.id, ...data }
      }, calendarId);
    }
    setCreating(false);
    setEditing(null);
  }

  async function deleteEntry(entry: AgendaEntry) {
    await onMutate(entries.filter(({ id }) => id !== entry.id), {
      url: `/api/calendars/${entry.calendarId}/events/${entry.id}`,
      method: "DELETE"
    }, entry.calendarId);
    setEditing(null);
  }

  return (
    <section className="content calendar-content">
      <div className="content-heading calendar-heading">
        {heading}
        <div className="list-heading-actions">
          {actions}
          {calendars.length > 0 && (
            <button className="calendar-add-button" onClick={() => setCreating(true)}>
              <Plus size={18} /> Nuevo
            </button>
          )}
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
              const dayEntries = entriesOnDate(entries, key);
              return (
                <button
                  key={key}
                  className={`calendar-day ${day.getMonth() !== month.getMonth() ? "outside" : ""} ${key === today ? "today" : ""} ${key === selectedDate ? "selected" : ""}`}
                  onClick={() => selectDay(day)}
                  aria-label={dayFormatter.format(day)}
                >
                  <span>{day.getDate()}</span>
                  <i className="calendar-dots">
                    {dayEntries.slice(0, 3).map((entry) => (
                      <b key={entry.id} className={combined ? `dot-${calendarOf(entry)?.color ?? "neutral"}` : entry.kind} />
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
            {calendars.length > 0 && (
              <button onClick={() => setCreating(true)} aria-label="Agregar en este día"><Plus size={17} /></button>
            )}
          </div>
          <div className="agenda-list">
            {selectedEntries.length ? selectedEntries.map((entry) => (
              <CalendarEntryRow
                key={entry.id}
                entry={entry}
                source={combined ? calendarOf(entry) : undefined}
                onEdit={(selected) => setEditing(selected as AgendaEntry)}
              />
            )) : (
              <div className="agenda-empty">Nada agendado para este día.</div>
            )}
          </div>

          <h4>Próximos</h4>
          <div className="upcoming-list">
            {upcoming.length ? upcoming.map(({ entry, key }) => (
              <button key={`${entry.id}-${key}`} onClick={() => {
                setSelectedDate(key);
                const date = localDate(key);
                setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
              }}>
                <time>{compactDateFormatter.format(localDate(key))}</time>
                <span>{entry.title}</span>
                {combined && <i className={`upcoming-source dot-${calendarOf(entry)?.color ?? "neutral"}`} title={calendarOf(entry)?.label} />}
                {entry.time && <small>{entry.time}</small>}
              </button>
            )) : <span className="agenda-empty">No hay eventos próximos.</span>}
          </div>
        </aside>
      </div>

      {(creating || editing) && (
        <CalendarEntryModal
          entry={editing}
          defaultDate={selectedDate}
          calendars={editing ? [] : calendars}
          onSave={saveEntry}
          onDelete={editing ? () => deleteEntry(editing) : undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
