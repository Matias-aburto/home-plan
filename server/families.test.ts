import request from "supertest";
import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type Session = Awaited<ReturnType<typeof loginAgent>>;
type ListSummary = { id: string; name: string; kind: string; familyId: string | null; access: string; pendingCount: number };

beforeAll(async () => {
  await migrate();
});

async function createFamily(agent: Agent, name = "Familia test") {
  return (await agent.post("/api/families").send({ name }).expect(201)).body as { id: string; name: string; role: string; memberCount: number };
}

// Mientras no existan invitaciones (Etapa 4), los tests agregan miembros directamente.
async function addMember(familyId: string, userId: string, role: "admin" | "member" = "member") {
  await db.execute({
    sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
    args: [familyId, userId, role, new Date().toISOString()]
  });
}

async function familyLists(agent: Agent, familyId: string) {
  return ((await agent.get("/api/me")).body.lists as ListSummary[]).filter((list) => list.familyId === familyId);
}

// Familia completa del modelo anterior (por código), como las que hay hoy en producción.
async function seedLegacyFamily(code: string) {
  const now = new Date().toISOString();
  await db.batch([
    { sql: "INSERT INTO families (id, name, created_at) VALUES (?, ?, ?)", args: [code, "Familia antigua", now] },
    { sql: "INSERT INTO locations (id, family_id, name) VALUES (?, ?, ?)", args: [`${code}-loc`, code, "Campo"] },
    {
      sql: `INSERT INTO shopping_items (id, family_id, name, location_id, completed, position, created_at, updated_at)
        VALUES (?, ?, 'Leche', ?, 0, 0, ?, ?)`,
      args: [`${code}-item1`, code, `${code}-loc`, now, now]
    },
    {
      sql: `INSERT INTO shopping_items (id, family_id, name, completed, position, created_at, updated_at, completed_at)
        VALUES (?, ?, 'Pan', 1, 1, ?, ?, ?)`,
      args: [`${code}-item2`, code, now, now, now]
    },
    {
      sql: `INSERT INTO household_tasks (id, family_id, title, assignee, completed, position, created_at, updated_at)
        VALUES (?, ?, 'Regar', 'Francisca', 0, 0, ?, ?)`,
      args: [`${code}-task1`, code, now, now]
    },
    {
      sql: `INSERT INTO learned_products (family_id, name_key, name, uses, last_used_at) VALUES (?, 'lechuga morada', 'Lechuga morada', 3, ?)`,
      args: [code, now]
    },
    {
      sql: `INSERT INTO calendar_entries (id, family_id, title, kind, event_date, recurrence, created_at, updated_at)
        VALUES (?, ?, 'Cumpleaños', 'event', '2026-10-12', 'yearly', ?, ?)`,
      args: [`${code}-cal`, code, now, now]
    }
  ], "write");
}

describe("salud y tiempo real", () => {
  it("responde health sin tiempo real configurado", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body).toEqual({ ok: true, realtime: false });
  });

  it("no entrega token de tiempo real sin clave de Ably", async () => {
    const { agent } = await loginAgent();
    await agent.get("/api/realtime/token").expect(503);
  });
});

describe("crear y ver familias", () => {
  it("crea la familia con su creador como dueño y dos listas iniciales", async () => {
    const { agent } = await loginAgent();
    const family = await createFamily(agent, "  Familia Pérez ");
    expect(family).toMatchObject({ name: "Familia Pérez", role: "owner", memberCount: 1 });
    const me = (await agent.get("/api/me")).body;
    expect(me.families.map(({ id }: { id: string }) => id)).toEqual([family.id]);
    const lists = await familyLists(agent, family.id);
    expect(lists.map(({ name, kind, access }) => [name, kind, access])).toEqual([
      ["Compras", "shopping", "owner"],
      ["Por hacer", "tasks", "owner"]
    ]);
  });

  it("valida el nombre", async () => {
    const { agent } = await loginAgent();
    await agent.post("/api/families").send({ name: " " }).expect(400);
  });

  it("muestra miembros y ubicaciones solo a sus miembros", async () => {
    const owner = await loginAgent();
    const outsider = await loginAgent();
    const family = await createFamily(owner.agent);
    const detail = (await owner.agent.get(`/api/families/${family.id}`).expect(200)).body;
    expect(detail.members).toEqual([expect.objectContaining({ userId: owner.user.id, role: "owner" })]);
    await outsider.agent.get(`/api/families/${family.id}`).expect(404);
    expect(await familyLists(outsider.agent, family.id)).toEqual([]);
  });

  it("un usuario puede estar en varias familias con contenido separado", async () => {
    const { agent } = await loginAgent();
    const first = await createFamily(agent, "Primera");
    const second = await createFamily(agent, "Segunda");
    const [firstShopping] = await familyLists(agent, first.id);
    await agent.post(`/api/lists/${firstShopping.id}/items`).send({ title: "Solo en la primera" }).expect(201);
    const secondLists = await familyLists(agent, second.id);
    const secondDetail = (await agent.get(`/api/lists/${secondLists[0].id}`)).body;
    expect(secondDetail.items).toEqual([]);
    expect((await agent.get("/api/me")).body.families).toHaveLength(2);
  });
});

describe("roles y permisos", () => {
  let owner: Session;
  let admin: Session;
  let member: Session;
  let familyId: string;

  beforeAll(async () => {
    owner = await loginAgent();
    admin = await loginAgent();
    member = await loginAgent();
    familyId = (await createFamily(owner.agent)).id;
    await addMember(familyId, admin.user.id, "admin");
    await addMember(familyId, member.user.id, "member");
  });

  it("los miembros editan ítems pero no administran la lista", async () => {
    const [shopping] = await familyLists(member.agent, familyId);
    expect(shopping.access).toBe("editor");
    await member.agent.post(`/api/lists/${shopping.id}/items`).send({ title: "Huevos" }).expect(201);
    await member.agent.post(`/api/lists/${shopping.id}/locations`).send({ name: "Parcela" }).expect(201);
    await member.agent.patch(`/api/lists/${shopping.id}`).send({ name: "Mía" }).expect(403);
    await member.agent.delete(`/api/lists/${shopping.id}`).expect(403);
    const [adminShopping] = await familyLists(admin.agent, familyId);
    expect(adminShopping.access).toBe("owner");
  });

  it("cualquier miembro crea listas en la familia; quien no es miembro no", async () => {
    const created = await member.agent.post("/api/lists").send({ name: "Regalos", kind: "checklist", familyId }).expect(201);
    expect(created.body).toMatchObject({ familyId, access: "editor" });
    expect((await familyLists(owner.agent, familyId)).some(({ id }) => id === created.body.id)).toBe(true);
    const outsider = await loginAgent();
    await outsider.agent.post("/api/lists").send({ name: "X", kind: "checklist", familyId }).expect(404);
  });

  it("solo dueño y admin renombran la familia", async () => {
    await member.agent.patch(`/api/families/${familyId}`).send({ name: "No" }).expect(403);
    const renamed = await admin.agent.patch(`/api/families/${familyId}`).send({ name: "Familia renombrada" }).expect(200);
    expect(renamed.body.name).toBe("Familia renombrada");
  });

  it("solo el dueño cambia roles, y nunca el del dueño", async () => {
    await admin.agent.patch(`/api/families/${familyId}/members/${member.user.id}`).send({ role: "admin" }).expect(403);
    await owner.agent.patch(`/api/families/${familyId}/members/${owner.user.id}`).send({ role: "member" }).expect(409);
    await owner.agent.patch(`/api/families/${familyId}/members/${member.user.id}`).send({ role: "owner" }).expect(400);
    await owner.agent.patch(`/api/families/${familyId}/members/${member.user.id}`).send({ role: "admin" }).expect(200);
    await owner.agent.patch(`/api/families/${familyId}/members/${member.user.id}`).send({ role: "member" }).expect(200);
  });

  it("admin quita miembros pero no a otros admins ni al dueño", async () => {
    const extra = await loginAgent();
    await addMember(familyId, extra.user.id);
    await member.agent.delete(`/api/families/${familyId}/members/${extra.user.id}`).expect(403);
    await admin.agent.delete(`/api/families/${familyId}/members/${owner.user.id}`).expect(403);
    await admin.agent.delete(`/api/families/${familyId}/members/${extra.user.id}`).expect(204);
    await extra.agent.get(`/api/families/${familyId}`).expect(404);
    expect(await familyLists(extra.agent, familyId)).toEqual([]);
  });

  it("el dueño no puede salir sin transferir; los demás sí", async () => {
    await owner.agent.delete(`/api/families/${familyId}/members/me`).expect(409);
    const leaver = await loginAgent();
    await addMember(familyId, leaver.user.id);
    await leaver.agent.delete(`/api/families/${familyId}/members/me`).expect(204);
    expect((await leaver.agent.get("/api/me")).body.families).toEqual([]);
  });

  it("al salir, sus tareas asignadas quedan sin asignar", async () => {
    const leaver = await loginAgent();
    await addMember(familyId, leaver.user.id);
    const tasks = (await familyLists(owner.agent, familyId)).find(({ kind }) => kind === "tasks")!;
    const task = (await owner.agent.post(`/api/lists/${tasks.id}/items`).send({ title: "Barrer", assigneeUserId: leaver.user.id })).body;
    expect(task.assigneeUserId).toBe(leaver.user.id);
    await leaver.agent.delete(`/api/families/${familyId}/members/me`).expect(204);
    const detail = (await owner.agent.get(`/api/lists/${tasks.id}`)).body;
    expect(detail.items.find(({ id }: { id: string }) => id === task.id).assigneeUserId).toBeNull();
  });

  it("transfiere la propiedad", async () => {
    const other = await loginAgent();
    const own = await createFamily(other.agent);
    const next = await loginAgent();
    await addMember(own.id, next.user.id);
    await other.agent.post(`/api/families/${own.id}/transfer`).send({ userId: other.user.id }).expect(400);
    const response = await other.agent.post(`/api/families/${own.id}/transfer`).send({ userId: next.user.id }).expect(200);
    expect(response.body.role).toBe("admin");
    const members = (await next.agent.get(`/api/families/${own.id}`)).body.members;
    expect(members.find(({ userId }: { userId: string }) => userId === next.user.id).role).toBe("owner");
    await other.agent.delete(`/api/families/${own.id}/members/me`).expect(204);
  });

  it("solo el dueño elimina la familia, con todo su contenido", async () => {
    const own = await createFamily(owner.agent, "Para borrar");
    await addMember(own.id, admin.user.id, "admin");
    const [shopping] = await familyLists(owner.agent, own.id);
    await owner.agent.post(`/api/lists/${shopping.id}/items`).send({ title: "Algo" });
    await admin.agent.delete(`/api/families/${own.id}`).expect(403);
    await owner.agent.delete(`/api/families/${own.id}`).expect(204);
    await owner.agent.get(`/api/lists/${shopping.id}`).expect(404);
    const leftovers = await db.execute({ sql: "SELECT COUNT(*) AS total FROM list_items WHERE list_id = ?", args: [shopping.id] });
    expect(Number(leftovers.rows[0].total)).toBe(0);
  });
});

describe("responsables de tareas", () => {
  it("solo acepta miembros de la familia y solo en tareas de familia", async () => {
    const owner = await loginAgent();
    const outsider = await loginAgent();
    const family = await createFamily(owner.agent);
    const lists = await familyLists(owner.agent, family.id);
    const tasks = lists.find(({ kind }) => kind === "tasks")!;
    const shopping = lists.find(({ kind }) => kind === "shopping")!;
    const valid = (await owner.agent.post(`/api/lists/${tasks.id}/items`).send({ title: "Uno", assigneeUserId: owner.user.id })).body;
    expect(valid.assigneeUserId).toBe(owner.user.id);
    const invalid = (await owner.agent.post(`/api/lists/${tasks.id}/items`).send({ title: "Dos", assigneeUserId: outsider.user.id })).body;
    expect(invalid.assigneeUserId).toBeNull();
    const notTasks = (await owner.agent.post(`/api/lists/${shopping.id}/items`).send({ title: "Tres", assigneeUserId: owner.user.id })).body;
    expect(notTasks.assigneeUserId).toBeNull();
    const cleared = await owner.agent.patch(`/api/lists/${tasks.id}/items/${valid.id}`).send({ assigneeUserId: null }).expect(200);
    expect(cleared.body.assigneeUserId).toBeNull();
    const detail = (await owner.agent.get(`/api/lists/${tasks.id}`)).body;
    expect(detail.members).toEqual([expect.objectContaining({ userId: owner.user.id })]);
  });
});

describe("familias del modelo por código", () => {
  it("se migran a listas conservando ítems, ubicaciones, calendario y productos", async () => {
    await seedLegacyFamily("LEGADO01");
    await migrate();
    await migrate();
    const lists = await db.execute({ sql: "SELECT id, name FROM lists WHERE family_id = ? ORDER BY name", args: ["LEGADO01"] });
    expect(lists.rows.map((row) => String(row.name))).toEqual(["Compras", "Por hacer"]);

    const { agent, user } = await loginAgent();
    const claimed = await agent.post("/api/families/claim").send({ code: "legado01" }).expect(200);
    expect(claimed.body).toMatchObject({ id: "LEGADO01", role: "owner" });

    const familyListIds = await familyLists(agent, "LEGADO01");
    const shopping = (await agent.get(`/api/lists/${familyListIds.find(({ kind }) => kind === "shopping")!.id}`)).body;
    expect(shopping.items.map(({ id, title, completed }: { id: string; title: string; completed: boolean }) => [id, title, completed]))
      .toEqual([["LEGADO01-item1", "Leche", false], ["LEGADO01-item2", "Pan", true]]);
    expect(shopping.items[0].locationId).toBe("LEGADO01-loc");
    expect(shopping.locations).toEqual([{ id: "LEGADO01-loc", name: "Campo" }]);
    const suggestions = (await agent.get(`/api/lists/${shopping.list.id}/suggestions`).query({ q: "lechu" })).body;
    expect(suggestions[0].name).toBe("Lechuga morada");

    const tasks = (await agent.get(`/api/lists/${familyListIds.find(({ kind }) => kind === "tasks")!.id}`)).body;
    expect(tasks.items[0]).toMatchObject({ title: "Regar", legacyAssignee: "Francisca", assigneeUserId: null });

    const detail = (await agent.get("/api/families/LEGADO01")).body;
    expect(detail.legacyAssignees).toEqual([{ name: "Francisca", count: 1 }]);
    await agent.post("/api/families/LEGADO01/legacy-assignees").send({ name: "Francisca", userId: user.id }).expect(200);
    const linked = (await agent.get(`/api/lists/${tasks.list.id}`)).body;
    expect(linked.items[0]).toMatchObject({ legacyAssignee: null, assigneeUserId: user.id });

    const calendar = (await agent.get("/api/families/LEGADO01/calendar").expect(200)).body;
    expect(calendar.map(({ title }: { title: string }) => title)).toEqual(["Cumpleaños"]);
  });

  it("solo se reclama una vez", async () => {
    await seedLegacyFamily("LEGADO02");
    await migrate();
    const first = await loginAgent();
    const second = await loginAgent();
    await first.agent.post("/api/families/claim").send({ code: "LEGADO02" }).expect(200);
    await first.agent.post("/api/families/claim").send({ code: "LEGADO02" }).expect(200);
    await second.agent.post("/api/families/claim").send({ code: "LEGADO02" }).expect(409);
    await second.agent.post("/api/families/claim").send({ code: "NOEXISTE" }).expect(404);
    await second.agent.post("/api/families/claim").send({}).expect(400);
  });

  it("no se vuelven a crear listas si la familia borra las suyas", async () => {
    const { agent } = await loginAgent();
    const family = await createFamily(agent);
    for (const list of await familyLists(agent, family.id)) await agent.delete(`/api/lists/${list.id}`).expect(204);
    await migrate();
    expect(await familyLists(agent, family.id)).toEqual([]);
  });
});

describe("calendario", () => {
  it("crea, edita, valida y elimina entradas solo para miembros", async () => {
    const { agent } = await loginAgent();
    const outsider = await loginAgent();
    const family = await createFamily(agent);
    const base = `/api/families/${family.id}/calendar`;
    const entry = (await agent.post(base).send({
      title: "Cumpleaños", kind: "event", date: "2026-10-12", time: "18:30", recurrence: "yearly"
    }).expect(201)).body;
    expect(entry).toMatchObject({ title: "Cumpleaños", time: "18:30", recurrence: "yearly", notes: null });

    await agent.post(base).send({ title: "Mal", kind: "event", date: "2026-02-30" }).expect(400);
    await agent.post(base).send({ title: "Mal", kind: "event", date: "2026-02-10", time: "25:00" }).expect(400);
    await agent.post(base).send({ title: "Mal", kind: "otro", date: "2026-02-10" }).expect(400);
    await outsider.agent.get(base).expect(404);
    await outsider.agent.post(base).send({ title: "X", kind: "event", date: "2026-02-10" }).expect(404);

    const edited = await agent.patch(`${base}/${entry.id}`)
      .send({ title: "Cumpleaños mamá", kind: "reminder", date: "2026-10-13" }).expect(200);
    expect(edited.body).toMatchObject({ title: "Cumpleaños mamá", kind: "reminder", time: null, recurrence: "none" });
    expect((await agent.get(base)).body).toHaveLength(1);

    await agent.delete(`${base}/${entry.id}`).expect(204);
    await agent.delete(`${base}/${entry.id}`).expect(404);
  });
});
