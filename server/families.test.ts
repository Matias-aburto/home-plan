import request from "supertest";
import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type Session = Awaited<ReturnType<typeof loginAgent>>;
type ListSummary = { id: string; name: string; familyId: string | null; access: string; pendingCount: number };

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

async function createList(agent: Agent, familyId: string, name = "Compras") {
  return (await agent.post("/api/lists").send({ name, familyId }).expect(201)).body as ListSummary;
}

async function familyLists(agent: Agent, familyId: string) {
  return ((await agent.get("/api/me")).body.lists as ListSummary[]).filter((list) => list.familyId === familyId);
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
  it("crea el grupo vacío, con su creador como dueño", async () => {
    const { agent } = await loginAgent();
    const family = await createFamily(agent, "  Familia Pérez ");
    expect(family).toMatchObject({ name: "Familia Pérez", role: "owner", memberCount: 1 });
    const me = (await agent.get("/api/me")).body;
    expect(me.families.map(({ id }: { id: string }) => id)).toEqual([family.id]);
    expect(me.lists).toEqual([]);
    expect(me.calendars).toEqual([]);
  });

  it("valida el nombre", async () => {
    const { agent } = await loginAgent();
    await agent.post("/api/families").send({ name: " " }).expect(400);
  });

  it("muestra los miembros solo a sus miembros", async () => {
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
    const firstShopping = await createList(agent, first.id);
    await agent.post(`/api/lists/${firstShopping.id}/items`).send({ title: "Solo en la primera" }).expect(201);
    const secondShopping = await createList(agent, second.id);
    const secondDetail = (await agent.get(`/api/lists/${secondShopping.id}`)).body;
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
    await createList(owner.agent, familyId);
  });

  it("los miembros editan ítems pero no administran la lista", async () => {
    const [shopping] = await familyLists(member.agent, familyId);
    expect(shopping.access).toBe("editor");
    await member.agent.post(`/api/lists/${shopping.id}/items`).send({ title: "Huevos" }).expect(201);
    await member.agent.patch(`/api/lists/${shopping.id}`).send({ name: "Mía" }).expect(403);
    await member.agent.delete(`/api/lists/${shopping.id}`).expect(403);
    const [adminShopping] = await familyLists(admin.agent, familyId);
    expect(adminShopping.access).toBe("owner");
  });

  it("cualquier miembro crea listas en la familia; quien no es miembro no", async () => {
    const created = await member.agent.post("/api/lists").send({ name: "Regalos", familyId }).expect(201);
    expect(created.body).toMatchObject({ familyId, access: "editor" });
    expect((await familyLists(owner.agent, familyId)).some(({ id }) => id === created.body.id)).toBe(true);
    const outsider = await loginAgent();
    await outsider.agent.post("/api/lists").send({ name: "X", familyId }).expect(404);
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
    const shopping = await createList(owner.agent, own.id);
    await owner.agent.post(`/api/lists/${shopping.id}/items`).send({ title: "Algo" });
    const calendar = (await owner.agent.post("/api/calendars").send({ name: "Casa", familyId: own.id }).expect(201)).body;
    await owner.agent.post(`/api/calendars/${calendar.id}/events`).send({ title: "Algo", kind: "event", date: "2026-11-01" }).expect(201);
    await admin.agent.delete(`/api/families/${own.id}`).expect(403);
    await owner.agent.delete(`/api/families/${own.id}`).expect(204);
    await owner.agent.get(`/api/lists/${shopping.id}`).expect(404);
    await owner.agent.get(`/api/calendars/${calendar.id}`).expect(404);
    const leftovers = await db.execute({
      sql: `SELECT (SELECT COUNT(*) FROM list_items WHERE list_id = ?)
        + (SELECT COUNT(*) FROM calendar_events WHERE calendar_id = ?) AS total`,
      args: [shopping.id, calendar.id]
    });
    expect(Number(leftovers.rows[0].total)).toBe(0);
  });
});
