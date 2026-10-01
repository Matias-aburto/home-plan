import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

type Session = Awaited<ReturnType<typeof loginAgent>>;
type CalendarEvent = { id: string; familyId: string | null; title: string; date: string; time: string | null; recurrence: string };

beforeAll(async () => {
  await migrate();
});

async function addMember(familyId: string, userId: string, role: "admin" | "member" = "member") {
  await db.execute({
    sql: "INSERT INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
    args: [familyId, userId, role, new Date().toISOString()]
  });
}

async function createEvent(agent: Agent, body: Record<string, unknown> = {}) {
  return (await agent.post("/api/calendar/events").send({ title: "Dentista", date: "2026-11-01", ...body }).expect(201)).body as CalendarEvent;
}

async function events(agent: Agent) {
  return (await agent.get("/api/calendar").expect(200)).body.events as CalendarEvent[];
}

describe("eventos personales", () => {
  it("crea, edita, valida y elimina; solo los ve su dueño", async () => {
    const owner = await loginAgent();
    const other = await loginAgent();
    const event = await createEvent(owner.agent, { time: "18:30", recurrence: "yearly", kind: "reminder" });
    expect(event).toMatchObject({ familyId: null, title: "Dentista", time: "18:30", recurrence: "yearly" });
    expect(event).not.toHaveProperty("kind");

    await owner.agent.post("/api/calendar/events").send({ title: "Mal", date: "2026-02-30" }).expect(400);
    await owner.agent.post("/api/calendar/events").send({ title: "Mal", date: "2026-02-10", time: "25:00" }).expect(400);
    await owner.agent.post("/api/calendar/events").send({ title: " ", date: "2026-02-10" }).expect(400);

    expect(await events(other.agent)).toEqual([]);
    await other.agent.patch(`/api/calendar/events/${event.id}`).send({ title: "X", date: "2026-11-01" }).expect(404);
    await other.agent.delete(`/api/calendar/events/${event.id}`).expect(404);

    const edited = await owner.agent.patch(`/api/calendar/events/${event.id}`).send({ title: "Dentista Ana", date: "2026-11-02" }).expect(200);
    expect(edited.body).toMatchObject({ title: "Dentista Ana", date: "2026-11-02", time: null, recurrence: "none" });
    expect(await events(owner.agent)).toHaveLength(1);
    await owner.agent.delete(`/api/calendar/events/${event.id}`).expect(204);
    await owner.agent.delete(`/api/calendar/events/${event.id}`).expect(404);
  });

  it("es idempotente con el id del cliente y no deja reutilizar ids ajenos", async () => {
    const owner = await loginAgent();
    const other = await loginAgent();
    await createEvent(owner.agent, { id: "evento-cliente" });
    await createEvent(owner.agent, { id: "evento-cliente" });
    expect(await events(owner.agent)).toHaveLength(1);
    await other.agent.post("/api/calendar/events").send({ id: "evento-cliente", title: "X", date: "2026-11-01" }).expect(404);
  });
});

describe("eventos de grupo", () => {
  let owner: Session;
  let member: Session;
  let familyId: string;

  beforeAll(async () => {
    owner = await loginAgent();
    member = await loginAgent();
    familyId = (await owner.agent.post("/api/families").send({ name: "Grupo" }).expect(201)).body.id;
    await addMember(familyId, member.user.id);
  });

  it("los ven y editan todos los miembros, junto con los personales de cada uno", async () => {
    const shared = await createEvent(member.agent, { title: "Asado", familyId });
    await createEvent(owner.agent, { title: "Solo mío" });
    expect((await events(owner.agent)).map(({ title }) => title).sort()).toEqual(["Asado", "Solo mío"]);
    expect((await events(member.agent)).map(({ title, familyId: space }) => [title, space])).toEqual([["Asado", familyId]]);
    await owner.agent.patch(`/api/calendar/events/${shared.id}`).send({ title: "Asado familiar", date: "2026-11-01" }).expect(200);

    const outsider = await loginAgent();
    await outsider.agent.post("/api/calendar/events").send({ title: "X", date: "2026-11-01", familyId }).expect(404);
    expect(await events(outsider.agent)).toEqual([]);
  });

  it("se mueven entre lo personal y el grupo", async () => {
    const event = await createEvent(member.agent, { title: "Cumpleaños" });
    const moved = await member.agent.patch(`/api/calendar/events/${event.id}`)
      .send({ title: "Cumpleaños", date: "2026-11-01", familyId }).expect(200);
    expect(moved.body.familyId).toBe(familyId);
    expect((await events(owner.agent)).some(({ id }) => id === event.id)).toBe(true);

    const back = await member.agent.patch(`/api/calendar/events/${event.id}`)
      .send({ title: "Cumpleaños", date: "2026-11-01", familyId: null }).expect(200);
    expect(back.body.familyId).toBeNull();
    expect((await events(owner.agent)).some(({ id }) => id === event.id)).toBe(false);
  });

  it("sacar un evento del grupo: solo quien lo creó o administra el grupo", async () => {
    const event = await createEvent(owner.agent, { title: "Reunión", familyId });
    await member.agent.patch(`/api/calendar/events/${event.id}`).send({ title: "Reunión", date: "2026-11-01", familyId: null }).expect(403);
    const other = (await owner.agent.post("/api/families").send({ name: "Otro" }).expect(201)).body.id;
    await member.agent.patch(`/api/calendar/events/${event.id}`).send({ title: "Reunión", date: "2026-11-01", familyId: other }).expect(404);
  });

  it("quien sale del grupo deja de verlos, pero siguen siendo del grupo", async () => {
    const leaver = await loginAgent();
    await addMember(familyId, leaver.user.id);
    const event = await createEvent(leaver.agent, { title: "Paseo", familyId });
    await leaver.agent.delete(`/api/families/${familyId}/members/me`).expect(204);
    expect((await events(leaver.agent)).some(({ id }) => id === event.id)).toBe(false);
    expect((await events(owner.agent)).some(({ id }) => id === event.id)).toBe(true);
  });
});

describe("colores de cada espacio", () => {
  it("son de cada persona y se validan", async () => {
    const ana = await loginAgent();
    const beto = await loginAgent();
    const familyId = (await ana.agent.post("/api/families").send({ name: "Grupo" }).expect(201)).body.id;
    await addMember(familyId, beto.user.id);
    await ana.agent.put("/api/me/space-colors").send({ space: "personal", color: "rose" }).expect(200);
    await ana.agent.put("/api/me/space-colors").send({ space: familyId, color: "teal" }).expect(200);
    await beto.agent.put("/api/me/space-colors").send({ space: familyId, color: "rose" }).expect(200);
    await ana.agent.put("/api/me/space-colors").send({ space: familyId, color: "fucsia" }).expect(400);
    await (await loginAgent()).agent.put("/api/me/space-colors").send({ space: familyId, color: "teal" }).expect(404);
    expect((await ana.agent.get("/api/me")).body.spaceColors).toEqual({ personal: "rose", [familyId]: "teal" });
    expect((await beto.agent.get("/api/me")).body.spaceColors).toEqual({ [familyId]: "rose" });
  });
});
