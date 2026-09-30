import type { QueuedOperation } from "./offline";

export type Location = {
  id: string;
  name: string;
};

export type Suggestion = {
  name: string;
  category: string;
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

export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  color: string;
};

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

export type FamilyDetail = {
  family: FamilySummary;
  members: FamilyMember[];
  locations: Location[];
  legacyAssignees: { name: string; count: number }[];
};

export type ListKind = "shopping" | "tasks" | "checklist";
export type ListAccess = "viewer" | "editor" | "owner";

export type ListSummary = {
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
  access: ListAccess;
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

// Quienes pueden ser responsables de una tarea (miembros de la familia de la lista).
export type Assignable = Pick<FamilyMember, "userId" | "name" | "color" | "avatarUrl">;

export type ListDetail = {
  list: ListSummary;
  items: ListItem[];
  locations: Location[];
  members: Assignable[];
};

export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export type Invitation = {
  id: string;
  kind: "family" | "list";
  familyId: string | null;
  listId: string | null;
  targetName: string;
  invitedEmail: string;
  offeredRole: string;
  inviterName: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
};

export type Me = {
  user: User;
  families: FamilySummary[];
  lists: ListSummary[];
  invitations: Invitation[];
};

export type OfflineMutation = Omit<QueuedOperation, "id" | "createdAt" | "familyId" | "listId">;
export type SortMode = "custom" | "alpha";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
