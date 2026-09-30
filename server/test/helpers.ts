import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../app.js";
import { authRateLimit } from "../routes/auth.js";

// Devuelve un agente de supertest con sesión iniciada (la cookie queda guardada en el agente).
export async function loginAgent(email = `${randomUUID()}@test.cl`) {
  authRateLimit.reset();
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/google").send({ credential: `ok:${email}` }).expect(200);
  return { agent, user: response.body.user as { id: string; email: string; name: string; color: string } };
}
