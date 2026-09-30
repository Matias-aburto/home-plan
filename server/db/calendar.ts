import { nanoid } from "nanoid";
import { db, familyKey, text, value } from "./client.js";
import type { CalendarEntry, CalendarEntryInput } from "./types.js";

export async function getCalendarEntry(familyId: string, entryId: string): Promise<CalendarEntry | null> {
  const result = await db.execute({
    sql: `SELECT id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at
      FROM calendar_entries WHERE id = ? AND family_id = ?`,
    args: [entryId, familyKey(familyId)]
  });
  const row = result.rows[0];
  if (!row) return null;
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

// Si el cliente reenvía un id ya guardado (cola offline), devuelve la existente.
export async function addCalendarEntry(familyId: string, entry: CalendarEntryInput, requestedId?: string) {
  const existing = requestedId ? await getCalendarEntry(familyId, requestedId) : null;
  if (existing) return existing;
  const now = new Date().toISOString();
  const calendarEntry: CalendarEntry = {
    id: requestedId || nanoid(),
    ...entry,
    createdAt: now,
    updatedAt: now
  };
  await db.execute({
    sql: `INSERT OR IGNORE INTO calendar_entries
      (id, family_id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      calendarEntry.id, familyKey(familyId), entry.title, entry.kind, entry.date,
      value(entry.time), entry.recurrence, value(entry.notes), now, now
    ]
  });
  return calendarEntry;
}

export async function updateCalendarEntry(familyId: string, entryId: string, entry: CalendarEntryInput) {
  const result = await db.execute({
    sql: `UPDATE calendar_entries SET title = ?, kind = ?, event_date = ?, event_time = ?,
      recurrence = ?, notes = ?, updated_at = ? WHERE id = ? AND family_id = ?`,
    args: [
      entry.title, entry.kind, entry.date, value(entry.time), entry.recurrence,
      value(entry.notes), new Date().toISOString(), entryId, familyKey(familyId)
    ]
  });
  return result.rowsAffected > 0;
}

export async function deleteCalendarEntry(familyId: string, entryId: string) {
  const result = await db.execute({
    sql: "DELETE FROM calendar_entries WHERE id = ? AND family_id = ?",
    args: [entryId, familyKey(familyId)]
  });
  return result.rowsAffected > 0;
}
