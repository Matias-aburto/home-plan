import { House } from "lucide-react";

export function Loading() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">
        <House size={27} strokeWidth={2.25} />
      </div>
      <span>Cargando tu casa</span>
    </main>
  );
}
