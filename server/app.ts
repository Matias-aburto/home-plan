import express from "express";
import { requireFamily } from "./http/family.js";
import { requireSameOrigin, requireUser } from "./http/session.js";
import { realtimeEnabled } from "./realtime.js";
import { authRouter } from "./routes/auth.js";
import { calendarRouter } from "./routes/calendar.js";
import { familiesRouter } from "./routes/families.js";
import { itemsRouter } from "./routes/items.js";
import { listsRouter } from "./routes/lists.js";
import { locationsRouter } from "./routes/locations.js";
import { meRouter } from "./routes/me.js";
import { realtimeRouter } from "./routes/realtime.js";
import { tasksRouter } from "./routes/tasks.js";

export const app = express();

// Vercel y el proxy de Vite terminan HTTPS antes de llegar aquí: así request.secure y request.ip son correctos.
app.set("trust proxy", true);
app.use(express.json());
app.use("/api", requireSameOrigin);

app.get("/api/health", (_request, response) => response.json({ ok: true, realtime: realtimeEnabled }));
app.use("/api/auth", authRouter);

// Todo lo demás requiere sesión.
app.use("/api", requireUser);
app.use("/api/me", meRouter);
app.use("/api/realtime", realtimeRouter);
app.use("/api/lists", listsRouter);
app.use("/api/families", familiesRouter);
app.use("/api/families/:id/items", requireFamily, itemsRouter);
app.use("/api/families/:id/tasks", requireFamily, tasksRouter);
app.use("/api/families/:id/calendar", requireFamily, calendarRouter);
app.use("/api/families/:id/locations", requireFamily, locationsRouter);

export default app;
