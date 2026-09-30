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

// Crea la familia con quien la crea como owner y dos listas iniciales.
export async function createFamily(userId: string, name: string) {
  const id = nanoid(8).replace(/[-_]/g, "A").toUpperCase();
  const now = new Date().toISOString();
  const lists = [
    { id: nanoid(), name: "Compras", kind: "shopping", icon: "shopping-basket", color: "green" },
    { id: nanoid(), name: "Por hacer", kind: "tasks", icon: "list-todo", color: "blue" }
  ];
  await db.batch([
    {
      sql: "INSERT INTO families (id, name, created_at, created_by, lists_migrated_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, name, now, userId, now]
    },
    {
      sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
      args: [id, userId, now]
    },
    ...lists.map((list) => ({
      sql: `INSERT INTO lists (id, owner_user_id, family_id, name, kind, icon, color, created_by, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [list.id, id, list.name, list.kind, list.icon, list.color, userId, now, now]
    }))
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
    { sql: "DELETE FROM family_members WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM invitations WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM shopping_items WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM household_tasks WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM learned_products WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM locations WHERE family_id = ?", args: [key] },
    { sql: "DELETE FROM families WHERE id = ?", args: [key] }
  ], "write");
}

export async function setMemberRole(familyId: string, userId: string, role: FamilyRole) {
  await db.execute({
    sql: "UPDATE family_members SET role = ? WHERE family_id = ? AND user_id = ?",
    args: [role, familyKey(familyId), userId]
  });
}

// Al salir, sus tareas asignadas en listas de la familia quedan sin asignar.
export async function removeMember(familyId: string, userId: string) {
  const key = familyKey(familyId);
  await db.batch([
    {
      sql: `UPDATE list_items SET assignee_user_id = NULL
        WHERE assignee_user_id = ? AND list_id IN (SELECT id FROM lists WHERE family_id = ?)`,
      args: [userId, key]
    },
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

// Una familia del modelo por código sin miembros la reclama quien ingresa su código.
export async function claimFamily(code: string, userId: string) {
  const key = familyKey(code);
  const family = await db.execute({ sql: "SELECT id FROM families WHERE id = ?", args: [key] });
  if (!family.rows[0]) return "missing" as const;
  const members = await db.execute({ sql: "SELECT 1 FROM family_members WHERE family_id = ? LIMIT 1", args: [key] });
  if (members.rows.length > 0) return "claimed" as const;
  const now = new Date().toISOString();
  await db.batch([
    {
      sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
      args: [key, userId, now]
    },
    {
      sql: "UPDATE families SET legacy_code_claimed_at = ?, created_by = COALESCE(created_by, ?) WHERE id = ?",
      args: [now, userId, key]
    }
  ], "write");
  return key;
}

// Nombres de responsables del modelo anterior ("Matías", "Francisca") que aún no se vinculan a un miembro.
export async function legacyAssignees(familyId: string) {
  const result = await db.execute({
    sql: `SELECT legacy_assignee AS name, COUNT(*) AS total FROM list_items
      WHERE legacy_assignee IS NOT NULL AND assignee_user_id IS NULL
        AND list_id IN (SELECT id FROM lists WHERE family_id = ?)
      GROUP BY legacy_assignee ORDER BY legacy_assignee`,
    args: [familyKey(familyId)]
  });
  return result.rows.map((row) => ({ name: String(row.name), count: Number(row.total) }));
}

export async function linkLegacyAssignee(familyId: string, name: string, userId: string) {
  await db.execute({
    sql: `UPDATE list_items SET assignee_user_id = ?, legacy_assignee = NULL
      WHERE legacy_assignee = ? AND list_id IN (SELECT id FROM lists WHERE family_id = ?)`,
    args: [userId, name, familyKey(familyId)]
  });
}
