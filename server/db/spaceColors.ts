import { db } from "./client.js";

// Color con que cada persona ve cada espacio en el calendario. Es una preferencia propia:
// nadie elige por otro, y así el color personal y el de un grupo nunca chocan.
// space: "personal" o el id del grupo.
export async function spaceColors(userId: string) {
  const result = await db.execute({ sql: "SELECT space, color FROM user_space_colors WHERE user_id = ?", args: [userId] });
  return Object.fromEntries(result.rows.map((row) => [String(row.space), String(row.color)]));
}

export async function setSpaceColor(userId: string, space: string, color: string) {
  await db.execute({
    sql: `INSERT INTO user_space_colors (user_id, space, color) VALUES (?, ?, ?)
      ON CONFLICT (user_id, space) DO UPDATE SET color = excluded.color`,
    args: [userId, space, color]
  });
}
