import type { CalendarEvent } from "../types";

export const monthFormatter = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" });
export const dayFormatter = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long" });
export const compactDateFormatter = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });

export function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function occurrenceKey(entry: CalendarEvent, year: number) {
  if (entry.recurrence === "none") return entry.date;
  const [, month, day] = entry.date.split("-");
  const key = `${year}-${month}-${day}`;
  return dateKey(localDate(key)) === key ? key : null;
}

export function entriesOnDate<T extends CalendarEvent>(entries: T[], key: string) {
  const year = Number(key.slice(0, 4));
  return entries
    .filter((entry) => occurrenceKey(entry, year) === key)
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}
