import { nanoid } from "nanoid";
import { db, normalizeText } from "./client.js";
import { scopeWhere } from "./scopes.js";
import type { Location, Scope } from "./types.js";

export async function listPlaces(scope: Scope): Promise<Location[]> {
  const where = scopeWhere(scope);
  const result = await db.execute({
    sql: `SELECT id, name FROM places WHERE ${where.sql} ORDER BY created_at, rowid`,
    args: where.args
  });
  return result.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

// Devuelve el id solo si la ubicación es del mismo dueño; si no, el ítem queda como general.
export async function validPlaceId(scope: Scope, placeId: string | null) {
  if (!placeId) return null;
  const where = scopeWhere(scope);
  const result = await db.execute({
    sql: `SELECT 1 FROM places WHERE id = ? AND ${where.sql}`,
    args: [placeId, ...where.args]
  });
  return result.rows.length > 0 ? placeId : null;
}

export async function placeNameTaken(scope: Scope, name: string, exceptId?: string) {
  return (await listPlaces(scope)).some((place) =>
    place.id !== exceptId && normalizeText(place.name) === normalizeText(name)
  );
}

export async function addPlace(scope: Scope, name: string) {
  const place: Location = { id: nanoid(8), name };
  await db.execute({
    sql: "INSERT INTO places (id, owner_user_id, family_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [place.id, scope.ownerUserId, scope.familyId, name, new Date().toISOString()]
  });
  return place;
}

export async function renamePlace(scope: Scope, placeId: string, name: string) {
  const where = scopeWhere(scope);
  const result = await db.execute({
    sql: `UPDATE places SET name = ? WHERE id = ? AND ${where.sql}`,
    args: [name, placeId, ...where.args]
  });
  return result.rowsAffected > 0;
}

// Los ítems que la usaban quedan como generales. Se hace explícito porque las claves foráneas
// solo actúan si la conexión tiene PRAGMA foreign_keys activo, y en Vercel no se garantiza.
export async function deletePlace(scope: Scope, placeId: string) {
  if (!(await validPlaceId(scope, placeId))) return false;
  await db.batch([
    { sql: "UPDATE list_items SET location_id = NULL WHERE location_id = ?", args: [placeId] },
    { sql: "DELETE FROM places WHERE id = ?", args: [placeId] }
  ], "write");
  return true;
}
