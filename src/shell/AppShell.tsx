import { useEffect, useState } from "react";
import { Bell, Menu, Plus, X } from "lucide-react";
import { appName, BrandIcon } from "../lib/brand";
import { Link, Outlet, useLocation } from "react-router";
import { AccountMenu, UserAvatar } from "../components/AccountMenu";
import { useConnection } from "../data/ConnectionProvider";
import { useMe } from "../data/MeProvider";
import { Loading } from "../components/Loading";
import { useFamilyDetail } from "../family/useFamilyDetail";
import { CreateModal } from "../create/CreateModal";
import type { User } from "../types";
import { InstallPrompt } from "./InstallPrompt";
import { NavContent } from "./NavContent";
import { calendarPin, listPin, maxPins, usePins } from "./pins";
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
  const { invitations, loaded, lists } = useMe();
  const { activeSpace, activeKey, home, calendar, pinEntry, onCalendar, onHome } = useNavigation();
  const { pins } = usePins();
  const { detail: familyDetail } = useFamilyDetail(activeSpace.familyId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // undefined: cerrado; null: crear en lo personal; string: crear en ese grupo.
  const [createIn, setCreateIn] = useState<string | null | undefined>(undefined);

  // Al volver a abrir la app se retoma la última lista o sección.
  useEffect(() => {
    if (/^\/(listas\/|grupos\/|calendario$|inicio$)/.test(pathname)) localStorage.setItem(lastPathKey, pathname);
  }, [pathname]);

  // En móvil la barra inferior muestra las primeras entradas del espacio actual y el menú completo.
  // Barra del celular: Inicio, lo fijado (máximo dos) y Menú. Si nunca se fijó nada, se sugiere
  // el calendario y la primera lista.
  const firstList = lists.find((list) => !list.archivedAt);
  const pinned = (pins ?? [calendarPin, ...(firstList ? [listPin(firstList.id)] : [])])
    .map(pinEntry)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .slice(0, maxPins);
  const barEntries = [home, ...pinned];
  // Los demás miembros del grupo: el usuario ya aparece en su botón de cuenta.
  const members = (familyDetail?.members ?? []).filter(({ userId }) => userId !== user.id);
  if (!loaded) return <Loading />;

  return (
    <main className="app-shell">
      <header className="app-header">
        <Link className="family-identity" to="/inicio">
          <div className="small-brand-mark"><BrandIcon /></div>
          <div>
            <span>{appName}</span>
            <h1>{onCalendar ? "Calendario" : onHome ? "Inicio" : activeSpace.title}</h1>
          </div>
        </Link>
        <div className="header-actions">
          <SyncStatus />
          {!onCalendar && !onHome && activeSpace.familyId && members.length > 0 && (
            <Link
              className="member-avatars"
              to={`/grupos/${activeSpace.familyId}/ajustes`}
              aria-label={`Otros miembros: ${members.map(({ name }) => name).join(", ")}`}
              title={members.map(({ name }) => name).join(", ")}
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
          <NavContent onCreate={setCreateIn} />
        </aside>
        <div className="dashboard-main">
          <Outlet />
        </div>
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
              onCreate={(familyId) => {
                setDrawerOpen(false);
                setCreateIn(familyId);
              }}
            />
          </section>
        </div>
      )}
      {createIn !== undefined && (
        <CreateModal familyId={createIn} onClose={() => setCreateIn(undefined)} />
      )}
    </main>
  );
}
