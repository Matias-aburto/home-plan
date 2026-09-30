import type { ListRecord, Scope } from "./types.js";

export function scopeOf(list: Pick<ListRecord, "ownerUserId" | "familyId">): Scope {
  return list.ownerUserId
    ? { ownerUserId: list.ownerUserId, familyId: null }
    : { ownerUserId: null, familyId: list.familyId! };
}

// Clave de texto para tablas que agrupan por dueño (por ejemplo, productos aprendidos).
export function scopeKey(scope: Scope) {
  return scope.ownerUserId ? `user:${scope.ownerUserId}` : `family:${scope.familyId}`;
}

// Condición SQL para filtrar por dueño en tablas con columnas owner_user_id / family_id.
export function scopeWhere(scope: Scope) {
  return scope.ownerUserId
    ? { sql: "owner_user_id = ?", args: [scope.ownerUserId] }
    : { sql: "family_id = ?", args: [scope.familyId] };
}
