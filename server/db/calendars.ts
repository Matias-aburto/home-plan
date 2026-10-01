import { nanoid } from "nanoid";
import { db, text, value } from "./client.js";
import type { CalendarEvent, CalendarEventInput } from "./types.js";

// Cada espacio (lo personal de alguien o un grupo) tiene un calendario interno que agrupa sus eventos.
// El usuario no lo ve: ve un solo calendario con los eventos de todos sus espacios.

export async function spaceCalendarId(userId: string, familyId: string | null) {
  const result = await db.execute(familyId
    ? { sql: "SELECT id FROM calendars WHERE family_id = ?", args: [familyId] }
    : { sql: "SELECT id FROM calendars WHERE owner_user_id = ?", args: [userId] });
  return result.rows[0] ? String(result.rows[0].id) : null;
}

// Lo crea con el primer evento del espacio.
export async function ensureSpaceCalendar(userId: string, familyId: string | null) {
  const existing = await spaceCalendarId(userId, familyId);
  if (existing) return existing;
  const id = nanoid();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR IGNORE INTO calendars (id, owner_user_id, family_id, name, icon, color, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'Calendario', 'calendar', 'blue', ?, ?, ?)`,
    args: [id, familyId ? null : userId, familyId, userId, now, now]
  });
  // Si otro pedido lo creó al mismo tiempo, el índice único deja uno solo.
  return (await spaceCalendarId(userId, familyId))!;
}

const eventColumns = `e.id, e.title, e.event_date, e.event_time, e.recurrence, e.notes, e.created_by,
  e.created_at, e.updated_at, c.family_id, c.owner_user_id`;

function toEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: String(row.id),
    familyId: text(row.family_id),
    title: String(row.title),
    date: String(row.event_date),
    time: text(row.event_time),
    recurrence: String(row.recurrence) as CalendarEvent["recurrence"],
    notes: text(row.notes),
    createdBy: text(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

// Eventos que ve el usuario: los personales y los de sus grupos.
export async function userEvents(userId: string) {
  const result = await db.execute({
    sql: `SELECT ${eventColumns}
      FROM calendar_events e
      JOIN calendars c ON c.id = e.calendar_id
      LEFT JOIN family_members m ON m.family_id = c.family_id AND m.user_id = ?
      WHERE c.owner_user_id = ? OR m.user_id IS NOT NULL
      ORDER BY e.event_date, e.event_time, e.created_at`,
    args: [userId, userId]
  });
  return result.rows.map(toEvent);
}

// El evento con el dueño de su espacio, para revisar permisos.
export async function getEventRecord(eventId: string) {
  const result = await db.execute({
    sql: `SELECT ${eventColumns} FROM calendar_events e JOIN calendars c ON c.id = e.calendar_id WHERE e.id = ?`,
    args: [eventId]
  });
  const row = result.rows[0];
  return row ? { event: toEvent(row), ownerUserId: text(row.owner_user_id) } : null;
}

export async function addEvent(calendarId: string, input: CalendarEventInput, createdBy: string, requestedId?: string) {
  const now = new Date().toISOString();
  const id = requestedId || nanoid();
  await db.execute({
    sql: `INSERT INTO calendar_events
      (id, calendar_id, title, kind, event_date, event_time, recurrence, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'event', ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, calendarId, input.title, input.date, value(input.time), input.recurrence, value(input.notes), createdBy, now, now]
  });
  return (await getEventRecord(id))!.event;
}

// Actualiza el evento y, si cambia de espacio, lo pasa al calendario de destino.
export async function updateEvent(eventId: string, input: CalendarEventInput, calendarId: string) {
  await db.execute({
    sql: `UPDATE calendar_events SET calendar_id = ?, title = ?, event_date = ?, event_time = ?, recurrence = ?,
      notes = ?, updated_at = ? WHERE id = ?`,
    args: [
      calendarId, input.title, input.date, value(input.time), input.recurrence, value(input.notes),
      new Date().toISOString(), eventId
    ]
  });
  return (await getEventRecord(eventId))!.event;
}

export async function deleteEvent(eventId: string) {
  await db.execute({ sql: "DELETE FROM calendar_events WHERE id = ?", args: [eventId] });
}
