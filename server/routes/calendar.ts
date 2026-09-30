import { Router } from "express";
import {
  addCalendarEntry,
  deleteCalendarEntry,
  getCalendarEntry,
  updateCalendarEntry
} from "../db/calendar.js";
import { broadcast, type FamilyParams } from "../http/family.js";
import { cleanText, readCalendarEntry } from "../http/validation.js";

export const calendarRouter = Router({ mergeParams: true });

const invalidEntry = { message: "Revisa el título, la fecha y la hora." };

calendarRouter.post<FamilyParams>("/", async (request, response) => {
  const entryData = readCalendarEntry(request.body);
  const requestedId = cleanText(request.body.id, 50) || undefined;
  if (!entryData) return response.status(400).json(invalidEntry);
  const entry = await addCalendarEntry(request.params.id, entryData, requestedId);
  await broadcast(request.params.id);
  return response.status(201).json(entry);
});

calendarRouter.patch<FamilyParams & { entryId: string }>("/:entryId", async (request, response) => {
  const { id: familyId, entryId } = request.params;
  const entryData = readCalendarEntry(request.body);
  if (!entryData) return response.status(400).json(invalidEntry);
  const updated = await updateCalendarEntry(familyId, entryId, entryData);
  if (!updated) return response.status(404).json({ message: "No encontramos ese evento." });
  await broadcast(familyId);
  return response.json(await getCalendarEntry(familyId, entryId));
});

calendarRouter.delete<FamilyParams & { entryId: string }>("/:entryId", async (request, response) => {
  const deleted = await deleteCalendarEntry(request.params.id, request.params.entryId);
  if (!deleted) return response.status(404).json({ message: "No encontramos ese evento." });
  await broadcast(request.params.id);
  return response.status(204).send();
});
