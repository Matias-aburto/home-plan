import { getMembership } from "../db/families.js";
import { getListPermission } from "../db/listMembers.js";
import type { ListAccess, ListRecord, User } from "../db/types.js";

const levels: ListAccess[] = ["none", "viewer", "editor", "owner"];

function highest(a: ListAccess, b: ListAccess) {
  return levels.indexOf(a) >= levels.indexOf(b) ? a : b;
}

// Nivel de acceso de un usuario sobre una lista (ver la matriz en docs/PLAN.md §3):
// el mayor entre ser dueño, ser de la familia dueña y tenerla compartida.
export async function listAccess(user: User, list: ListRecord): Promise<ListAccess> {
  if (list.ownerUserId === user.id) return "owner";
  let access: ListAccess = "none";
  if (list.familyId) {
    const role = await getMembership(list.familyId, user.id);
    if (role === "owner" || role === "admin") return "owner";
    if (role === "member") access = "editor";
  }
  const permission = await getListPermission(list.id, user.id);
  return permission ? highest(access, permission) : access;
}

export function hasAccess(access: ListAccess, required: Exclude<ListAccess, "none">) {
  return levels.indexOf(access) >= levels.indexOf(required);
}
