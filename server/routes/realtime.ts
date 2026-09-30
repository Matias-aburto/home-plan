import { Router } from "express";
import { userFamilies } from "../db/families.js";
import { currentUser } from "../http/session.js";
import { createTokenRequest, familyChannel, userChannel } from "../realtime.js";

export const realtimeRouter = Router();

// Token de Ably para escuchar el canal propio y el de cada familia del usuario.
realtimeRouter.get("/token", async (_request, response) => {
  const user = currentUser(response);
  const families = await userFamilies(user.id);
  const tokenRequest = await createTokenRequest([userChannel(user.id), ...families.map(({ id }) => familyChannel(id))]);
  if (!tokenRequest) return response.status(503).json({ message: "El tiempo real no está configurado." });
  return response.json(tokenRequest);
});
