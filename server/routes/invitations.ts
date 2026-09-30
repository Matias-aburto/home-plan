import { Router, type Request, type Response } from "express";
import { getMembership, roleAtLeast } from "../db/families.js";
import { hasAccess, listAccess } from "../auth/access.js";
import { getListRecord } from "../db/lists.js";
import {
  acceptFamilyInvitation,
  acceptListInvitation,
  createFamilyInvitation,
  findUserIdByEmail,
  getInvitation,
  getInvitationByToken,
  invitationsSentToday,
  isFamilyMemberByEmail,
  normalizeEmail,
  pendingFamilyInvitations,
  receivedInvitations,
  setInvitationStatus,
  type Invitation
} from "../db/invitations.js";
import type { User } from "../db/types.js";
import { requireMember, currentRole, type FamilyParams } from "../http/family.js";
import { broadcastList } from "../http/lists.js";
import { currentUser } from "../http/session.js";
import { cleanText, oneOf } from "../http/validation.js";
import { notifyFamilyChanged, notifyUserChanged } from "../realtime.js";

export const invitationsRouter = Router();
export const familyInvitationsRouter = Router({ mergeParams: true });

const maxInvitationsPerDay = 50;
const invitationNotFound = { message: "No encontramos esa invitación." };

function invitationLink(request: Request, token: string) {
  return `${request.protocol}://${request.get("host")}/invitacion/${token}`;
}

// Lo que ve quien recibe la invitación (sin datos internos de quien invita).
function publicInvitation(invitation: Invitation) {
  const { invitedBy: _invitedBy, ...rest } = invitation;
  return rest;
}

async function notifyInvitee(email: string) {
  const userId = await findUserIdByEmail(email);
  if (userId) await notifyUserChanged(userId);
}

// ---- Desde la familia: invitar y ver las pendientes (owner y admin) ----

familyInvitationsRouter.use(requireMember("admin"));

familyInvitationsRouter.get<FamilyParams>("/", async (request, response) => {
  const invitations = await pendingFamilyInvitations(request.params.id);
  return response.json(invitations.map(publicInvitation));
});

familyInvitationsRouter.post<FamilyParams>("/", async (request, response) => {
  const familyId = request.params.id.toUpperCase();
  const user = currentUser(response);
  const email = normalizeEmail(cleanText(request.body.email, 120));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return response.status(400).json({ message: "Escribe un email válido." });
  const role = oneOf(["admin", "member"] as const, request.body.role ?? "member");
  if (!role) return response.status(400).json({ message: "Elige un rol válido." });
  if (role === "admin" && currentRole(response) !== "owner") {
    return response.status(403).json({ message: "Solo el dueño puede invitar administradores." });
  }
  if (await isFamilyMemberByEmail(familyId, email)) {
    return response.status(409).json({ message: "Esa persona ya es parte de la familia." });
  }
  if (await invitationsSentToday(user.id) >= maxInvitationsPerDay) {
    return response.status(429).json({ message: "Enviaste muchas invitaciones hoy. Inténtalo mañana." });
  }
  const { invitation, token } = await createFamilyInvitation(familyId, email, role, user.id);
  await notifyInvitee(email);
  await notifyFamilyChanged(familyId);
  return response.status(201).json({ invitation: publicInvitation(invitation), link: invitationLink(request, token) });
});

// ---- Para quien recibe ----

invitationsRouter.get("/", async (_request, response) => {
  const invitations = await receivedInvitations(currentUser(response).email);
  return response.json(invitations.map(publicInvitation));
});

// Vista previa del enlace. Requiere sesión, pero no que el email coincida.
invitationsRouter.get<{ token: string }>("/token/:token", async (request, response) => {
  const invitation = await getInvitationByToken(request.params.token);
  if (!invitation) return response.status(404).json(invitationNotFound);
  return response.json(publicInvitation(invitation));
});

async function respond(invitation: Invitation | null, user: User, action: "accept" | "decline", response: Response) {
  if (!invitation) return response.status(404).json(invitationNotFound);
  if (invitation.status !== "pending") {
    const messages: Record<string, string> = {
      accepted: "Esta invitación ya fue aceptada.",
      declined: "Esta invitación fue rechazada.",
      revoked: "Esta invitación fue anulada. Pide una nueva.",
      expired: "Esta invitación venció. Pide una nueva."
    };
    return response.status(410).json({ message: messages[invitation.status], status: invitation.status });
  }
  if (action === "decline") {
    await setInvitationStatus(invitation.id, "declined", user.id);
  } else if (invitation.kind === "family") {
    await acceptFamilyInvitation(invitation, user.id);
    await notifyFamilyChanged(invitation.familyId!);
  } else {
    await acceptListInvitation(invitation, user.id);
    const list = await getListRecord(invitation.listId!);
    if (list) await broadcastList(list);
  }
  await notifyUserChanged(user.id);
  return response.json({ ...publicInvitation(invitation), status: action === "accept" ? "accepted" : "declined" });
}

// Desde la bandeja: la invitación debe ser para el email de la cuenta.
async function ownInvitation(id: string, user: User) {
  const invitation = await getInvitation(id);
  return invitation && invitation.invitedEmail === normalizeEmail(user.email) ? invitation : null;
}

invitationsRouter.post<{ id: string }>("/:id/accept", async (request, response) => {
  const user = currentUser(response);
  return respond(await ownInvitation(request.params.id, user), user, "accept", response);
});

invitationsRouter.post<{ id: string }>("/:id/decline", async (request, response) => {
  const user = currentUser(response);
  return respond(await ownInvitation(request.params.id, user), user, "decline", response);
});

// Desde el enlace: cualquier cuenta con el enlace puede usarlo, una sola vez.
invitationsRouter.post<{ token: string }>("/token/:token/accept", async (request, response) => {
  return respond(await getInvitationByToken(request.params.token), currentUser(response), "accept", response);
});

invitationsRouter.post<{ token: string }>("/token/:token/decline", async (request, response) => {
  return respond(await getInvitationByToken(request.params.token), currentUser(response), "decline", response);
});

// Revocar: quien invitó, un owner/admin de la familia o quien administra la lista.
invitationsRouter.delete<{ id: string }>("/:id", async (request, response) => {
  const user = currentUser(response);
  const invitation = await getInvitation(request.params.id);
  if (!invitation) return response.status(404).json(invitationNotFound);
  const role = invitation.familyId ? await getMembership(invitation.familyId, user.id) : null;
  const list = invitation.listId ? await getListRecord(invitation.listId) : null;
  const managesList = list ? hasAccess(await listAccess(user, list), "owner") : false;
  const allowed = invitation.invitedBy === user.id || (role && roleAtLeast(role, "admin")) || managesList;
  if (!allowed) return response.status(404).json(invitationNotFound);
  if (invitation.status === "pending") {
    await setInvitationStatus(invitation.id, "revoked", user.id);
    await notifyInvitee(invitation.invitedEmail);
    if (invitation.familyId) await notifyFamilyChanged(invitation.familyId);
  }
  return response.status(204).send();
});
