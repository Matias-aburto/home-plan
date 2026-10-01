import { useState } from "react";
import { Users } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { CreateModal } from "../create/CreateModal";
import { SpaceCards } from "../create/SpaceCards";
import { useMe } from "../data/MeProvider";

// Vista general de lo personal; cuando todavía no hay nada, explica qué se puede hacer.
export function PersonalHome() {
  const { lists, calendars, families } = useMe();
  const { user } = useSession();
  const [creating, setCreating] = useState(false);
  const activeLists = lists.filter((list) => list.ownerUserId === user?.id && !list.archivedAt);
  const calendar = calendars.find((candidate) => candidate.ownerUserId === user?.id) ?? null;
  const empty = activeLists.length === 0 && !calendar;

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>Personal</h2></div>
      </div>
      {empty && (
        <p className="space-intro">
          Crea listas para las compras, un viaje o tus pendientes, y agrega un calendario para tus fechas.
          Solo tú los ves, salvo las listas que decidas compartir.
        </p>
      )}
      <SpaceCards familyId={null} lists={activeLists} calendar={calendar} onCreate={() => setCreating(true)} />
      {empty && families.length === 0 && (
        <Link className="text-button family-settings-link" to="/grupos/nuevo">
          <Users size={15} /> ¿Lo quieres compartir con tu familia o amigos? Crea un grupo
        </Link>
      )}
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </section>
  );
}
