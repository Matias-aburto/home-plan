import { Pin, Plus } from "lucide-react";
import { Link } from "react-router";
import { ListIcon } from "../lists/listStyle";
import { listPin, usePins } from "../shell/pins";
import type { ListSummary } from "../types";

export function pendingLabel(count: number) {
  return count ? `${count} pendiente${count === 1 ? "" : "s"}` : "Al día";
}

// Tarjetas de las listas de un espacio (lo personal o un grupo), más la de crear si se puede.
// En el celular, cada tarjeta permite fijar la lista en la barra inferior.
export function SpaceCards({ lists, onCreate }: { lists: ListSummary[]; onCreate?: () => void }) {
  const { isPinned, togglePin } = usePins();
  return (
    <div className="list-cards">
      {lists.map((list) => {
        const pinned = isPinned(listPin(list.id));
        return (
          <div key={list.id} className="list-card-wrap">
            <Link className="list-card" to={`/listas/${list.id}`}>
              <ListIcon icon={list.icon} color={list.color} size={20} />
              <strong>{list.name}</strong>
              <small>{pendingLabel(list.pendingCount)}</small>
            </Link>
            <button
              className={`card-pin mobile-only ${pinned ? "pinned" : ""}`}
              onClick={() => togglePin(listPin(list.id))}
              aria-pressed={pinned}
              aria-label={pinned ? `Quitar ${list.name} de la barra` : `Fijar ${list.name} en la barra`}
            >
              <Pin size={15} />
            </button>
          </div>
        );
      })}
      {onCreate && (
        <button className="list-card new" onClick={onCreate}>
          <Plus size={20} />
          <strong>Nueva lista</strong>
        </button>
      )}
    </div>
  );
}
