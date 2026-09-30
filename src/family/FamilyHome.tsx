import { useMemo, useState } from "react";
import { CalendarDays, Copy, Download, House, ListTodo, Share2, ShoppingBasket } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { CalendarSection } from "../calendar/CalendarSection";
import { AccountMenu } from "../components/AccountMenu";
import { useSortMode } from "../hooks/useSortMode";
import { ShoppingSection } from "../shopping/ShoppingSection";
import { TasksSection } from "../tasks/TasksSection";
import type { Family, OfflineMutation, User } from "../types";
import { LocationManager } from "./LocationManager";

type Section = "shopping" | "tasks" | "calendar";

const sectionPaths: Record<Section, string> = {
  shopping: "/",
  tasks: "/tareas",
  calendar: "/calendario"
};

function sectionFromPath(pathname: string): Section {
  if (pathname.startsWith(sectionPaths.tasks)) return "tasks";
  if (pathname.startsWith(sectionPaths.calendar)) return "calendar";
  return "shopping";
}

export function FamilyHome({
  family,
  user,
  connected,
  online,
  pendingCount,
  canInstall,
  onInstall,
  onMutate,
  onRefresh,
  onLeave,
  onLogout
}: {
  family: Family;
  user: User;
  connected: boolean;
  online: boolean;
  pendingCount: number;
  canInstall: boolean;
  onInstall: () => Promise<void>;
  onMutate: (family: Family, operation: OfflineMutation) => Promise<void>;
  onRefresh: () => Promise<void>;
  onLeave: () => void;
  onLogout: (everywhere?: boolean) => Promise<void>;
}) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const activeSection = sectionFromPath(pathname);
  const [shareLabel, setShareLabel] = useState("Compartir");
  const [managingLocations, setManagingLocations] = useState(false);
  const [sortMode, setSortMode] = useSortMode(`sort:shopping:${family.id}`);
  const [taskSortMode, setTaskSortMode] = useSortMode(`sort:tasks:${family.id}`);
  const totalPending = useMemo(() => family.items.filter((item) => !item.completed).length, [family.items]);
  const pendingTasks = useMemo(() => family.tasks.filter((task) => !task.completed).length, [family.tasks]);

  function openSection(section: Section) {
    navigate({ pathname: sectionPaths[section], search });
  }

  async function shareFamily() {
    const url = `${window.location.origin}/?familia=${family.id}`;
    const message = `Únete a ${family.name} en Casa. Código: ${family.id}`;
    if (navigator.share) {
      await navigator.share({ title: family.name, text: message, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(`${message}\n${url}`);
    setShareLabel("Copiado");
    window.setTimeout(() => setShareLabel("Compartir"), 1800);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="family-identity">
          <div className="small-brand-mark"><House size={21} /></div>
          <div>
            <span>Casa</span>
            <h1>{family.name}</h1>
          </div>
        </div>
        <div className="header-actions">
          {canInstall && (
            <button className="install-button" onClick={onInstall}>
              <Download size={17} />
              <span>Instalar</span>
            </button>
          )}
          <div className="member-avatars" aria-label="Miembros: Matías y Francisca">
            <span className="avatar-matias" title="Matías">M</span>
            <span className="avatar-francisca" title="Francisca">F</span>
          </div>
          <span className={`connection-status ${connected && online && pendingCount === 0 ? "online" : ""} ${!online || pendingCount ? "attention" : ""}`}>
            <i />
            {!online
              ? `Sin conexión${pendingCount ? ` · ${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}` : ""}`
              : pendingCount
                ? `Sincronizando · ${pendingCount}`
                : connected ? "Sincronizado" : "Reconectando"}
          </span>
          <button className="share-button" onClick={shareFamily}>
            {shareLabel === "Copiado" ? <Copy size={17} /> : <Share2 size={17} />}
            <span>{shareLabel}</span>
          </button>
          <AccountMenu user={user} onLogout={onLogout} onLeaveFamily={onLeave} />
        </div>
      </header>

      <div className="dashboard">
        <aside className="sidebar">
          <button
            className={`nav-item ${activeSection === "shopping" ? "active" : ""}`}
            onClick={() => openSection("shopping")}
          >
            <ShoppingBasket size={20} />
            <span>Lista de compras</span>
            {totalPending > 0 && <b>{totalPending}</b>}
          </button>
          <button
            className={`nav-item ${activeSection === "tasks" ? "active" : ""}`}
            onClick={() => openSection("tasks")}
          >
            <ListTodo size={20} />
            <span>Por hacer</span>
            {pendingTasks > 0 && <b>{pendingTasks}</b>}
          </button>
          <button
            className={`nav-item ${activeSection === "calendar" ? "active" : ""}`}
            onClick={() => openSection("calendar")}
          >
            <CalendarDays size={20} />
            <span>Calendario</span>
          </button>
          <div className="sidebar-bottom">
            <div className="family-code">
              <span>Código familiar</span>
              <strong>{family.id}</strong>
            </div>
            <button className="leave-button" onClick={onLeave}>Salir de esta familia</button>
          </div>
        </aside>

        {/* Compras queda montada al cambiar de sección para no perder lo que se estaba escribiendo. */}
        <ShoppingSection
          family={family}
          hidden={activeSection !== "shopping"}
          sortMode={sortMode}
          onSortChange={setSortMode}
          onMutate={onMutate}
          onManageLocations={() => setManagingLocations(true)}
        />
        {activeSection === "tasks" && (
          <TasksSection
            family={family}
            sortMode={taskSortMode}
            onSortChange={setTaskSortMode}
            onMutate={onMutate}
            onManageLocations={() => setManagingLocations(true)}
          />
        )}
        {activeSection === "calendar" && <CalendarSection family={family} onMutate={onMutate} />}
      </div>
      {managingLocations && (
        <LocationManager
          family={family}
          sortMode={activeSection === "tasks" ? taskSortMode : sortMode}
          onSortChange={activeSection === "tasks" ? setTaskSortMode : setSortMode}
          onChanged={onRefresh}
          onClose={() => setManagingLocations(false)}
        />
      )}
    </main>
  );
}
