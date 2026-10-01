import { useState } from "react";
import { CircleAlert, Plus, Settings2, Users } from "lucide-react";
import { Link, useParams } from "react-router";
import { CreateModal } from "../create/CreateModal";
import { SpaceCards } from "../create/SpaceCards";
import { useMe } from "../data/MeProvider";

// Portada de un grupo: sus listas, sus calendarios y los ajustes.
export function FamilyHomePage() {
  const { familyId = "" } = useParams();
  const { families, lists, calendars, loaded } = useMe();
  const [creating, setCreating] = useState(false);
  const family = families.find(({ id }) => id === familyId);

  if (loaded && !family) {
    return (
      <section className="content">
        <div className="empty-state animate-in">
          <div><CircleAlert size={28} /></div>
          <h3>No encontramos este grupo</h3>
          <p>Puede que lo hayan eliminado o que ya no seas parte de él.</p>
          <Link className="secondary-button empty-state-action" to="/">Volver al inicio</Link>
        </div>
      </section>
    );
  }
  if (!family) return null;

  const familyLists = lists.filter((list) => list.familyId === family.id && !list.archivedAt);
  const familyCalendars = calendars.filter((calendar) => calendar.familyId === family.id && !calendar.archivedAt);
  const empty = familyLists.length === 0 && familyCalendars.length === 0;
  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>{family.name}</h2></div>
        <span>{family.memberCount} {family.memberCount === 1 ? "miembro" : "miembros"}</span>
      </div>
      {empty ? (
        <div className="empty-state welcome-empty animate-in">
          <div><Users size={28} /></div>
          <h3>Todavía no hay nada en {family.name}</h3>
          <p>Crea una lista o un calendario para el grupo. Todos los miembros lo verán y podrán editarlo.</p>
          <div className="empty-state-actions">
            <button className="primary-button" onClick={() => setCreating(true)}>
              <Plus size={18} /> Nuevo
            </button>
            {(family.role === "owner" || family.role === "admin") && (
              <Link className="secondary-button" to={`/grupos/${family.id}/ajustes`}>
                <Users size={18} /> Invitar personas
              </Link>
            )}
          </div>
        </div>
      ) : (
        <SpaceCards lists={familyLists} calendars={familyCalendars} onCreate={() => setCreating(true)} />
      )}
      <Link className="text-button family-settings-link" to={`/grupos/${family.id}/ajustes`}>
        <Settings2 size={15} /> Ajustes del grupo
      </Link>
      {creating && <CreateModal familyId={family.id} onClose={() => setCreating(false)} />}
    </section>
  );
}
