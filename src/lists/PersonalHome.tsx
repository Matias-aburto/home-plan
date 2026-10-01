import { useState } from "react";
import { Users } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { CreateModal } from "../create/CreateModal";
import { SpaceCards } from "../create/SpaceCards";
import { useMe } from "../data/MeProvider";

// Vista general de lo personal; cuando todavía no hay nada, explica qué se puede hacer.
export function PersonalHome() {
  const { lists, families } = useMe();
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  const activeLists = lists.filter((list) => list.ownerUserId === user?.id && !list.archivedAt);
  const empty = activeLists.length === 0;

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>Personal</h2></div>
      </div>
      {empty && (
        <p className="space-intro">
          Crea listas para las compras, un viaje o tus pendientes. Solo tú las ves, salvo las que decidas compartir.
          Tus fechas van en el calendario.
        </p>
      )}
      <SpaceCards lists={activeLists} onCreate={() => setCreating(true)} />
      {empty && families.length === 0 && (
        <Link className="text-button family-settings-link" to="/grupos/nuevo">
          <Users size={15} /> ¿Lo quieres compartir con tu familia o amigos? Crea un grupo
        </Link>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </section>
  );
}
