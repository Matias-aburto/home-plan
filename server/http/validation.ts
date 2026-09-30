import type { Assignee, CalendarEntryInput } from "../db/types.js";

export function cleanText(input: unknown, maxLength: number) {
  return typeof input === "string" ? input.trim().slice(0, maxLength) : "";
}

export function capitalizeFirst(input: string) {
  return input ? input[0].toLocaleUpperCase("es-CL") + input.slice(1) : input;
}

export function readIdList(input: unknown) {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter((id) => id.length > 0 && id.length <= 50)
  )];
}

export function readAssignee(input: unknown): Assignee | null {
  return input === "Matías" || input === "Francisca" ? input : null;
}

export function readCalendarEntry(body: Record<string, unknown>): CalendarEntryInput | null {
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
  return { title, kind, date, time, recurrence, notes };
}
