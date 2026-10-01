import { useEffect, useState } from "react";
import { CircleAlert, MailOpen } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { ApiError, api } from "../api/client";
import { AccountMenu } from "../components/AccountMenu";
import { appName, BrandIcon } from "../lib/brand";
import { useMe } from "../data/MeProvider";
import type { Invitation, User } from "../types";
import { invitationSummary } from "./InvitationCard";

const closedMessages: Record<string, string> = {
  accepted: "Esta invitación ya fue aceptada.",
  declined: "Esta invitación fue rechazada.",
  revoked: "Esta invitación fue anulada. Pide una nueva a quien te invitó.",
  expired: "Esta invitación venció. Pide una nueva a quien te invitó."
};

// Página a la que lleva el enlace de invitación (/invitacion/:token).
export function InvitationLanding({ user, onLogout }: { user: User; onLogout: (everywhere?: boolean) => Promise<void> }) {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Invitation>(`/api/invitations/token/${encodeURIComponent(token)}`)
      .then(setInvitation)
      .catch((requestError) => setError(
        requestError instanceof ApiError && requestError.status === 404
          ? "No encontramos esta invitación. Revisa que el enlace esté completo."
          : navigator.onLine ? (requestError as Error).message : "Necesitas conexión para ver la invitación."
      ));
  }, [token]);

  async function respond(action: "accept" | "decline") {
    if (!invitation) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/invitations/token/${encodeURIComponent(token)}/${action}`, { method: "POST" });
      await me.refresh();
      if (action === "decline") navigate("/", { replace: true });
      else navigate(invitation.familyId ? `/grupos/${invitation.familyId}` : `/listas/${invitation.listId}`, { replace: true });
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const otherEmail = invitation && invitation.invitedEmail !== user.email.toLowerCase();

  return (
    <main className="onboarding">
      <section className="onboarding-card">
        <header className="brand">
          <div className="brand-mark"><BrandIcon size={27} /></div>
          <span>{appName}</span>
          <div className="brand-account"><AccountMenu user={user} onLogout={onLogout} /></div>
        </header>
        <div className="form-content animate-in">
          <div className="form-icon">{error && !invitation ? <CircleAlert /> : <MailOpen />}</div>
          {!invitation && !error && <p>Cargando invitación…</p>}
          {invitation && (
            <>
              <h1>{invitation.targetName}</h1>
              <p>{invitationSummary(invitation)}</p>
              {invitation.status === "pending" ? (
                <>
                  {otherEmail && (
                    <p className="invitation-note">
                      La invitación era para {invitation.invitedEmail}. Si la aceptas, entrarás con {user.email}.
                    </p>
                  )}
                  <div className="welcome-actions">
                    <button className="primary-button" disabled={busy} onClick={() => void respond("accept")}>Aceptar</button>
                    <button className="secondary-button" disabled={busy} onClick={() => void respond("decline")}>Rechazar</button>
                  </div>
                </>
              ) : (
                <p className="invitation-note">{closedMessages[invitation.status]}</p>
              )}
            </>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="text-button" onClick={() => navigate("/")}>Ir a mis listas</button>
        </div>
        <footer><span>Conectado como {user.email}</span></footer>
      </section>
    </main>
  );
}
