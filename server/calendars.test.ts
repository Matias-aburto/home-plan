import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type Session = Awaited<ReturnType<typeof loginAgent>>;
type CalendarSummary = { id: string; name: string; icon: string; color: string; familyId: string | null; ownerUserId: string | null; access: string };

beforeAll(async () => {
  await migrate();
});

async function createCalendar(agent: Agent, body: Record<string, unknown> = {}) {
  return (await agent.post("/api/calendars").send({ name: "Casa", ...body }).expect(201)).body as CalendarSummary;
}

async function addMember(familyId: string, userId: string, role: "admin" | "member" = "member") {
  await db.execute({
    sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
    args: [familyId, userId, role, new Date().toISOString()]
  });
}

async function visible(agent: Agent) {
  return (await agent.get("/api/me")).body.calendars as CalendarSummary[];
}

describe("calendarios personales", () => {
  it("crea con valores por defecto y aparece solo para su dueño", async () => {
    const owner = await loginAgent();
    const other = await loginAgent();
    const calendar = await createCalendar(owner.agent, { name: "  cumpleaños " });
    expect(calendar).toMatchObject({ name: "Cumpleaños", icon: "calendar", color: "blue", familyId: null, ownerUserId: owner.user.id, access: "owner" });
    expect((await visible(owner.agent)).map(({ id }) => id)).toEqual([calendar.id]);
    expect(await visible(other.agent)).toEqual([]);
    await other.agent.get(`/api/calendars/${calendar.id}`).expect(404);
    await other.agent.post(`/api/calendars/${calendar.id}/events`).send({ title: "X", kind: "event", date: "2026-02-10" }).expect(404);
  });

  it("valida nombre, ícono y color", async () => {
    const { agent } = await loginAgent();
    await agent.post("/api/calendars").send({ name: " " }).expect(400);
    const calendar = await createCalendar(agent, { icon: "no-existe", color: "fucsia" });
    expect(calendar).toMatchObject({ icon: "calendar", color: "blue" });
    await agent.patch(`/api/calendars/${calendar.id}`).send({ icon: "no-existe" }).expect(400);
    await agent.patch(`/api/calendars/${calendar.id}`).send({ name: "" }).expect(400);
  });

  it("es idempotente con el id del cliente y no deja reutilizar ids ajenos", async () => {
    const owner = await loginAgent();
    const other = await loginAgent();
    const body = { id: "calendario-cliente", name: "Offline" };
    await owner.agent.post("/api/calendars").send(body).expect(201);
    await owner.agent.post("/api/calendars").send(body).expect(201);
    await other.agent.post("/api/calendars").send(body).expect(409);
    expect(await visible(owner.agent)).toHaveLength(1);
  });

  it("renombra, archiva y elimina con sus eventos", async () => {
    const { agent } = await loginAgent();
    const calendar = await createCalendar(agent);
    const edited = await agent.patch(`/api/calendars/${calendar.id}`).send({ name: "trabajo", icon: "briefcase", color: "violet" }).expect(200);
    expect(edited.body).toMatchObject({ name: "Trabajo", icon: "briefcase", color: "violet" });
    const archived = await agent.patch(`/api/calendars/${calendar.id}`).send({ archived: true }).expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
    await agent.post(`/api/calendars/${calendar.id}/events`).send({ title: "Reunión", kind: "event", date: "2026-11-01" }).expect(201);
    await agent.delete(`/api/calendars/${calendar.id}`).expect(204);
    await agent.get(`/api/calendars/${calendar.id}`).expect(404);
    const leftovers = await db.execute({ sql: "SELECT COUNT(*) AS total FROM calendar_events WHERE calendar_id = ?", args: [calendar.id] });
    expect(Number(leftovers.rows[0].total)).toBe(0);
  });
});

describe("eventos", () => {
  it("crea, edita, valida y elimina", async () => {
    const { agent } = await loginAgent();
    const calendar = await createCalendar(agent);
    const base = `/api/calendars/${calendar.id}/events`;
    const event = (await agent.post(base).send({
      title: "Cumpleaños", kind: "event", date: "2026-10-12", time: "18:30", recurrence: "yearly"
    }).expect(201)).body;
    expect(event).toMatchObject({ title: "Cumpleaños", time: "18:30", recurrence: "yearly", notes: null });

    await agent.post(base).send({ title: "Mal", kind: "event", date: "2026-02-30" }).expect(400);
    await agent.post(base).send({ title: "Mal", kind: "event", date: "2026-02-10", time: "25:00" }).expect(400);
    await agent.post(base).send({ title: "Mal", kind: "otro", date: "2026-02-10" }).expect(400);

    const edited = await agent.patch(`${base}/${event.id}`)
      .send({ title: "Cumpleaños mamá", kind: "reminder", date: "2026-10-13" }).expect(200);
    expect(edited.body).toMatchObject({ title: "Cumpleaños mamá", kind: "reminder", time: null, recurrence: "none" });
    expect((await agent.get(`/api/calendars/${calendar.id}`)).body.events).toHaveLength(1);

    await agent.delete(`${base}/${event.id}`).expect(204);
    await agent.delete(`${base}/${event.id}`).expect(404);
  });

  it("es idempotente con el id del cliente", async () => {
    const { agent } = await loginAgent();
    const calendar = await createCalendar(agent);
    const body = { id: "evento-cliente", title: "Dentista", kind: "event", date: "2026-11-01" };
    await agent.post(`/api/calendars/${calendar.id}/events`).send(body).expect(201);
    await agent.post(`/api/calendars/${calendar.id}/events`).send(body).expect(201);
    expect((await agent.get(`/api/calendars/${calendar.id}`)).body.events).toHaveLength(1);
  });
});

describe("calendarios de grupo", () => {
  let owner: Session;
  let admin: Session;
  let member: Session;
  let familyId: string;
  let calendar: CalendarSummary;

  beforeAll(async () => {
    owner = await loginAgent();
    admin = await loginAgent();
    member = await loginAgent();
    familyId = (await owner.agent.post("/api/families").send({ name: "Grupo" }).expect(201)).body.id;
    await addMember(familyId, admin.user.id, "admin");
    await addMember(familyId, member.user.id);
    calendar = await createCalendar(member.agent, { familyId });
  });

  it("cualquier miembro lo crea y todos lo ven; quien no es miembro no", async () => {
    expect(calendar).toMatchObject({ familyId, ownerUserId: null, access: "editor" });
    expect((await visible(owner.agent)).find(({ id }) => id === calendar.id)?.access).toBe("owner");
    expect((await visible(admin.agent)).find(({ id }) => id === calendar.id)?.access).toBe("owner");
    const outsider = await loginAgent();
    await outsider.agent.post("/api/calendars").send({ name: "X", familyId }).expect(404);
    await outsider.agent.get(`/api/calendars/${calendar.id}`).expect(404);
    expect(await visible(outsider.agent)).toEqual([]);
  });

  it("los miembros editan eventos pero no administran el calendario", async () => {
    await member.agent.post(`/api/calendars/${calendar.id}/events`).send({ title: "Asado", kind: "event", date: "2026-12-01" }).expect(201);
    await member.agent.patch(`/api/calendars/${calendar.id}`).send({ name: "Mío" }).expect(403);
    await member.agent.delete(`/api/calendars/${calendar.id}`).expect(403);
    await admin.agent.patch(`/api/calendars/${calendar.id}`).send({ name: "Familia" }).expect(200);
  });

  it("quien sale del grupo deja de verlo", async () => {
    const leaver = await loginAgent();
    await addMember(familyId, leaver.user.id);
    await leaver.agent.get(`/api/calendars/${calendar.id}`).expect(200);
    await leaver.agent.delete(`/api/families/${familyId}/members/me`).expect(204);
    await leaver.agent.get(`/api/calendars/${calendar.id}`).expect(404);
  });
});
