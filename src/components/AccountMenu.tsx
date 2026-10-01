import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, LogOut, MonitorSmartphone, X } from "lucide-react";
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
  onInstall
}: {
  user: User;
  onLogout: (everywhere?: boolean) => Promise<void>;
  // Solo si la app se puede instalar en este dispositivo y todavía no lo está.
  onInstall?: () => Promise<void>;
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
      {/* En <body>: dentro del header (que usa backdrop-filter) el fondo fijo quedaría limitado al header. */}
      {open && createPortal(
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
              {onInstall && (
                <button onClick={() => {
                  setOpen(false);
                  void onInstall();
                }}>
                  <Download size={18} /> Instalar app
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
        </div>,
        document.body
      )}
    </>
  );
}
