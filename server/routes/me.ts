import { Router } from "express";
import { updateUser, userColors } from "../db/users.js";
import { currentUser } from "../http/session.js";
import { cleanText } from "../http/validation.js";

export const meRouter = Router();

// Arranque de la app. Familias, listas e invitaciones se agregan en las próximas etapas.
meRouter.get("/", (_request, response) => {
  response.json({ user: currentUser(response), families: [], lists: [], invitations: [] });
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
