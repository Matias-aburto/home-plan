import type { ReactNode } from "react";
import { CalendarDays, Settings2 } from "lucide-react";
import { useLocation } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { useMe } from "../data/MeProvider";
import { ListIcon } from "../lists/listStyle";
import type { ListSummary } from "../types";

export type NavEntry = {
  key: string;
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
};

// Un espacio del menú: las listas personales o una familia.
export type NavSpace = {
  key: string;
  familyId: string | null;
  title: string;
  to: string;
  lists: NavEntry[];
  archived: ListSummary[];
  // Se pueden crear listas en el espacio (no en "Compartidas conmigo").
  canCreate: boolean;
  // Accesos que no son listas (calendario, ajustes); no se reordenan.
  links: NavEntry[];
};

function listEntry(list: ListSummary): NavEntry {
  return {
    key: list.id,
    to: `/listas/${list.id}`,
    label: list.name,
    icon: <ListIcon icon={list.icon} color={list.color} size={16} />,
    badge: list.pendingCount
  };
}

// Espacios del menú y cuál está activo según la URL.
export function useNavigation() {
  const { pathname } = useLocation();
  const { lists, families } = useMe();
  const { user } = useSession();
  const segments = pathname.split("/");
  const familyIds = new Set(families.map(({ id }) => id));

  // Dónde aparece cada lista: la propia en "Mis listas", la de una familia mía en esa familia
  // y cualquier otra (compartida conmigo) en "Compartidas conmigo".
  function spaceOf(list: ListSummary) {
    if (list.ownerUserId === user?.id) return "personal";
    if (list.familyId && familyIds.has(list.familyId)) return list.familyId;
    return "shared";
  }
  const listsIn = (space: string) => lists.filter((list) => spaceOf(list) === space && !list.archivedAt).map(listEntry);
  const archivedIn = (space: string) => lists.filter((list) => spaceOf(list) === space && list.archivedAt);
  const sharedLists = listsIn("shared");

  const spaces: NavSpace[] = [
    {
      key: "personal",
      familyId: null,
      title: "Mis listas",
      to: "/personal",
      lists: listsIn("personal"),
      archived: archivedIn("personal"),
      canCreate: true,
      links: []
    },
    ...families.map((family) => ({
      key: family.id,
      familyId: family.id,
      title: family.name,
      to: `/familias/${family.id}`,
      lists: listsIn(family.id),
      archived: archivedIn(family.id),
      canCreate: true,
      links: [
        { key: `calendar:${family.id}`, to: `/familias/${family.id}/calendario`, label: "Calendario", icon: <CalendarDays size={18} /> },
        { key: `settings:${family.id}`, to: `/familias/${family.id}/ajustes`, label: "Ajustes", icon: <Settings2 size={18} /> }
      ]
    })),
    ...(sharedLists.length || archivedIn("shared").length ? [{
      key: "shared",
      familyId: null,
      title: "Compartidas conmigo",
      to: "/compartidas",
      lists: sharedLists,
      archived: archivedIn("shared"),
      canCreate: false,
      links: []
    }] : [])
  ];

  let activeKey: string | null = null;
  let activeSpaceKey = "personal";
  if (segments[1] === "listas") {
    activeKey = segments[2];
    const list = lists.find(({ id }) => id === segments[2]);
    if (list) activeSpaceKey = spaceOf(list);
  } else if (segments[1] === "familias" && segments[2]) {
    activeSpaceKey = segments[2];
    activeKey = segments[3] === "calendario" ? `calendar:${segments[2]}`
      : segments[3] === "ajustes" ? `settings:${segments[2]}` : null;
  } else if (segments[1] === "compartidas") {
    activeSpaceKey = "shared";
  }
  const activeSpace = spaces.find((space) => space.key === activeSpaceKey) ?? spaces[0];

  return { spaces, activeSpace, activeKey, families };
}
