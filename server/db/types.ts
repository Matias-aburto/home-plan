export type ShoppingItem = {
  id: string;
  name: string;
  locationId: string | null;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

export type Location = { id: string; name: string };
export type Assignee = "Matías" | "Francisca";

export type HouseholdTask = {
  id: string;
  title: string;
  assignee: Assignee | null;
  locationId: string | null;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

export type CalendarEntry = {
  id: string;
  title: string;
  kind: "event" | "reminder";
  date: string;
  time: string | null;
  recurrence: "none" | "yearly";
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalendarEntryInput = Pick<CalendarEntry, "title" | "kind" | "date" | "time" | "recurrence" | "notes">;

export type LearnedProduct = {
  name: string;
  uses: number;
  lastUsedAt: string;
};

export type Family = {
  id: string;
  name: string;
  createdAt: string;
  locations: Location[];
  learnedProducts: LearnedProduct[];
  items: ShoppingItem[];
  tasks: HouseholdTask[];
  calendarEntries: CalendarEntry[];
};

export type ListTable = "shopping_items" | "household_tasks";
