import { Router } from "express";
import { getMembership, userFamilies } from "../db/families.js";
import { receivedInvitations } from "../db/invitations.js";
import { setListOrder, visibleLists } from "../db/lists.js";
import { setSpaceColor, spaceColors } from "../db/spaceColors.js";
import { updateUser, userColors } from "../db/users.js";
import { currentUser } from "../http/session.js";
import { cleanText, listColors, oneOf, readIdList } from "../http/validation.js";
import { notifyUserChanged } from "../realtime.js";

export const meRouter = Router();

// Arranque de la app: grupos, listas visibles, colores de cada espacio e invitaciones pendientes recibidas.
meRouter.get("/", async (_request, response) => {
  const user = currentUser(response);
  const [families, lists, colors, invitations] = await Promise.all([
    userFamilies(user.id),
    visibleLists(user.id),
    spaceColors(user.id),
    receivedInvitations(user.email)
  ]);
  response.json({
    user,
    families,
    lists,
    spaceColors: colors,
    invitations: invitations.map(({ invitedBy: _invitedBy, ...invitation }) => invitation)
  });
});

meRouter.patch("/", async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const name = "name" in body ? cleanText(body.name, 50) : undefined;
  if (name === "") return response.status(400).json({ message: "Escribe tu nombre." });
  const color = "color" in body ? String(body.color) : undefined;
  if (color !== undefined && !(userColors as readonly string[]).includes(color)) {
    return response.status(400).json({ message: "Elige uno de los colores disponibles." });
  }
  const user = await updateUser(currentUser(response).id, { name, color });
  return response.json({ user });
});

// Color con que el usuario ve un espacio en su calendario.
meRouter.put("/space-colors", async (request, response) => {
  const user = currentUser(response);
  const space = cleanText(request.body.space, 20);
  const color = oneOf(listColors, request.body.color);
  if (!space || !color) return response.status(400).json({ message: "Elige un color válido." });
  const key = space === "personal" ? space : space.toUpperCase();
  if (key !== "personal" && !(await getMembership(key, user.id))) return response.status(404).json({ message: "No encontramos ese grupo." });
  await setSpaceColor(user.id, key, color);
  await notifyUserChanged(user.id);
  return response.json({ ok: true });
});

// Orden de las listas en el menú del usuario.
meRouter.put("/list-order", async (request, response) => {
  const ids = readIdList(request.body.ids);
  if (ids.length === 0) return response.status(400).json({ message: "Indica el nuevo orden." });
  const user = currentUser(response);
  await setListOrder(user.id, ids);
  await notifyUserChanged(user.id);
  return response.json({ ok: true });
});
