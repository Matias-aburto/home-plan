import { useState } from "react";
import { ChevronRight, Pin } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "../auth/AuthProvider";
import { CreateModal } from "../create/CreateModal";
import { SpaceCards } from "../create/SpaceCards";
import { useMe } from "../data/MeProvider";

// Inicio: todas mis listas, agrupadas por espacio (lo personal, cada grupo y lo compartido conmigo).
export function HomePage() {
  const { lists, families } = useMe();
  const { user } = useSession();
  // undefined: cerrado; null: personal; string: ese grupo.
  const [createIn, setCreateIn] = useState<string | null | undefined>(undefined);
  const familyIds = new Set(families.map(({ id }) => id));
  const active = lists.filter((list) => !list.archivedAt);

  const sections = [
    { key: "personal", title: "Personal", to: "/personal", familyId: null as string | null, canCreate: true,
      lists: active.filter((list) => list.ownerUserId === user?.id) },
    ...families.map((family) => ({
      key: family.id, title: family.name, to: `/grupos/${family.id}`, familyId: family.id as string | null, canCreate: true,
      lists: active.filter((list) => list.familyId === family.id && list.ownerUserId !== user?.id)
    })),
    { key: "shared", title: "Compartidas conmigo", to: "/compartidas", familyId: null, canCreate: false,
      lists: active.filter((list) => list.ownerUserId !== user?.id && !(list.familyId && familyIds.has(list.familyId))) }
  ].filter((section) => section.canCreate || section.lists.length > 0);

  return (
    <section className="content">
      <div className="content-heading">
        <div className="title-only"><h2>Inicio</h2></div>
      </div>
      <p className="space-intro mobile-only">
        <Pin size={13} /> Fija hasta dos listas (o el calendario) para tenerlas en la barra de abajo.
      </p>
      {sections.map((section) => (
        <div key={section.key} className="home-section">
          <Link className="home-section-title" to={section.to}>
            {section.title} <ChevronRight size={15} />
          </Link>
          <SpaceCards lists={section.lists} onCreate={section.canCreate ? () => setCreateIn(section.familyId) : undefined} />
        </div>
      ))}
      {createIn !== undefined && <CreateModal familyId={createIn} onClose={() => setCreateIn(undefined)} />}
    </section>
  );
}
