import { useState } from "react";
import { ChevronDown, Plus, Settings2, Users } from "lucide-react";
import { Link } from "react-router";
import { SortableList } from "../components/SortableList";
import { useMe } from "../data/MeProvider";
import { useNavigation, type NavEntry, type NavSpace } from "./navigation";

function EntryLink({ entry, active, className = "", onNavigate }: {
  entry: NavEntry;
  active: boolean;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link className={`nav-item ${className} ${active ? "active" : ""}`} to={entry.to} onClick={onNavigate} aria-current={active ? "page" : undefined}>
      {entry.icon}
      <span>{entry.label}</span>
      {Boolean(entry.badge) && <b>{entry.badge}</b>}
    </Link>
  );
}

function SpaceSection({
  space,
  activeKey,
  onNavigate,
  onCreate
}: {
  space: NavSpace;
  activeKey: string | null;
  onNavigate?: () => void;
  onCreate: (familyId: string | null) => void;
}) {
  const { reorderLists } = useMe();
  const [showArchived, setShowArchived] = useState(false);
  const empty = space.lists.length === 0;

  return (
    <div className="nav-section">
      <div className="nav-section-title">
        <Link to={space.to} onClick={onNavigate}>{space.title}</Link>
        <span className="nav-section-actions">
          {space.settingsTo && (
            <Link
              className={`nav-section-action ${activeKey === `settings:${space.key}` ? "active" : ""}`}
              to={space.settingsTo}
              onClick={onNavigate}
              aria-label={`Ajustes de ${space.title}`}
              title="Ajustes del grupo"
            >
              <Settings2 size={15} />
            </Link>
          )}
          {space.canCreate && (
            <button className="nav-section-action" onClick={() => onCreate(space.familyId)} aria-label={`Nueva lista en ${space.title}`} title="Nueva lista">
              <Plus size={16} />
            </button>
          )}
        </span>
      </div>
      {empty && space.canCreate ? (
        <button className="nav-item nav-new-list" onClick={() => onCreate(space.familyId)}>
          <span className="nav-icon"><Plus size={17} /></span>
          <span>Crear una lista</span>
        </button>
      ) : space.lists.length > 0 && (
        <SortableList
          items={space.lists.map((entry) => ({ ...entry, id: entry.key }))}
          onReorder={(ids) => void reorderLists(ids)}
          renderItem={(entry, handle) => (
            <div className="nav-row">
              <EntryLink entry={entry} active={activeKey === entry.key} onNavigate={onNavigate} />
              {handle}
            </div>
          )}
        />
      )}
      {space.archived.length > 0 && (
        <>
          <button className={`nav-archived-toggle ${showArchived ? "open" : ""}`} onClick={() => setShowArchived(!showArchived)}>
            <ChevronDown size={14} /> Archivados · {space.archived.length}
          </button>
          {showArchived && space.archived.map((entry) => (
            <EntryLink
              key={entry.key}
              entry={{ ...entry, badge: undefined }}
              className="archived"
              active={activeKey === entry.key}
              onNavigate={onNavigate}
            />
          ))}
        </>
      )}
    </div>
  );
}

// Menú completo con cada espacio. Se usa en la barra lateral y en el cajón móvil.
export function NavContent({ onNavigate, onCreate }: { onNavigate?: () => void; onCreate: (familyId: string | null) => void }) {
  const { spaces, activeKey, calendar } = useNavigation();
  return (
    <>
      <div className="nav-scroll">
        <div className="nav-section nav-agenda">
          <EntryLink entry={calendar} active={activeKey === "calendar"} onNavigate={onNavigate} />
        </div>
        {spaces.map((space) => (
          <SpaceSection key={space.key} space={space} activeKey={activeKey} onNavigate={onNavigate} onCreate={onCreate} />
        ))}
      </div>
      {/* Al pie del menú: crear un grupo no es parte del último espacio. */}
      <div className="nav-section sidebar-bottom">
        <Link className="nav-item nav-family-link" to="/grupos/nuevo" onClick={onNavigate}>
          <span className="nav-icon"><Users size={17} /></span>
          <span>Crear grupo</span>
        </Link>
      </div>
    </>
  );
}
