import { createHash, randomBytes } from "node:crypto";
import { db } from "./client.js";
import { getUser } from "./users.js";

export const sessionDurationMs = 60 * 24 * 60 * 60 * 1000;
const renewAfterMs = 24 * 60 * 60 * 1000;

// En la base solo se guarda el hash: filtrar la tabla no permite usar las sesiones.
function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.execute({
    sql: `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      hashToken(token), userId, now.toISOString(),
      new Date(now.getTime() + sessionDurationMs).toISOString(), now.toISOString(),
      userAgent ? userAgent.slice(0, 200) : null
    ]
  });
  return token;
}

// Devuelve el usuario de la sesión. Si lleva más de un día sin renovarse, extiende el vencimiento.
export async function resolveSession(token: string) {
  const id = hashToken(token);
  const result = await db.execute({
    sql: "SELECT user_id, expires_at, last_seen_at FROM sessions WHERE id = ?",
    args: [id]
  });
  const row = result.rows[0];
  if (!row) return null;
  const now = new Date();
  if (String(row.expires_at) <= now.toISOString()) {
    await db.execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [id] });
    return null;
  }
  const user = await getUser(String(row.user_id));
  if (!user) return null;
  const renewed = now.getTime() - new Date(String(row.last_seen_at)).getTime() > renewAfterMs;
  if (renewed) {
    await db.execute({
      sql: "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?",
      args: [now.toISOString(), new Date(now.getTime() + sessionDurationMs).toISOString(), id]
    });
  }
  return { user, renewed };
}

export async function deleteSession(token: string) {
  await db.execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [hashToken(token)] });
}

export async function deleteUserSessions(userId: string) {
  await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [userId] });
}
