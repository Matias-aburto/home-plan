import type { SortMode } from "../types";

export function archiveCompletedLocally<T extends {
  completed: boolean;
  completedAt: string | null;
  updatedAt: string;
  archivedAt: string | null;
}>(entries: T[]) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const completed = entries
    .filter((entry) => entry.completed && (entry.completedAt || entry.updatedAt) >= cutoff)
    .sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
  const visibleIds = new Set(completed.slice(0, 5));
  const now = new Date().toISOString();
  return entries.map((entry) => ({
    ...entry,
    archivedAt: entry.completed
      ? visibleIds.has(entry) ? null : entry.archivedAt || now
      : null
  }));
}

export function nextListPosition(entries: { completed: boolean; position: number }[]) {
  const positions = entries.filter((entry) => !entry.completed).map((entry) => entry.position);
  return positions.length === 0 ? 0 : Math.min(...positions) - 1;
}

export function sortPending<T extends { position: number; createdAt: string }>(
  items: T[],
  mode: SortMode,
  label: (item: T) => string
) {
  const sorted = [...items];
  if (mode === "alpha") {
    return sorted.sort((a, b) =>
      label(a).localeCompare(label(b), "es", { sensitivity: "base" }) || b.createdAt.localeCompare(a.createdAt)
    );
  }
  return sorted.sort((a, b) => a.position - b.position || b.createdAt.localeCompare(a.createdAt));
}

export function sortCompleted<T extends { completedAt: string | null; updatedAt: string }>(items: T[]) {
  return [...items].sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt));
}

export function mergeVisibleOrder<T extends { id: string }>(allPending: T[], visibleIds: string[]) {
  const visible = new Set(visibleIds);
  let index = 0;
  return allPending.map((item) => {
    if (!visible.has(item.id)) return item;
    const nextId = visibleIds[index++];
    return allPending.find((candidate) => candidate.id === nextId) ?? item;
  });
}

export function withPendingPositions<T extends { id: string; completed: boolean; position: number }>(
  entries: T[],
  pending: T[]
) {
  const positions = new Map(pending.map((entry, index) => [entry.id, index]));
  return entries.map((entry) =>
    positions.has(entry.id) ? { ...entry, position: positions.get(entry.id)! } : entry
  );
}
