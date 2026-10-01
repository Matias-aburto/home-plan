import { ListChecks } from "lucide-react";

// Nombre provisorio de la app: cambiarlo aquí (y en index.html / vite.config.ts para la PWA).
export const appName = "Listas";

export function BrandIcon({ size = 21 }: { size?: number }) {
  return <ListChecks size={size} strokeWidth={2.25} />;
}
