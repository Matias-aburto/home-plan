import type { QueuedOperation } from "./offline";

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

export type Location = {
  id: string;
  name: string;
};

export type Suggestion = {
  name: string;
  category: string;
};

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

export type Family = {
  id: string;
  name: string;
  createdAt: string;
  locations: Location[];
  items: ShoppingItem[];
  tasks: HouseholdTask[];
  calendarEntries: CalendarEntry[];
};

export type View = "welcome" | "create" | "join";
export type OfflineMutation = Omit<QueuedOperation, "id" | "createdAt" | "familyId">;
export type SortMode = "custom" | "alpha";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
