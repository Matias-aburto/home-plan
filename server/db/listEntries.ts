import { db, familyKey } from "./client.js";
import type { ListTable } from "./types.js";

// Lógica compartida por compras y tareas: orden manual y archivado de completados.

export async function nextPosition(table: ListTable, familyId: string) {
  const result = await db.execute({
    sql: `SELECT MIN(position) AS top FROM ${table} WHERE family_id = ? AND completed = 0`,
    args: [familyKey(familyId)]
  });
  const top = result.rows[0]?.top;
  return top === null || top === undefined ? 0 : Number(top) - 1;
}

export async function reorderEntries(table: ListTable, familyId: string, ids: string[]) {
  const pending = await db.execute({
    sql: `SELECT id FROM ${table} WHERE family_id = ? AND completed = 0`,
    args: [familyKey(familyId)]
  });
  const pendingIds = new Set(pending.rows.map((row) => String(row.id)));
  const ordered = [...new Set(ids)].filter((id) => pendingIds.has(id));
  if (ordered.length === 0) return;
  await db.batch(ordered.map((id, index) => ({
    sql: `UPDATE ${table} SET position = ? WHERE id = ? AND family_id = ?`,
    args: [index, id, familyKey(familyId)]
  })), "write");
}

// Mantiene visibles solo los 5 completados más recientes de las últimas 24 horas.
export async function archiveOlder(table: ListTable, familyId: string, now: string) {
  const cutoff = new Date(new Date(now).getTime() - 24 * 60 * 60 * 1000).toISOString();
  await db.execute({
    sql: `UPDATE ${table}
      SET archived_at = CASE
        WHEN id IN (
          SELECT id FROM ${table}
          WHERE family_id = ? AND completed = 1
            AND COALESCE(completed_at, updated_at) >= ?
          ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 5
        ) THEN NULL
        ELSE COALESCE(archived_at, ?)
      END
      WHERE family_id = ? AND completed = 1`,
    args: [familyKey(familyId), cutoff, now, familyKey(familyId)]
  });
}
