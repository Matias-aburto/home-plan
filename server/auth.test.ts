import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "./app.js";
import { db } from "./db/client.js";
import { migrate } from "./db/migrations.js";
import { authRateLimit } from "./routes/auth.js";
import { loginAgent } from "./test/helpers.js";

beforeAll(async () => {
  await migrate();
});

beforeEach(() => authRateLimit.reset());

function sessionCookie(setCookie: string[] | string | undefined) {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return cookies.find((cookie) => cookie.startsWith("sid="));
}

describe("login con Google", () => {
  it("entrega la configuración pública sin sesión", async () => {
    const response = await request(app).get("/api/auth/config").expect(200);
    expect(response.body).toEqual({ googleClientId: "test-client-id", devLogin: false });
  });

  it("crea el usuario y una cookie de sesión httpOnly", async () => {
    const response = await request(app).post("/api/auth/google").send({ credential: "ok:Ana@Test.cl" }).expect(200);
    expect(response.body.user).toMatchObject({ email: "ana@test.cl", name: "Persona Test" });
    const cookie = sessionCookie(response.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=5184000/);
  });

  it("rechaza credenciales inválidas o vacías", async () => {
    await request(app).post("/api/auth/google").send({ credential: "falsa" }).expect(401);
    await request(app).post("/api/auth/google").send({}).expect(401);
  });

  it("reutiliza el mismo usuario y conserva el nombre que eligió", async () => {
    const { agent, user } = await loginAgent("repite@test.cl");
    await agent.patch("/api/me").send({ name: "Repite" }).expect(200);
    const again = await loginAgent("repite@test.cl");
    expect(again.user.id).toBe(user.id);
    expect(again.user.name).toBe("Repite");
  });

  it("no guarda el token en claro", async () => {
    const response = await request(app).post("/api/auth/google").send({ credential: "ok:hash@test.cl" });
    const token = decodeURIComponent(sessionCookie(response.headers["set-cookie"])!.split(";")[0].slice(4));
    const rows = await db.execute({ sql: "SELECT id FROM sessions WHERE id = ?", args: [token] });
    expect(rows.rows).toHaveLength(0);
  });

  it("limita los intentos por IP", async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request(app).post("/api/auth/google").send({ credential: "falsa" }).expect(401);
    }
    await request(app).post("/api/auth/google").send({ credential: "falsa" }).expect(429);
  });
});

describe("login por redirección", () => {
  async function startLogin(returnPath?: string) {
    const agent = request.agent(app);
    const response = await agent.get("/api/auth/nonce").query(returnPath ? { return: returnPath } : {}).expect(200);
    const cookies = ([] as string[]).concat(response.headers["set-cookie"] ?? []);
    // Las cookies del login son Secure: el cliente de supertest no las envía por http, así que se pasan a mano.
    const loginCookies = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    return { agent, nonce: response.body.nonce as string, cookies, loginCookies };
  }

  it("guarda el nonce en una cookie que llega desde Google", async () => {
    const { nonce, cookies } = await startLogin();
    expect(nonce).toMatch(/^[\w-]{20,}$/);
    const nonceCookie = cookies.find((cookie) => cookie.startsWith("login_nonce="));
    expect(nonceCookie).toMatch(/HttpOnly/);
    expect(nonceCookie).toMatch(/SameSite=None/);
    expect(nonceCookie).toMatch(/Secure/);
  });

  it("acepta el token con el mismo nonce, crea la sesión y vuelve a la página pedida", async () => {
    const { agent, nonce, loginCookies } = await startLogin("/invitacion/abc");
    const response = await agent.post("/api/auth/google/redirect")
      .set("Origin", "https://accounts.google.com")
      .set("Cookie", loginCookies)
      .type("form")
      .send({ credential: `ok:redirect@test.cl#${nonce}`, g_csrf_token: "x" })
      .expect(303);
    expect(response.headers.location).toBe("/invitacion/abc");
    expect(sessionCookie(response.headers["set-cookie"])).toMatch(/HttpOnly/);
    const me = await agent.get("/api/me").expect(200);
    expect(me.body.user.email).toBe("redirect@test.cl");
  });

  it("rechaza tokens sin nonce, con otro nonce o sin la cookie del navegador", async () => {
    const { agent, nonce, loginCookies } = await startLogin();
    for (const credential of ["ok:a@test.cl", "ok:a@test.cl#otro", "falsa"]) {
      const response = await agent.post("/api/auth/google/redirect").set("Cookie", loginCookies)
        .type("form").send({ credential }).expect(303);
      expect(response.headers.location).toBe("/?login=error");
    }
    const withoutCookie = await request(app).post("/api/auth/google/redirect").type("form")
      .send({ credential: `ok:a@test.cl#${nonce}` }).expect(303);
    expect(withoutCookie.headers.location).toBe("/?login=error");
    await agent.get("/api/me").expect(401);
  });

  it("solo vuelve a rutas internas de la app", async () => {
    for (const returnPath of ["//malicioso.example", "https://malicioso.example", "/\\malicioso.example"]) {
      const { agent, nonce, loginCookies } = await startLogin(returnPath);
      const response = await agent.post("/api/auth/google/redirect").set("Cookie", loginCookies).type("form")
        .send({ credential: `ok:vuelta@test.cl#${nonce}` }).expect(303);
      expect(response.headers.location).toBe("/");
    }
  });
});

describe("sesión", () => {
  it("exige sesión para la API", async () => {
    await request(app).get("/api/me").expect(401);
    await request(app).get("/api/families/CASA").expect(401);
    await request(app).get("/api/health").expect(200);
  });

  it("devuelve el arranque del usuario", async () => {
    const { agent, user } = await loginAgent();
    const response = await agent.get("/api/me").expect(200);
    expect(response.body).toEqual({ user, families: [], lists: [], invitations: [] });
  });

  it("valida los cambios de perfil", async () => {
    const { agent } = await loginAgent();
    await agent.patch("/api/me").send({ name: " " }).expect(400);
    await agent.patch("/api/me").send({ color: "fucsia" }).expect(400);
    const response = await agent.patch("/api/me").send({ name: "Nueva", color: "teal" }).expect(200);
    expect(response.body.user).toMatchObject({ name: "Nueva", color: "teal" });
  });

  it("cierra la sesión actual", async () => {
    const { agent } = await loginAgent();
    const response = await agent.post("/api/auth/logout").expect(204);
    expect(sessionCookie(response.headers["set-cookie"])).toMatch(/Max-Age=0/);
    await agent.get("/api/me").expect(401);
  });

  it("cierra todas las sesiones del usuario", async () => {
    const first = await loginAgent("varias@test.cl");
    const second = await loginAgent("varias@test.cl");
    await first.agent.post("/api/auth/logout-all").expect(204);
    await second.agent.get("/api/me").expect(401);
  });

  it("elimina sesiones vencidas", async () => {
    const { agent, user } = await loginAgent();
    await db.execute({ sql: "UPDATE sessions SET expires_at = ? WHERE user_id = ?", args: ["2000-01-01T00:00:00.000Z", user.id] });
    await agent.get("/api/me").expect(401);
    const rows = await db.execute({ sql: "SELECT 1 FROM sessions WHERE user_id = ?", args: [user.id] });
    expect(rows.rows).toHaveLength(0);
  });

  it("renueva el vencimiento si pasó más de un día", async () => {
    const { agent, user } = await loginAgent();
    const old = "2026-01-01T00:00:00.000Z";
    await db.execute({ sql: "UPDATE sessions SET last_seen_at = ? WHERE user_id = ?", args: [old, user.id] });
    const response = await agent.get("/api/me").expect(200);
    expect(sessionCookie(response.headers["set-cookie"])).toBeDefined();
    const rows = await db.execute({ sql: "SELECT last_seen_at FROM sessions WHERE user_id = ?", args: [user.id] });
    expect(String(rows.rows[0].last_seen_at) > old).toBe(true);
  });
});

describe("origen", () => {
  it("rechaza escrituras desde otro origen", async () => {
    const { agent } = await loginAgent();
    await agent.post("/api/families").set("Origin", "https://malicioso.example").send({ name: "X" }).expect(403);
    await agent.get("/api/me").set("Origin", "https://malicioso.example").expect(200);
  });

  it("acepta escrituras desde el mismo origen", async () => {
    const { agent } = await loginAgent();
    const host = "casa.test";
    await agent.post("/api/families").set("Host", host).set("Origin", `https://${host}`).send({ name: "X" }).expect(201);
  });
});
