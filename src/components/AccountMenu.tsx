import { useState } from "react";
import { DoorOpen, LogOut, MonitorSmartphone, X } from "lucide-react";
import type { User } from "../types";

export function UserAvatar({ user, size = "normal" }: { user: User; size?: "normal" | "large" }) {
  return (
    <span className={`user-avatar avatar-color-${user.color} ${size === "large" ? "large" : ""}`} aria-hidden="true">
      {user.avatarUrl
        ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
        : user.name.trim().charAt(0).toLocaleUpperCase("es-CL")}
    </span>
  );
}

export function AccountMenu({
  user,
  onLogout,
  onLeaveFamily
}: {
  user: User;
  onLogout: (everywhere?: boolean) => Promise<void>;
  onLeaveFamily?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout(everywhere: boolean) {
    setBusy(true);
    try {
      await onLogout(everywhere);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="account-button" onClick={() => setOpen(true)} aria-label={`Cuenta de ${user.name}`}>
        <UserAvatar user={user} />
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
          <section className="account-modal animate-in" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <UserAvatar user={user} size="large" />
              <div>
                <h2>{user.name}</h2>
                <span>{user.email}</span>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Cerrar"><X size={20} /></button>
            </header>
            <div className="account-actions">
              {onLeaveFamily && (
                <button onClick={() => {
                  setOpen(false);
                  onLeaveFamily();
                }}>
                  <DoorOpen size={18} /> Salir de esta familia
                </button>
              )}
              <button onClick={() => logout(false)} disabled={busy}>
                <LogOut size={18} /> Cerrar sesión
              </button>
              <button onClick={() => logout(true)} disabled={busy}>
                <MonitorSmartphone size={18} /> Cerrar sesión en todos los dispositivos
              </button>
            </div>
            <p>Al cerrar sesión se borran de este dispositivo los datos guardados y los cambios sin sincronizar.</p>
          </section>
        </div>
      )}
    </>
  );
}
