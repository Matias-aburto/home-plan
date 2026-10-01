import { useMemo } from "react";
import { useMe } from "../data/MeProvider";

// Un espacio: lo personal o un grupo. Cada evento del calendario es de uno.
export type Space = { key: string; familyId: string | null; label: string; color: string };

const palette = ["blue", "rose", "violet", "teal", "amber", "green"];

export function spaceKey(familyId: string | null) {
  return familyId ?? "personal";
}

// Espacios del usuario con el color con que los ve. Los que no eligió a mano reciben uno según su
// posición (personal primero), distinto para cada uno y estable: cambiar uno no mueve los demás.
export function useSpaces(): Space[] {
  const { families, spaceColors } = useMe();
  return useMemo(() => {
    const spaces = [
      { key: "personal", familyId: null, label: "Personal" },
      ...families.map((family) => ({ key: family.id, familyId: family.id, label: family.name }))
    ];
    return spaces.map((space, index) => ({ ...space, color: spaceColors[space.key] ?? palette[index % palette.length] }));
  }, [families, spaceColors]);
}
