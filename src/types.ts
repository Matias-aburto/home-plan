import type { QueuedOperation } from "./offline";

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
};

export type ListAccess = "viewer" | "editor" | "owner";

export type ListSummary = {
  id: string;
  ownerUserId: string | null;
  familyId: string | null;
  name: string;
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
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

export type SharedMember = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  color: string;
  permission: "editor" | "viewer";
};

export type ListDetail = {
  list: ListSummary;
  items: ListItem[];
  // Personas con quienes está compartida la lista fuera de su dueño o grupo.
  sharedWith: SharedMember[];
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
  calendars: CalendarSummary[];
  invitations: Invitation[];
};

// Calendario personal o de un grupo. No se comparte con personas puntuales.
export type CalendarSummary = {
  id: string;
  ownerUserId: string | null;
  familyId: string | null;
  name: string;
  icon: string;
  color: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  access: "owner" | "editor";
};

export type CalendarDetail = {
  calendar: CalendarSummary;
  events: CalendarEntry[];
};

export type OfflineMutation = Omit<QueuedOperation, "id" | "createdAt" | "familyId" | "listId" | "calendarId">;
export type SortMode = "custom" | "alpha";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
