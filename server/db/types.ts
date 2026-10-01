// Evento del calendario. Es de un espacio: personal (familyId null) o de un grupo.
export type CalendarEvent = {
  id: string;
  familyId: string | null;
  title: string;
  date: string;
  time: string | null;
  recurrence: "none" | "yearly";
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CalendarEventInput = Pick<CalendarEvent, "title" | "date" | "time" | "recurrence" | "notes">;

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
