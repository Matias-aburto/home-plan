import { Pin, PinOff } from "lucide-react";
import { usePins } from "./pins";

// Fijar o soltar algo en la barra inferior del celular. Solo se ve en el celular.
export function PinButton({ pin, label }: { pin: string; label: string }) {
  const { isPinned, togglePin } = usePins();
  const pinned = isPinned(pin);
  return (
    <button
      type="button"
      className={`pin-button mobile-only ${pinned ? "pinned" : ""}`}
      onClick={() => togglePin(pin)}
      aria-pressed={pinned}
    >
      {pinned ? <PinOff size={16} /> : <Pin size={16} />}
      {pinned ? `Quitar ${label} de la barra` : `Fijar ${label} en la barra`}
    </button>
  );
}
