import { useState } from "react";
import { ChevronDown, Plus, Users } from "lucide-react";
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
  const empty = space.lists.length === 0 && !space.calendar;

  return (
    <div className="nav-section">
      <div className="nav-section-title">
        <Link to={space.to} onClick={onNavigate}>{space.title}</Link>
        {space.canCreate && (
          <button className="nav-section-action" onClick={() => onCreate(space.familyId)} aria-label={`Crear en ${space.title}`}>
            <Plus size={16} />
          </button>
        )}
      </div>
      {space.calendar && (
        <EntryLink entry={space.calendar} active={activeKey === space.calendar.key} onNavigate={onNavigate} />
      )}
      {empty && space.canCreate ? (
        <button className="nav-item nav-new-list" onClick={() => onCreate(space.familyId)}>
          <span className="nav-icon"><Plus size={17} /></span>
          <span>Crear nuevo</span>
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
      {space.links.map((entry) => (
        <EntryLink key={entry.key} entry={entry} active={activeKey === entry.key} onNavigate={onNavigate} />
      ))}
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
  const { spaces, activeKey, families, agenda } = useNavigation();
  return (
    <>
      {agenda && (
        <div className="nav-section nav-agenda">
          <EntryLink entry={agenda} active={activeKey === "agenda"} onNavigate={onNavigate} />
        </div>
      )}
      {spaces.map((space) => (
        <SpaceSection key={space.key} space={space} activeKey={activeKey} onNavigate={onNavigate} onCreate={onCreate} />
      ))}
      <div className="nav-section">
        <Link className="nav-item nav-family-link" to="/grupos/nuevo" onClick={onNavigate}>
          <span className="nav-icon"><Users size={17} /></span>
          <span>{families.length > 0 ? "Crear otro grupo" : "Crear un grupo"}</span>
        </Link>
      </div>
    </>
  );
}
