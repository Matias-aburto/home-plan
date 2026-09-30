import { nanoid } from "nanoid";
import { db, familyKey, text, value } from "./client.js";
import { archiveOlder, nextPosition, reorderEntries } from "./listEntries.js";
import { validLocationId } from "./locations.js";
import type { Assignee, HouseholdTask } from "./types.js";

const table = "household_tasks";

export async function getTask(familyId: string, taskId: string): Promise<HouseholdTask | null> {
  const result = await db.execute({
    sql: `SELECT id, title, assignee, location_id, completed, position, created_at, updated_at, completed_at, archived_at
      FROM ${table} WHERE id = ? AND family_id = ?`,
    args: [taskId, familyKey(familyId)]
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
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
  };
}

// Si el cliente reenvía un id ya guardado (cola offline), devuelve la existente.
export async function addTask(
  familyId: string,
  title: string,
  assignee: Assignee | null,
  locationId: string | null,
  requestedId?: string
) {
  const existing = requestedId ? await getTask(familyId, requestedId) : null;
  if (existing) return existing;
  const key = familyKey(familyId);
  const location = await validLocationId(key, locationId);
  const now = new Date().toISOString();
  const position = await nextPosition(table, key);
  const task: HouseholdTask = {
    id: requestedId || nanoid(), title, assignee, locationId: location, completed: false, position,
    createdAt: now, updatedAt: now, completedAt: null, archivedAt: null
  };
  await db.execute({
    sql: `INSERT OR IGNORE INTO ${table}
      (id, family_id, title, assignee, location_id, completed, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    args: [task.id, key, title, value(assignee), value(location), position, now, now]
  });
  return task;
}

// Los campos `undefined` conservan su valor actual.
export async function updateTask(
  familyId: string,
  taskId: string,
  changes: {
    completed?: boolean;
    assignee?: Assignee | null;
    locationId?: string | null;
    title?: string;
  }
) {
  const current = await getTask(familyId, taskId);
  if (!current) return false;
  const completed = changes.completed ?? current.completed;
  const title = changes.title ?? current.title;
  const assignee = changes.assignee === undefined ? current.assignee : changes.assignee;
  const location = changes.locationId === undefined
    ? current.locationId
    : await validLocationId(familyId, changes.locationId);
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE ${table} SET title = ?, completed = ?, assignee = ?, location_id = ?, updated_at = ?,
      completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE NULL END,
      archived_at = NULL WHERE id = ? AND family_id = ?`,
    args: [
      title, completed ? 1 : 0, value(assignee), value(location), now,
      completed ? 1 : 0, now,
      taskId, familyKey(familyId)
    ]
  });
  await archiveOlder(table, familyId, now);
  return true;
}

export async function reorderTasks(familyId: string, ids: string[]) {
  await reorderEntries(table, familyId, ids);
}

export async function deleteTask(familyId: string, taskId: string) {
  const result = await db.execute({
    sql: `DELETE FROM ${table} WHERE id = ? AND family_id = ?`,
    args: [taskId, familyKey(familyId)]
  });
  return result.rowsAffected > 0;
}
