import { useState } from "react";
import { ChevronDown, Plus, Users } from "lucide-react";
import { Link } from "react-router";
import { SortableList } from "../components/SortableList";
import { useMe } from "../data/MeProvider";
import { ListIcon } from "../lists/listStyle";
import { useNavigation, type NavEntry } from "./navigation";

function EntryLink({ entry, active, onNavigate }: { entry: NavEntry; active: boolean; onNavigate?: () => void }) {
  return (
    <Link className={`nav-item ${active ? "active" : ""}`} to={entry.to} onClick={onNavigate} aria-current={active ? "page" : undefined}>
      {entry.icon}
      <span>{entry.label}</span>
      {Boolean(entry.badge) && <b>{entry.badge}</b>}
    </Link>
  );
}

// Menú completo: listas personales (reordenables) y la familia. Se usa en la barra lateral y en el cajón móvil.
export function NavContent({ onNavigate, onNewList }: { onNavigate?: () => void; onNewList: () => void }) {
  const { activeKey, personal, archivedLists, familyEntries, family } = useNavigation();
  const { reorderLists } = useMe();
  const [showArchived, setShowArchived] = useState(false);

  return (
    <>
      <div className="nav-section">
        <div className="nav-section-title">
          <Link to="/personal" onClick={onNavigate}>Mis listas</Link>
          <button className="nav-section-action" onClick={onNewList} aria-label="Nueva lista">
            <Plus size={16} />
          </button>
        </div>
        {personal.length === 0 ? (
          <button className="nav-item nav-new-list" onClick={onNewList}>
            <Plus size={18} />
            <span>Crear mi primera lista</span>
          </button>
        ) : (
          <SortableList
            items={personal.map((entry) => ({ ...entry, id: entry.key }))}
            onReorder={(ids) => void reorderLists(ids)}
            renderItem={(entry, handle) => (
              <div className="nav-row">
                <EntryLink entry={entry} active={activeKey === entry.key} onNavigate={onNavigate} />
                {handle}
              </div>
            )}
          />
        )}
        {archivedLists.length > 0 && (
          <>
            <button className={`nav-archived-toggle ${showArchived ? "open" : ""}`} onClick={() => setShowArchived(!showArchived)}>
              <ChevronDown size={14} /> Archivadas · {archivedLists.length}
            </button>
            {showArchived && archivedLists.map((list) => (
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

      <div className="nav-section">
        <div className="nav-section-title">
          <span>{family ? family.name : "Familia"}</span>
        </div>
        {family ? (
          familyEntries.map((entry) => (
            <EntryLink key={entry.key} entry={entry} active={activeKey === entry.key} onNavigate={onNavigate} />
          ))
        ) : (
          <Link className="nav-item" to="/familia/unirse" onClick={onNavigate}>
            <Users size={18} />
            <span>Crear o unirme a una familia</span>
          </Link>
        )}
      </div>

      {family && (
        <div className="sidebar-bottom">
          <div className="family-code">
            <span>Código familiar</span>
            <strong>{family.id}</strong>
          </div>
        </div>
      )}
    </>
  );
}
