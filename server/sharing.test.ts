import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type Session = Awaited<ReturnType<typeof loginAgent>>;
type ListSummary = { id: string; access: string; familyId: string | null; ownerUserId: string | null };

beforeAll(async () => {
  await migrate();
});

async function createList(agent: Agent, body: Record<string, unknown> = {}) {
  return (await agent.post("/api/lists").send({ name: "Compartida", ...body }).expect(201)).body as ListSummary;
}

// Invita y acepta por la bandeja; devuelve la sesión de quien recibió.
async function share(owner: Agent, listId: string, guest: Session, permission: "editor" | "viewer") {
  const created = await owner.post(`/api/lists/${listId}/invitations`).send({ email: guest.user.email, permission }).expect(201);
  expect(created.body.link).toMatch(/\/invitacion\//);
  await guest.agent.post(`/api/invitations/${created.body.invitation.id}/accept`).expect(200);
}

async function visible(agent: Agent) {
  return (await agent.get("/api/me")).body.lists as ListSummary[];
}

describe("compartir una lista personal", () => {
  let owner: Session;
  let viewer: Session;
  let editor: Session;
  let listId: string;

  beforeAll(async () => {
    owner = await loginAgent();
    viewer = await loginAgent();
    editor = await loginAgent();
    listId = (await createList(owner.agent)).id;
    await owner.agent.post(`/api/lists/${listId}/items`).send({ title: "Pan" });
    await share(owner.agent, listId, viewer, "viewer");
    await share(owner.agent, listId, editor, "editor");
  });

  it("aparece en el menú de cada uno con su permiso", async () => {
    expect((await visible(viewer.agent)).find(({ id }) => id === listId)?.access).toBe("viewer");
    expect((await visible(editor.agent)).find(({ id }) => id === listId)?.access).toBe("editor");
    const detail = (await owner.agent.get(`/api/lists/${listId}`)).body;
    expect(detail.sharedWith.map(({ userId, permission }: { userId: string; permission: string }) => [userId, permission]))
      .toEqual([[viewer.user.id, "viewer"], [editor.user.id, "editor"]]);
  });

  it("el lector ve pero no modifica", async () => {
    const detail = (await viewer.agent.get(`/api/lists/${listId}`).expect(200)).body;
    await viewer.agent.post(`/api/lists/${listId}/items`).send({ title: "No" }).expect(403);
    await viewer.agent.patch(`/api/lists/${listId}/items/${detail.items[0].id}`).send({ completed: true }).expect(403);
    await viewer.agent.put(`/api/lists/${listId}/prefs`).send({ sort: "alpha" }).expect(200);
  });

  it("el editor modifica ítems pero no administra la lista", async () => {
    await editor.agent.post(`/api/lists/${listId}/items`).send({ title: "Queso" }).expect(201);
    await editor.agent.patch(`/api/lists/${listId}`).send({ name: "Mía" }).expect(403);
    await editor.agent.delete(`/api/lists/${listId}`).expect(403);
    await editor.agent.post(`/api/lists/${listId}/invitations`).send({ email: "x@test.cl" }).expect(403);
    await editor.agent.post(`/api/lists/${listId}/move`).send({ familyId: null }).expect(403);
  });

  it("el dueño cambia permisos y no puede invitar a quien ya tiene acceso", async () => {
    await owner.agent.patch(`/api/lists/${listId}/members/${viewer.user.id}`).send({ permission: "editor" }).expect(200);
    await viewer.agent.post(`/api/lists/${listId}/items`).send({ title: "Ahora sí" }).expect(201);
    await owner.agent.patch(`/api/lists/${listId}/members/${viewer.user.id}`).send({ permission: "viewer" }).expect(200);
    await owner.agent.post(`/api/lists/${listId}/invitations`).send({ email: viewer.user.email }).expect(409);
    await owner.agent.post(`/api/lists/${listId}/invitations`).send({ email: owner.user.email }).expect(409);
    await owner.agent.post(`/api/lists/${listId}/invitations`).send({ email: "x@test.cl", permission: "owner" }).expect(400);
  });

  it("dejar de ver y quitar a alguien", async () => {
    const leaver = await loginAgent();
    await share(owner.agent, listId, leaver, "editor");
    await leaver.agent.delete(`/api/lists/${listId}/members/me`).expect(204);
    await leaver.agent.get(`/api/lists/${listId}`).expect(404);

    const removed = await loginAgent();
    await share(owner.agent, listId, removed, "viewer");
    await editor.agent.delete(`/api/lists/${listId}/members/${removed.user.id}`).expect(403);
    await owner.agent.delete(`/api/lists/${listId}/members/${removed.user.id}`).expect(204);
    expect((await visible(removed.agent)).some(({ id }) => id === listId)).toBe(false);
    await owner.agent.delete(`/api/lists/${listId}/members/me`).expect(404);
  });

  it("el dueño anula invitaciones pendientes de la lista", async () => {
    const pending = await owner.agent.post(`/api/lists/${listId}/invitations`).send({ email: "pendiente@test.cl" }).expect(201);
    expect((await owner.agent.get(`/api/lists/${listId}/invitations`)).body).toHaveLength(1);
    await editor.agent.delete(`/api/invitations/${pending.body.invitation.id}`).expect(404);
    await owner.agent.delete(`/api/invitations/${pending.body.invitation.id}`).expect(204);
    expect((await owner.agent.get(`/api/lists/${listId}/invitations`)).body).toEqual([]);
  });
});

describe("listas de familia compartidas fuera de la familia", () => {
  it("la persona invitada accede sin ver el resto de la familia", async () => {
    const owner = await loginAgent();
    const outsider = await loginAgent();
    const familyId = (await owner.agent.post("/api/families").send({ name: "F" }).expect(201)).body.id;
    const shopping = await createList(owner.agent, { familyId });
    const tasks = await createList(owner.agent, { name: "Otra", familyId });
    await share(owner.agent, shopping.id, outsider, "editor");
    await outsider.agent.post(`/api/lists/${shopping.id}/items`).send({ title: "Leche" }).expect(201);
    await outsider.agent.get(`/api/lists/${tasks.id}`).expect(404);
    await outsider.agent.get(`/api/families/${familyId}`).expect(404);
  });
});

describe("mover listas", () => {
  it("de personal a un grupo: la ven sus miembros y quienes la tenían compartida", async () => {
    const owner = await loginAgent();
    const member = await loginAgent();
    const guest = await loginAgent();
    const familyId = (await owner.agent.post("/api/families").send({ name: "F" }).expect(201)).body.id;
    const invitation = await owner.agent.post(`/api/families/${familyId}/invitations`).send({ email: member.user.email }).expect(201);
    await member.agent.post(`/api/invitations/${invitation.body.invitation.id}/accept`).expect(200);

    const list = await createList(owner.agent);
    await owner.agent.post(`/api/lists/${list.id}/items`).send({ title: "Café" });
    await share(owner.agent, list.id, guest, "viewer");

    await owner.agent.post(`/api/lists/${list.id}/move`).send({ familyId: "NOEXISTE" }).expect(404);
    const moved = await owner.agent.post(`/api/lists/${list.id}/move`).send({ familyId }).expect(200);
    expect(moved.body).toMatchObject({ familyId, ownerUserId: null, access: "owner" });
    expect((await visible(member.agent)).find(({ id }) => id === list.id)?.access).toBe("editor");
    expect((await visible(guest.agent)).find(({ id }) => id === list.id)?.access).toBe("viewer");
    expect((await owner.agent.get(`/api/lists/${list.id}`)).body.items).toHaveLength(1);
    await owner.agent.post(`/api/lists/${list.id}/move`).send({ familyId }).expect(400);
  });

  it("de una familia a personal: solo quien la administra, y la familia deja de verla", async () => {
    const owner = await loginAgent();
    const member = await loginAgent();
    const familyId = (await owner.agent.post("/api/families").send({ name: "F" }).expect(201)).body.id;
    await db.execute({
      sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
      args: [familyId, member.user.id, new Date().toISOString()]
    });
    const shopping = await createList(owner.agent, { familyId });
    await member.agent.post(`/api/lists/${shopping.id}/move`).send({ familyId: null }).expect(403);
    const moved = await owner.agent.post(`/api/lists/${shopping.id}/move`).send({ familyId: null }).expect(200);
    expect(moved.body).toMatchObject({ familyId: null, ownerUserId: owner.user.id });
    await member.agent.get(`/api/lists/${shopping.id}`).expect(404);
  });
});

describe("eliminar", () => {
  it("borra el acceso compartido y las invitaciones de la lista", async () => {
    const owner = await loginAgent();
    const guest = await loginAgent();
    const list = await createList(owner.agent);
    await share(owner.agent, list.id, guest, "editor");
    await owner.agent.post(`/api/lists/${list.id}/invitations`).send({ email: "pendiente@test.cl" });
    await owner.agent.delete(`/api/lists/${list.id}`).expect(204);
    expect((await visible(guest.agent)).some(({ id }) => id === list.id)).toBe(false);
    const leftovers = await db.execute({
      sql: "SELECT (SELECT COUNT(*) FROM list_members WHERE list_id = ?) + (SELECT COUNT(*) FROM invitations WHERE list_id = ?) AS total",
      args: [list.id, list.id]
    });
    expect(Number(leftovers.rows[0].total)).toBe(0);
  });
});
