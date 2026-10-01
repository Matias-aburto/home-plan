import { Router } from "express";
import { listAccess } from "../auth/access.js";
import {
  addListItem,
  deleteListItem,
  getListItems,
  reorderListItems,
  updateListItem
} from "../db/listItems.js";
import {
  createList,
  deleteList,
  moveList,
  getListRecord,
  listSummary,
  setListSort,
  updateList
} from "../db/lists.js";
import { getMembership } from "../db/families.js";
import {
  createListInvitation,
  findUserIdByEmail,
  normalizeEmail,
  pendingListInvitations
} from "../db/invitations.js";
import {
  getListPermission,
  listSharedMembers,
  removeListMember,
  setListMemberPermission
} from "../db/listMembers.js";
import { getUser } from "../db/users.js";
import { notifyUserChanged } from "../realtime.js";
import {
  broadcastList,
  currentAccess,
  currentList,
  loadList,
  requireAccess,
  type ListParams
} from "../http/lists.js";
import { currentUser } from "../http/session.js";
import {
  capitalizeFirst,
  cleanText,
  listColors,
  listIcons,
  oneOf,
  readIdList,
  readSortMode
} from "../http/validation.js";

export const listsRouter = Router();

const invalidName = { message: "Escribe un nombre para la lista." };
const missingTitle = { message: "Escribe un nombre para el ítem." };
const itemNotFound = { message: "No encontramos ese ítem." };

listsRouter.post("/", async (request, response) => {
  const user = currentUser(response);
  const body = request.body as Record<string, unknown>;
  const name = cleanText(body.name, 40);
  if (!name) return response.status(400).json(invalidName);
  const familyId = cleanText(body.familyId, 20).toUpperCase() || null;
  if (familyId && !(await getMembership(familyId, user.id))) {
    return response.status(404).json({ message: "No encontramos ese grupo." });
  }
  const requestedId = cleanText(body.id, 50) || undefined;
  if (requestedId) {
    const existing = await getListRecord(requestedId);
    const access = existing ? await listAccess(user, existing) : "none";
    if (existing && access !== "none") return response.status(201).json(await listSummary(user.id, existing, access));
    if (existing) return response.status(409).json({ message: "Ese identificador ya está en uso." });
  }
  const list = await createList(user.id, familyId, {
    name: capitalizeFirst(name),
    icon: oneOf(listIcons, body.icon) || "list-checks",
    color: oneOf(listColors, body.color) || "green"
  }, requestedId);
  await broadcastList(list);
  const access = await listAccess(user, list);
  return response.status(201).json(await listSummary(user.id, list, access === "none" ? "owner" : access));
});

listsRouter.use("/:listId", loadList);

listsRouter.get<ListParams>("/:listId", async (_request, response) => {
  const list = currentList(response);
  const [summary, items, sharedWith] = await Promise.all([
    listSummary(currentUser(response).id, list, currentAccess(response)),
    getListItems(list.id),
    listSharedMembers(list.id)
  ]);
  return response.json({ list: summary, items, sharedWith });
});

listsRouter.patch<ListParams>("/:listId", requireAccess("owner"), async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const name = "name" in body ? capitalizeFirst(cleanText(body.name, 40)) : undefined;
  if (name === "") return response.status(400).json(invalidName);
  const icon = "icon" in body ? oneOf(listIcons, body.icon) : undefined;
  const color = "color" in body ? oneOf(listColors, body.color) : undefined;
  if (icon === null || color === null) return response.status(400).json({ message: "Elige un ícono y un color válidos." });
  const archived = typeof body.archived === "boolean" ? body.archived : undefined;
  const list = (await updateList(currentList(response).id, { name, icon, color, archived }))!;
  await broadcastList(list);
  return response.json(await listSummary(currentUser(response).id, list, currentAccess(response)));
});

listsRouter.delete<ListParams>("/:listId", requireAccess("owner"), async (_request, response) => {
  const list = currentList(response);
  // Se leen antes de borrar: después ya no quedan registros de con quién estaba compartida.
  const shared = (await listSharedMembers(list.id)).map(({ userId }) => userId);
  await deleteList(list.id);
  await broadcastList(list, shared);
  return response.status(204).send();
});

// Mover entre lo personal (familyId null) y una familia a la que pertenece quien la mueve.
listsRouter.post<ListParams>("/:listId/move", requireAccess("owner"), async (request, response) => {
  const list = currentList(response);
  const user = currentUser(response);
  const familyId = cleanText(request.body.familyId, 20).toUpperCase() || null;
  if (familyId === list.familyId && (familyId || list.ownerUserId === user.id)) {
    return response.status(400).json({ message: "La lista ya está ahí." });
  }
  if (familyId && !(await getMembership(familyId, user.id))) {
    return response.status(404).json({ message: "No encontramos ese grupo." });
  }
  await moveList(list.id, familyId ? { familyId } : { ownerUserId: user.id });
  const moved = (await getListRecord(list.id))!;
  // Avisa también a la familia o dueño anterior, que dejan de verla.
  await broadcastList(moved, list.ownerUserId ? [list.ownerUserId] : []);
  if (list.familyId) await broadcastList(list);
  // Quien la mueve siempre queda con acceso: es dueño o miembro de la familia de destino.
  const access = await listAccess(user, moved);
  return response.json(await listSummary(user.id, moved, access === "none" ? "owner" : access));
});

// Compartir con personas puntuales: invitar por email con permiso de editor o lector.
listsRouter.get<ListParams>("/:listId/invitations", requireAccess("owner"), async (_request, response) => {
  const invitations = await pendingListInvitations(currentList(response).id);
  return response.json(invitations.map(({ invitedBy: _invitedBy, ...invitation }) => invitation));
});

listsRouter.post<ListParams>("/:listId/invitations", requireAccess("owner"), async (request, response) => {
  const list = currentList(response);
  const user = currentUser(response);
  const email = normalizeEmail(cleanText(request.body.email, 120));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return response.status(400).json({ message: "Escribe un email válido." });
  const permission = oneOf(["editor", "viewer"] as const, request.body.permission ?? "editor");
  if (!permission) return response.status(400).json({ message: "Elige un permiso válido." });
  const existingUserId = await findUserIdByEmail(email);
  const existingUser = existingUserId ? await getUser(existingUserId) : null;
  if (existingUser && await listAccess(existingUser, list) !== "none") {
    return response.status(409).json({ message: "Esa persona ya tiene acceso a la lista." });
  }
  const { invitation, token } = await createListInvitation(list.id, email, permission, user.id);
  if (existingUserId) await notifyUserChanged(existingUserId);
  return response.status(201).json({
    invitation: (({ invitedBy: _invitedBy, ...rest }) => rest)(invitation),
    link: `${request.protocol}://${request.get("host")}/invitacion/${token}`
  });
});

listsRouter.patch<ListParams & { userId: string }>("/:listId/members/:userId", requireAccess("owner"), async (request, response) => {
  const list = currentList(response);
  const permission = oneOf(["editor", "viewer"] as const, request.body.permission);
  if (!permission) return response.status(400).json({ message: "Elige un permiso válido." });
  if (!(await setListMemberPermission(list.id, request.params.userId, permission))) {
    return response.status(404).json({ message: "Esa persona no tiene la lista compartida." });
  }
  await broadcastList(list);
  return response.json({ userId: request.params.userId, permission });
});

// Quitar a alguien (quien administra la lista) o dejar de ver una lista compartida conmigo ("me").
listsRouter.delete<ListParams & { userId: string }>("/:listId/members/:userId", async (request, response) => {
  const list = currentList(response);
  const user = currentUser(response);
  const targetId = request.params.userId === "me" ? user.id : request.params.userId;
  if (targetId !== user.id && currentAccess(response) !== "owner") {
    return response.status(403).json({ message: "No tienes permiso para hacer esto en la lista." });
  }
  if (!(await getListPermission(list.id, targetId))) {
    return response.status(404).json({ message: "Esa persona no tiene la lista compartida." });
  }
  await removeListMember(list.id, targetId);
  await broadcastList(list, [targetId]);
  return response.status(204).send();
});

// Preferencias propias sobre la lista (hoy, el orden de los ítems). Cualquier nivel de acceso.
listsRouter.put<ListParams>("/:listId/prefs", async (request, response) => {
  const sort = readSortMode(request.body.sort);
  if (!sort) return response.status(400).json({ message: "Elige un orden válido." });
  await setListSort(currentUser(response).id, currentList(response).id, sort);
  return response.json({ sort });
});

listsRouter.post<ListParams>("/:listId/items", requireAccess("editor"), async (request, response) => {
  const list = currentList(response);
  const title = capitalizeFirst(cleanText(request.body.title, 100));
  if (!title) return response.status(400).json(missingTitle);
  const item = await addListItem(list.id, { title, createdBy: currentUser(response).id }, cleanText(request.body.id, 50) || undefined);
  await broadcastList(list);
  return response.status(201).json(item);
});

listsRouter.post<ListParams>("/:listId/items/reorder", requireAccess("editor"), async (request, response) => {
  const ids = readIdList(request.body.ids);
  if (ids.length === 0) return response.status(400).json({ message: "Indica el nuevo orden." });
  await reorderListItems(currentList(response).id, ids);
  await broadcastList(currentList(response));
  return response.json({ ok: true });
});

listsRouter.patch<ListParams & { itemId: string }>("/:listId/items/:itemId", requireAccess("editor"), async (request, response) => {
  const list = currentList(response);
  const body = request.body as Record<string, unknown>;
  const title = "title" in body ? capitalizeFirst(cleanText(body.title, 100)) : undefined;
  if (title === "") return response.status(400).json(missingTitle);
  const item = await updateListItem(list.id, request.params.itemId, {
    title,
    completed: typeof body.completed === "boolean" ? body.completed : undefined
  });
  if (!item) return response.status(404).json(itemNotFound);
  await broadcastList(list);
  return response.json(item);
});

listsRouter.delete<ListParams & { itemId: string }>("/:listId/items/:itemId", requireAccess("editor"), async (request, response) => {
  const list = currentList(response);
  await deleteListItem(list.id, request.params.itemId);
  await broadcastList(list);
  return response.status(204).send();
});
