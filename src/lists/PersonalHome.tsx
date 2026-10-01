import { useState } from "react";
import { ListChecks, Plus, Users } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { CreateModal } from "../create/CreateModal";
import { SpaceCards } from "../create/SpaceCards";
import { useMe } from "../data/MeProvider";

// Vista general de lo personal; también es la bienvenida cuando todavía no hay nada.
export function PersonalHome() {
  const { lists, calendars, families } = useMe();
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  const activeLists = lists.filter((list) => list.ownerUserId === user?.id && !list.archivedAt);
  const activeCalendars = calendars.filter((calendar) => calendar.ownerUserId === user?.id && !calendar.archivedAt);
  const empty = activeLists.length === 0 && activeCalendars.length === 0;

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>Personal</h2></div>
      </div>

      {empty ? (
        <div className="empty-state welcome-empty animate-in">
          <div><ListChecks size={28} /></div>
          <h3>Crea tu primera lista o calendario</h3>
          <p>Para las compras, un viaje, pendientes o fechas importantes. Solo tú lo ves, salvo que lo compartas.</p>
          <div className="empty-state-actions">
            <button className="primary-button" onClick={() => setCreating(true)}>
              <Plus size={18} /> Nuevo
            </button>
            {families.length === 0 && (
              <Link className="secondary-button" to="/grupos/nuevo">
                <Users size={18} /> Crear un grupo
              </Link>
            )}
          </div>
        </div>
      ) : (
        <SpaceCards lists={activeLists} calendars={activeCalendars} onCreate={() => setCreating(true)} />
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </section>
  );
}
