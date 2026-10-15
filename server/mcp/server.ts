import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hasAccess, listAccess } from "../auth/access.js";
import { addEvent, ensureSpaceCalendar, userEvents } from "../db/calendars.js";
import { getMembership, userFamilies } from "../db/families.js";
import { addListItem, getListItems, updateListItem } from "../db/listItems.js";
import { createList, getListRecord, visibleLists } from "../db/lists.js";
import type { CalendarEvent, ListAccess, ListRecord, User } from "../db/types.js";
import { broadcastList } from "../http/lists.js";
import { capitalizeFirst, cleanText, listColors, listIcons, readCalendarEvent } from "../http/validation.js";
import { notifyFamilyChanged, notifyUserChanged } from "../realtime.js";

// Servidor MCP con que un asistente (Claude) lee y edita las listas y el calendario de una persona.
// Aplica las mismas reglas que la API de la app y avisa los cambios en tiempo real.

const instructions = `Home Plan es la app de listas y calendario de la persona (personal y de sus grupos).
- Antes de agregar a "la lista de compras" u otra lista nombrada, usa list_lists y elige la que corresponda por nombre.
  Si no existe ninguna parecida, créala con create_list incluyendo los ítems.
- Los ítems son textos cortos (máximo 100 caracteres). Incluye cantidad y medida en el texto, por ejemplo "Tapa gorro PVC 110 mm (x2)".
- Las fechas van en formato AAAA-MM-DD y las horas en HH:MM (24 horas), en la hora local de la persona.`;

// La app se usa en Chile: "hoy" se calcula en esa zona horaria.
const timeZone = "America/Santiago";

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

// Próxima fecha del evento desde `from`: la misma para los únicos, la del aniversario para los anuales.
function nextOccurrence(event: CalendarEvent, from: string) {
  if (event.recurrence !== "yearly") return event.date;
  const sameYear = `${from.slice(0, 4)}${event.date.slice(4)}`;
  return sameYear >= from ? sameYear : `${Number(from.slice(0, 4)) + 1}${event.date.slice(4)}`;
}

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const listNotFound = "No encontramos esa lista. Usa list_lists para ver los ids.";
const groupNotFound = "No encontramos ese grupo. Usa list_lists para ver los ids de los grupos.";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato AAAA-MM-DD");

async function editableList(
  user: User,
  listId: string,
  required: Exclude<ListAccess, "none"> = "editor"
): Promise<{ list: ListRecord } | { error: string }> {
  const list = await getListRecord(listId);
  const access = list ? await listAccess(user, list) : "none";
  if (!list || access === "none") return { error: listNotFound };
  if (!hasAccess(access, required)) return { error: "No tienes permiso para editar esa lista." };
  return { list };
}

// Los ítems nuevos quedan arriba: se agregan del último al primero para conservar el orden pedido.
async function addItems(listId: string, titles: string[], userId: string) {
  const items = [];
  for (const title of [...titles].reverse()) {
    const clean = capitalizeFirst(cleanText(title, 100));
    if (clean) items.unshift(await addListItem(listId, { title: clean, createdBy: userId }));
  }
  return items.map(({ id, title }) => ({ id, title }));
}

export function createMcpServer(user: User) {
  const server = new McpServer({ name: "home-plan", version: "0.1.0" }, { instructions });

  server.registerTool("list_lists", {
    title: "Ver listas y grupos",
    description: "Lista las listas que ve la persona (personales, de sus grupos y compartidas) con sus pendientes, y los grupos a los que pertenece.",
    annotations: { readOnlyHint: true }
  }, async () => {
    const [lists, groups] = await Promise.all([visibleLists(user.id), userFamilies(user.id)]);
    const groupNames = new Map(groups.map(({ id, name }) => [id, name]));
    return result({
      lists: lists.filter((list) => !list.archivedAt).map((list) => ({
        id: list.id,
        name: list.name,
        space: list.familyId ? groupNames.get(list.familyId) ?? "Grupo" : list.ownerUserId === user.id ? "Personal" : "Compartida conmigo",
        canEdit: list.access !== "viewer",
        pending: list.pendingCount
      })),
      groups: groups.map(({ id, name }) => ({ id, name }))
    });
  });

  server.registerTool("get_list", {
    title: "Ver una lista",
    description: "Muestra los ítems de una lista: los pendientes y los completados recientemente.",
    inputSchema: { list_id: z.string() },
    annotations: { readOnlyHint: true }
  }, async ({ list_id }) => {
    const found = await editableList(user, list_id, "viewer");
    if ("error" in found) return failure(found.error);
    const items = await getListItems(found.list.id);
    return result({
      list: { id: found.list.id, name: found.list.name },
      items: items.filter((item) => !item.archivedAt).map(({ id, title, completed }) => ({ id, title, completed }))
    });
  });

  server.registerTool("create_list", {
    title: "Crear lista",
    description: "Crea una lista nueva, opcionalmente con ítems. Sin group_id queda en el espacio personal.",
    inputSchema: {
      name: z.string().min(1).max(40),
      items: z.array(z.string().min(1).max(100)).max(100).optional(),
      group_id: z.string().optional().describe("Id de un grupo (de list_lists) para crearla compartida con el grupo."),
      icon: z.enum(listIcons).optional(),
      color: z.enum(listColors).optional()
    }
  }, async ({ name, items, group_id, icon, color }) => {
    const familyId = group_id ? cleanText(group_id, 20).toUpperCase() : null;
    const listName = capitalizeFirst(cleanText(name, 40));
    if (!listName) return failure("Escribe un nombre para la lista.");
    if (familyId && !(await getMembership(familyId, user.id))) return failure(groupNotFound);
    const list = await createList(user.id, familyId, {
      name: listName,
      icon: icon ?? "list-checks",
      color: color ?? "green"
    });
    const added = await addItems(list.id, items ?? [], user.id);
    await broadcastList(list);
    return result({ list: { id: list.id, name: list.name }, items: added });
  });

  server.registerTool("add_items", {
    title: "Agregar ítems",
    description: "Agrega uno o más ítems a una lista existente, en el orden dado.",
    inputSchema: { list_id: z.string(), items: z.array(z.string().min(1).max(100)).min(1).max(100) }
  }, async ({ list_id, items }) => {
    const found = await editableList(user, list_id);
    if ("error" in found) return failure(found.error);
    const added = await addItems(found.list.id, items, user.id);
    await broadcastList(found.list);
    return result({ list: { id: found.list.id, name: found.list.name }, items: added });
  });

  server.registerTool("set_items_completed", {
    title: "Marcar ítems",
    description: "Marca ítems de una lista como completados (o los vuelve a pendientes con completed=false).",
    inputSchema: {
      list_id: z.string(),
      item_ids: z.array(z.string()).min(1).max(100),
      completed: z.boolean().default(true)
    }
  }, async ({ list_id, item_ids, completed }) => {
    const found = await editableList(user, list_id);
    if ("error" in found) return failure(found.error);
    const updated = [];
    for (const itemId of item_ids) {
      const item = await updateListItem(found.list.id, itemId, { completed });
      if (item) updated.push({ id: item.id, title: item.title, completed: item.completed });
    }
    await broadcastList(found.list);
    return result({ updated, notFound: item_ids.length - updated.length });
  });

  server.registerTool("list_events", {
    title: "Ver eventos",
    description: "Muestra los eventos del calendario (personales y de los grupos) entre dos fechas. Por defecto, los próximos 60 días.",
    inputSchema: { from: date.optional(), to: date.optional() },
    annotations: { readOnlyHint: true }
  }, async ({ from, to }) => {
    const start = from ?? today();
    const end = to ?? addDays(start, 60);
    const [events, groups] = await Promise.all([userEvents(user.id), userFamilies(user.id)]);
    const groupNames = new Map(groups.map(({ id, name }) => [id, name]));
    return result({
      today: today(),
      events: events
        .map((event) => ({ event, on: nextOccurrence(event, start) }))
        .filter(({ on }) => on >= start && on <= end)
        .sort((a, b) => a.on.localeCompare(b.on) || (a.event.time ?? "").localeCompare(b.event.time ?? ""))
        .map(({ event, on }) => ({
          id: event.id,
          title: event.title,
          date: on,
          time: event.time,
          yearly: event.recurrence === "yearly",
          notes: event.notes,
          space: event.familyId ? groupNames.get(event.familyId) ?? "Grupo" : "Personal"
        }))
    });
  });

  server.registerTool("create_event", {
    title: "Crear evento",
    description: "Crea un evento en el calendario. Sin group_id queda en el espacio personal.",
    inputSchema: {
      title: z.string().min(1).max(100),
      date,
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM").optional(),
      notes: z.string().max(300).optional(),
      yearly: z.boolean().optional().describe("Se repite cada año (cumpleaños, aniversarios)."),
      group_id: z.string().optional().describe("Id de un grupo (de list_lists) para que lo vea el grupo.")
    }
  }, async ({ title, date: eventDate, time, notes, yearly, group_id }) => {
    const input = readCalendarEvent({ title, date: eventDate, time, notes, recurrence: yearly ? "yearly" : "none" });
    if (!input) return failure("Revisa el título, la fecha y la hora.");
    const familyId = group_id ? cleanText(group_id, 20).toUpperCase() : null;
    if (familyId && !(await getMembership(familyId, user.id))) return failure(groupNotFound);
    const event = await addEvent(await ensureSpaceCalendar(user.id, familyId), input, user.id);
    if (familyId) await notifyFamilyChanged(familyId, { calendarId: familyId });
    else await notifyUserChanged(user.id, { calendarId: "personal" });
    return result({ event: { id: event.id, title: event.title, date: event.date, time: event.time } });
  });

  return server;
}
