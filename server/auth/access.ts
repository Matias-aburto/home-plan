import type { ListAccess, ListRecord, User } from "../db/types.js";

const levels: ListAccess[] = ["none", "viewer", "editor", "owner"];

// Nivel de acceso de un usuario sobre una lista (ver la matriz en docs/PLAN.md §3).
// Por ahora solo existen listas personales; las de familia y las compartidas se suman después.
export async function listAccess(user: User, list: ListRecord): Promise<ListAccess> {
  if (list.ownerUserId === user.id) return "owner";
  return "none";
}

export function hasAccess(access: ListAccess, required: Exclude<ListAccess, "none">) {
  return levels.indexOf(access) >= levels.indexOf(required);
}
