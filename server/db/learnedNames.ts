import { db, normalizeText } from "./client.js";
import { scopeKey } from "./scopes.js";
import type { Scope } from "./types.js";

export async function rememberName(scope: Scope, name: string) {
  await db.execute({
    sql: `INSERT INTO learned_names (scope, name_key, name, uses, last_used_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(scope, name_key) DO UPDATE SET
      name = excluded.name, uses = uses + 1, last_used_at = excluded.last_used_at`,
    args: [scopeKey(scope), normalizeText(name), name, new Date().toISOString()]
  });
}

export async function findLearnedNames(scope: Scope, query: string) {
  const result = await db.execute({
    sql: `SELECT name, uses FROM learned_names
      WHERE scope = ? AND name_key LIKE ? ORDER BY uses DESC, last_used_at DESC LIMIT 20`,
    args: [scopeKey(scope), `%${normalizeText(query)}%`]
  });
  return result.rows.map((row) => ({ name: String(row.name), uses: Number(row.uses) }));
}
