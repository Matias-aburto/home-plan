import type { CalendarSummary, FamilySummary } from "../types";
import type { CalendarOption } from "./CalendarSection";

// Cada calendario es de un espacio: lo personal o un grupo. Se nombra por su espacio.
export function calendarSpaceName(calendar: Pick<CalendarSummary, "familyId">, families: FamilySummary[]) {
  if (!calendar.familyId) return "Personal";
  return families.find(({ id }) => id === calendar.familyId)?.name ?? "Grupo";
}

export function calendarOption(calendar: CalendarSummary, families: FamilySummary[]): CalendarOption {
  return { id: calendar.id, label: calendarSpaceName(calendar, families), color: calendar.color };
}

// Color para un calendario nuevo: uno que no usen los demás, para distinguirlos en la agenda.
const calendarPalette = ["blue", "rose", "violet", "teal", "amber", "green"];

export function nextCalendarColor(calendars: CalendarSummary[]) {
  const used = new Set(calendars.map(({ color }) => color));
  return calendarPalette.find((color) => !used.has(color)) ?? calendarPalette[0];
}

// Primero el personal y después los grupos, en el orden del menú.
export function sortBySpace(calendars: CalendarSummary[], families: FamilySummary[]) {
  const rank = (calendar: CalendarSummary) =>
    calendar.familyId ? 1 + families.findIndex(({ id }) => id === calendar.familyId) : 0;
  return [...calendars].sort((a, b) => rank(a) - rank(b));
}
