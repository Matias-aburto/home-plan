import type { SortMode } from "../types";

export function SortChips({ value, onChange }: { value: SortMode; onChange: (mode: SortMode) => void }) {
  return (
    <div className="entry-type-picker" role="group" aria-label="Orden de la lista">
      <button type="button" className={value === "custom" ? "selected" : ""} onClick={() => onChange("custom")}>
        Personalizado
      </button>
      <button type="button" className={value === "alpha" ? "selected" : ""} onClick={() => onChange("alpha")}>
        Alfabético
      </button>
    </div>
  );
}
