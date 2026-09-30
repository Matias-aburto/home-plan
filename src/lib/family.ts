import type { Family } from "../types";

export function initialFamilyId() {
  const fromUrl = new URLSearchParams(window.location.search).get("familia");
  return (fromUrl || localStorage.getItem("familyId") || "").toUpperCase();
}

export function normalizeFamily(family: Family): Family {
  return {
    ...family,
    items: (family.items || []).map((item, index) => ({ ...item, position: item.position ?? index })),
    tasks: (family.tasks || []).map((task, index) => ({ ...task, position: task.position ?? index })),
    calendarEntries: family.calendarEntries || []
  };
}
