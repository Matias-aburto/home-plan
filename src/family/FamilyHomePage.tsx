import { useState } from "react";
import { CalendarDays, CircleAlert, Plus, Settings2 } from "lucide-react";
import { Link, useParams } from "react-router";
import { useMe } from "../data/MeProvider";
import { NewListModal } from "../lists/NewListModal";
import { ListIcon, listKinds } from "../lists/listStyle";

// Portada de una familia: sus listas, el calendario y los ajustes.
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
  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>{family.name}</h2></div>
        <span>{family.memberCount} {family.memberCount === 1 ? "miembro" : "miembros"}</span>
      </div>
      <div className="list-cards">
        {familyLists.map((list) => (
          <Link key={list.id} className="list-card" to={`/listas/${list.id}`}>
            <ListIcon icon={list.icon} color={list.color} size={20} />
            <strong>{list.name}</strong>
            <small>
              {listKinds.find((option) => option.kind === list.kind)?.label}
              {" · "}
              {list.pendingCount ? `${list.pendingCount} pendiente${list.pendingCount === 1 ? "" : "s"}` : "Al día"}
            </small>
          </Link>
        ))}
        <Link className="list-card" to={`/grupos/${family.id}/calendario`}>
          <span className="list-icon list-color-neutral" aria-hidden="true"><CalendarDays size={20} /></span>
          <strong>Calendario</strong>
          <small>Eventos y recordatorios</small>
        </Link>
        <button className="list-card new" onClick={() => setCreating(true)}>
          <Plus size={20} />
          <strong>Nueva lista</strong>
        </button>
      </div>
      <Link className="text-button family-settings-link" to={`/grupos/${family.id}/ajustes`}>
        <Settings2 size={15} /> Ajustes del grupo
      </Link>
      {creating && <NewListModal familyId={family.id} onClose={() => setCreating(false)} />}
    </section>
  );
}

