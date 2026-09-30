import { nanoid } from "nanoid";
import { db, familyKey } from "./client.js";
import type { Location } from "./types.js";

export async function listLocations(familyId: string): Promise<Location[]> {
  const result = await db.execute({
    sql: "SELECT id, name FROM locations WHERE family_id = ? ORDER BY rowid",
    args: [familyKey(familyId)]
  });
  return result.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

// Devuelve la ubicación solo si pertenece a la familia; si no, el ítem queda como general.
export async function validLocationId(familyId: string, locationId: string | null) {
  if (!locationId) return null;
  const result = await db.execute({
    sql: "SELECT 1 FROM locations WHERE id = ? AND family_id = ?",
    args: [locationId, familyKey(familyId)]
  });
  return result.rows.length > 0 ? locationId : null;
}

export async function addLocation(familyId: string, name: string) {
  const location: Location = { id: nanoid(8), name };
  await db.execute({
    sql: "INSERT INTO locations (id, family_id, name) VALUES (?, ?, ?)",
    args: [location.id, familyKey(familyId), name]
  });
  return location;
}

export async function renameLocation(familyId: string, locationId: string, name: string) {
  const result = await db.execute({
    sql: "UPDATE locations SET name = ? WHERE id = ? AND family_id = ?",
    args: [name, locationId, familyKey(familyId)]
  });
  return result.rowsAffected > 0;
}

export async function deleteLocation(familyId: string, locationId: string) {
  const result = await db.execute({
    sql: "DELETE FROM locations WHERE id = ? AND family_id = ?",
    args: [locationId, familyKey(familyId)]
  });
  return result.rowsAffected > 0;
}
