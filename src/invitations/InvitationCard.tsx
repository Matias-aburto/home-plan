import { Mail, Users } from "lucide-react";
import type { Invitation } from "../types";

export const offeredRoleLabels: Record<string, string> = {
  admin: "administrador",
  member: "miembro",
  editor: "editor",
  viewer: "lector"
};

const dateFormatter = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long" });

export function invitationSummary(invitation: Invitation) {
  const place = invitation.kind === "family" ? `«${invitation.targetName}»` : `la lista «${invitation.targetName}»`;
  return `${invitation.inviterName} te invitó a ${place} como ${offeredRoleLabels[invitation.offeredRole] ?? invitation.offeredRole}.`;
}

export function InvitationCard({
  invitation,
  busy,
  onAccept,
  onDecline
}: {
  invitation: Invitation;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <article className="invitation-card">
      <span className="list-icon list-color-green" aria-hidden="true">
        {invitation.kind === "family" ? <Users size={18} /> : <Mail size={18} />}
      </span>
      <div className="invitation-copy">
        <strong>{invitation.targetName}</strong>
        <p>{invitationSummary(invitation)}</p>
        <small>Vence el {dateFormatter.format(new Date(invitation.expiresAt))}</small>
      </div>
      <div className="invitation-actions">
        <button className="secondary-button" disabled={busy} onClick={onDecline}>Rechazar</button>
        <button className="primary-button" disabled={busy} onClick={onAccept}>Aceptar</button>
      </div>
    </article>
  );
}
