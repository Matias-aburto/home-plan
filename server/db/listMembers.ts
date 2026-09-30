import { db, text } from "./client.js";

export type ListPermission = "editor" | "viewer";

export type ListMember = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  color: string;
  permission: ListPermission;
};

export async function getListPermission(listId: string, userId: string) {
  const result = await db.execute({
    sql: "SELECT permission FROM list_members WHERE list_id = ? AND user_id = ?",
    args: [listId, userId]
  });
  return result.rows[0] ? String(result.rows[0].permission) as ListPermission : null;
}

export async function listSharedMembers(listId: string): Promise<ListMember[]> {
  const result = await db.execute({
    sql: `SELECT u.id, u.name, u.email, u.avatar_url, u.color, m.permission
      FROM list_members m JOIN users u ON u.id = m.user_id
      WHERE m.list_id = ? ORDER BY m.added_at`,
    args: [listId]
  });
  return result.rows.map((row) => ({
    userId: String(row.id),
    name: String(row.name),
    email: String(row.email),
    avatarUrl: text(row.avatar_url),
    color: String(row.color),
    permission: String(row.permission) as ListPermission
  }));
}

export async function addListMember(listId: string, userId: string, permission: ListPermission, addedBy: string) {
  await db.execute({
    sql: `INSERT INTO list_members (list_id, user_id, permission, added_by, added_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(list_id, user_id) DO UPDATE SET permission = excluded.permission`,
    args: [listId, userId, permission, addedBy, new Date().toISOString()]
  });
}

export async function setListMemberPermission(listId: string, userId: string, permission: ListPermission) {
  const result = await db.execute({
    sql: "UPDATE list_members SET permission = ? WHERE list_id = ? AND user_id = ?",
    args: [permission, listId, userId]
  });
  return result.rowsAffected > 0;
}

// Al dejar de tener acceso, se borran también sus preferencias sobre la lista.
export async function removeListMember(listId: string, userId: string) {
  const result = await db.batch([
    { sql: "DELETE FROM list_members WHERE list_id = ? AND user_id = ?", args: [listId, userId] },
    { sql: "DELETE FROM user_list_prefs WHERE list_id = ? AND user_id = ?", args: [listId, userId] }
  ], "write");
  return result[0].rowsAffected > 0;
}
