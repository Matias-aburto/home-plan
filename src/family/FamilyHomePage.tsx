import { useState } from "react";
import { CircleAlert, Settings2, UserPlus } from "lucide-react";
import { Link, useParams } from "react-router";
import { UpcomingEvents } from "../calendar/UpcomingEvents";
import { CreateModal } from "../create/CreateModal";
import { SpaceCards } from "../create/SpaceCards";
import { useMe } from "../data/MeProvider";

// Portada de un grupo: sus listas, sus próximos eventos y los ajustes.
export function FamilyHomePage() {
  const { familyId = "" } = useParams();
  const { families, lists, loaded } = useMe();
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
  const empty = familyLists.length === 0;
  const canInvite = family.role === "owner" || family.role === "admin";
  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>{family.name}</h2></div>
        <span>{family.memberCount} {family.memberCount === 1 ? "miembro" : "miembros"}</span>
      </div>
      {empty && (
        <p className="space-intro">
          Todavía no hay listas en el grupo. Lo que crees aquí lo ven y editan todos sus miembros.
        </p>
      )}
      <SpaceCards lists={familyLists} onCreate={() => setCreating(true)} />
      <UpcomingEvents familyId={family.id} />
      <div className="space-links">
        {canInvite && family.memberCount === 1 && (
          <Link className="text-button family-settings-link" to={`/grupos/${family.id}/ajustes`}>
            <UserPlus size={15} /> Invitar personas
          </Link>
        )}
        <Link className="text-button family-settings-link" to={`/grupos/${family.id}/ajustes`}>
          <Settings2 size={15} /> Ajustes del grupo
        </Link>
      </div>
      {creating && <CreateModal familyId={family.id} onClose={() => setCreating(false)} />}
    </section>
  );
}
