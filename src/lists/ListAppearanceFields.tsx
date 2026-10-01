import { Check } from "lucide-react";
import { listColorNames, listColors, listIcons, ListIcon } from "./listStyle";

// Selector de ícono y color, compartido al crear y en los ajustes de listas y calendarios.
export function ListAppearanceFields({
  icon,
  color,
  onIconChange,
  onColorChange
}: {
  icon: string;
  color: string;
  onIconChange: (icon: string) => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <>
      <fieldset>
        <legend>Ícono</legend>
        <div className="icon-picker">
          {Object.keys(listIcons).map((name) => (
            <button
              type="button"
              key={name}
              className={icon === name ? "selected" : ""}
              onClick={() => onIconChange(name)}
              aria-label={listIcons[name].label}
              title={listIcons[name].label}
              aria-pressed={icon === name}
            >
              <ListIcon icon={name} color={icon === name ? color : "neutral"} size={17} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Color</legend>
        <div className="color-picker">
          {listColors.map((name) => (
            <button
              type="button"
              key={name}
              className={`list-color-${name} ${color === name ? "selected" : ""}`}
              onClick={() => onColorChange(name)}
              aria-label={listColorNames[name]}
              aria-pressed={color === name}
            >
              {color === name && <Check size={15} strokeWidth={3} />}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
