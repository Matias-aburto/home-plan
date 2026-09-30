import { Router } from "express";
import { normalizeText } from "../db/client.js";
import { addLocation, deleteLocation, listLocations, renameLocation } from "../db/locations.js";
import { broadcast, type FamilyParams } from "../http/family.js";
import { cleanText } from "../http/validation.js";

export const locationsRouter = Router({ mergeParams: true });

const missingName = { message: "Escribe un nombre para la ubicación." };
const duplicated = { message: "Esa ubicación ya existe." };

async function nameTaken(familyId: string, name: string, exceptId?: string) {
  return (await listLocations(familyId)).some((location) =>
    location.id !== exceptId && normalizeText(location.name) === normalizeText(name)
  );
}

locationsRouter.post<FamilyParams>("/", async (request, response) => {
  const name = cleanText(request.body.name, 30);
  if (!name) return response.status(400).json(missingName);
  if (await nameTaken(request.params.id, name)) return response.status(409).json(duplicated);

  const location = await addLocation(request.params.id, name);
  await broadcast(request.params.id);
  return response.status(201).json(location);
});

locationsRouter.patch<FamilyParams & { locationId: string }>("/:locationId", async (request, response) => {
  const { id: familyId, locationId } = request.params;
  const name = cleanText(request.body.name, 30);
  if (!name) return response.status(400).json(missingName);
  if (await nameTaken(familyId, name, locationId)) return response.status(409).json(duplicated);

  const updated = await renameLocation(familyId, locationId, name);
  if (!updated) return response.status(404).json({ message: "No encontramos esa ubicación." });
  await broadcast(familyId);
  return response.json({ id: locationId, name });
});

locationsRouter.delete<FamilyParams & { locationId: string }>("/:locationId", async (request, response) => {
  const deleted = await deleteLocation(request.params.id, request.params.locationId);
  if (!deleted) return response.status(404).json({ message: "No encontramos esa ubicación." });
  await broadcast(request.params.id);
  return response.status(204).send();
});
