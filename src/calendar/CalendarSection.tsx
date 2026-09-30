import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { CalendarEntryModal } from "./CalendarEntryModal";
import { CalendarEntryRow } from "./CalendarEntryRow";
import { compactDateFormatter, dateKey, dayFormatter, entriesOnDate, localDate, monthFormatter, occurrenceKey } from "../lib/calendar";
import type { CalendarEntry, OfflineMutation } from "../types";

export function CalendarSection({
  familyId,
  entries,
  onMutate
}: {
  familyId: string;
  entries: CalendarEntry[];
  onMutate: (entries: CalendarEntry[], operation: OfflineMutation) => Promise<void>;
}) {
  const today = dateKey(new Date());
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [editing, setEditing] = useState<CalendarEntry | null>(null);
  const [creating, setCreating] = useState(false);

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
    ).slice(0, 6);
  }, [entries, today]);

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

  async function saveEntry(data: Omit<CalendarEntry, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    if (editing) {
      const updated = { ...editing, ...data, updatedAt: now };
      await onMutate(entries.map((entry) => entry.id === editing.id ? updated : entry), {
        url: `/api/families/${familyId}/calendar/${editing.id}`,
        method: "PATCH",
        body: data
      });
    } else {
      const entry: CalendarEntry = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: now,
        updatedAt: now
      };
      await onMutate([...entries, entry], {
        url: `/api/families/${familyId}/calendar`,
        method: "POST",
        body: { id: entry.id, ...data }
      });
    }
    setCreating(false);
    setEditing(null);
  }

  async function deleteEntry(entry: CalendarEntry) {
    await onMutate(entries.filter(({ id }) => id !== entry.id), {
      url: `/api/families/${familyId}/calendar/${entry.id}`,
      method: "DELETE"
    });
    setEditing(null);
  }

  return (
    <section className="content calendar-content">
      <div className="content-heading calendar-heading">
        <div className="title-only"><h2>Calendario</h2></div>
        <button className="calendar-add-button" onClick={() => setCreating(true)}>
          <Plus size={18} /> Nuevo
        </button>
      </div>

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
                      <b key={entry.id} className={entry.kind} />
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
            {selectedEntries.length ? selectedEntries.map((entry) => (
              <CalendarEntryRow key={entry.id} entry={entry} onEdit={setEditing} />
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
