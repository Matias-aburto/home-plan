import { nanoid } from "nanoid";
import { db, familyKey, normalizeText, text, value } from "./client.js";
import { archiveOlder, nextPosition, reorderEntries } from "./listEntries.js";
import { validLocationId } from "./locations.js";
import type { ShoppingItem } from "./types.js";

const table = "shopping_items";

export async function getItem(familyId: string, itemId: string): Promise<ShoppingItem | null> {
  const result = await db.execute({
    sql: `SELECT id, name, location_id, completed, position, created_at, updated_at, completed_at, archived_at
      FROM ${table} WHERE id = ? AND family_id = ?`,
    args: [itemId, familyKey(familyId)]
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    locationId: text(row.location_id),
    completed: Boolean(row.completed),
    position: Number(row.position || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: text(row.completed_at),
    archivedAt: text(row.archived_at)
  };
}

// Si el cliente reenvía un id ya guardado (cola offline), devuelve el existente.
export async function addItem(familyId: string, name: string, locationId: string | null, requestedId?: string) {
  const existing = requestedId ? await getItem(familyId, requestedId) : null;
  if (existing) return existing;
  const key = familyKey(familyId);
  const location = await validLocationId(key, locationId);
  const now = new Date().toISOString();
  const position = await nextPosition(table, key);
  const item: ShoppingItem = {
    id: requestedId || nanoid(), name, locationId: location, completed: false, position,
    createdAt: now, updatedAt: now, completedAt: null, archivedAt: null
  };
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO ${table}
        (id, family_id, name, location_id, completed, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      args: [item.id, key, name, value(location), position, now, now]
    },
    {
      sql: `INSERT INTO learned_products (family_id, name_key, name, uses, last_used_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(family_id, name_key) DO UPDATE SET
        name = excluded.name, uses = uses + 1, last_used_at = excluded.last_used_at`,
      args: [key, normalizeText(name), name, now]
    }
  ], "write");
  return item;
}

export async function setItemCompleted(familyId: string, itemId: string, completed: boolean) {
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `UPDATE ${table} SET completed = ?, updated_at = ?, completed_at = ?, archived_at = NULL
      WHERE id = ? AND family_id = ?`,
    args: [completed ? 1 : 0, now, value(completed ? now : null), itemId, familyKey(familyId)]
  });
  if (result.rowsAffected === 0) return false;
  await archiveOlder(table, familyId, now);
  return true;
}

export async function updateItemDetails(familyId: string, itemId: string, name: string, locationId: string | null) {
  const location = await validLocationId(familyId, locationId);
  const result = await db.execute({
    sql: `UPDATE ${table} SET name = ?, location_id = ?, updated_at = ?
      WHERE id = ? AND family_id = ?`,
    args: [name, value(location), new Date().toISOString(), itemId, familyKey(familyId)]
  });
  return result.rowsAffected > 0;
}

export async function reorderItems(familyId: string, ids: string[]) {
  await reorderEntries(table, familyId, ids);
}

export async function deleteItem(familyId: string, itemId: string) {
  const result = await db.execute({
    sql: `DELETE FROM ${table} WHERE id = ? AND family_id = ?`,
    args: [itemId, familyKey(familyId)]
  });
  return result.rowsAffected > 0;
}

export async function getLearnedProducts(familyId: string, query: string) {
  const result = await db.execute({
    sql: `SELECT name, uses, last_used_at FROM learned_products
      WHERE family_id = ? AND name_key LIKE ? ORDER BY uses DESC, last_used_at DESC LIMIT 20`,
    args: [familyKey(familyId), `%${normalizeText(query)}%`]
  });
  return result.rows.map((row) => ({
    name: String(row.name),
    uses: Number(row.uses),
    lastUsedAt: String(row.last_used_at)
  }));
}
