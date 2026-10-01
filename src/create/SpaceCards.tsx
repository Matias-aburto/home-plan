import { Plus } from "lucide-react";
import { Link } from "react-router";
import { ListIcon } from "../lists/listStyle";
import type { ListSummary } from "../types";

export function pendingLabel(count: number) {
  return count ? `${count} pendiente${count === 1 ? "" : "s"}` : "Al día";
}

// Tarjetas de las listas de un espacio (lo personal o un grupo), más la de crear.
export function SpaceCards({ lists, onCreate }: { lists: ListSummary[]; onCreate: () => void }) {
  return (
    <div className="list-cards">
      {lists.map((list) => (
        <Link key={list.id} className="list-card" to={`/listas/${list.id}`}>
          <ListIcon icon={list.icon} color={list.color} size={20} />
          <strong>{list.name}</strong>
          <small>{pendingLabel(list.pendingCount)}</small>
        </Link>
      ))}
      <button className="list-card new" onClick={onCreate}>
        <Plus size={20} />
        <strong>Nueva lista</strong>
      </button>
    </div>
  );
}
