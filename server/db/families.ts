import { nanoid } from "nanoid";
import { db, familyKey, text } from "./client.js";
import type { FamilyMember, FamilyRole, FamilySummary } from "./types.js";

const roleRank: Record<FamilyRole, number> = { member: 0, admin: 1, owner: 2 };

export function roleAtLeast(role: FamilyRole, required: FamilyRole) {
  return roleRank[role] >= roleRank[required];
}

export async function familyExists(id: string) {
  const result = await db.execute({ sql: "SELECT 1 FROM families WHERE id = ?", args: [familyKey(id)] });
  return result.rows.length > 0;
}

export async function getMembership(familyId: string, userId: string) {
  const result = await db.execute({
    sql: "SELECT role FROM family_members WHERE family_id = ? AND user_id = ?",
    args: [familyKey(familyId), userId]
  });
  return result.rows[0] ? String(result.rows[0].role) as FamilyRole : null;
}

export async function userFamilies(userId: string): Promise<FamilySummary[]> {
  const result = await db.execute({
    sql: `SELECT f.id, f.name, f.created_at, m.role,
        (SELECT COUNT(*) FROM family_members c WHERE c.family_id = f.id) AS member_count
      FROM family_members m JOIN families f ON f.id = m.family_id
      WHERE m.user_id = ? ORDER BY m.joined_at, f.name`,
    args: [userId]
  });
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    role: String(row.role) as FamilyRole,
    memberCount: Number(row.member_count)
  }));
}

export async function familySummary(familyId: string, userId: string) {
  return (await userFamilies(userId)).find(({ id }) => id === familyKey(familyId)) ?? null;
}

export async function listMembers(familyId: string): Promise<FamilyMember[]> {
  const result = await db.execute({
    sql: `SELECT u.id, u.name, u.email, u.avatar_url, u.color, m.role, m.joined_at
      FROM family_members m JOIN users u ON u.id = m.user_id
      WHERE m.family_id = ? ORDER BY m.joined_at`,
    args: [familyKey(familyId)]
  });
  return result.rows.map((row) => ({
    userId: String(row.id),
    name: String(row.name),
    email: String(row.email),
    avatarUrl: text(row.avatar_url),
    color: String(row.color),
    role: String(row.role) as FamilyRole,
    joinedAt: String(row.joined_at)
  }));
}

// Crea el grupo, vacío, con quien lo crea como owner.
export async function createFamily(userId: string, name: string) {
  const id = nanoid(8).replace(/[-_]/g, "A").toUpperCase();
  const now = new Date().toISOString();
  await db.batch([
    {
      sql: "INSERT INTO families (id, name, created_at, created_by) VALUES (?, ?, ?, ?)",
      args: [id, name, now, userId]
    },
    {
      sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
      args: [id, userId, now]
    }
  ], "write");
  return id;
}

export async function renameFamily(familyId: string, name: string) {
  await db.execute({ sql: "UPDATE families SET name = ? WHERE id = ?", args: [name, familyKey(familyId)] });
}

// Borra la familia y todo lo suyo. Explícito: no se depende de ON DELETE CASCADE.
export async function deleteFamily(familyId: string) {
  const key = familyKey(familyId);
  const familyLists = "SELECT id FROM lists WHERE family_id = ?";
  await db.batch([
    { sql: `DELETE FROM list_items WHERE list_id IN (${familyLists})`, args: [key] },
    { sql: `DELETE FROM user_list_prefs WHERE list_id IN (${familyLists})`, args: [key] },
    { sql: "DELETE FROM lists WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM places WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM learned_names WHERE scope = ?", args: [`family:${key}`] },
    { sql: "DELETE FROM calendar_entries WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM calendar_events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = ?)", args: [key] },
    { sql: "DELETE FROM calendars WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM family_members WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM invitations WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM families WHERE id = ?", args: [key] }
  ], "write");
}

export async function setMemberRole(familyId: string, userId: string, role: FamilyRole) {
  await db.execute({
    sql: "UPDATE family_members SET role = ? WHERE family_id = ? AND user_id = ?",
    args: [role, familyKey(familyId), userId]
  });
}

export async function removeMember(familyId: string, userId: string) {
  const key = familyKey(familyId);
  await db.batch([
    {
      sql: "DELETE FROM user_list_prefs WHERE user_id = ? AND list_id IN (SELECT id FROM lists WHERE family_id = ?)",
      args: [userId, key]
    },
    { sql: "DELETE FROM family_members WHERE family_id = ? AND user_id = ?", args: [key, userId] }
  ], "write");
}

export async function transferOwnership(familyId: string, fromUserId: string, toUserId: string) {
  const key = familyKey(familyId);
  await db.batch([
    { sql: "UPDATE family_members SET role = 'owner' WHERE family_id = ? AND user_id = ?", args: [key, toUserId] },
    { sql: "UPDATE family_members SET role = 'admin' WHERE family_id = ? AND user_id = ?", args: [key, fromUserId] }
  ], "write");
}
