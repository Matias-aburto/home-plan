import { useEffect, useState } from "react";
import { Copy, Download, House, Menu, Plus, Share2, X } from "lucide-react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { AccountMenu } from "../components/AccountMenu";
import { useConnection } from "../data/ConnectionProvider";
import { useLegacyFamily } from "../family/LegacyFamilyProvider";
import { NewListModal } from "../lists/NewListModal";
import type { User } from "../types";
import { NavContent } from "./NavContent";
import { useNavigation } from "./navigation";

export const lastPathKey = "casa:lastPath";

export function AppShell({
  user,
  canInstall,
  onInstall,
  onLogout
}: {
  user: User;
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onLogout: (everywhere?: boolean) => Promise<void>;
}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { online, connected, pendingCount } = useConnection();
  const legacy = useLegacyFamily();
  const { space, activeKey, personal, familyEntries } = useNavigation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const [shareLabel, setShareLabel] = useState("Compartir");
  const family = space === "family" ? legacy.family : null;

  // Al volver a abrir la app se retoma la última lista o sección.
  useEffect(() => {
    if (pathname.startsWith("/listas/") || pathname.startsWith("/familia")) localStorage.setItem(lastPathKey, pathname);
  }, [pathname]);

  async function shareFamily() {
    if (!family) return;
    const url = `${window.location.origin}/familia?familia=${family.id}`;
    const message = `Únete a ${family.name} en Casa. Código: ${family.id}`;
    if (navigator.share) {
      await navigator.share({ title: family.name, text: message, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(`${message}\n${url}`);
    setShareLabel("Copiado");
    window.setTimeout(() => setShareLabel("Compartir"), 1800);
  }

  function leaveFamily() {
    legacy.leave();
    navigate("/", { replace: true });
  }

  // En móvil la barra inferior muestra las primeras entradas del espacio actual y el menú completo.
  const barEntries = (space === "family" ? familyEntries : personal).slice(0, 3);

  return (
    <main className="app-shell">
      <header className="app-header">
        <Link className="family-identity" to="/">
          <div className="small-brand-mark"><House size={21} /></div>
          <div>
            <span>Casa</span>
            <h1>{family ? family.name : "Mis listas"}</h1>
          </div>
        </Link>
        <div className="header-actions">
          {canInstall && (
            <button className="install-button" onClick={onInstall}>
              <Download size={17} />
              <span>Instalar</span>
            </button>
          )}
          {family && (
            <div className="member-avatars" aria-label="Miembros: Matías y Francisca">
              <span className="avatar-matias" title="Matías">M</span>
              <span className="avatar-francisca" title="Francisca">F</span>
            </div>
          )}
          <span className={`connection-status ${connected && online && pendingCount === 0 ? "online" : ""} ${!online || pendingCount ? "attention" : ""}`}>
            <i />
            {!online
              ? `Sin conexión${pendingCount ? ` · ${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}` : ""}`
              : pendingCount
                ? `Sincronizando · ${pendingCount}`
                : connected ? "Sincronizado" : "Reconectando"}
          </span>
          {family && (
            <button className="share-button" onClick={shareFamily}>
              {shareLabel === "Copiado" ? <Copy size={17} /> : <Share2 size={17} />}
              <span>{shareLabel}</span>
            </button>
          )}
          <AccountMenu user={user} onLogout={onLogout} onLeaveFamily={legacy.family ? leaveFamily : undefined} />
        </div>
      </header>

      <div className="dashboard">
        <aside className="sidebar">
          <NavContent onNewList={() => setCreatingList(true)} />
        </aside>
        <Outlet />
      </div>

      <nav className="mobile-nav" aria-label="Navegación">
        {barEntries.map((entry) => (
          <Link
            key={entry.key}
            className={`nav-item ${activeKey === entry.key ? "active" : ""}`}
            to={entry.to}
            aria-current={activeKey === entry.key ? "page" : undefined}
          >
            {entry.icon}
            <span>{entry.label}</span>
            {Boolean(entry.badge) && <b>{entry.badge}</b>}
          </Link>
        ))}
        {space === "personal" && barEntries.length < 3 && (
          <button className="nav-item" onClick={() => setCreatingList(true)}>
            <Plus size={20} />
            <span>Nueva lista</span>
          </button>
        )}
        <button className="nav-item" onClick={() => setDrawerOpen(true)}>
          <Menu size={20} />
          <span>Menú</span>
        </button>
      </nav>

      {drawerOpen && (
        <div className="nav-drawer-backdrop" onMouseDown={() => setDrawerOpen(false)}>
          <section className="nav-drawer animate-in" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Menú</h2>
              <button onClick={() => setDrawerOpen(false)} aria-label="Cerrar"><X size={20} /></button>
            </header>
            <NavContent
              onNavigate={() => setDrawerOpen(false)}
              onNewList={() => {
                setDrawerOpen(false);
                setCreatingList(true);
              }}
            />
          </section>
        </div>
      )}
      {creatingList && <NewListModal onClose={() => setCreatingList(false)} />}
    </main>
  );
}
