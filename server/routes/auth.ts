import { randomBytes } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { googleClientId, verifyGoogleCredential } from "../auth/google.js";
import { createSession, deleteSession, deleteUserSessions } from "../db/sessions.js";
import { upsertGoogleUser } from "../db/users.js";
import {
  clearSessionCookie,
  currentUser,
  rateLimit,
  readCookie,
  requireUser,
  sessionCookie,
  setSessionCookie
} from "../http/session.js";
import { cleanText } from "../http/validation.js";

export const authRouter = Router();
export const authRateLimit = rateLimit({ max: 30, windowMs: 10 * 60 * 1000 });

// Login sin Google para desarrollo local. Nunca se habilita en Vercel.
export const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "1" && !process.env.VERCEL;

authRouter.get("/config", (_request, response) => {
  response.json({ googleClientId, devLogin: devLoginEnabled });
});

// ---- Login por redirección (sin ventana emergente, que bloquean muchos navegadores y extensiones) ----
// 1. GET /nonce: el servidor guarda un nonce en una cookie y lo entrega para pedírselo a Google.
// 2. Google firma el ID token con ese nonce y lo envía por POST a /google/redirect.
// 3. Se acepta solo si el nonce del token coincide con el de la cookie: así el login lo inició este navegador.

const nonceCookie = "login_nonce";
const returnCookie = "login_return";
const loginCookieMaxAge = 10 * 60;

// El POST llega desde accounts.google.com: la cookie debe ser SameSite=None (y por eso Secure;
// los navegadores la aceptan también en http://localhost).
function loginCookie(name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}

// Solo rutas internas de la app, para no redirigir a otro sitio.
function safeReturnPath(input: unknown) {
  return typeof input === "string" && input.startsWith("/") && !input.startsWith("//") && !input.startsWith("/\\")
    ? input.slice(0, 300)
    : "/";
}

authRouter.get("/nonce", (request, response) => {
  const nonce = randomBytes(24).toString("base64url");
  response.append("Set-Cookie", loginCookie(nonceCookie, nonce, loginCookieMaxAge));
  response.append("Set-Cookie", loginCookie(returnCookie, safeReturnPath(request.query.return), loginCookieMaxAge));
  response.setHeader("Cache-Control", "no-store");
  return response.json({ nonce });
});

function finishRedirectLogin(response: Response, path: string) {
  response.append("Set-Cookie", loginCookie(nonceCookie, "", 0));
  response.append("Set-Cookie", loginCookie(returnCookie, "", 0));
  return response.redirect(303, path);
}

authRouter.post("/google/redirect", authRateLimit, express.urlencoded({ extended: false }), async (request: Request, response: Response) => {
  const credential = cleanText(request.body?.credential, 4096);
  const nonce = readCookie(request, nonceCookie);
  const returnPath = safeReturnPath(readCookie(request, returnCookie));
  const profile = credential && nonce ? await verifyGoogleCredential(credential, nonce) : null;
  if (!profile) return finishRedirectLogin(response, "/?login=error");
  const user = await upsertGoogleUser(profile);
  setSessionCookie(request, response, await createSession(user.id, request.get("user-agent") || null));
  return finishRedirectLogin(response, returnPath);
});

// Login con la ventana emergente de Google (JSON). Se mantiene para clientes que ya lo usan.
authRouter.post("/google", authRateLimit, async (request, response) => {
  const credential = cleanText(request.body.credential, 4096);
  const profile = credential ? await verifyGoogleCredential(credential) : null;
  if (!profile) return response.status(401).json({ message: "No pudimos validar tu cuenta de Google." });
  const user = await upsertGoogleUser(profile);
  setSessionCookie(request, response, await createSession(user.id, request.get("user-agent") || null));
  return response.json({ user });
});

if (devLoginEnabled) {
  authRouter.post("/dev", authRateLimit, async (request, response) => {
    const email = cleanText(request.body.email, 120).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return response.status(400).json({ message: "Escribe un email." });
    const user = await upsertGoogleUser({ sub: `dev:${email}`, email, name: email.split("@")[0], picture: null });
    setSessionCookie(request, response, await createSession(user.id, request.get("user-agent") || null));
    return response.json({ user });
  });
}

authRouter.post("/logout", async (request, response) => {
  const token = readCookie(request, sessionCookie);
  if (token) await deleteSession(token);
  clearSessionCookie(request, response);
  return response.status(204).send();
});

authRouter.post("/logout-all", requireUser, async (request, response) => {
  await deleteUserSessions(currentUser(response).id);
  clearSessionCookie(request, response);
  return response.status(204).send();
});
