import {
  Baby,
  BookOpen,
  Briefcase,
  Dumbbell,
  Gift,
  Heart,
  House,
  ListChecks,
  ListTodo,
  PawPrint,
  Plane,
  ShoppingBasket,
  Star,
  Utensils,
  type LucideIcon
} from "lucide-react";
import type { ListKind } from "../types";

// Deben coincidir con listIcons y listColors de server/http/validation.ts.
export const listIcons: Record<string, LucideIcon> = {
  "shopping-basket": ShoppingBasket,
  "list-todo": ListTodo,
  "list-checks": ListChecks,
  house: House,
  gift: Gift,
  plane: Plane,
  utensils: Utensils,
  "book-open": BookOpen,
  dumbbell: Dumbbell,
  heart: Heart,
  star: Star,
  briefcase: Briefcase,
  "paw-print": PawPrint,
  baby: Baby
};

export const listIconNames: Record<string, string> = {
  "shopping-basket": "Canasta",
  "list-todo": "Tareas",
  "list-checks": "Checklist",
  house: "Casa",
  gift: "Regalo",
  plane: "Viaje",
  utensils: "Comida",
  "book-open": "Libro",
  dumbbell: "Ejercicio",
  heart: "Corazón",
  star: "Estrella",
  briefcase: "Trabajo",
  "paw-print": "Mascotas",
  baby: "Bebé"
};

export const listColors =["green", "blue", "amber", "rose", "violet", "teal"] as const;

export const listColorNames: Record<string, string> = {
  green: "Verde",
  blue: "Azul",
  amber: "Ámbar",
  rose: "Rosa",
  violet: "Violeta",
  teal: "Turquesa"
};

export const listKinds: { kind: ListKind; label: string; description: string; icon: string }[] = [
  { kind: "shopping", label: "Compras", description: "Con ubicaciones y sugerencias de productos", icon: "shopping-basket" },
  { kind: "tasks", label: "Tareas", description: "Cosas por hacer, con ubicaciones", icon: "list-todo" },
  { kind: "checklist", label: "Checklist", description: "Una lista simple para marcar", icon: "list-checks" }
];

export function ListIcon({ icon, color, size = 18 }: { icon: string; color: string; size?: number }) {
  const Icon = listIcons[icon] || ListChecks;
  return (
    <span className={`list-icon list-color-${color}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
