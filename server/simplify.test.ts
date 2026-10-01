import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type Session = Awaited<ReturnType<typeof loginAgent>>;

let owner: Session;
let member: Session;

// Reproduce datos del modelo anterior (tipos de lista, ubicaciones, responsables y un calendario
// único por grupo) y vuelve a correr las migraciones de una sola vez.
beforeAll(async () => {
  await migrate();
  owner = await loginAgent();
  member = await loginAgent();
  const now = new Date().toISOString();
  await db.batch([
    { sql: "INSERT INTO families (id, name, created_at, created_by) VALUES ('VIEJO', 'Grupo antiguo', ?, ?)", args: [now, owner.user.id] },
    { sql: "INSERT INTO families (id, name, created_at, created_by) VALUES ('SINCAL', 'Sin calendario', ?, ?)", args: [now, owner.user.id] },
    { sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES ('VIEJO', ?, 'member', ?)", args: [member.user.id, now] },
    { sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES ('VIEJO', ?, 'owner', ?)", args: [owner.user.id, now] },
    { sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES ('SINCAL', ?, 'owner', ?)", args: [owner.user.id, now] },
    {
      sql: `INSERT INTO lists (id, owner_user_id, family_id, name, kind, icon, color, created_by, created_at, updated_at)
        VALUES ('compras-vieja', NULL, 'VIEJO', 'Compras', 'shopping', 'shopping-basket', 'green', ?, ?, ?)`,
      args: [owner.user.id, now, now]
    },
    { sql: "INSERT INTO places (id, owner_user_id, family_id, name, created_at) VALUES ('lugar', NULL, 'VIEJO', 'Casa', ?)", args: [now] },
    {
      sql: `INSERT INTO list_items (id, list_id, title, completed, position, location_id, assignee_user_id, created_by, created_at, updated_at)
        VALUES ('item-viejo', 'compras-vieja', 'Leche', 0, 0, 'lugar', ?, ?, ?, ?)`,
      args: [member.user.id, owner.user.id, now, now]
    },
    {
      sql: `INSERT INTO calendar_entries (id, family_id, title, kind, event_date, event_time, recurrence, notes, created_at, updated_at)
        VALUES ('evento-viejo', 'VIEJO', 'Cumpleaños', 'event', '2026-10-12', '18:30', 'yearly', NULL, ?, ?)`,
      args: [now, now]
    },
    "DELETE FROM app_migrations"
  ], "write");
  await migrate();
  await migrate();
});

describe("simplificación del modelo", () => {
  it("todas las listas quedan del tipo único y sin ubicaciones ni responsables", async () => {
    const list = await db.execute("SELECT kind FROM lists WHERE id = 'compras-vieja'");
    expect(String(list.rows[0].kind)).toBe("checklist");
    const item = await db.execute("SELECT location_id, assignee_user_id FROM list_items WHERE id = 'item-viejo'");
    expect(item.rows[0].location_id).toBeNull();
    expect(item.rows[0].assignee_user_id).toBeNull();
    const detail = (await member.agent.get("/api/lists/compras-vieja").expect(200)).body;
    expect(detail.items.map(({ title }: { title: string }) => title)).toEqual(["Leche"]);
  });

  it("el calendario del grupo pasa a ser un calendario del grupo con sus eventos", async () => {
    const calendars = (await member.agent.get("/api/me")).body.calendars;
    expect(calendars).toEqual([expect.objectContaining({
      id: "cal-VIEJO", familyId: "VIEJO", name: "Calendario", icon: "calendar", createdBy: owner.user.id, access: "editor"
    })]);
    const detail = (await member.agent.get("/api/calendars/cal-VIEJO").expect(200)).body;
    expect(detail.events).toEqual([expect.objectContaining({ id: "evento-viejo", title: "Cumpleaños", time: "18:30" })]);
  });

  it("los grupos sin eventos no reciben calendario", async () => {
    const result = await db.execute("SELECT COUNT(*) AS total FROM calendars WHERE family_id = 'SINCAL'");
    expect(Number(result.rows[0].total)).toBe(0);
  });
});
