import express from "express";
import { requireSameOrigin, requireUser } from "./http/session.js";
import { realtimeEnabled } from "./realtime.js";
import { authRouter } from "./routes/auth.js";
import { calendarRouter } from "./routes/calendar.js";
import { familiesRouter } from "./routes/families.js";
import { familyInvitationsRouter, invitationsRouter } from "./routes/invitations.js";
import { listsRouter } from "./routes/lists.js";
import { meRouter } from "./routes/me.js";
import { realtimeRouter } from "./routes/realtime.js";

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
app.use("/api/calendar", calendarRouter);
app.use("/api/families/:id/invitations", familyInvitationsRouter);
app.use("/api/invitations", invitationsRouter);
app.use("/api/families", familiesRouter);

export default app;
