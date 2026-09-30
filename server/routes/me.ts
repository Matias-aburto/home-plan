import { Router } from "express";
import { userFamilies } from "../db/families.js";
import { setListOrder, visibleLists } from "../db/lists.js";
import { updateUser, userColors } from "../db/users.js";
import { currentUser } from "../http/session.js";
import { cleanText, readIdList } from "../http/validation.js";
import { notifyUserChanged } from "../realtime.js";

export const meRouter = Router();

// Arranque de la app. Las invitaciones se agregan en la Etapa 4.
meRouter.get("/", async (_request, response) => {
  const user = currentUser(response);
  const [families, lists] = await Promise.all([userFamilies(user.id), visibleLists(user.id)]);
  response.json({ user, families, lists, invitations: [] });
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

// Orden de las listas en el menú del usuario.
meRouter.put("/list-order", async (request, response) => {
  const ids = readIdList(request.body.ids);
  if (ids.length === 0) return response.status(400).json({ message: "Indica el nuevo orden." });
  const user = currentUser(response);
  await setListOrder(user.id, ids);
  await notifyUserChanged(user.id);
  return response.json({ ok: true });
});
