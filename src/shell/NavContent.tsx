import { useState } from "react";
import { ChevronDown, Plus, Users } from "lucide-react";
import { Link } from "react-router";
import { SortableList } from "../components/SortableList";
import { useMe } from "../data/MeProvider";
import { ListIcon } from "../lists/listStyle";
import { useNavigation, type NavEntry, type NavSpace } from "./navigation";

function EntryLink({ entry, active, onNavigate }: { entry: NavEntry; active: boolean; onNavigate?: () => void }) {
  return (
    <Link className={`nav-item ${active ? "active" : ""}`} to={entry.to} onClick={onNavigate} aria-current={active ? "page" : undefined}>
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
  onNewList
}: {
  space: NavSpace;
  activeKey: string | null;
  onNavigate?: () => void;
  onNewList: (familyId: string | null) => void;
}) {
  const { reorderLists } = useMe();
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="nav-section">
      <div className="nav-section-title">
        <Link to={space.to} onClick={onNavigate}>{space.title}</Link>
        {space.canCreate && (
          <button className="nav-section-action" onClick={() => onNewList(space.familyId)} aria-label={`Nueva lista en ${space.title}`}>
            <Plus size={16} />
          </button>
        )}
      </div>
      {space.lists.length === 0 && space.key === "personal" ? (
        <button className="nav-item nav-new-list" onClick={() => onNewList(null)}>
          <span className="nav-icon"><Plus size={17} /></span>
          <span>Crear mi primera lista</span>
        </button>
      ) : (
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
            <ChevronDown size={14} /> Archivadas · {space.archived.length}
          </button>
          {showArchived && space.archived.map((list) => (
            <Link
              key={list.id}
              className={`nav-item archived ${activeKey === list.id ? "active" : ""}`}
              to={`/listas/${list.id}`}
              onClick={onNavigate}
            >
              <ListIcon icon={list.icon} color={list.color} size={16} />
              <span>{list.name}</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

// Menú completo con cada espacio. Se usa en la barra lateral y en el cajón móvil.
export function NavContent({ onNavigate, onNewList }: { onNavigate?: () => void; onNewList: (familyId: string | null) => void }) {
  const { spaces, activeKey, families } = useNavigation();
  return (
    <>
      {spaces.map((space) => (
        <SpaceSection key={space.key} space={space} activeKey={activeKey} onNavigate={onNavigate} onNewList={onNewList} />
      ))}
      <div className="nav-section">
        <Link className="nav-item nav-family-link" to="/familias/nueva" onClick={onNavigate}>
          <span className="nav-icon"><Users size={17} /></span>
          <span>{families.length > 0 ? "Crear otra familia" : "Crear una familia"}</span>
        </Link>
      </div>
    </>
  );
}
