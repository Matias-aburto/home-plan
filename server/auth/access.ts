import { getMembership } from "../db/families.js";
import type { ListAccess, ListRecord, User } from "../db/types.js";

const levels: ListAccess[] = ["none", "viewer", "editor", "owner"];

// Nivel de acceso de un usuario sobre una lista (ver la matriz en docs/PLAN.md §3).
export async function listAccess(user: User, list: ListRecord): Promise<ListAccess> {
  if (list.ownerUserId === user.id) return "owner";
  if (list.familyId) {
    const role = await getMembership(list.familyId, user.id);
    if (role === "owner" || role === "admin") return "owner";
    if (role === "member") return "editor";
  }
  return "none";
}

export function hasAccess(access: ListAccess, required: Exclude<ListAccess, "none">) {
  return levels.indexOf(access) >= levels.indexOf(required);
}
