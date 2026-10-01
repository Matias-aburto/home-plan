import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

// Reproduce la base de producción anterior a las cuentas (modelo por código) antes de migrar.
beforeAll(async () => {
  await db.batch([
    "CREATE TABLE families (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)",
    `CREATE TABLE locations (id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      name TEXT NOT NULL, UNIQUE(family_id, name))`,
    `CREATE TABLE shopping_items (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, name TEXT NOT NULL, location_id TEXT,
      completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, completed_at TEXT, archived_at TEXT)`,
    `CREATE TABLE calendar_entries (id TEXT PRIMARY KEY, family_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
      event_date TEXT NOT NULL, event_time TEXT, recurrence TEXT NOT NULL DEFAULT 'none', notes TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    { sql: "INSERT INTO families (id, name, created_at) VALUES ('CASA', 'Familia de prueba', ?)", args: [new Date().toISOString()] },
    {
      sql: `INSERT INTO shopping_items (id, family_id, name, created_at, updated_at) VALUES ('viejo', 'CASA', 'Leche', ?, ?)`,
      args: [new Date().toISOString(), new Date().toISOString()]
    }
  ], "write");
  await migrate();
  await migrate();
});

describe("base de producción anterior", () => {
  it("agrega lo nuevo sin tocar los datos antiguos", async () => {
    const columns = await db.execute("PRAGMA table_info(families)");
    expect(columns.rows.map((row) => String(row.name))).toContain("created_by");
    const legacy = await db.execute("SELECT COUNT(*) AS total FROM shopping_items WHERE family_id = 'CASA'");
    expect(Number(legacy.rows[0].total)).toBe(1);
  });

  it("se parte de cero: la familia antigua no es visible ni se puede reclamar", async () => {
    const { agent } = await loginAgent();
    const me = (await agent.get("/api/me").expect(200)).body;
    expect(me).toMatchObject({ families: [], lists: [], invitations: [] });
    await agent.get("/api/families/CASA").expect(404);
    await agent.post("/api/families/claim").send({ code: "CASA" }).expect(404);
  });

  it("se pueden crear grupos, listas y eventos nuevos", async () => {
    const { agent } = await loginAgent();
    const family = (await agent.post("/api/families").send({ name: "Nueva" }).expect(201)).body;
    const list = (await agent.post("/api/lists").send({ name: "Compras", familyId: family.id }).expect(201)).body;
    await agent.post(`/api/lists/${list.id}/items`).send({ title: "Pan" }).expect(201);
    await agent.post("/api/calendar/events").send({ title: "Evento", date: "2026-11-01", familyId: family.id }).expect(201);
  });
});
