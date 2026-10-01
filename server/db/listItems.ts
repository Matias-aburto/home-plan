import { nanoid } from "nanoid";
import { db, text, value } from "./client.js";
import type { ListItem } from "./types.js";

const columns = `id, title, completed, position, created_by,
  created_at, updated_at, completed_at, archived_at`;

function toItem(row: Record<string, unknown>): ListItem {
  return {
    id: String(row.id),
    title: String(row.title),
    completed: Boolean(row.completed),
    position: Number(row.position || 0),
    createdBy: text(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: text(row.completed_at),
    archivedAt: text(row.archived_at)
  };
}

export async function getListItem(listId: string, itemId: string) {
  const result = await db.execute({
    sql: `SELECT ${columns} FROM list_items WHERE id = ? AND list_id = ?`,
    args: [itemId, listId]
  });
  return result.rows[0] ? toItem(result.rows[0]) : null;
}

// Devuelve los ítems de la lista después de archivar los completados antiguos.
export async function getListItems(listId: string) {
  await archiveOlderItems(listId, new Date().toISOString());
  const result = await db.execute({
    sql: `SELECT ${columns} FROM list_items WHERE list_id = ? ORDER BY position ASC, created_at DESC`,
    args: [listId]
  });
  return result.rows.map(toItem);
}

async function nextItemPosition(listId: string) {
  const result = await db.execute({
    sql: "SELECT MIN(position) AS top FROM list_items WHERE list_id = ? AND completed = 0",
    args: [listId]
  });
  const top = result.rows[0]?.top;
  return top === null || top === undefined ? 0 : Number(top) - 1;
}

// Los ítems nuevos quedan arriba. Si el id ya existe (reenvío de la cola offline) devuelve el existente.
export async function addListItem(
  listId: string,
  input: { title: string; createdBy: string },
  requestedId?: string
) {
  const existing = requestedId ? await getListItem(listId, requestedId) : null;
  if (existing) return existing;
  const now = new Date().toISOString();
  const item: ListItem = {
    id: requestedId || nanoid(),
    title: input.title,
    completed: false,
    position: await nextItemPosition(listId),
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    archivedAt: null
  };
  await db.execute({
    sql: `INSERT OR IGNORE INTO list_items
      (id, list_id, title, completed, position, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    args: [item.id, listId, item.title, item.position, item.createdBy, now, now]
  });
  return item;
}

// Los campos `undefined` conservan su valor actual.
export async function updateListItem(
  listId: string,
  itemId: string,
  changes: { title?: string; completed?: boolean }
) {
  const current = await getListItem(listId, itemId);
  if (!current) return null;
  const now = new Date().toISOString();
  const completed = changes.completed ?? current.completed;
  const completedAt = completed
    ? changes.completed === true && !current.completed ? now : current.completedAt ?? now
    : null;
  await db.execute({
    sql: `UPDATE list_items SET title = ?, completed = ?, updated_at = ?, completed_at = ?, archived_at = NULL
      WHERE id = ? AND list_id = ?`,
    args: [changes.title ?? current.title, completed ? 1 : 0, now, value(completedAt), itemId, listId]
  });
  if (changes.completed !== undefined) await archiveOlderItems(listId, now);
  return getListItem(listId, itemId);
}

export async function deleteListItem(listId: string, itemId: string) {
  const result = await db.execute({
    sql: "DELETE FROM list_items WHERE id = ? AND list_id = ?",
    args: [itemId, listId]
  });
  return result.rowsAffected > 0;
}

// Reordena los pendientes según `ids`; los que no son pendientes de la lista se ignoran.
export async function reorderListItems(listId: string, ids: string[]) {
  const pending = await db.execute({
    sql: "SELECT id FROM list_items WHERE list_id = ? AND completed = 0",
    args: [listId]
  });
  const pendingIds = new Set(pending.rows.map((row) => String(row.id)));
  const ordered = [...new Set(ids)].filter((id) => pendingIds.has(id));
  if (ordered.length === 0) return;
  await db.batch(ordered.map((id, index) => ({
    sql: "UPDATE list_items SET position = ? WHERE id = ? AND list_id = ?",
    args: [index, id, listId]
  })), "write");
}

// Misma regla que las listas antiguas: quedan visibles los 5 completados más recientes de las últimas 24 horas.
async function archiveOlderItems(listId: string, now: string) {
  const cutoff = new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: `UPDATE list_items
      SET archived_at = CASE
        WHEN id IN (
          SELECT id FROM list_items
          WHERE list_id = ? AND completed = 1 AND COALESCE(completed_at, updated_at) >= ?
          ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 5
        ) THEN NULL
        ELSE COALESCE(archived_at, ?)
      END
      WHERE list_id = ? AND completed = 1`,
    args: [listId, cutoff, now, listId]
  });
}
