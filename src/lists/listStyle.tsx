import {
  Baby,
  Bed,
  Bike,
  BookOpen,
  Briefcase,
  Cake,
  CalendarDays,
  CalendarHeart,
  Car,
  Coffee,
  CookingPot,
  Dumbbell,
  Gamepad2,
  Gift,
  GraduationCap,
  Hammer,
  Heart,
  House,
  Lightbulb,
  ListChecks,
  ListTodo,
  Luggage,
  Music,
  PartyPopper,
  PawPrint,
  Pill,
  Plane,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  Sofa,
  Sprout,
  Star,
  Tent,
  Utensils,
  Wine,
  Wrench,
  type LucideIcon
} from "lucide-react";

// Deben coincidir con listIcons y listColors de server/http/validation.ts.
// Se conservan los nombres de los íconos que ya existían ("list-todo", "shopping-basket", etc.).
export const listIcons: Record<string, { icon: LucideIcon; label: string }> = {
  "list-checks": { icon: ListChecks, label: "Checklist" },
  "list-todo": { icon: ListTodo, label: "Tareas" },
  "shopping-cart": { icon: ShoppingCart, label: "Carro de compras" },
  "shopping-basket": { icon: ShoppingBasket, label: "Canasta" },
  hammer: { icon: Hammer, label: "Martillo" },
  wrench: { icon: Wrench, label: "Herramientas" },
  house: { icon: House, label: "Casa" },
  sofa: { icon: Sofa, label: "Living" },
  bed: { icon: Bed, label: "Dormitorio" },
  utensils: { icon: Utensils, label: "Comida" },
  "cooking-pot": { icon: CookingPot, label: "Cocina" },
  coffee: { icon: Coffee, label: "Café" },
  wine: { icon: Wine, label: "Copas" },
  gift: { icon: Gift, label: "Regalo" },
  "party-popper": { icon: PartyPopper, label: "Fiesta" },
  cake: { icon: Cake, label: "Cumpleaños" },
  plane: { icon: Plane, label: "Viaje" },
  luggage: { icon: Luggage, label: "Maleta" },
  tent: { icon: Tent, label: "Camping" },
  car: { icon: Car, label: "Auto" },
  bike: { icon: Bike, label: "Bicicleta" },
  dumbbell: { icon: Dumbbell, label: "Ejercicio" },
  heart: { icon: Heart, label: "Corazón" },
  star: { icon: Star, label: "Estrella" },
  briefcase: { icon: Briefcase, label: "Trabajo" },
  "book-open": { icon: BookOpen, label: "Libro" },
  "graduation-cap": { icon: GraduationCap, label: "Estudios" },
  "paw-print": { icon: PawPrint, label: "Mascotas" },
  baby: { icon: Baby, label: "Bebé" },
  sprout: { icon: Sprout, label: "Plantas" },
  pill: { icon: Pill, label: "Salud" },
  shirt: { icon: Shirt, label: "Ropa" },
  music: { icon: Music, label: "Música" },
  "gamepad-2": { icon: Gamepad2, label: "Juegos" },
  lightbulb: { icon: Lightbulb, label: "Ideas" },
  calendar: { icon: CalendarDays, label: "Calendario" },
  "calendar-heart": { icon: CalendarHeart, label: "Fechas especiales" }
};

export const listColors = ["green", "blue", "amber", "rose", "violet", "teal"] as const;

export const listColorNames: Record<string, string> = {
  green: "Verde",
  blue: "Azul",
  amber: "Ámbar",
  rose: "Rosa",
  violet: "Violeta",
  teal: "Turquesa"
};

export function ListIcon({ icon, color, size = 18 }: { icon: string; color: string; size?: number }) {
  const Icon = listIcons[icon]?.icon || ListChecks;
  return (
    <span className={`list-icon list-color-${color}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  );
}
