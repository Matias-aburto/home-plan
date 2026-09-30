import { nanoid } from "nanoid";
import { db, text } from "./client.js";
import type { ListAccess, ListKind, ListRecord, ListSummary, SortMode } from "./types.js";

export type ListInput = { name: string; kind: ListKind; icon: string; color: string };

const listColumns = `l.id, l.owner_user_id, l.family_id, l.name, l.kind, l.icon, l.color,
  l.created_by, l.created_at, l.updated_at, l.archived_at`;

function toRecord(row: Record<string, unknown>): ListRecord {
  return {
    id: String(row.id),
    ownerUserId: text(row.owner_user_id),
    familyId: text(row.family_id),
    name: String(row.name),
    kind: String(row.kind) as ListKind,
    icon: String(row.icon),
    color: String(row.color),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: text(row.archived_at)
  };
}

export async function getListRecord(listId: string) {
  const result = await db.execute({ sql: `SELECT ${listColumns} FROM lists l WHERE l.id = ?`, args: [listId] });
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

// Listas que el usuario ve en su menú, en su orden: las propias, las de sus familias
// y las compartidas con él. El acceso es el mayor de esas tres vías (igual que listAccess).
export async function visibleLists(userId: string): Promise<ListSummary[]> {
  const result = await db.execute({
    sql: `SELECT ${listColumns},
        COALESCE(p.position, 0) AS pref_position,
        COALESCE(p.sort, 'custom') AS pref_sort,
        (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id AND i.completed = 0) AS pending_count,
        m.role AS family_role,
        s.permission AS shared_permission
      FROM lists l
      LEFT JOIN user_list_prefs p ON p.list_id = l.id AND p.user_id = ?
      LEFT JOIN family_members m ON m.family_id = l.family_id AND m.user_id = ?
      LEFT JOIN list_members s ON s.list_id = l.id AND s.user_id = ?
      WHERE l.owner_user_id = ? OR m.user_id IS NOT NULL OR s.user_id IS NOT NULL
      ORDER BY pref_position, l.created_at`,
    args: [userId, userId, userId, userId]
  });
  return result.rows.map((row) => {
    const owner = row.owner_user_id === userId || row.family_role === "owner" || row.family_role === "admin";
    const editor = row.family_role === "member" || row.shared_permission === "editor";
    return {
      ...toRecord(row),
      access: owner ? "owner" : editor ? "editor" : "viewer",
      position: Number(row.pref_position),
      sort: String(row.pref_sort) as SortMode,
      pendingCount: Number(row.pending_count)
    } satisfies ListSummary;
  });
}

export async function listSummary(userId: string, list: ListRecord, access: Exclude<ListAccess, "none">) {
  const [prefs, pending] = await Promise.all([
    db.execute({
      sql: "SELECT position, sort FROM user_list_prefs WHERE user_id = ? AND list_id = ?",
      args: [userId, list.id]
    }),
    db.execute({
      sql: "SELECT COUNT(*) AS total FROM list_items WHERE list_id = ? AND completed = 0",
      args: [list.id]
    })
  ]);
  return {
    ...list,
    access,
    position: Number(prefs.rows[0]?.position ?? 0),
    sort: String(prefs.rows[0]?.sort ?? "custom") as SortMode,
    pendingCount: Number(pending.rows[0]?.total ?? 0)
  } satisfies ListSummary;
}

// Crea una lista personal (familyId null) o de familia y la deja al final del menú de quien la crea.
export async function createList(userId: string, familyId: string | null, input: ListInput, requestedId?: string) {
  const id = requestedId || nanoid();
  const now = new Date().toISOString();
  const last = await db.execute({
    sql: "SELECT MAX(position) AS last FROM user_list_prefs WHERE user_id = ?",
    args: [userId]
  });
  const position = last.rows[0]?.last === null || last.rows[0]?.last === undefined ? 0 : Number(last.rows[0].last) + 1;
  await db.batch([
    {
      sql: `INSERT INTO lists (id, owner_user_id, family_id, name, kind, icon, color, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, familyId ? null : userId, familyId, input.name, input.kind, input.icon, input.color, userId, now, now
      ]
    },
    {
      sql: "INSERT INTO user_list_prefs (user_id, list_id, position) VALUES (?, ?, ?)",
      args: [userId, id, position]
    }
  ], "write");
  return (await getListRecord(id))!;
}

export async function updateList(
  listId: string,
  changes: Partial<Pick<ListRecord, "name" | "icon" | "color">> & { archived?: boolean }
) {
  const current = await getListRecord(listId);
  if (!current) return null;
  const now = new Date().toISOString();
  const archivedAt = changes.archived === undefined
    ? current.archivedAt
    : changes.archived ? current.archivedAt || now : null;
  await db.execute({
    sql: "UPDATE lists SET name = ?, icon = ?, color = ?, archived_at = ?, updated_at = ? WHERE id = ?",
    args: [
      changes.name ?? current.name, changes.icon ?? current.icon, changes.color ?? current.color,
      archivedAt, now, listId
    ]
  });
  return getListRecord(listId);
}

// Borra explícitamente lo que depende de la lista: no se puede contar con ON DELETE CASCADE
// porque requiere PRAGMA foreign_keys en cada conexión.
export async function deleteList(listId: string) {
  await db.batch([
    { sql: "DELETE FROM list_items WHERE list_id = ?", args: [listId] },
    { sql: "DELETE FROM user_list_prefs WHERE list_id = ?", args: [listId] },
    { sql: "DELETE FROM list_members WHERE list_id = ?", args: [listId] },
    { sql: "DELETE FROM invitations WHERE list_id = ?", args: [listId] },
    { sql: "DELETE FROM lists WHERE id = ?", args: [listId] }
  ], "write");
}

// Cambia el dueño de la lista entre una persona y una familia. Las ubicaciones y los
// responsables eran del dueño anterior, así que los ítems quedan como generales y sin asignar.
// Las personas con quienes estaba compartida la siguen viendo.
export async function moveList(listId: string, target: { ownerUserId: string } | { familyId: string }) {
  const ownerUserId = "ownerUserId" in target ? target.ownerUserId : null;
  const familyId = "familyId" in target ? target.familyId : null;
  await db.batch([
    {
      sql: "UPDATE lists SET owner_user_id = ?, family_id = ?, updated_at = ? WHERE id = ?",
      args: [ownerUserId, familyId, new Date().toISOString(), listId]
    },
    {
      sql: "UPDATE list_items SET location_id = NULL, assignee_user_id = NULL, legacy_assignee = NULL WHERE list_id = ?",
      args: [listId]
    },
    // Quien pasa a ser dueño ya no necesita figurar como invitado.
    ...(ownerUserId ? [{ sql: "DELETE FROM list_members WHERE list_id = ? AND user_id = ?", args: [listId, ownerUserId] }] : [])
  ], "write");
}

async function upsertPrefs(userId: string, listId: string, changes: { position?: number; sort?: SortMode }) {
  await db.execute({
    sql: `INSERT INTO user_list_prefs (user_id, list_id, position, sort) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, list_id) DO UPDATE SET
        position = COALESCE(?, position), sort = COALESCE(?, sort)`,
    args: [
      userId, listId, changes.position ?? 0, changes.sort ?? "custom",
      changes.position ?? null, changes.sort ?? null
    ]
  });
}

export async function setListSort(userId: string, listId: string, sort: SortMode) {
  await upsertPrefs(userId, listId, { sort });
}

// Reordena el menú del usuario. Los ids que no ve se ignoran.
export async function setListOrder(userId: string, ids: string[]) {
  const visible = new Set((await visibleLists(userId)).map(({ id }) => id));
  const ordered = ids.filter((id) => visible.has(id));
  for (const [position, listId] of ordered.entries()) await upsertPrefs(userId, listId, { position });
}
