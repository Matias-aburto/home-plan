import { useEffect, useState } from "react";
import { Bell, House, Menu, Plus, X } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";
import { AccountMenu, UserAvatar } from "../components/AccountMenu";
import { useConnection } from "../data/ConnectionProvider";
import { useMe } from "../data/MeProvider";
import { Loading } from "../components/Loading";
import { useFamilyDetail } from "../family/useFamilyDetail";
import { NewListModal } from "../lists/NewListModal";
import type { User } from "../types";
import { InstallPrompt } from "./InstallPrompt";
import { NavContent } from "./NavContent";
import { SyncStatus } from "./SyncStatus";
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
  const { notice, dismissNotice } = useConnection();
  const { invitations, loaded } = useMe();
  const { activeSpace, activeKey } = useNavigation();
  const { detail: familyDetail } = useFamilyDetail(activeSpace.familyId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // undefined: cerrado; null: lista personal; string: lista de esa familia.
  const [newListFamily, setNewListFamily] = useState<string | null | undefined>(undefined);

  // Al volver a abrir la app se retoma la última lista o sección.
  useEffect(() => {
    if (pathname.startsWith("/listas/") || pathname.startsWith("/familias/")) localStorage.setItem(lastPathKey, pathname);
  }, [pathname]);

  // En móvil la barra inferior muestra las primeras entradas del espacio actual y el menú completo.
  const barEntries = [...activeSpace.lists, ...activeSpace.links.slice(0, 1)].slice(0, 3);
  const members = familyDetail?.members ?? [];
  if (!loaded) return <Loading />;

  return (
    <main className="app-shell">
      <header className="app-header">
        <Link className="family-identity" to={activeSpace.to}>
          <div className="small-brand-mark"><House size={21} /></div>
          <div>
            <span>Casa</span>
            <h1>{activeSpace.title}</h1>
          </div>
        </Link>
        <div className="header-actions">
          <SyncStatus />
          {activeSpace.familyId && members.length > 0 && (
            <Link
              className="member-avatars"
              to={`/familias/${activeSpace.familyId}/ajustes`}
              aria-label={`Miembros: ${members.map(({ name }) => name).join(", ")}`}
            >
              {members.slice(0, 3).map((member) => (
                <UserAvatar
                  key={member.userId}
                  user={{ id: member.userId, name: member.name, email: member.email, avatarUrl: member.avatarUrl, color: member.color }}
                />
              ))}
              {members.length > 3 && <span className="more-members">+{members.length - 3}</span>}
            </Link>
          )}
          {invitations.length > 0 && (
            <Link className="invitations-button" to="/invitaciones" aria-label={`${invitations.length} ${invitations.length === 1 ? "invitación pendiente" : "invitaciones pendientes"}`}>
              <Bell size={18} />
              <b>{invitations.length}</b>
            </Link>
          )}
          <AccountMenu user={user} onLogout={onLogout} onInstall={canInstall ? onInstall : undefined} />
        </div>
      </header>

      <InstallPrompt canInstall={canInstall} onInstall={onInstall} />

      {notice && (
        <div className="sync-notice" role="status">
          <span>{notice}</span>
          <button onClick={dismissNotice} aria-label="Cerrar aviso"><X size={16} /></button>
        </div>
      )}

      <div className="dashboard">
        <aside className="sidebar">
          <NavContent onNewList={setNewListFamily} />
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
        {barEntries.length < 3 && activeSpace.canCreate && (
          <button className="nav-item" onClick={() => setNewListFamily(activeSpace.familyId)}>
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
              onNewList={(familyId) => {
                setDrawerOpen(false);
                setNewListFamily(familyId);
              }}
            />
          </section>
        </div>
      )}
      {newListFamily !== undefined && (
        <NewListModal familyId={newListFamily} onClose={() => setNewListFamily(undefined)} />
      )}
    </main>
  );
}
