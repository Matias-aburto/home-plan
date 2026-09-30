import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, RotateCw, Send, Share2, X } from "lucide-react";
import { api } from "../api/client";
import { onSyncEvent, syncEvents } from "../data/sync";
import { offeredRoleLabels } from "../invitations/InvitationCard";
import type { Invitation } from "../types";

const dateFormatter = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long" });

type Created = { invitation: Invitation; link: string };

// Invitar por email y gestionar las invitaciones pendientes (owner y admin). Requiere conexión.
export function FamilyInvitations({ familyId, familyName, canInviteAdmins }: {
  familyId: string;
  familyName: string;
  canInviteAdmins: boolean;
}) {
  const [pending, setPending] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/families/${familyId}/invitations`;

  const load = useCallback(async () => {
    try {
      setPending(await api<Invitation[]>(base));
    } catch {
      // Sin conexión se mantiene la lista anterior.
    }
  }, [base]);

  useEffect(() => {
    void load();
    return onSyncEvent<{ familyId?: string }>(syncEvents.familyChanged, (data) => {
      if (data?.familyId === familyId) void load();
    });
  }, [familyId, load]);

  async function send(targetEmail: string, targetRole: string) {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const result = await api<Created>(base, { method: "POST", body: JSON.stringify({ email: targetEmail, role: targetRole }) });
      setCreated(result);
      setEmail("");
      await load();
    } catch (requestError) {
      setError(navigator.onLine ? (requestError as Error).message : "Necesitas conexión para invitar.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (email.trim()) void send(email.trim(), role);
  }

  async function revoke(invitation: Invitation) {
    setBusy(true);
    try {
      await api(`/api/invitations/${invitation.id}`, { method: "DELETE" });
      if (created?.invitation.id === invitation.id) setCreated(null);
      await load();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function shareLink(link: string) {
    const text = `Te invito a ${familyName} en Casa.`;
    if (navigator.share) {
      await navigator.share({ title: familyName, text, url: link }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${link}`);
    setCopied(true);
  }

  return (
    <div className="settings-card">
      <h3>Invitar</h3>
      <form className="inline-form" onSubmit={submit}>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="email@ejemplo.cl"
          aria-label="Email de la persona"
          autoComplete="off"
        />
        {canInviteAdmins && (
          <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Rol">
            <option value="member">Miembro</option>
            <option value="admin">Administrador</option>
          </select>
        )}
        <button className="primary-button" disabled={busy || !email.trim()}><Send size={16} /> Invitar</button>
      </form>
      {error && <div className="form-error">{error}</div>}

      {created && (
        <div className="invite-link-box">
          <p>
            Listo. {created.invitation.invitedEmail} verá la invitación al entrar a Casa.
            También puedes enviarle este enlace (sirve una vez y vence en 7 días):
          </p>
          <div className="invite-link-row">
            <input readOnly value={created.link} aria-label="Enlace de invitación" onFocus={(event) => event.target.select()} />
            <button className="secondary-button" onClick={async () => {
              await navigator.clipboard.writeText(created.link);
              setCopied(true);
            }}>
              <Copy size={16} /> {copied ? "Copiado" : "Copiar"}
            </button>
            <button className="secondary-button" onClick={() => void shareLink(created.link)}><Share2 size={16} /> Compartir</button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="pending-invites">
          <h4>Pendientes</h4>
          {pending.map((invitation) => (
            <div className="pending-invite" key={invitation.id}>
              <span>
                <strong>{invitation.invitedEmail}</strong>
                <small>
                  {offeredRoleLabels[invitation.offeredRole]} · vence el {dateFormatter.format(new Date(invitation.expiresAt))}
                </small>
              </span>
              <button className="icon-button" disabled={busy} title="Reenviar (crea un enlace nuevo)" aria-label={`Reenviar a ${invitation.invitedEmail}`}
                onClick={() => void send(invitation.invitedEmail, invitation.offeredRole)}>
                <RotateCw size={16} />
              </button>
              <button className="icon-button" disabled={busy} title="Anular" aria-label={`Anular invitación a ${invitation.invitedEmail}`}
                onClick={() => void revoke(invitation)}>
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
