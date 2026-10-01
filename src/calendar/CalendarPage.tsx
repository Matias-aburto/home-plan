import { useState } from "react";
import { CalendarDays, Check, Palette, X } from "lucide-react";
import { useSearchParams } from "react-router";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import { listColorNames, listColors } from "../lists/listStyle";
import { CalendarSection } from "./CalendarSection";
import { spaceKey, useSpaces, type Space } from "./spaces";
import { useCalendarEvents } from "./useCalendarEvents";

const hiddenKey = "casa:calendar-hidden";

function readHidden() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(hiddenKey) || "[]"));
  } catch {
    return new Set<string>();
  }
}

// El calendario: los eventos personales y los de todos mis grupos, cada espacio con su color.
// Con ?espacio=<id> se abre mostrando solo ese espacio (por ejemplo, desde la portada de un grupo).
export function CalendarPage() {
  const spaces = useSpaces();
  const { events, apply } = useCalendarEvents();
  const [params, setParams] = useSearchParams();
  const only = params.get("espacio");
  const [hidden, setHidden] = useState(readHidden);
  const [colorsOpen, setColorsOpen] = useState(false);

  const isVisible = (space: Space) => only ? space.key === only : !hidden.has(space.key);
  const visibleSpaces = spaces.filter(isVisible);

  function toggle(key: string) {
    // Al tocar un filtro se sale del modo "solo este espacio".
    const next = only ? new Set(spaces.map((space) => space.key).filter((candidate) => candidate !== only)) : new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    if (only) setParams({}, { replace: true });
    try {
      localStorage.setItem(hiddenKey, JSON.stringify([...next]));
    } catch {
      // Sin almacenamiento, el filtro dura solo esta visita.
    }
  }

  if (!events) return <Loading />;
  const visibleKeys = new Set(visibleSpaces.map(({ key }) => key));
  const shown = events.filter((event) => visibleKeys.has(spaceKey(event.familyId)));

  return (
    <>
      <CalendarSection
        heading={(
          <div className="title-only list-title">
            <span className="list-icon list-color-neutral" aria-hidden="true"><CalendarDays size={20} /></span>
            <h2>Calendario</h2>
          </div>
        )}
        banner={spaces.length > 1 && (
          <div className="agenda-legend" role="group" aria-label="Espacios visibles">
            {spaces.map((space) => (
              <button
                key={space.key}
                className={isVisible(space) ? "" : "off"}
                onClick={() => toggle(space.key)}
                aria-pressed={isVisible(space)}
              >
                <i className={`chip-dot dot-${space.color}`} /> {space.label}
              </button>
            ))}
            <button className="legend-colors" onClick={() => setColorsOpen(true)} aria-label="Cambiar colores">
              <Palette size={14} />
            </button>
          </div>
        )}
        spaces={spaces}
        visibleSpaces={visibleSpaces}
        // Al editar se trabaja sobre todos los eventos: los ocultos no se pierden.
        events={shown}
        onMutate={(next, operation) => {
          const nextIds = new Set(next.map(({ id }) => id));
          const shownIds = new Set(shown.map(({ id }) => id));
          // Se conservan los eventos ocultos; los visibles se reemplazan por la nueva versión.
          return apply([...events.filter(({ id }) => !shownIds.has(id) && !nextIds.has(id)), ...next], operation);
        }}
      />
      {colorsOpen && <SpaceColorsModal spaces={spaces} onClose={() => setColorsOpen(false)} />}
    </>
  );
}

// Cada persona elige con qué color ve cada espacio; no cambia lo que ven los demás.
function SpaceColorsModal({ spaces, onClose }: { spaces: Space[]; onClose: () => void }) {
  const { setSpaceColor } = useMe();
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal list-settings-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Calendario</div>
            <h2>Colores</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <p>Elige con qué color ves cada espacio. Es solo para ti: los demás eligen los suyos.</p>
        {spaces.map((space) => (
          <fieldset key={space.key} className="space-color-row">
            <legend>{space.label}</legend>
            <div className="color-picker">
              {listColors.map((color) => (
                <button
                  type="button"
                  key={color}
                  className={`list-color-${color} ${space.color === color ? "selected" : ""}`}
                  onClick={() => void setSpaceColor(space.key, color)}
                  aria-label={`${space.label}: ${listColorNames[color]}`}
                  aria-pressed={space.color === color}
                >
                  {space.color === color && <Check size={15} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </section>
    </div>
  );
}
