import type { NextFunction, Request, Response } from "express";
import { resolveSession, sessionDurationMs } from "../db/sessions.js";
import type { User } from "../db/types.js";

export const sessionCookie = "sid";

export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookieAttributes(request: Request) {
  return ["Path=/", "HttpOnly", "SameSite=Lax", ...(request.secure ? ["Secure"] : [])];
}

export function setSessionCookie(request: Request, response: Response, token: string) {
  response.append("Set-Cookie", [
    `${sessionCookie}=${encodeURIComponent(token)}`,
    ...cookieAttributes(request),
    `Max-Age=${Math.floor(sessionDurationMs / 1000)}`
  ].join("; "));
}

export function clearSessionCookie(request: Request, response: Response) {
  response.append("Set-Cookie", [`${sessionCookie}=`, ...cookieAttributes(request), "Max-Age=0"].join("; "));
}

export function currentUser(response: Response) {
  return response.locals.user as User;
}

// Exige una sesión válida. Si se renovó, reenvía la cookie con el nuevo vencimiento.
export async function requireUser(request: Request, response: Response, next: NextFunction) {
  const token = readCookie(request, sessionCookie);
  const session = token ? await resolveSession(token) : null;
  if (!session) {
    if (token) clearSessionCookie(request, response);
    return response.status(401).json({ message: "Inicia sesión para continuar." });
  }
  if (session.renewed) setSessionCookie(request, response, token!);
  response.locals.user = session.user;
  next();
}

// Rutas que reciben POST desde otro sitio a propósito. Se protegen de otra forma (nonce del login).
const crossOriginPosts = new Set(["/auth/google/redirect"]);

// Complementa SameSite=Lax: rechaza escrituras que vengan de otro origen.
export function requireSameOrigin(request: Request, response: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  if (crossOriginPosts.has(request.path)) return next();
  const origin = request.get("origin");
  if (origin) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // Un Origin inválido se trata como ajeno.
    }
    if (host !== request.get("host")) return response.status(403).json({ message: "Origen no permitido." });
  }
  next();
}

// Límite simple por IP y por instancia; suficiente para frenar abuso básico del login.
export function rateLimit({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const middleware = (request: Request, response: Response, next: NextFunction) => {
    const key = request.ip || "desconocido";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      response.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return response.status(429).json({ message: "Demasiados intentos. Espera un momento." });
    }
    next();
  };
  return Object.assign(middleware, { reset: () => hits.clear() });
}
