import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "../types";
import { dateKey, entriesOnDate, localDate, occurrenceKey } from "./calendar";

function entry(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e",
    title: "Evento",
    familyId: null,
    createdBy: null,
    date: "2026-03-10",
    time: null,
    recurrence: "none",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("fechas locales", () => {
  it("convierte ida y vuelta sin desfase de zona horaria", () => {
    expect(dateKey(localDate("2026-12-31"))).toBe("2026-12-31");
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("occurrenceKey", () => {
  it("usa la fecha exacta si no se repite", () => {
    expect(occurrenceKey(entry({ date: "2026-03-10" }), 2030)).toBe("2026-03-10");
  });

  it("repite cada año y omite el 29 de febrero en años no bisiestos", () => {
    expect(occurrenceKey(entry({ date: "2020-05-01", recurrence: "yearly" }), 2027)).toBe("2027-05-01");
    expect(occurrenceKey(entry({ date: "2024-02-29", recurrence: "yearly" }), 2027)).toBeNull();
    expect(occurrenceKey(entry({ date: "2024-02-29", recurrence: "yearly" }), 2028)).toBe("2028-02-29");
  });
});

describe("entriesOnDate", () => {
  it("ordena por hora y deja al final las de todo el día", () => {
    const entries = [
      entry({ id: "todo-el-dia" }),
      entry({ id: "tarde", time: "18:00" }),
      entry({ id: "manana", time: "08:30" }),
      entry({ id: "otro-dia", date: "2026-03-11" })
    ];
    expect(entriesOnDate(entries, "2026-03-10").map(({ id }) => id)).toEqual(["manana", "tarde", "todo-el-dia"]);
  });
});
