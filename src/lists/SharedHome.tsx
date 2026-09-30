import { Share2 } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { useMe } from "../data/MeProvider";
import { ListIcon } from "./listStyle";

const permissionLabels = { owner: "Administras", editor: "Puedes editar", viewer: "Solo lectura" };

// Listas que otras personas compartieron conmigo (fuera de mis familias).
export function SharedHome() {
  const { lists, families } = useMe();
  const { user } = useSession();
  const familyIds = new Set(families.map(({ id }) => id));
  const shared = lists.filter((list) =>
    list.ownerUserId !== user?.id && !(list.familyId && familyIds.has(list.familyId)) && !list.archivedAt
  );

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>Compartidas conmigo</h2></div>
      </div>
      {shared.length === 0 ? (
        <div className="empty-state animate-in">
          <div><Share2 size={28} /></div>
          <h3>Nadie compartió listas contigo</h3>
          <p>Cuando alguien te invite a una lista, aparecerá aquí.</p>
        </div>
      ) : (
        <div className="list-cards">
          {shared.map((list) => (
            <Link key={list.id} className="list-card" to={`/listas/${list.id}`}>
              <ListIcon icon={list.icon} color={list.color} size={20} />
              <strong>{list.name}</strong>
              <small>{permissionLabels[list.access]} · {list.pendingCount ? `${list.pendingCount} pendientes` : "Al día"}</small>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
