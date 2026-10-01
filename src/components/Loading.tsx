import { BrandIcon } from "../lib/brand";

export function Loading() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">
        <BrandIcon size={27} />
      </div>
      <span>Cargando…</span>
    </main>
  );
}
