import { nanoid } from "nanoid";
import { db } from "./client.js";

// Autor de las listas creadas por la migración (las familias antiguas no tenían usuarios).
export const systemUserId = "system";

// Convierte cada familia del modelo por código a listas nuevas, una sola vez por familia:
// "Compras" y "Por hacer" pasan a ser listas de la familia, conservando los ids de ítems y
// ubicaciones. Las tablas antiguas no se tocan y quedan como respaldo.
export async function migrateLegacyFamilies() {
  const pending = await db.execute("SELECT id FROM families WHERE lists_migrated_at IS NULL");
  for (const row of pending.rows) await migrateFamily(String(row.id));
}

async function migrateFamily(familyId: string) {
  const now = new Date().toISOString();
  const shoppingId = nanoid();
  const tasksId = nanoid();
  // Un batch "write" es una transacción: la familia queda migrada completa o no se toca.
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO places (id, owner_user_id, family_id, name, created_at)
        SELECT id, NULL, family_id, name, ? FROM locations WHERE family_id = ?`,
      args: [now, familyId]
    },
    {
      sql: `INSERT INTO lists (id, owner_user_id, family_id, name, kind, icon, color, created_by, created_at, updated_at)
        VALUES (?, NULL, ?, 'Compras', 'shopping', 'shopping-basket', 'green', ?, ?, ?)`,
      args: [shoppingId, familyId, systemUserId, now, now]
    },
    {
      sql: `INSERT INTO lists (id, owner_user_id, family_id, name, kind, icon, color, created_by, created_at, updated_at)
        VALUES (?, NULL, ?, 'Por hacer', 'tasks', 'list-todo', 'blue', ?, ?, ?)`,
      args: [tasksId, familyId, systemUserId, now, now]
    },
    {
      sql: `INSERT OR IGNORE INTO list_items
        (id, list_id, title, completed, position, location_id, created_at, updated_at, completed_at, archived_at)
        SELECT id, ?, name, completed, position,
          CASE WHEN location_id IN (SELECT id FROM places) THEN location_id END,
          created_at, updated_at, completed_at, archived_at
        FROM shopping_items WHERE family_id = ?`,
      args: [shoppingId, familyId]
    },
    {
      sql: `INSERT OR IGNORE INTO list_items
        (id, list_id, title, completed, position, location_id, legacy_assignee, created_at, updated_at, completed_at, archived_at)
        SELECT id, ?, title, completed, position,
          CASE WHEN location_id IN (SELECT id FROM places) THEN location_id END,
          assignee, created_at, updated_at, completed_at, archived_at
        FROM household_tasks WHERE family_id = ?`,
      args: [tasksId, familyId]
    },
    {
      sql: `INSERT OR IGNORE INTO learned_names (scope, name_key, name, uses, last_used_at)
        SELECT 'family:' || family_id, name_key, name, uses, last_used_at FROM learned_products WHERE family_id = ?`,
      args: [familyId]
    },
    { sql: "UPDATE families SET lists_migrated_at = ? WHERE id = ?", args: [now, familyId] }
  ], "write");
}
