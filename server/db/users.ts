import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { db, text } from "./client.js";
import type { User } from "./types.js";

export const userColors = ["green", "blue", "amber", "rose", "violet", "teal"] as const;

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
};

function colorFor(email: string) {
  const hash = createHash("sha256").update(email).digest();
  return userColors[hash[0] % userColors.length];
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    avatarUrl: text(row.avatar_url),
    color: String(row.color)
  };
}

export async function getUser(id: string) {
  const result = await db.execute({
    sql: "SELECT id, email, name, avatar_url, color FROM users WHERE id = ?",
    args: [id]
  });
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

// Crea el usuario en su primer login. En los siguientes solo actualiza email y foto:
// el nombre visible lo puede haber cambiado el propio usuario.
export async function upsertGoogleUser(profile: GoogleProfile) {
  const email = profile.email.toLowerCase();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO users (id, google_sub, email, name, avatar_url, color, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET
        email = excluded.email, avatar_url = excluded.avatar_url, last_login_at = excluded.last_login_at`,
    args: [nanoid(), profile.sub, email, profile.name || email, profile.picture, colorFor(email), now, now]
  });
  const result = await db.execute({
    sql: "SELECT id, email, name, avatar_url, color FROM users WHERE google_sub = ?",
    args: [profile.sub]
  });
  return toUser(result.rows[0]);
}

export async function updateUser(id: string, changes: { name?: string; color?: string }) {
  const current = await getUser(id);
  if (!current) return null;
  await db.execute({
    sql: "UPDATE users SET name = ?, color = ? WHERE id = ?",
    args: [changes.name ?? current.name, changes.color ?? current.color, id]
  });
  return getUser(id);
}
