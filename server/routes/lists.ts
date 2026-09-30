import { Router } from "express";
import { baseCatalog } from "../catalog.js";
import { normalizeText } from "../db/client.js";
import { findLearnedNames, rememberName } from "../db/learnedNames.js";
import {
  addListItem,
  deleteListItem,
  getListItems,
  reorderListItems,
  updateListItem
} from "../db/listItems.js";
import {
  createPersonalList,
  deleteList,
  getListRecord,
  listSummary,
  setListSort,
  updateList
} from "../db/lists.js";
import { addPlace, deletePlace, listPlaces, placeNameTaken, renamePlace, validPlaceId } from "../db/places.js";
import { scopeOf } from "../db/scopes.js";
import type { ListRecord } from "../db/types.js";
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
  listKinds,
  oneOf,
  readIdList,
  readSortMode
} from "../http/validation.js";

export const listsRouter = Router();

const invalidName = { message: "Escribe un nombre para la lista." };
const missingTitle = { message: "Escribe un nombre para el ítem." };
const itemNotFound = { message: "No encontramos ese ítem." };

// Las listas de tipo checklist no usan ubicación.
async function readLocation(list: ListRecord, input: unknown) {
  if (list.kind === "checklist") return null;
  return validPlaceId(scopeOf(list), cleanText(input, 30) || null);
}

listsRouter.post("/", async (request, response) => {
  const user = currentUser(response);
  const body = request.body as Record<string, unknown>;
  const name = cleanText(body.name, 40);
  const kind = oneOf(listKinds, body.kind);
  if (!name) return response.status(400).json(invalidName);
  if (!kind) return response.status(400).json({ message: "Elige un tipo de lista." });
  const requestedId = cleanText(body.id, 50) || undefined;
  if (requestedId) {
    const existing = await getListRecord(requestedId);
    if (existing?.ownerUserId === user.id) return response.status(201).json(await listSummary(user.id, existing, "owner"));
    if (existing) return response.status(409).json({ message: "Ese identificador ya está en uso." });
  }
  const list = await createPersonalList(user.id, {
    name: capitalizeFirst(name),
    kind,
    icon: oneOf(listIcons, body.icon) || (kind === "shopping" ? "shopping-basket" : kind === "tasks" ? "list-todo" : "list-checks"),
    color: oneOf(listColors, body.color) || "green"
  }, requestedId);
  await broadcastList(list);
  return response.status(201).json(await listSummary(user.id, list, "owner"));
});

listsRouter.use("/:listId", loadList);

listsRouter.get<ListParams>("/:listId", async (_request, response) => {
  const list = currentList(response);
  const [summary, items, locations] = await Promise.all([
    listSummary(currentUser(response).id, list, currentAccess(response)),
    getListItems(list.id),
    list.kind === "checklist" ? Promise.resolve([]) : listPlaces(scopeOf(list))
  ]);
  return response.json({ list: summary, items, locations });
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
  await deleteList(list.id);
  await broadcastList(list);
  return response.status(204).send();
});

// Preferencias propias sobre la lista (hoy, el orden de los ítems). Cualquier nivel de acceso.
listsRouter.put<ListParams>("/:listId/prefs", async (request, response) => {
  const sort = readSortMode(request.body.sort);
  if (!sort) return response.status(400).json({ message: "Elige un orden válido." });
  await setListSort(currentUser(response).id, currentList(response).id, sort);
  return response.json({ sort });
});

listsRouter.get<ListParams>("/:listId/suggestions", async (request, response) => {
  const list = currentList(response);
  const query = normalizeText(cleanText(request.query.q, 80));
  if (list.kind !== "shopping" || query.length < 2) return response.json([]);

  // El catálogo base suma menos que lo que ya se usó en listas del mismo dueño.
  const suggestions = new Map<string, { name: string; category: string; score: number }>();
  for (const product of baseCatalog) {
    const key = normalizeText(product.name);
    if (key.includes(query)) suggestions.set(key, { ...product, score: key.startsWith(query) ? 100 : 50 });
  }
  for (const product of await findLearnedNames(scopeOf(list), query)) {
    const key = normalizeText(product.name);
    suggestions.set(key, {
      name: product.name,
      category: suggestions.get(key)?.category || "Usado antes",
      score: (key.startsWith(query) ? 200 : 150) + Math.min(product.uses, 20)
    });
  }
  return response.json(
    [...suggestions.values()]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"))
      .slice(0, 6)
      .map(({ name, category }) => ({ name, category }))
  );
});

listsRouter.post<ListParams>("/:listId/items", requireAccess("editor"), async (request, response) => {
  const list = currentList(response);
  const title = capitalizeFirst(cleanText(request.body.title, 100));
  if (!title) return response.status(400).json(missingTitle);
  const item = await addListItem(list.id, {
    title,
    locationId: await readLocation(list, request.body.locationId),
    assigneeUserId: null,
    createdBy: currentUser(response).id
  }, cleanText(request.body.id, 50) || undefined);
  if (list.kind === "shopping") await rememberName(scopeOf(list), title);
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
    completed: typeof body.completed === "boolean" ? body.completed : undefined,
    locationId: "locationId" in body ? await readLocation(list, body.locationId) : undefined
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

// Las ubicaciones son del dueño de la lista y se comparten entre sus listas.
listsRouter.post<ListParams>("/:listId/locations", requireAccess("owner"), async (request, response) => {
  const list = currentList(response);
  const name = cleanText(request.body.name, 30);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para la ubicación." });
  if (await placeNameTaken(scopeOf(list), name)) return response.status(409).json({ message: "Esa ubicación ya existe." });
  const place = await addPlace(scopeOf(list), name);
  await broadcastList(list);
  return response.status(201).json(place);
});

listsRouter.patch<ListParams & { locationId: string }>("/:listId/locations/:locationId", requireAccess("owner"), async (request, response) => {
  const list = currentList(response);
  const name = cleanText(request.body.name, 30);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para la ubicación." });
  if (await placeNameTaken(scopeOf(list), name, request.params.locationId)) {
    return response.status(409).json({ message: "Esa ubicación ya existe." });
  }
  if (!(await renamePlace(scopeOf(list), request.params.locationId, name))) {
    return response.status(404).json({ message: "No encontramos esa ubicación." });
  }
  await broadcastList(list);
  return response.json({ id: request.params.locationId, name });
});

listsRouter.delete<ListParams & { locationId: string }>("/:listId/locations/:locationId", requireAccess("owner"), async (request, response) => {
  const list = currentList(response);
  if (!(await deletePlace(scopeOf(list), request.params.locationId))) {
    return response.status(404).json({ message: "No encontramos esa ubicación." });
  }
  await broadcastList(list);
  return response.status(204).send();
});
