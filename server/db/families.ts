import { nanoid } from "nanoid";
import { db, familyKey, text } from "./client.js";
import { archiveOlder } from "./listEntries.js";
import type { Assignee, CalendarEntry, Family } from "./types.js";

export async function createFamily(name: string, requestedId?: string) {
  const id = requestedId || nanoid(8).replace(/[-_]/g, "A").toUpperCase();
  const now = new Date().toISOString();
  await db.batch([
    { sql: "INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)", args: [id, name, now] },
    { sql: "INSERT INTO locations (id, family_id, name) VALUES (?, ?, ?)", args: [nanoid(8), id, "Ciudad"] },
    { sql: "INSERT INTO locations (id, family_id, name) VALUES (?, ?, ?)", args: [nanoid(8), id, "Campo"] }
  ], "write");
  return (await getFamily(id))!;
}

export async function familyExists(id: string) {
  const result = await db.execute({ sql: "SELECT 1 FROM families WHERE id = ?", args: [familyKey(id)] });
  return result.rows.length > 0;
}

// Devuelve la familia completa. Antes archiva los completados antiguos para que el cliente reciba el estado final.
export async function getFamily(id: string): Promise<Family | null> {
  const key = familyKey(id);
  const familyResult = await db.execute({
    sql: "SELECT id, name, created_at FROM families WHERE id = ?",
    args: [key]
  });
  const familyRow = familyResult.rows[0];
  if (!familyRow) return null;

  const now = new Date().toISOString();
  await Promise.all([
    archiveOlder("shopping_items", key, now),
    archiveOlder("household_tasks", key, now)
  ]);

  const [locationsResult, itemsResult, tasksResult, calendarResult] = await Promise.all([
    db.execute({ sql: "SELECT id, name FROM locations WHERE family_id = ? ORDER BY rowid", args: [key] }),
    db.execute({
      sql: `SELECT id, name, location_id, completed, position, created_at, updated_at, completed_at, archived_at
        FROM shopping_items WHERE family_id = ? ORDER BY position ASC, created_at DESC`,
      args: [key]
    }),
    db.execute({
      sql: `SELECT id, title, assignee, location_id, completed, position, created_at, updated_at, completed_at, archived_at
        FROM household_tasks WHERE family_id = ? ORDER BY position ASC, created_at DESC`,
      args: [key]
    }),
    db.execute({
      sql: `SELECT id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at
        FROM calendar_entries WHERE family_id = ? ORDER BY event_date, event_time, created_at`,
      args: [key]
    })
  ]);

  return {
    id: String(familyRow.id),
    name: String(familyRow.name),
    createdAt: String(familyRow.created_at),
    locations: locationsResult.rows.map((row) => ({ id: String(row.id), name: String(row.name) })),
    learnedProducts: [],
    items: itemsResult.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      locationId: text(row.location_id),
      completed: Boolean(row.completed),
      position: Number(row.position || 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: text(row.completed_at),
      archivedAt: text(row.archived_at)
    })),
    tasks: tasksResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      assignee: text(row.assignee) as Assignee | null,
      locationId: text(row.location_id),
      completed: Boolean(row.completed),
      position: Number(row.position || 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: text(row.completed_at),
      archivedAt: text(row.archived_at)
    })),
    calendarEntries: calendarResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      kind: String(row.kind) as CalendarEntry["kind"],
      date: String(row.event_date),
      time: text(row.event_time),
      recurrence: String(row.recurrence) as CalendarEntry["recurrence"],
      notes: text(row.notes),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }))
  };
}
