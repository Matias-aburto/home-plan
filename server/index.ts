import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { baseCatalog } from "./catalog.js";
import {
  HomeRepository,
  normalizeText,
  type Assignee,
  type CalendarEntry,
  type Family
} from "./database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });
const repository = new HomeRepository();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());
await repository.initialize();

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function capitalizeFirst(input: string) {
  return input ? input[0].toLocaleUpperCase("es-CL") + input.slice(1) : input;
}

function readCalendarEntry(body: Record<string, unknown>) {
  const title = cleanText(body.title, 100);
  const kind = body.kind === "reminder" ? "reminder" : body.kind === "event" ? "event" : null;
  const date = cleanText(body.date, 10);
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(parsedDate.valueOf())
    && parsedDate.toISOString().slice(0, 10) === date;
  const rawTime = cleanText(body.time, 5);
  const time = rawTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime) ? rawTime : null;
  const recurrence = body.recurrence === "yearly" ? "yearly" : "none";
  const notes = cleanText(body.notes, 300) || null;
  if (!title || !kind || !validDate || (rawTime && !time)) return null;
  return { title, kind, date, time, recurrence, notes } satisfies Pick<
    CalendarEntry,
    "title" | "kind" | "date" | "time" | "recurrence" | "notes"
  >;
}

async function broadcast(familyId: string) {
  const family = await repository.getFamily(familyId);
  if (family) io.to(family.id).emit("family:updated", family);
  return family;
}

app.get("/api/health", (_request, response) => response.json({ ok: true }));

app.post("/api/families", async (request, response) => {
  const name = cleanText(request.body.name, 50);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para tu familia." });
  const family = await repository.createFamily(name);
  return response.status(201).json(family);
});

app.get("/api/families/:id", async (request, response) => {
  const family = await repository.getFamily(request.params.id);
  if (!family) return response.status(404).json({ message: "No encontramos esa familia." });
  return response.json(family);
});

app.get("/api/families/:id/suggestions", async (request, response) => {
  const family = await repository.getFamily(request.params.id);
  if (!family) return response.status(404).json({ message: "No encontramos esa familia." });

  const query = normalizeText(cleanText(request.query.q, 80));
  if (query.length < 2) return response.json([]);

  const suggestions = new Map<string, { name: string; category: string; score: number }>();
  for (const product of baseCatalog) {
    const normalizedName = normalizeText(product.name);
    if (!normalizedName.includes(query)) continue;
    suggestions.set(normalizedName, {
      ...product,
      score: normalizedName.startsWith(query) ? 100 : 50
    });
  }
  for (const product of await repository.getLearnedProducts(family.id, query)) {
    const normalizedName = normalizeText(product.name);
    const existing = suggestions.get(normalizedName);
    suggestions.set(normalizedName, {
      name: product.name,
      category: existing?.category || "Usado antes",
      score: (normalizedName.startsWith(query) ? 200 : 150) + Math.min(product.uses, 20)
    });
  }

  return response.json(
    [...suggestions.values()]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"))
      .slice(0, 6)
      .map(({ name, category }) => ({ name, category }))
  );
});

app.post("/api/families/:id/items", async (request, response) => {
  const name = capitalizeFirst(cleanText(request.body.name, 80));
  const locationId = cleanText(request.body.locationId, 30) || null;
  const requestedId = cleanText(request.body.id, 50) || undefined;
  if (!name) return response.status(400).json({ message: "Escribe qué necesitas comprar." });

  const item = await repository.addItem(request.params.id, name, locationId, requestedId);
  if (!item) return response.status(404).json({ message: "No encontramos esa familia." });
  await broadcast(request.params.id);
  return response.status(201).json(item);
});

app.patch("/api/families/:id/items/:itemId", async (request, response) => {
  if (typeof request.body.completed !== "boolean") {
    return response.status(400).json({ message: "Indica el estado del producto." });
  }
  const updated = await repository.setItemCompleted(
    request.params.id,
    request.params.itemId,
    request.body.completed
  );
  if (!updated) return response.status(404).json({ message: "No encontramos ese producto." });
  const family = await broadcast(request.params.id);
  return response.json(family?.items.find(({ id }) => id === request.params.itemId));
});

app.delete("/api/families/:id/items/:itemId", async (request, response) => {
  if (!(await repository.getFamily(request.params.id))) {
    return response.status(404).json({ message: "No encontramos esa familia." });
  }
  await repository.deleteItem(request.params.id, request.params.itemId);
  await broadcast(request.params.id);
  return response.status(204).send();
});

app.post("/api/families/:id/tasks", async (request, response) => {
  const title = capitalizeFirst(cleanText(request.body.title, 100));
  const assignee: Assignee | null = request.body.assignee === "Matías" || request.body.assignee === "Francisca"
    ? request.body.assignee
    : null;
  const requestedId = cleanText(request.body.id, 50) || undefined;
  if (!title) return response.status(400).json({ message: "Escribe qué hay que hacer." });

  const task = await repository.addTask(request.params.id, title, assignee, requestedId);
  if (!task) return response.status(404).json({ message: "No encontramos esa familia." });
  await broadcast(request.params.id);
  return response.status(201).json(task);
});

app.patch("/api/families/:id/tasks/:taskId", async (request, response) => {
  const completed = typeof request.body.completed === "boolean" ? request.body.completed : undefined;
  const assignee: Assignee | null | undefined = "assignee" in request.body
    ? request.body.assignee === "Matías" || request.body.assignee === "Francisca"
      ? request.body.assignee
      : null
    : undefined;
  const updated = await repository.updateTask(request.params.id, request.params.taskId, completed, assignee);
  if (!updated) return response.status(404).json({ message: "No encontramos esa tarea." });
  const family = await broadcast(request.params.id);
  return response.json(family?.tasks.find(({ id }) => id === request.params.taskId));
});

app.delete("/api/families/:id/tasks/:taskId", async (request, response) => {
  if (!(await repository.getFamily(request.params.id))) {
    return response.status(404).json({ message: "No encontramos esa familia." });
  }
  await repository.deleteTask(request.params.id, request.params.taskId);
  await broadcast(request.params.id);
  return response.status(204).send();
});

app.post("/api/families/:id/calendar", async (request, response) => {
  const entryData = readCalendarEntry(request.body);
  const requestedId = cleanText(request.body.id, 50) || undefined;
  if (!entryData) {
    return response.status(400).json({ message: "Revisa el título, la fecha y la hora." });
  }
  const entry = await repository.addCalendarEntry(request.params.id, entryData, requestedId);
  if (!entry) return response.status(404).json({ message: "No encontramos esa familia." });
  await broadcast(request.params.id);
  return response.status(201).json(entry);
});

app.patch("/api/families/:id/calendar/:entryId", async (request, response) => {
  const entryData = readCalendarEntry(request.body);
  if (!entryData) {
    return response.status(400).json({ message: "Revisa el título, la fecha y la hora." });
  }
  const updated = await repository.updateCalendarEntry(
    request.params.id,
    request.params.entryId,
    entryData
  );
  if (!updated) return response.status(404).json({ message: "No encontramos ese evento." });
  const family = await broadcast(request.params.id);
  return response.json(family?.calendarEntries.find(({ id }) => id === request.params.entryId));
});

app.delete("/api/families/:id/calendar/:entryId", async (request, response) => {
  const deleted = await repository.deleteCalendarEntry(request.params.id, request.params.entryId);
  if (!deleted) return response.status(404).json({ message: "No encontramos ese evento." });
  await broadcast(request.params.id);
  return response.status(204).send();
});

app.post("/api/families/:id/locations", async (request, response) => {
  const name = cleanText(request.body.name, 30);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para la ubicación." });
  const family = await repository.getFamily(request.params.id);
  if (!family) return response.status(404).json({ message: "No encontramos esa familia." });
  if (hasLocation(family, name)) return response.status(409).json({ message: "Esa ubicación ya existe." });

  const location = await repository.addLocation(family.id, name);
  await broadcast(family.id);
  return response.status(201).json(location);
});

app.patch("/api/families/:id/locations/:locationId", async (request, response) => {
  const name = cleanText(request.body.name, 30);
  if (!name) return response.status(400).json({ message: "Escribe un nombre para la ubicación." });
  const family = await repository.getFamily(request.params.id);
  if (!family) return response.status(404).json({ message: "No encontramos esa familia." });
  if (family.locations.some((location) =>
    location.id !== request.params.locationId && normalizeText(location.name) === normalizeText(name)
  )) {
    return response.status(409).json({ message: "Esa ubicación ya existe." });
  }

  const updated = await repository.renameLocation(family.id, request.params.locationId, name);
  if (!updated) return response.status(404).json({ message: "No encontramos esa ubicación." });
  await broadcast(family.id);
  return response.json({ id: request.params.locationId, name });
});

app.delete("/api/families/:id/locations/:locationId", async (request, response) => {
  const deleted = await repository.deleteLocation(request.params.id, request.params.locationId);
  if (!deleted) return response.status(404).json({ message: "No encontramos esa ubicación." });
  await broadcast(request.params.id);
  return response.status(204).send();
});

function hasLocation(family: Family, name: string) {
  return family.locations.some((location) => normalizeText(location.name) === normalizeText(name));
}

io.on("connection", (socket) => {
  socket.on("family:join", (familyId: string) => {
    if (typeof familyId === "string") socket.join(familyId.toUpperCase());
  });
});

const distDirectory = path.join(__dirname, "../dist");
app.use(express.static(distDirectory));
app.get("/{*splat}", (_request, response) => response.sendFile(path.join(distDirectory, "index.html")));

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Casa está disponible en http://localhost:${port}`);
});
