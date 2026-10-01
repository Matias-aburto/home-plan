import { useState } from "react";
import { DoorOpen, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useSession } from "../auth/AuthProvider";
import { UserAvatar } from "../components/AccountMenu";
import { useMe } from "../data/MeProvider";
import { onSyncEvent, syncEvents } from "../data/sync";
import { InviteManager } from "../invitations/InviteManager";
import type { ListDetail, SharedMember } from "../types";

const permissionLabels: Record<SharedMember["permission"], string> = { editor: "Puede editar", viewer: "Solo lectura" };

// Personas con quienes está compartida la lista. Quien la administra invita y cambia permisos;
// quien la tiene compartida puede dejar de verla. Requiere conexión.
export function ShareListModal({ detail, onChanged, onClose }: {
  detail: ListDetail;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { list } = detail;
  const sharedWith = detail.sharedWith ?? [];
  const { user } = useSession();
  const me = useMe();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwner = list.access === "owner";
  const iAmShared = sharedWith.some(({ userId }) => userId === user?.id);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (requestError) {
      setError(navigator.onLine ? (requestError as Error).message : "Necesitas conexión para esto.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await api(`/api/lists/${list.id}/members/me`, { method: "DELETE" });
      await me.refresh();
      onClose();
      navigate("/", { replace: true });
    } catch (requestError) {
      setError((requestError as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="locations-modal list-settings-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <div className="eyebrow">Compartir</div>
            <h2>{list.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </header>
        <p>
          {list.familyId
            ? "Todo el grupo ya ve esta lista. Aquí puedes sumar a personas de fuera."
            : "Comparte esta lista con quien quieras, sin que tenga que ser de tus grupos."}
        </p>

        {isOwner && (
          <InviteManager
            endpoint={`/api/lists/${list.id}/invitations`}
            targetName={list.name}
            roleOptions={[{ value: "editor", label: "Puede editar" }, { value: "viewer", label: "Solo lectura" }]}
            roleField="permission"
            refreshOn={(reload) => onSyncEvent<{ listId?: string }>(syncEvents.meChanged, (data) => {
              if (data?.listId === list.id) reload();
            })}
          />
        )}

        <h3 className="list-settings-heading shared-heading">Con acceso · {sharedWith.length}</h3>
        {sharedWith.length === 0 ? (
          <p className="settings-hint">Todavía no la compartiste con nadie.</p>
        ) : (
          <div className="member-list">
            {sharedWith.map((member) => (
              <div className="member-row" key={member.userId}>
                <UserAvatar user={{ id: member.userId, name: member.name, email: member.email, avatarUrl: member.avatarUrl, color: member.color }} />
                <div className="member-copy">
                  <strong>{member.name}{member.userId === user?.id ? " (tú)" : ""}</strong>
                  <small>{member.email}</small>
                </div>
                {isOwner ? (
                  <>
                    <select
                      value={member.permission}
                      disabled={busy}
                      aria-label={`Permiso de ${member.name}`}
                      onChange={(event) => void run(() => api(`/api/lists/${list.id}/members/${member.userId}`, {
                        method: "PATCH",
                        body: JSON.stringify({ permission: event.target.value })
                      }))}
                    >
                      <option value="editor">{permissionLabels.editor}</option>
                      <option value="viewer">{permissionLabels.viewer}</option>
                    </select>
                    <button
                      className="icon-button"
                      disabled={busy}
                      aria-label={`Quitar a ${member.name}`}
                      onClick={() => void run(() => api(`/api/lists/${list.id}/members/${member.userId}`, { method: "DELETE" }))}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <span className="role-badge">{permissionLabels[member.permission]}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {error && <div className="form-error">{error}</div>}

        {iAmShared && !isOwner && (
          <div className="list-danger-zone">
            <button onClick={() => void leave()} disabled={busy}><DoorOpen size={17} /> Dejar de ver esta lista</button>
          </div>
        )}
      </section>
    </div>
  );
}
