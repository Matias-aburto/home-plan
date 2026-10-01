import { Router, type NextFunction, type Request, type Response } from "express";
import { calendarAccess, hasAccess } from "../auth/access.js";
import {
  addEvent,
  agendaEvents,
  calendarForSpace,
  createCalendar,
  deleteCalendar,
  deleteEvent,
  getCalendarRecord,
  getEvent,
  listEvents,
  updateCalendar,
  updateEvent,
  visibleCalendars
} from "../db/calendars.js";
import { getMembership } from "../db/families.js";
import type { CalendarRecord, CalendarSummary } from "../db/types.js";
import { currentUser } from "../http/session.js";
import { capitalizeFirst, cleanText, listColors, listIcons, oneOf, readCalendarEntry } from "../http/validation.js";
import { notifyFamilyChanged, notifyUserChanged } from "../realtime.js";

export const calendarsRouter = Router();

type CalendarParams = { calendarId: string };

const calendarNotFound = { message: "No encontramos ese calendario." };
const invalidEvent = { message: "Revisa el título, la fecha y la hora." };

function currentCalendar(response: Response) {
  return response.locals.calendar as CalendarRecord;
}

function summary(response: Response, calendar = currentCalendar(response)): CalendarSummary {
  return { ...calendar, access: response.locals.calendarAccess };
}

// Avisa a quien ve el calendario: su dueño o el grupo.
async function broadcastCalendar(calendar: CalendarRecord) {
  if (calendar.ownerUserId) await notifyUserChanged(calendar.ownerUserId, { calendarId: calendar.id });
  if (calendar.familyId) await notifyFamilyChanged(calendar.familyId, { calendarId: calendar.id });
}

function requireCalendarAccess(required: "editor" | "owner") {
  return (_request: Request, response: Response, next: NextFunction) => {
    if (!hasAccess(response.locals.calendarAccess, required)) {
      return response.status(403).json({ message: "No tienes permiso para hacer esto en el calendario." });
    }
    next();
  };
}

// Agenda: los calendarios que veo (el personal y los de mis grupos) con todos sus eventos.
calendarsRouter.get("/", async (_request, response) => {
  const calendars = await visibleCalendars(currentUser(response).id);
  return response.json({ calendars, events: await agendaEvents(calendars.map(({ id }) => id)) });
});

// El calendario es un complemento de cada espacio: se agrega una vez, sin nombre propio obligatorio.
calendarsRouter.post("/", async (request, response) => {
  const user = currentUser(response);
  const body = request.body as Record<string, unknown>;
  const name = capitalizeFirst(cleanText(body.name, 40)) || "Calendario";
  const familyId = cleanText(body.familyId, 20).toUpperCase() || null;
  if (familyId && !(await getMembership(familyId, user.id))) return response.status(404).json({ message: "No encontramos ese grupo." });
  const requestedId = cleanText(body.id, 50) || undefined;
  if (requestedId) {
    const existing = await getCalendarRecord(requestedId);
    const access = existing ? await calendarAccess(user, existing) : "none";
    if (existing && access !== "none") return response.status(201).json({ ...existing, access });
    if (existing) return response.status(409).json({ message: "Ese identificador ya está en uso." });
  }
  if (await calendarForSpace(user.id, familyId)) {
    return response.status(409).json({ message: familyId ? "El grupo ya tiene calendario." : "Ya tienes un calendario personal." });
  }
  const calendar = await createCalendar(user.id, familyId, {
    name,
    icon: oneOf(listIcons, body.icon) || "calendar",
    color: oneOf(listColors, body.color) || "blue"
  }, requestedId);
  await broadcastCalendar(calendar);
  const access = await calendarAccess(user, calendar);
  return response.status(201).json({ ...calendar, access });
});

// Carga el calendario y el acceso. Sin acceso responde 404 para no revelar que existe.
calendarsRouter.use("/:calendarId", async (request: Request<CalendarParams>, response, next) => {
  const calendar = await getCalendarRecord(request.params.calendarId);
  const access = calendar ? await calendarAccess(currentUser(response), calendar) : "none";
  if (!calendar || access === "none") return response.status(404).json(calendarNotFound);
  response.locals.calendar = calendar;
  response.locals.calendarAccess = access;
  next();
});

calendarsRouter.get<CalendarParams>("/:calendarId", async (_request, response) => {
  return response.json({ calendar: summary(response), events: await listEvents(currentCalendar(response).id) });
});

calendarsRouter.patch<CalendarParams>("/:calendarId", requireCalendarAccess("owner"), async (request, response) => {
  const body = request.body as Record<string, unknown>;
  const name = "name" in body ? capitalizeFirst(cleanText(body.name, 40)) : undefined;
  if (name === "") return response.status(400).json({ message: "Escribe un nombre para el calendario." });
  const icon = "icon" in body ? oneOf(listIcons, body.icon) : undefined;
  const color = "color" in body ? oneOf(listColors, body.color) : undefined;
  if (icon === null || color === null) return response.status(400).json({ message: "Elige un ícono y un color válidos." });
  const archived = typeof body.archived === "boolean" ? body.archived : undefined;
  const calendar = (await updateCalendar(currentCalendar(response).id, { name, icon, color, archived }))!;
  await broadcastCalendar(calendar);
  return response.json(summary(response, calendar));
});

calendarsRouter.delete<CalendarParams>("/:calendarId", requireCalendarAccess("owner"), async (_request, response) => {
  const calendar = currentCalendar(response);
  await deleteCalendar(calendar.id);
  await broadcastCalendar(calendar);
  return response.status(204).send();
});

calendarsRouter.post<CalendarParams>("/:calendarId/events", requireCalendarAccess("editor"), async (request, response) => {
  const input = readCalendarEntry(request.body);
  if (!input) return response.status(400).json(invalidEvent);
  const calendar = currentCalendar(response);
  const event = await addEvent(calendar.id, input, currentUser(response).id, cleanText(request.body.id, 50) || undefined);
  await broadcastCalendar(calendar);
  return response.status(201).json(event);
});

calendarsRouter.patch<CalendarParams & { eventId: string }>("/:calendarId/events/:eventId", requireCalendarAccess("editor"), async (request, response) => {
  const input = readCalendarEntry(request.body);
  if (!input) return response.status(400).json(invalidEvent);
  const calendar = currentCalendar(response);
  if (!(await updateEvent(calendar.id, request.params.eventId, input))) {
    return response.status(404).json({ message: "No encontramos ese evento." });
  }
  await broadcastCalendar(calendar);
  return response.json(await getEvent(calendar.id, request.params.eventId));
});

calendarsRouter.delete<CalendarParams & { eventId: string }>("/:calendarId/events/:eventId", requireCalendarAccess("editor"), async (request, response) => {
  const calendar = currentCalendar(response);
  if (!(await deleteEvent(calendar.id, request.params.eventId))) {
    return response.status(404).json({ message: "No encontramos ese evento." });
  }
  await broadcastCalendar(calendar);
  return response.status(204).send();
});
