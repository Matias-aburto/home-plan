import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Agent } from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { loginAgent } from "./test/helpers.js";

beforeAll(async () => {
  await migrate();
});

const newEmail = () => `${randomUUID()}@test.cl`;

async function familyOf(agent: Agent) {
  return (await agent.post("/api/families").send({ name: "Familia" }).expect(201)).body.id as string;
}

async function invite(agent: Agent, familyId: string, email: string, role = "member") {
  const response = await agent.post(`/api/families/${familyId}/invitations`).send({ email, role }).expect(201);
  const token = (response.body.link as string).split("/invitacion/")[1];
  return { invitation: response.body.invitation as { id: string; status: string; invitedEmail: string }, token, link: response.body.link as string };
}

async function membersOf(agent: Agent, familyId: string) {
  return (await agent.get(`/api/families/${familyId}`).expect(200)).body.members as { userId: string; role: string }[];
}

describe("invitar a una familia", () => {
  it("invita por email, aparece en la bandeja y al aceptar entra con el rol ofrecido", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const email = newEmail();
    const { invitation, link } = await invite(owner.agent, familyId, email.toUpperCase(), "admin");
    expect(link).toMatch(/\/invitacion\/[\w-]+$/);
    expect(invitation).toMatchObject({ invitedEmail: email, status: "pending" });
    expect((await owner.agent.get(`/api/families/${familyId}/invitations`)).body).toHaveLength(1);

    const guest = await loginAgent(email);
    const me = (await guest.agent.get("/api/me")).body;
    expect(me.invitations).toEqual([expect.objectContaining({ id: invitation.id, targetName: "Familia", offeredRole: "admin" })]);
    expect(me.invitations[0].invitedBy).toBeUndefined();

    await guest.agent.post(`/api/invitations/${invitation.id}/accept`).expect(200);
    expect((await membersOf(owner.agent, familyId)).find(({ userId }) => userId === guest.user.id)?.role).toBe("admin");
    expect((await guest.agent.get("/api/me")).body.invitations).toEqual([]);
    expect((await owner.agent.get(`/api/families/${familyId}/invitations`)).body).toEqual([]);
    await guest.agent.post(`/api/invitations/${invitation.id}/accept`).expect(410);
  });

  it("espera a quien todavía no tiene cuenta", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const email = newEmail();
    await invite(owner.agent, familyId, email);
    const guest = await loginAgent(email);
    expect((await guest.agent.get("/api/invitations")).body).toHaveLength(1);
  });

  it("valida email, rol, permisos y miembros existentes", async () => {
    const owner = await loginAgent();
    const admin = await loginAgent();
    const member = await loginAgent();
    const familyId = await familyOf(owner.agent);
    for (const [session, role] of [[admin, "admin"], [member, "member"]] as const) {
      const { invitation } = await invite(owner.agent, familyId, session.user.email, role);
      await session.agent.post(`/api/invitations/${invitation.id}/accept`).expect(200);
    }
    await owner.agent.post(`/api/families/${familyId}/invitations`).send({ email: "no-es-email" }).expect(400);
    await owner.agent.post(`/api/families/${familyId}/invitations`).send({ email: newEmail(), role: "owner" }).expect(400);
    await owner.agent.post(`/api/families/${familyId}/invitations`).send({ email: member.user.email }).expect(409);
    await admin.agent.post(`/api/families/${familyId}/invitations`).send({ email: newEmail(), role: "admin" }).expect(403);
    await admin.agent.post(`/api/families/${familyId}/invitations`).send({ email: newEmail() }).expect(201);
    await member.agent.post(`/api/families/${familyId}/invitations`).send({ email: newEmail() }).expect(403);
    await member.agent.get(`/api/families/${familyId}/invitations`).expect(403);
    const outsider = await loginAgent();
    await outsider.agent.post(`/api/families/${familyId}/invitations`).send({ email: newEmail() }).expect(404);
  });
});

describe("responder", () => {
  it("rechazar no suma a la familia", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const email = newEmail();
    const { invitation } = await invite(owner.agent, familyId, email);
    const guest = await loginAgent(email);
    await guest.agent.post(`/api/invitations/${invitation.id}/decline`).expect(200);
    expect(await membersOf(owner.agent, familyId)).toHaveLength(1);
    await guest.agent.post(`/api/invitations/${invitation.id}/accept`).expect(410);
  });

  it("desde la bandeja solo responde la persona invitada", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const { invitation } = await invite(owner.agent, familyId, newEmail());
    const other = await loginAgent();
    await other.agent.post(`/api/invitations/${invitation.id}/accept`).expect(404);
    await other.agent.post(`/api/invitations/${invitation.id}/decline`).expect(404);
  });

  it("el enlace sirve para otra cuenta, una sola vez", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const { token } = await invite(owner.agent, familyId, newEmail());
    await request(app).get(`/api/invitations/token/${token}`).expect(401);
    const other = await loginAgent();
    const preview = (await other.agent.get(`/api/invitations/token/${token}`).expect(200)).body;
    expect(preview).toMatchObject({ targetName: "Familia", status: "pending" });
    await other.agent.post(`/api/invitations/token/${token}/accept`).expect(200);
    expect((await membersOf(owner.agent, familyId)).some(({ userId }) => userId === other.user.id)).toBe(true);
    const third = await loginAgent();
    await third.agent.post(`/api/invitations/token/${token}/accept`).expect(410);
    await other.agent.get("/api/invitations/token/no-existe").expect(404);
  });

  it("vence a los 7 días", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const { invitation, token } = await invite(owner.agent, familyId, newEmail());
    await db.execute({ sql: "UPDATE invitations SET expires_at = ? WHERE id = ?", args: ["2000-01-01T00:00:00.000Z", invitation.id] });
    const guest = await loginAgent();
    const response = await guest.agent.post(`/api/invitations/token/${token}/accept`).expect(410);
    expect(response.body.status).toBe("expired");
  });
});

describe("revocar y reenviar", () => {
  it("revocar anula el enlace y la bandeja", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const email = newEmail();
    const { invitation, token } = await invite(owner.agent, familyId, email);
    const outsider = await loginAgent();
    await outsider.agent.delete(`/api/invitations/${invitation.id}`).expect(404);
    await owner.agent.delete(`/api/invitations/${invitation.id}`).expect(204);
    const guest = await loginAgent(email);
    expect((await guest.agent.get("/api/invitations")).body).toEqual([]);
    await guest.agent.post(`/api/invitations/token/${token}/accept`).expect(410);
  });

  it("reenviar reemplaza la invitación anterior", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const email = newEmail();
    const first = await invite(owner.agent, familyId, email);
    const second = await invite(owner.agent, familyId, email);
    expect((await owner.agent.get(`/api/families/${familyId}/invitations`)).body.map(({ id }: { id: string }) => id)).toEqual([second.invitation.id]);
    const guest = await loginAgent(email);
    await guest.agent.post(`/api/invitations/token/${first.token}/accept`).expect(410);
    await guest.agent.post(`/api/invitations/token/${second.token}/accept`).expect(200);
  });

  it("eliminar la familia borra sus invitaciones", async () => {
    const owner = await loginAgent();
    const familyId = await familyOf(owner.agent);
    const email = newEmail();
    await invite(owner.agent, familyId, email);
    await owner.agent.delete(`/api/families/${familyId}`).expect(204);
    const guest = await loginAgent(email);
    expect((await guest.agent.get("/api/invitations")).body).toEqual([]);
  });
});
