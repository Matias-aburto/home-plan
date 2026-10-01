import { Router } from "express";
import {
  createFamily,
  deleteFamily,
  familySummary,
  getMembership,
  listMembers,
  removeMember,
  renameFamily,
  setMemberRole,
  transferOwnership
} from "../db/families.js";
import { listPlaces } from "../db/places.js";
import { currentRole, requireMember, type FamilyParams } from "../http/family.js";
import { currentUser } from "../http/session.js";
import { cleanText, oneOf } from "../http/validation.js";
import { notifyFamilyChanged, notifyUserChanged } from "../realtime.js";

export const familiesRouter = Router();

type MemberParams = FamilyParams & { userId: string };

const memberNotFound = { message: "No encontramos a esa persona en el grupo." };

// Avisa a la familia y a cada persona afectada (su menú de familias cambió).
async function broadcastMembership(familyId: string, userIds: string[]) {
  await notifyFamilyChanged(familyId);
  await Promise.all(userIds.map((userId) => notifyUserChanged(userId)));
}

familiesRouter.post("/", async (request, response) => {
  const name = cleanText(request.body.name, 50);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para el grupo." });
  const user = currentUser(response);
  const familyId = await createFamily(user.id, name);
  await notifyUserChanged(user.id);
  return response.status(201).json(await familySummary(familyId, user.id));
});

familiesRouter.get<FamilyParams>("/:id", requireMember(), async (request, response) => {
  const familyId = request.params.id.toUpperCase();
  const [summary, members, locations] = await Promise.all([
    familySummary(familyId, currentUser(response).id),
    listMembers(familyId),
    listPlaces({ ownerUserId: null, familyId })
  ]);
  return response.json({ family: summary, members, locations });
});

familiesRouter.patch<FamilyParams>("/:id", requireMember("admin"), async (request, response) => {
  const name = cleanText(request.body.name, 50);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para el grupo." });
  const familyId = request.params.id.toUpperCase();
  await renameFamily(familyId, name);
  await broadcastMembership(familyId, (await listMembers(familyId)).map(({ userId }) => userId));
  return response.json(await familySummary(familyId, currentUser(response).id));
});

familiesRouter.delete<FamilyParams>("/:id", requireMember("owner"), async (request, response) => {
  const familyId = request.params.id.toUpperCase();
  const members = await listMembers(familyId);
  await deleteFamily(familyId);
  await broadcastMembership(familyId, members.map(({ userId }) => userId));
  return response.status(204).send();
});

// Cambiar el rol entre admin y member. La propiedad solo cambia con /transfer.
familiesRouter.patch<MemberParams>("/:id/members/:userId", requireMember("owner"), async (request, response) => {
  const familyId = request.params.id.toUpperCase();
  const role = oneOf(["admin", "member"] as const, request.body.role);
  if (!role) return response.status(400).json({ message: "Elige un rol válido." });
  const targetRole = await getMembership(familyId, request.params.userId);
  if (!targetRole) return response.status(404).json(memberNotFound);
  if (targetRole === "owner") return response.status(409).json({ message: "Para cambiar al dueño, transfiere el grupo." });
  await setMemberRole(familyId, request.params.userId, role);
  await broadcastMembership(familyId, [request.params.userId]);
  return response.json({ userId: request.params.userId, role });
});

// Quitar a alguien o salir ("me"). El dueño no puede salir sin transferir antes.
familiesRouter.delete<MemberParams>("/:id/members/:userId", requireMember(), async (request, response) => {
  const familyId = request.params.id.toUpperCase();
  const me = currentUser(response);
  const targetId = request.params.userId === "me" ? me.id : request.params.userId;
  const targetRole = await getMembership(familyId, targetId);
  if (!targetRole) return response.status(404).json(memberNotFound);
  const myRole = currentRole(response);
  if (targetId === me.id) {
    if (myRole === "owner") {
      return response.status(409).json({ message: "Transfiere el grupo a otra persona antes de salir, o elimínalo." });
    }
  } else {
    const canRemove = myRole === "owner" || (myRole === "admin" && targetRole === "member");
    if (!canRemove) return response.status(403).json({ message: "No tienes permiso para quitar a esta persona." });
  }
  await removeMember(familyId, targetId);
  await broadcastMembership(familyId, [targetId]);
  return response.status(204).send();
});

familiesRouter.post<FamilyParams>("/:id/transfer", requireMember("owner"), async (request, response) => {
  const familyId = request.params.id.toUpperCase();
  const me = currentUser(response);
  const targetId = cleanText(request.body.userId, 50);
  if (!targetId || targetId === me.id) return response.status(400).json({ message: "Elige a otra persona del grupo." });
  if (!(await getMembership(familyId, targetId))) return response.status(404).json(memberNotFound);
  await transferOwnership(familyId, me.id, targetId);
  await broadcastMembership(familyId, [me.id, targetId]);
  return response.json(await familySummary(familyId, me.id));
});
