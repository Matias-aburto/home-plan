import { useContext, useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ReorderLockContext } from "./SortableList";

export function SwipeCard({
  label,
  children,
  onEdit,
  onDelete
}: {
  label: string;
  children: ReactNode;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const reordering = useContext(ReorderLockContext);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; offset: number; armed: boolean } | null>(null);
  const actionWidth = 140;

  useEffect(() => {
    if (!reordering) return;
    start.current = null;
    setOffset(0);
    setDragging(false);
  }, [reordering]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || reordering) return;
    start.current = { x: event.clientX, y: event.clientY, offset, armed: false };
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current || event.pointerType !== "touch" || reordering) return;
    const deltaX = event.clientX - start.current.x;
    const deltaY = event.clientY - start.current.y;
    if (!start.current.armed) {
      if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) return;
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        start.current = null;
        return;
      }
      start.current.armed = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setOffset(Math.max(-actionWidth, Math.min(0, start.current.offset + deltaX)));
  }

  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    if (start.current.armed) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // El pointer ya no está capturado.
      }
    }
    const finalOffset = start.current.armed
      ? Math.max(-actionWidth, Math.min(0, start.current.offset + event.clientX - start.current.x))
      : start.current.offset;
    setOffset(finalOffset < -44 ? -actionWidth : 0);
    setDragging(false);
    start.current = null;
  }

  function pointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    if (start.current.armed) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // El pointer ya no está capturado.
      }
    }
    setOffset(start.current.offset);
    setDragging(false);
    start.current = null;
  }

  return (
    <div className={`swipe-card ${offset < 0 ? "open" : ""} ${dragging ? "dragging" : ""}`}>
      <div className="swipe-actions" aria-hidden={offset === 0}>
        <button className="swipe-edit" onClick={() => {
          setOffset(0);
          onEdit();
        }} aria-label={`Editar ${label}`} tabIndex={offset < 0 ? 0 : -1}>
          <Pencil size={18} /><span>Editar</span>
        </button>
        <button className="swipe-delete" onClick={onDelete} aria-label={`Eliminar ${label}`} tabIndex={offset < 0 ? 0 : -1}>
          <Trash2 size={18} /><span>Eliminar</span>
        </button>
      </div>
      <div
        className={`swipe-card-content ${dragging ? "dragging" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerCancel}
      >
        {children}
      </div>
    </div>
  );
}
