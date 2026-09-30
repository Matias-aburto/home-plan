import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { db, familyKey, text } from "./client.js";
import type { FamilyRole } from "./types.js";

export const invitationDurationMs = 7 * 24 * 60 * 60 * 1000;

export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export type Invitation = {
  id: string;
  kind: "family" | "list";
  familyId: string | null;
  listId: string | null;
  targetName: string;
  invitedEmail: string;
  offeredRole: string;
  invitedBy: string;
  inviterName: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const selectInvitation = `SELECT i.id, i.kind, i.family_id, i.list_id, i.invited_email, i.offered_role, i.invited_by,
    i.status, i.created_at, i.expires_at, u.name AS inviter_name,
    COALESCE(f.name, l.name, '') AS target_name
  FROM invitations i
  JOIN users u ON u.id = i.invited_by
  LEFT JOIN families f ON f.id = i.family_id
  LEFT JOIN lists l ON l.id = i.list_id`;

function toInvitation(row: Record<string, unknown>): Invitation {
  return {
    id: String(row.id),
    kind: String(row.kind) as Invitation["kind"],
    familyId: text(row.family_id),
    listId: text(row.list_id),
    targetName: String(row.target_name),
    invitedEmail: String(row.invited_email),
    offeredRole: String(row.offered_role),
    invitedBy: String(row.invited_by),
    inviterName: String(row.inviter_name),
    status: String(row.status) as InvitationStatus,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at)
  };
}

// Las pendientes vencidas se marcan al consultarlas: no hace falta un proceso aparte.
async function expireOld() {
  await db.execute({
    sql: "UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?",
    args: [new Date().toISOString()]
  });
}

export async function getInvitation(id: string) {
  await expireOld();
  const result = await db.execute({ sql: `${selectInvitation} WHERE i.id = ?`, args: [id] });
  return result.rows[0] ? toInvitation(result.rows[0]) : null;
}

export async function getInvitationByToken(token: string) {
  await expireOld();
  const result = await db.execute({ sql: `${selectInvitation} WHERE i.token_hash = ?`, args: [hashToken(token)] });
  return result.rows[0] ? toInvitation(result.rows[0]) : null;
}

// Crea la invitación y revoca la pendiente anterior para el mismo email y destino (reenviar).
export async function createFamilyInvitation(familyId: string, email: string, role: FamilyRole, invitedBy: string) {
  const token = randomBytes(24).toString("base64url");
  const id = nanoid();
  const key = familyKey(familyId);
  const invitedEmail = normalizeEmail(email);
  const now = new Date();
  await db.batch([
    {
      sql: `UPDATE invitations SET status = 'revoked', responded_at = ?
        WHERE kind = 'family' AND family_id = ? AND invited_email = ? AND status = 'pending'`,
      args: [now.toISOString(), key, invitedEmail]
    },
    {
      sql: `INSERT INTO invitations
        (id, token_hash, kind, family_id, invited_email, offered_role, invited_by, created_at, expires_at)
        VALUES (?, ?, 'family', ?, ?, ?, ?, ?, ?)`,
      args: [
        id, hashToken(token), key, invitedEmail, role, invitedBy,
        now.toISOString(), new Date(now.getTime() + invitationDurationMs).toISOString()
      ]
    }
  ], "write");
  return { invitation: (await getInvitation(id))!, token };
}

export async function pendingFamilyInvitations(familyId: string) {
  await expireOld();
  const result = await db.execute({
    sql: `${selectInvitation} WHERE i.kind = 'family' AND i.family_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC`,
    args: [familyKey(familyId)]
  });
  return result.rows.map(toInvitation);
}

export async function receivedInvitations(email: string) {
  await expireOld();
  const result = await db.execute({
    sql: `${selectInvitation} WHERE i.invited_email = ? AND i.status = 'pending' ORDER BY i.created_at DESC`,
    args: [normalizeEmail(email)]
  });
  return result.rows.map(toInvitation);
}

// Cuántas invitaciones creó el usuario en las últimas 24 horas (límite contra abuso).
export async function invitationsSentToday(userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = await db.execute({
    sql: "SELECT COUNT(*) AS total FROM invitations WHERE invited_by = ? AND created_at >= ?",
    args: [userId, since]
  });
  return Number(result.rows[0]?.total ?? 0);
}

export async function isFamilyMemberByEmail(familyId: string, email: string) {
  const result = await db.execute({
    sql: `SELECT 1 FROM family_members m JOIN users u ON u.id = m.user_id
      WHERE m.family_id = ? AND u.email = ?`,
    args: [familyKey(familyId), normalizeEmail(email)]
  });
  return result.rows.length > 0;
}

export async function findUserIdByEmail(email: string) {
  const result = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [normalizeEmail(email)] });
  return result.rows[0] ? String(result.rows[0].id) : null;
}

// Acepta: suma a la familia con el rol ofrecido (si ya era miembro, conserva su rol).
export async function acceptFamilyInvitation(invitation: Invitation, userId: string) {
  const now = new Date().toISOString();
  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO family_members (family_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`,
      args: [invitation.familyId, userId, invitation.offeredRole, now]
    },
    {
      sql: "UPDATE invitations SET status = 'accepted', responded_at = ?, responded_by = ? WHERE id = ? AND status = 'pending'",
      args: [now, userId, invitation.id]
    }
  ], "write");
}

export async function setInvitationStatus(id: string, status: "declined" | "revoked", userId: string) {
  await db.execute({
    sql: "UPDATE invitations SET status = ?, responded_at = ?, responded_by = ? WHERE id = ? AND status = 'pending'",
    args: [status, new Date().toISOString(), userId, id]
  });
}
