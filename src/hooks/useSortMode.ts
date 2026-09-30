import { useEffect, useState } from "react";
import type { SortMode } from "../types";

export function readSortMode(key: string): SortMode {
  return localStorage.getItem(key) === "alpha" ? "alpha" : "custom";
}

export function useSortMode(key: string) {
  const [mode, setMode] = useState<SortMode>(() => readSortMode(key));
  useEffect(() => setMode(readSortMode(key)), [key]);
  function update(next: SortMode) {
    setMode(next);
    localStorage.setItem(key, next);
  }
  return [mode, update] as const;
}
