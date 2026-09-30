import cors from "cors";
import express from "express";
import { requireFamily } from "./http/family.js";
import { realtimeEnabled } from "./realtime.js";
import { calendarRouter } from "./routes/calendar.js";
import { familiesRouter } from "./routes/families.js";
import { itemsRouter } from "./routes/items.js";
import { locationsRouter } from "./routes/locations.js";
import { tasksRouter } from "./routes/tasks.js";

export const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => response.json({ ok: true, realtime: realtimeEnabled }));

app.use("/api/families", familiesRouter);
app.use("/api/families/:id/items", requireFamily, itemsRouter);
app.use("/api/families/:id/tasks", requireFamily, tasksRouter);
app.use("/api/families/:id/calendar", requireFamily, calendarRouter);
app.use("/api/families/:id/locations", requireFamily, locationsRouter);

export default app;
