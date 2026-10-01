import { getMembership } from "../db/families.js";
import { getListPermission } from "../db/listMembers.js";
import type { CalendarRecord, ListAccess, ListRecord, User } from "../db/types.js";

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

// Calendarios: dueño, o miembro del grupo dueño (owner/admin administran, member edita eventos).
// No se comparten con personas puntuales.
export async function calendarAccess(user: User, calendar: CalendarRecord): Promise<ListAccess> {
  if (calendar.ownerUserId === user.id) return "owner";
  if (!calendar.familyId) return "none";
  const role = await getMembership(calendar.familyId, user.id);
  if (role === "owner" || role === "admin") return "owner";
  return role === "member" ? "editor" : "none";
}

export function hasAccess(access: ListAccess, required: Exclude<ListAccess, "none">) {
  return levels.indexOf(access) >= levels.indexOf(required);
}
