import type { ReactNode } from "react";
import { CalendarDays, Settings2 } from "lucide-react";
import { useLocation } from "react-router";
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
  const segments = pathname.split("/");

  const spaces: NavSpace[] = [
    {
      key: "personal",
      familyId: null,
      title: "Mis listas",
      to: "/personal",
      lists: lists.filter((list) => !list.familyId && !list.archivedAt).map(listEntry),
      archived: lists.filter((list) => !list.familyId && list.archivedAt),
      links: []
    },
    ...families.map((family) => ({
      key: family.id,
      familyId: family.id,
      title: family.name,
      to: `/familias/${family.id}`,
      lists: lists.filter((list) => list.familyId === family.id && !list.archivedAt).map(listEntry),
      archived: lists.filter((list) => list.familyId === family.id && list.archivedAt),
      links: [
        { key: `calendar:${family.id}`, to: `/familias/${family.id}/calendario`, label: "Calendario", icon: <CalendarDays size={18} /> },
        { key: `settings:${family.id}`, to: `/familias/${family.id}/ajustes`, label: "Ajustes", icon: <Settings2 size={18} /> }
      ]
    }))
  ];

  let activeKey: string | null = null;
  let activeFamilyId: string | null = null;
  if (segments[1] === "listas") {
    activeKey = segments[2];
    activeFamilyId = lists.find((list) => list.id === segments[2])?.familyId ?? null;
  } else if (segments[1] === "familias" && segments[2]) {
    activeFamilyId = segments[2];
    activeKey = segments[3] === "calendario" ? `calendar:${segments[2]}`
      : segments[3] === "ajustes" ? `settings:${segments[2]}` : null;
  }
  const activeSpace = spaces.find((space) => space.familyId === activeFamilyId) ?? spaces[0];

  return { spaces, activeSpace, activeKey, families };
}
