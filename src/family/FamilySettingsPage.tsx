import { useState, type FormEvent } from "react";
import { CircleAlert, DoorOpen, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useSession } from "../auth/AuthProvider";
import { UserAvatar } from "../components/AccountMenu";
import { Loading } from "../components/Loading";
import { useMe } from "../data/MeProvider";
import type { FamilyMember, FamilyRole } from "../types";
import { onSyncEvent, syncEvents } from "../data/sync";
import { InviteManager } from "../invitations/InviteManager";
import { useFamilyDetail } from "./useFamilyDetail";

export const roleLabels: Record<FamilyRole, string> = {
  owner: "Dueño",
  admin: "Administrador",
  member: "Miembro"
};

export function FamilySettingsRoute() {
  const { familyId = "" } = useParams();
  return <FamilySettingsPage key={familyId} familyId={familyId} />;
}

function FamilySettingsPage({ familyId }: { familyId: string }) {
  const { user } = useSession();
  const me = useMe();
  const navigate = useNavigate();
  const { detail, missing, reload } = useFamilyDetail(familyId);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [confirming, setConfirming] = useState<"transfer" | "leave" | "delete" | null>(null);

  if (missing) {
    return (
      <section className="content">
        <div className="empty-state animate-in">
          <div><CircleAlert size={28} /></div>
          <h3>No encontramos esta familia</h3>
          <p>Puede que la hayan eliminado o que ya no seas parte de ella.</p>
          <Link className="secondary-button empty-state-action" to="/">Volver al inicio</Link>
        </div>
      </section>
    );
  }
  if (!detail || !user) return <Loading />;

  const { family, members } = detail;
  const myRole = family.role;
  const isOwner = myRole === "owner";
  const isAdmin = myRole === "owner" || myRole === "admin";
  const others = members.filter((member) => member.userId !== user.id);

  // Las acciones sobre la familia requieren conexión: dependen de permisos que valida el servidor.
  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError("");
    try {
      await action();
      await Promise.all([reload(), me.refresh()]);
      after?.();
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const base = `/api/families/${family.id}`;

  function saveName(event: FormEvent) {
    event.preventDefault();
    if (!name?.trim()) return;
    void run(() => api(base, { method: "PATCH", body: JSON.stringify({ name }) }), () => setName(null));
  }

  function canRemove(member: FamilyMember) {
    if (member.userId === user!.id || member.role === "owner") return false;
    return isOwner || (myRole === "admin" && member.role === "member");
  }

  return (
    <section className="content family-settings">
      <div className="content-heading">
        <div className="title-only"><h2>Ajustes de la familia</h2></div>
        <span>{roleLabels[myRole]}</span>
      </div>

      {error && <div className="form-error settings-error">{error}</div>}

      <div className="settings-card">
        <h3>Nombre</h3>
        {isAdmin ? (
          <form className="inline-form" onSubmit={saveName}>
            <input value={name ?? family.name} onChange={(event) => setName(event.target.value)} maxLength={50} aria-label="Nombre de la familia" />
            {name !== null && name.trim() !== family.name && (
              <button className="primary-button" disabled={busy || !name.trim()}>Guardar</button>
            )}
          </form>
        ) : (
          <p className="settings-value">{family.name}</p>
        )}
      </div>

      <div className="settings-card">
        <h3>Miembros · {members.length}</h3>
        <div className="member-list">
          {members.map((member) => (
            <div className="member-row" key={member.userId}>
              <UserAvatar user={{ id: member.userId, name: member.name, email: member.email, avatarUrl: member.avatarUrl, color: member.color }} />
              <div className="member-copy">
                <strong>{member.name}{member.userId === user.id ? " (tú)" : ""}</strong>
                <small>{member.email}</small>
              </div>
              {isOwner && member.role !== "owner" ? (
                <select
                  value={member.role}
                  disabled={busy}
                  aria-label={`Rol de ${member.name}`}
                  onChange={(event) => void run(() => api(`${base}/members/${member.userId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ role: event.target.value })
                  }))}
                >
                  <option value="admin">{roleLabels.admin}</option>
                  <option value="member">{roleLabels.member}</option>
                </select>
              ) : (
                <span className={`role-badge role-${member.role}`}>{roleLabels[member.role]}</span>
              )}
              {canRemove(member) && (
                <button
                  className="icon-button"
                  disabled={busy}
                  aria-label={`Quitar a ${member.name}`}
                  onClick={() => void run(() => api(`${base}/members/${member.userId}`, { method: "DELETE" }))}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className="settings-card">
          <h3>Invitar</h3>
          <InviteManager
            endpoint={`/api/families/${family.id}/invitations`}
            targetName={family.name}
            roleOptions={isOwner
              ? [{ value: "member", label: "Miembro" }, { value: "admin", label: "Administrador" }]
              : [{ value: "member", label: "Miembro" }]}
            refreshOn={(reload) => onSyncEvent<{ familyId?: string }>(syncEvents.familyChanged, (data) => {
              if (data?.familyId === family.id) reload();
            })}
          />
        </div>
      )}

      {isOwner && others.length > 0 && (
        <div className="settings-card">
          <h3>Transferir la familia</h3>
          <p className="settings-hint">La otra persona pasa a ser dueña y tú quedas como administrador.</p>
          <div className="inline-form">
            <select value={transferTo} onChange={(event) => setTransferTo(event.target.value)} aria-label="Nuevo dueño">
              <option value="">Elegir miembro</option>
              {others.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
            </select>
            {confirming === "transfer" ? (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void run(() => api(`${base}/transfer`, { method: "POST", body: JSON.stringify({ userId: transferTo }) }))}
              >
                Confirmar
              </button>
            ) : (
              <button className="secondary-button" disabled={!transferTo} onClick={() => setConfirming("transfer")}>Transferir</button>
            )}
          </div>
        </div>
      )}

      <div className="settings-card list-danger-zone">
        {!isOwner && (
          confirming === "leave" ? (
            <div className="delete-confirm">
              <span>¿Salir de {family.name}? Dejarás de ver sus listas y su calendario.</span>
              <div>
                <button onClick={() => setConfirming(null)}>Cancelar</button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => void run(() => api(`${base}/members/me`, { method: "DELETE" }), () => navigate("/", { replace: true }))}
                >
                  Salir
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming("leave")}><DoorOpen size={17} /> Salir de la familia</button>
          )
        )}
        {isOwner && (
          confirming === "delete" ? (
            <div className="delete-confirm">
              <span>¿Eliminar {family.name}? Se borran sus listas, ítems y calendario para todos. No se puede deshacer.</span>
              <div>
                <button onClick={() => setConfirming(null)}>Cancelar</button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => void run(() => api(base, { method: "DELETE" }), () => navigate("/", { replace: true }))}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ) : (
            <button className="danger" onClick={() => setConfirming("delete")}><Trash2 size={17} /> Eliminar la familia</button>
          )
        )}
        {isOwner && others.length > 0 && (
          <p className="settings-hint">Para salir, primero transfiere la familia a otra persona.</p>
        )}
      </div>
    </section>
  );
}
