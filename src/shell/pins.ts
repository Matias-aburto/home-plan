import { useSyncExternalStore } from "react";

// Accesos fijados en la barra inferior del celular: "calendar" o "list:<id>". Máximo dos, guardados
// en este dispositivo (en escritorio la barra lateral ya muestra todo).
export const maxPins = 2;
const storageKey = "casa:pins";
const listeners = new Set<() => void>();

// null: nunca se fijó nada en este dispositivo (la barra muestra una sugerencia).
let current: string[] | null = read();

function read(): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function write(next: string[]) {
  current = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Sin almacenamiento, los fijados duran solo esta visita.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const listPin = (listId: string) => `list:${listId}`;
export const calendarPin = "calendar";

export function usePins() {
  const pins = useSyncExternalStore(subscribe, () => current);
  const isPinned = (key: string) => Boolean(pins?.includes(key));

  // Al fijar un tercero se suelta el más antiguo.
  function togglePin(key: string) {
    const list = pins ?? [];
    write(list.includes(key) ? list.filter((pin) => pin !== key) : [...list, key].slice(-maxPins));
  }

  return { pins, isPinned, togglePin };
}
