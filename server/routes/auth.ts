import { Router } from "express";
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
