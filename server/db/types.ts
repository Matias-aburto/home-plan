export type Location = { id: string; name: string };

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

export type FamilyRole = "owner" | "admin" | "member";

export type FamilySummary = {
  id: string;
  name: string;
  createdAt: string;
  role: FamilyRole;
  memberCount: number;
};

export type FamilyMember = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  color: string;
  role: FamilyRole;
  joinedAt: string;
};

export type ListKind ="shopping" | "tasks" | "checklist";
export type ListAccess = "none" | "viewer" | "editor" | "owner";
export type SortMode = "custom" | "alpha";

// Dueño de listas, ubicaciones y productos aprendidos.
export type Scope = { ownerUserId: string; familyId: null } | { ownerUserId: null; familyId: string };

export type ListRecord = {
  id: string;
  ownerUserId: string | null;
  familyId: string | null;
  name: string;
  kind: ListKind;
  icon: string;
  color: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

// Lo que ve cada usuario en su menú: la lista más su acceso y preferencias.
export type ListSummary = ListRecord & {
  access: Exclude<ListAccess, "none">;
  position: number;
  sort: SortMode;
  pendingCount: number;
};

export type ListItem = {
  id: string;
  title: string;
  completed: boolean;
  position: number;
  locationId: string | null;
  assigneeUserId: string | null;
  // Nombre del responsable en el modelo anterior, hasta vincularlo a un miembro.
  legacyAssignee: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  color: string;
};
