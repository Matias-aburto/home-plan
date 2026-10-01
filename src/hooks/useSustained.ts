import { useEffect, useState } from "react";

// true solo si `condition` se mantiene durante `delayMs`. Evita mostrar estados que duran un instante.
export function useSustained(condition: boolean, delayMs: number) {
  const [sustained, setSustained] = useState(false);
  useEffect(() => {
    if (!condition) {
      setSustained(false);
      return;
    }
    const timer = window.setTimeout(() => setSustained(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [condition, delayMs]);
  return sustained;
}
