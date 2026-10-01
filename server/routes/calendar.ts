import { Router, type Response } from "express";
import { addEvent, deleteEvent, ensureSpaceCalendar, getEventRecord, updateEvent, userEvents } from "../db/calendars.js";
import { getMembership } from "../db/families.js";
import type { CalendarEvent, User } from "../db/types.js";
import { currentUser } from "../http/session.js";
import { cleanText, readCalendarEvent } from "../http/validation.js";
import { notifyFamilyChanged, notifyUserChanged } from "../realtime.js";

// Un solo calendario por persona: sus eventos personales y los de sus grupos. Cada evento es de un
// espacio (familyId null: personal) y se puede mover entre espacios.
export const calendarRouter = Router();

const invalidEvent = { message: "Revisa el título, la fecha y la hora." };
const eventNotFound = { message: "No encontramos ese evento." };
const groupNotFound = { message: "No encontramos ese grupo." };

// Avisa a quienes ven el espacio del evento.
async function broadcast(userId: string, familyId: string | null) {
  if (familyId) await notifyFamilyChanged(familyId, { calendarId: familyId });
  else await notifyUserChanged(userId, { calendarId: "personal" });
}

function readSpace(input: unknown) {
  return cleanText(input, 20).toUpperCase() || null;
}

// Carga el evento si el usuario lo ve; si no, responde 404 para no revelar que existe.
async function visibleEvent(user: User, eventId: string, response: Response) {
  const record = await getEventRecord(eventId);
  const visible = record && (record.ownerUserId === user.id
    || (record.event.familyId && await getMembership(record.event.familyId, user.id)));
  if (!record || !visible) {
    response.status(404).json(eventNotFound);
    return null;
  }
  return record.event;
}

// Sacar un evento de un grupo solo lo puede hacer quien lo creó o quien administra el grupo.
async function canMoveOut(user: User, event: CalendarEvent) {
  if (!event.familyId || event.createdBy === user.id) return true;
  const role = await getMembership(event.familyId, user.id);
  return role === "owner" || role === "admin";
}

calendarRouter.get("/", async (_request, response) => {
  return response.json({ events: await userEvents(currentUser(response).id) });
});

calendarRouter.post("/events", async (request, response) => {
  const user = currentUser(response);
  const input = readCalendarEvent(request.body);
  if (!input) return response.status(400).json(invalidEvent);
  const familyId = readSpace(request.body.familyId);
  if (familyId && !(await getMembership(familyId, user.id))) return response.status(404).json(groupNotFound);

  // Si el cliente reenvía un id ya guardado (cola offline), devuelve el existente.
  const requestedId = cleanText(request.body.id, 50) || undefined;
  if (requestedId) {
    const existing = await getEventRecord(requestedId);
    if (existing) {
      const event = await visibleEvent(user, requestedId, response);
      return event ? response.status(201).json(event) : undefined;
    }
  }
  const event = await addEvent(await ensureSpaceCalendar(user.id, familyId), input, user.id, requestedId);
  await broadcast(user.id, familyId);
  return response.status(201).json(event);
});

calendarRouter.patch<{ eventId: string }>("/events/:eventId", async (request, response) => {
  const user = currentUser(response);
  const current = await visibleEvent(user, request.params.eventId, response);
  if (!current) return;
  const input = readCalendarEvent(request.body);
  if (!input) return response.status(400).json(invalidEvent);
  const familyId = "familyId" in request.body ? readSpace(request.body.familyId) : current.familyId;
  if (familyId !== current.familyId) {
    if (familyId && !(await getMembership(familyId, user.id))) return response.status(404).json(groupNotFound);
    if (!(await canMoveOut(user, current))) {
      return response.status(403).json({ message: "Solo quien lo creó o administra el grupo puede sacarlo del grupo." });
    }
  }
  // Un evento personal ajeno nunca llega aquí (no es visible), así que el dueño de destino es quien edita.
  const event = await updateEvent(current.id, input, await ensureSpaceCalendar(user.id, familyId));
  await broadcast(user.id, familyId);
  if (familyId !== current.familyId) await broadcast(user.id, current.familyId);
  return response.json(event);
});

calendarRouter.delete<{ eventId: string }>("/events/:eventId", async (request, response) => {
  const user = currentUser(response);
  const event = await visibleEvent(user, request.params.eventId, response);
  if (!event) return;
  await deleteEvent(event.id);
  await broadcast(user.id, event.familyId);
  return response.status(204).send();
});
