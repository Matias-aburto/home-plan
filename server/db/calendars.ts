import { nanoid } from "nanoid";
import { db, text, value } from "./client.js";
import type { CalendarEntry, CalendarEntryInput, CalendarRecord, CalendarSummary } from "./types.js";

export type CalendarInput = { name: string; icon: string; color: string };

const calendarColumns = `c.id, c.owner_user_id, c.family_id, c.name, c.icon, c.color,
  c.created_by, c.created_at, c.updated_at, c.archived_at`;

function toRecord(row: Record<string, unknown>): CalendarRecord {
  return {
    id: String(row.id),
    ownerUserId: text(row.owner_user_id),
    familyId: text(row.family_id),
    name: String(row.name),
    icon: String(row.icon),
    color: String(row.color),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: text(row.archived_at)
  };
}

export async function getCalendarRecord(calendarId: string) {
  const result = await db.execute({ sql: `SELECT ${calendarColumns} FROM calendars c WHERE c.id = ?`, args: [calendarId] });
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

// Calendarios que el usuario ve: los propios y los de sus grupos (owner/admin administran, member edita eventos).
export async function visibleCalendars(userId: string): Promise<CalendarSummary[]> {
  const result = await db.execute({
    sql: `SELECT ${calendarColumns}, m.role AS family_role
      FROM calendars c
      LEFT JOIN family_members m ON m.family_id = c.family_id AND m.user_id = ?
      WHERE c.owner_user_id = ? OR m.user_id IS NOT NULL
      ORDER BY c.created_at`,
    args: [userId, userId]
  });
  return result.rows.map((row) => ({
    ...toRecord(row),
    access: row.owner_user_id === userId || row.family_role === "owner" || row.family_role === "admin" ? "owner" : "editor"
  }));
}

// Cada espacio (lo personal de alguien o un grupo) tiene como máximo un calendario.
export async function calendarForSpace(userId: string, familyId: string | null) {
  const result = await db.execute(familyId
    ? { sql: "SELECT id FROM calendars WHERE family_id = ?", args: [familyId] }
    : { sql: "SELECT id FROM calendars WHERE owner_user_id = ?", args: [userId] });
  return result.rows[0] ? String(result.rows[0].id) : null;
}

export async function createCalendar(userId: string, familyId: string | null, input: CalendarInput, requestedId?: string) {
  const id = requestedId || nanoid();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO calendars (id, owner_user_id, family_id, name, icon, color, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, familyId ? null : userId, familyId, input.name, input.icon, input.color, userId, now, now]
  });
  return (await getCalendarRecord(id))!;
}

export async function updateCalendar(
  calendarId: string,
  changes: Partial<Pick<CalendarRecord, "name" | "icon" | "color">> & { archived?: boolean }
) {
  const current = await getCalendarRecord(calendarId);
  if (!current) return null;
  const now = new Date().toISOString();
  const archivedAt = changes.archived === undefined
    ? current.archivedAt
    : changes.archived ? current.archivedAt || now : null;
  await db.execute({
    sql: "UPDATE calendars SET name = ?, icon = ?, color = ?, archived_at = ?, updated_at = ? WHERE id = ?",
    args: [changes.name ?? current.name, changes.icon ?? current.icon, changes.color ?? current.color, archivedAt, now, calendarId]
  });
  return getCalendarRecord(calendarId);
}

// Borra explícitamente sus eventos: no se depende de ON DELETE CASCADE.
export async function deleteCalendar(calendarId: string) {
  await db.batch([
    { sql: "DELETE FROM calendar_events WHERE calendar_id = ?", args: [calendarId] },
    { sql: "DELETE FROM calendars WHERE id = ?", args: [calendarId] }
  ], "write");
}

// ---- Eventos ----

const eventColumns = "id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at";

function toEvent(row: Record<string, unknown>): CalendarEntry {
  return {
    id: String(row.id),
    title: String(row.title),
    kind: String(row.kind) as CalendarEntry["kind"],
    date: String(row.event_date),
    time: text(row.event_time),
    recurrence: String(row.recurrence) as CalendarEntry["recurrence"],
    notes: text(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

// Eventos de varios calendarios juntos, para la agenda.
export async function agendaEvents(calendarIds: string[]) {
  if (!calendarIds.length) return [];
  const result = await db.execute({
    sql: `SELECT ${eventColumns}, calendar_id FROM calendar_events
      WHERE calendar_id IN (${calendarIds.map(() => "?").join(", ")})
      ORDER BY event_date, event_time, created_at`,
    args: calendarIds
  });
  return result.rows.map((row) => ({ ...toEvent(row), calendarId: String(row.calendar_id) }));
}

export async function listEvents(calendarId: string) {
  const result = await db.execute({
    sql: `SELECT ${eventColumns} FROM calendar_events WHERE calendar_id = ? ORDER BY event_date, event_time, created_at`,
    args: [calendarId]
  });
  return result.rows.map(toEvent);
}

export async function getEvent(calendarId: string, eventId: string) {
  const result = await db.execute({
    sql: `SELECT ${eventColumns} FROM calendar_events WHERE id = ? AND calendar_id = ?`,
    args: [eventId, calendarId]
  });
  return result.rows[0] ? toEvent(result.rows[0]) : null;
}

// Si el cliente reenvía un id ya guardado (cola offline), devuelve el existente.
export async function addEvent(calendarId: string, input: CalendarEntryInput, createdBy: string, requestedId?: string) {
  const existing = requestedId ? await getEvent(calendarId, requestedId) : null;
  if (existing) return existing;
  const now = new Date().toISOString();
  const event: CalendarEntry = { id: requestedId || nanoid(), ...input, createdAt: now, updatedAt: now };
  await db.execute({
    sql: `INSERT OR IGNORE INTO calendar_events
      (id, calendar_id, title, kind, event_date, event_time, recurrence, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      event.id, calendarId, input.title, input.kind, input.date, value(input.time), input.recurrence,
      value(input.notes), createdBy, now, now
    ]
  });
  return event;
}

export async function updateEvent(calendarId: string, eventId: string, input: CalendarEntryInput) {
  const result = await db.execute({
    sql: `UPDATE calendar_events SET title = ?, kind = ?, event_date = ?, event_time = ?, recurrence = ?, notes = ?,
      updated_at = ? WHERE id = ? AND calendar_id = ?`,
    args: [
      input.title, input.kind, input.date, value(input.time), input.recurrence, value(input.notes),
      new Date().toISOString(), eventId, calendarId
    ]
  });
  return result.rowsAffected > 0;
}

export async function deleteEvent(calendarId: string, eventId: string) {
  const result = await db.execute({
    sql: "DELETE FROM calendar_events WHERE id = ? AND calendar_id = ?",
    args: [eventId, calendarId]
  });
  return result.rowsAffected > 0;
}
