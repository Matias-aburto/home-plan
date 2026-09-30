import { createContext, useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";

export const ReorderLockContext = createContext(false);

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const draggingIdRef = useRef<string | null>(null);
  const orderRef = useRef(order);
  const itemsRef = useRef(items);
  const origin = useRef<{ id: string; x: number; y: number; pointerId: number; node: HTMLElement } | null>(null);
  const longPress = useRef<number | null>(null);
  const didMove = useRef(false);
  const suppressClick = useRef(false);
  const scrollBlocker = useRef<((event: TouchEvent) => void) | null>(null);
  const windowMove = useRef<((event: PointerEvent) => void) | null>(null);
  const windowUp = useRef<((event: PointerEvent) => void) | null>(null);
  const itemIds = items.map((item) => item.id).join(",");

  itemsRef.current = items;
  orderRef.current = order;

  useEffect(() => {
    if (!draggingId) setOrder(items.map((item) => item.id));
  }, [draggingId, itemIds, items]);

  useEffect(() => () => {
    clearTimer();
    unlockScroll();
    detachWindow();
  }, []);

  function clearTimer() {
    if (longPress.current) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
  }

  function lockScroll() {
    if (scrollBlocker.current) return;
    const blocker = (event: TouchEvent) => event.preventDefault();
    scrollBlocker.current = blocker;
    document.addEventListener("touchmove", blocker, { passive: false, capture: true });
    document.documentElement.classList.add("reordering");
    document.body.classList.add("reordering");
  }

  function unlockScroll() {
    if (!scrollBlocker.current) return;
    document.removeEventListener("touchmove", scrollBlocker.current, true);
    scrollBlocker.current = null;
    document.documentElement.classList.remove("reordering");
    document.body.classList.remove("reordering");
  }

  function detachWindow() {
    if (windowMove.current) window.removeEventListener("pointermove", windowMove.current);
    if (windowUp.current) {
      window.removeEventListener("pointerup", windowUp.current);
      window.removeEventListener("pointercancel", windowUp.current);
    }
    windowMove.current = null;
    windowUp.current = null;
  }

  function attachWindow(pointerId: number) {
    detachWindow();
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      handleMove(event.clientX, event.clientY);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      finishDrag();
    };
    windowMove.current = onMove;
    windowUp.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function beginDrag(id: string, pointerId: number, target: HTMLElement | null) {
    clearTimer();
    draggingIdRef.current = id;
    setDraggingId(id);
    lockScroll();
    const item = target?.closest(".sortable-item") as HTMLElement | null;
    try {
      item?.setPointerCapture(pointerId);
    } catch {
      // El pointer puede no admitir captura en este elemento.
    }
    attachWindow(pointerId);
    navigator.vibrate?.(12);
  }

  function startHold(event: ReactPointerEvent<HTMLElement>, id: string, fromHandle: boolean) {
    if (itemsRef.current.length < 2) return;
    origin.current = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId, node: event.currentTarget };
    didMove.current = false;
    if (fromHandle && event.pointerType !== "touch") {
      beginDrag(id, event.pointerId, event.currentTarget);
      return;
    }
    if (event.pointerType !== "touch") return;
    longPress.current = window.setTimeout(() => {
      if (!origin.current) return;
      beginDrag(origin.current.id, origin.current.pointerId, origin.current.node);
    }, 420);
  }

  function handleMove(clientX: number, clientY: number) {
    if (!origin.current) return;
    const deltaX = clientX - origin.current.x;
    const deltaY = clientY - origin.current.y;
    if (!draggingIdRef.current) {
      if (Math.hypot(deltaX, deltaY) > 8) clearTimer();
      return;
    }
    const over = document.elementFromPoint(clientX, clientY)?.closest("[data-sortable-id]") as HTMLElement | null;
    const overId = over?.dataset.sortableId;
    if (!overId || overId === draggingIdRef.current) return;
    const from = orderRef.current.indexOf(draggingIdRef.current);
    const to = orderRef.current.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const rect = over.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    if (from < to && clientY < middle) return;
    if (from > to && clientY > middle) return;
    didMove.current = true;
    const next = [...orderRef.current];
    next.splice(from, 1);
    next.splice(to, 0, draggingIdRef.current);
    orderRef.current = next;
    setOrder(next);
  }

  function finishDrag() {
    clearTimer();
    detachWindow();
    unlockScroll();
    const dragged = draggingIdRef.current;
    const nextOrder = orderRef.current;
    const previous = itemsRef.current.map((item) => item.id);
    const moved = didMove.current;
    origin.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    didMove.current = false;
    if (!dragged || !moved || nextOrder.join() === previous.join()) return;
    suppressClick.current = true;
    onReorder(nextOrder);
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!origin.current) return;
    if (draggingIdRef.current) event.preventDefault();
    handleMove(event.clientX, event.clientY);
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const orderedItems = order.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));

  return (
    <ReorderLockContext.Provider value={Boolean(draggingId)}>
      <div className={`sortable-list ${draggingId ? "is-reordering" : ""}`}>
        {orderedItems.map((item) => (
          <div
            key={item.id}
            data-sortable-id={item.id}
            className={`sortable-item ${draggingId === item.id ? "is-dragging" : ""}`}
            onPointerDown={(event) => startHold(event, item.id, false)}
            onPointerMove={pointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onContextMenu={(event) => {
              if (draggingIdRef.current) event.preventDefault();
            }}
            onClickCapture={(event) => {
              if (!suppressClick.current) return;
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }}
          >
            {renderItem(item, (
              <button
                type="button"
                className="drag-handle"
                aria-label="Reordenar"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  startHold(event, item.id, true);
                }}
              >
                <GripVertical size={16} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </ReorderLockContext.Provider>
  );
}
