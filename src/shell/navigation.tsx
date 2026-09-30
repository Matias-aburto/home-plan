import type { ReactNode } from "react";
import { CalendarDays, ListTodo, ShoppingBasket } from "lucide-react";
import { useLocation } from "react-router";
import { useMe } from "../data/MeProvider";
import { useLegacyFamily } from "../family/LegacyFamilyProvider";
import { ListIcon } from "../lists/listStyle";

export type NavEntry = {
  key: string;
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
};

export type Space = "personal" | "family";

export const familyPaths = {
  shopping: "/familia",
  tasks: "/familia/tareas",
  calendar: "/familia/calendario"
} as const;

// Entradas del menú de cada espacio y cuál está activo según la URL.
export function useNavigation() {
  const { pathname } = useLocation();
  const { lists } = useMe();
  const { family } = useLegacyFamily();

  const activeLists = lists.filter((list) => !list.archivedAt);
  const archivedLists = lists.filter((list) => list.archivedAt);
  const personal: NavEntry[] = activeLists.map((list) => ({
    key: list.id,
    to: `/listas/${list.id}`,
    label: list.name,
    icon: <ListIcon icon={list.icon} color={list.color} size={16} />,
    badge: list.pendingCount
  }));
  const familyEntries: NavEntry[] = family ? [
    {
      key: "family-shopping",
      to: familyPaths.shopping,
      label: "Lista de compras",
      icon: <ShoppingBasket size={20} />,
      badge: family.items.filter((item) => !item.completed).length
    },
    {
      key: "family-tasks",
      to: familyPaths.tasks,
      label: "Por hacer",
      icon: <ListTodo size={20} />,
      badge: family.tasks.filter((task) => !task.completed).length
    },
    { key: "family-calendar", to: familyPaths.calendar, label: "Calendario", icon: <CalendarDays size={20} /> }
  ] : [];

  const currentListId = pathname.startsWith("/listas/") ? pathname.split("/")[2] : null;
  const space: Space = pathname.startsWith("/familia") ? "family" : "personal";
  const activeKey = currentListId
    ?? (pathname.startsWith(familyPaths.tasks) ? "family-tasks"
      : pathname.startsWith(familyPaths.calendar) ? "family-calendar"
        : pathname.startsWith(familyPaths.shopping) ? "family-shopping" : null);

  return { space, activeKey, personal, archivedLists, familyEntries, family };
}
