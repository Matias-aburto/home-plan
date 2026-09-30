import { useState } from "react";
import { ListChecks, Plus, Users } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { useMe } from "../data/MeProvider";
import { NewListModal } from "./NewListModal";
import { ListIcon, listKinds } from "./listStyle";

// Vista general de las listas del usuario; también es la bienvenida cuando todavía no tiene ninguna.
export function PersonalHome() {
  const { lists, families } = useMe();
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  const activeLists = lists.filter((list) => list.ownerUserId === user?.id && !list.archivedAt);

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>Mis listas</h2></div>
        {activeLists.length > 0 && <span>{activeLists.length} {activeLists.length === 1 ? "lista" : "listas"}</span>}
      </div>

      {activeLists.length === 0 ? (
        <div className="empty-state welcome-empty animate-in">
          <div><ListChecks size={28} /></div>
          <h3>Crea tu primera lista</h3>
          <p>Compras, tareas o una checklist para lo que necesites. Solo tú la ves.</p>
          <div className="empty-state-actions">
            <button className="primary-button" onClick={() => setCreating(true)}>
              <Plus size={18} /> Nueva lista
            </button>
            {families.length === 0 && (
              <Link className="secondary-button" to="/familias/nueva">
                <Users size={18} /> Crear o recuperar una familia
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="list-cards">
          {activeLists.map((list) => (
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
          <button className="list-card new" onClick={() => setCreating(true)}>
            <Plus size={20} />
            <strong>Nueva lista</strong>
          </button>
        </div>
      )}
      {creating && <NewListModal onClose={() => setCreating(false)} />}
    </section>
  );
}
