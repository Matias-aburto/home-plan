import type { ReactNode } from "react";
import { CalendarRange, Settings2 } from "lucide-react";
import { useLocation } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { useMe } from "../data/MeProvider";
import { ListIcon } from "../lists/listStyle";
import type { CalendarSummary, ListSummary } from "../types";

export type NavEntry = {
  key: string;
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
};

// Un espacio del menú: lo personal, un grupo o lo compartido conmigo.
export type NavSpace = {
  key: string;
  familyId: string | null;
  title: string;
  to: string;
  // Las listas se pueden reordenar.
  lists: NavEntry[];
  archived: NavEntry[];
  // Su calendario, si se agregó (uno por espacio).
  calendar: NavEntry | null;
  // Se pueden crear listas y agregar el calendario (no en "Compartidas conmigo").
  canCreate: boolean;
  // Accesos que no son contenido (ajustes del grupo); no se reordenan.
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

function calendarEntry(calendar: CalendarSummary): NavEntry {
  return {
    key: `calendar:${calendar.id}`,
    to: `/calendarios/${calendar.id}`,
    label: "Calendario",
    icon: <ListIcon icon="calendar" color={calendar.color} size={16} />
  };
}

// Espacios del menú y cuál está activo según la URL.
export function useNavigation() {
  const { pathname } = useLocation();
  const { lists, calendars, families } = useMe();
  const { user } = useSession();
  const segments = pathname.split("/");
  const familyIds = new Set(families.map(({ id }) => id));

  // Dónde aparece cada lista: la propia en "Personal", la de un grupo mío en ese grupo
  // y cualquier otra (compartida conmigo) en "Compartidas conmigo".
  function spaceOf(list: ListSummary) {
    if (list.ownerUserId === user?.id) return "personal";
    if (list.familyId && familyIds.has(list.familyId)) return list.familyId;
    return "shared";
  }
  // Los calendarios son personales o de un grupo mío.
  const calendarSpace = (calendar: CalendarSummary) => calendar.familyId ?? "personal";

  const listsIn = (space: string) => lists.filter((list) => spaceOf(list) === space && !list.archivedAt).map(listEntry);
  const calendarIn = (space: string) => {
    const calendar = calendars.find((candidate) => calendarSpace(candidate) === space);
    return calendar ? calendarEntry(calendar) : null;
  };
  const archivedIn = (space: string) => lists.filter((list) => spaceOf(list) === space && list.archivedAt).map(listEntry);
  const sharedLists = listsIn("shared");
  const sharedArchived = archivedIn("shared");

  const spaces: NavSpace[] = [
    {
      key: "personal",
      familyId: null,
      title: "Personal",
      to: "/personal",
      lists: listsIn("personal"),
      calendar: calendarIn("personal"),
      archived: archivedIn("personal"),
      canCreate: true,
      links: []
    },
    ...families.map((family) => ({
      key: family.id,
      familyId: family.id,
      title: family.name,
      to: `/grupos/${family.id}`,
      lists: listsIn(family.id),
      calendar: calendarIn(family.id),
      archived: archivedIn(family.id),
      canCreate: true,
      links: [
        {
          key: `settings:${family.id}`,
          to: `/grupos/${family.id}/ajustes`,
          label: "Ajustes",
          icon: <span className="nav-icon"><Settings2 size={17} /></span>
        }
      ]
    })),
    ...(sharedLists.length || sharedArchived.length ? [{
      key: "shared",
      familyId: null,
      title: "Compartidas conmigo",
      to: "/compartidas",
      lists: sharedLists,
      calendar: null,
      archived: sharedArchived,
      canCreate: false,
      links: []
    }] : [])
  ];

  // La agenda junta todos los calendarios; aparece cuando hay al menos uno.
  const agenda: NavEntry | null = calendars.length ? {
    key: "agenda",
    to: "/agenda",
    label: "Agenda",
    icon: <span className="nav-icon"><CalendarRange size={17} /></span>
  } : null;

  let activeKey: string | null = null;
  let activeSpaceKey = "personal";
  if (segments[1] === "agenda") {
    activeKey = "agenda";
  } else if (segments[1] === "listas") {
    activeKey = segments[2];
    const list = lists.find(({ id }) => id === segments[2]);
    if (list) activeSpaceKey = spaceOf(list);
  } else if (segments[1] === "calendarios") {
    activeKey = `calendar:${segments[2]}`;
    const calendar = calendars.find(({ id }) => id === segments[2]);
    if (calendar) activeSpaceKey = calendarSpace(calendar);
  } else if (segments[1] === "grupos" && segments[2]) {
    activeSpaceKey = segments[2];
    activeKey = segments[3] === "ajustes" ? `settings:${segments[2]}` : null;
  } else if (segments[1] === "compartidas") {
    activeSpaceKey = "shared";
  }
  const activeSpace = spaces.find((space) => space.key === activeSpaceKey) ?? spaces[0];

  return { spaces, activeSpace, activeKey, families, agenda, onAgenda: activeKey === "agenda" };
}
