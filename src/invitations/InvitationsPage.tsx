import { useState } from "react";
import { Inbox } from "lucide-react";
import { useNavigate } from "react-router";
import { useMe } from "../data/MeProvider";
import type { Invitation } from "../types";
import { InvitationCard } from "./InvitationCard";

// Bandeja de invitaciones recibidas.
export function InvitationsPage() {
  const { invitations, respondInvitation } = useMe();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function respond(invitation: Invitation, action: "accept" | "decline") {
    setBusyId(invitation.id);
    setError("");
    try {
      await respondInvitation(invitation.id, action);
      if (action === "accept" && invitation.familyId) navigate(`/familias/${invitation.familyId}`);
      if (action === "accept" && invitation.listId) navigate(`/listas/${invitation.listId}`);
    } catch (requestError) {
      setError(navigator.onLine ? (requestError as Error).message : "Necesitas conexión para responder.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>Invitaciones</h2></div>
        {invitations.length > 0 && <span>{invitations.length} pendiente{invitations.length === 1 ? "" : "s"}</span>}
      </div>
      {error && <div className="form-error settings-error">{error}</div>}
      {invitations.length === 0 ? (
        <div className="empty-state animate-in">
          <div><Inbox size={28} /></div>
          <h3>No tienes invitaciones</h3>
          <p>Cuando alguien te invite a una familia o a una lista, aparecerá aquí.</p>
        </div>
      ) : (
        <div className="invitation-list">
          {invitations.map((invitation) => (
            <InvitationCard
              key={invitation.id}
              invitation={invitation}
              busy={busyId === invitation.id}
              onAccept={() => void respond(invitation, "accept")}
              onDecline={() => void respond(invitation, "decline")}
            />
          ))}
        </div>
      )}
    </section>
  );
}
