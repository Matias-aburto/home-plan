import { Router } from "express";
import { familyExists } from "../db/families.js";
import { currentUser } from "../http/session.js";
import { cleanText } from "../http/validation.js";
import { createTokenRequest, familyChannel, userChannel } from "../realtime.js";

export const realtimeRouter = Router();

// Token de Ably para escuchar el canal propio y, si se indica, el de la familia actual.
realtimeRouter.get("/token", async (request, response) => {
  const channels = [userChannel(currentUser(response).id)];
  const familyId = cleanText(request.query.family, 20);
  if (familyId && await familyExists(familyId)) channels.push(familyChannel(familyId));
  const tokenRequest = await createTokenRequest(channels);
  if (!tokenRequest) return response.status(503).json({ message: "El tiempo real no está configurado." });
  return response.json(tokenRequest);
});
