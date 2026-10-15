import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { db, text } from "./client.js";
import { getUser } from "./users.js";

// Tokens con que un asistente (por ejemplo, Claude por MCP) actúa a nombre de una persona.
// No vencen: se revocan desde la app.

export type ApiToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

const touchAfterMs = 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiToken(userId: string, name: string) {
  const token = randomBytes(32).toString("base64url");
  const apiToken: ApiToken = { id: nanoid(), name, createdAt: new Date().toISOString(), lastUsedAt: null };
  await db.execute({
    sql: "INSERT INTO api_tokens (id, token_hash, user_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [apiToken.id, hashToken(token), userId, name, apiToken.createdAt]
  });
  return { apiToken, token };
}

export async function userApiTokens(userId: string): Promise<ApiToken[]> {
  const result = await db.execute({
    sql: "SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC",
    args: [userId]
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    lastUsedAt: text(row.last_used_at)
  }));
}

export async function deleteApiToken(userId: string, id: string) {
  const result = await db.execute({ sql: "DELETE FROM api_tokens WHERE id = ? AND user_id = ?", args: [id, userId] });
  return result.rowsAffected > 0;
}

// Devuelve el usuario del token. El último uso se anota como mucho una vez por hora.
export async function resolveApiToken(token: string) {
  const result = await db.execute({
    sql: "SELECT id, user_id, last_used_at FROM api_tokens WHERE token_hash = ?",
    args: [hashToken(token)]
  });
  const row = result.rows[0];
  if (!row) return null;
  const user = await getUser(String(row.user_id));
  if (!user) return null;
  const now = new Date();
  const lastUsed = text(row.last_used_at);
  if (!lastUsed || now.getTime() - new Date(lastUsed).getTime() > touchAfterMs) {
    await db.execute({ sql: "UPDATE api_tokens SET last_used_at = ? WHERE id = ?", args: [now.toISOString(), String(row.id)] });
  }
  return user;
}
