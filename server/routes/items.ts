import { Router } from "express";
import {
  addItem,
  deleteItem,
  getItem,
  reorderItems,
  setItemCompleted,
  updateItemDetails
} from "../db/items.js";
import { broadcast, type FamilyParams } from "../http/family.js";
import { capitalizeFirst, cleanText, readIdList } from "../http/validation.js";

export const itemsRouter = Router({ mergeParams: true });

itemsRouter.post<FamilyParams>("/", async (request, response) => {
  const name = capitalizeFirst(cleanText(request.body.name, 80));
  const locationId = cleanText(request.body.locationId, 30) || null;
  const requestedId = cleanText(request.body.id, 50) || undefined;
  if (!name) return response.status(400).json({ message: "Escribe qué necesitas comprar." });

  const item = await addItem(request.params.id, name, locationId, requestedId);
  await broadcast(request.params.id);
  return response.status(201).json(item);
});

itemsRouter.post<FamilyParams>("/reorder", async (request, response) => {
  const ids = readIdList(request.body.ids);
  if (ids.length === 0) return response.status(400).json({ message: "Indica el nuevo orden." });
  await reorderItems(request.params.id, ids);
  await broadcast(request.params.id);
  return response.json({ ok: true });
});

itemsRouter.patch<FamilyParams & { itemId: string }>("/:itemId", async (request, response) => {
  const { id: familyId, itemId } = request.params;
  const hasCompleted = typeof request.body.completed === "boolean";
  const hasDetails = "name" in request.body;
  if (!hasCompleted && !hasDetails) {
    return response.status(400).json({ message: "Indica qué quieres modificar." });
  }
  let updated = true;
  if (hasCompleted) updated = await setItemCompleted(familyId, itemId, request.body.completed);
  if (updated && hasDetails) {
    const name = capitalizeFirst(cleanText(request.body.name, 80));
    const locationId = cleanText(request.body.locationId, 30) || null;
    if (!name) return response.status(400).json({ message: "Escribe qué necesitas comprar." });
    updated = await updateItemDetails(familyId, itemId, name, locationId);
  }
  if (!updated) return response.status(404).json({ message: "No encontramos ese producto." });
  await broadcast(familyId);
  return response.json(await getItem(familyId, itemId));
});

itemsRouter.delete<FamilyParams & { itemId: string }>("/:itemId", async (request, response) => {
  await deleteItem(request.params.id, request.params.itemId);
  await broadcast(request.params.id);
  return response.status(204).send();
});
