import { ENTER, MAKE_WAY_MS, SETTLE_BACK_MS, SHELF_DROP_MS, animates, reducedMotion } from "./motion";
import { clampOffset, dropIndex, edgeScroll, makeWay, type Slot } from "./shelfDrag";

/** Which way the shelf runs: the strip lies along x, the drawer along y. */
export type ShelfAxis = "x" | "y";

/** A board picked up off the shelf, and what can be done with it. */
export interface Carry {
  /** Draws the board where the pointer now is, and the gap it would land in. */
  follow: (x: number, y: number) => void;
  /** Let go: the seat it takes is handed to `place`, unless it is the seat it
   *  left, and the board settles into wherever it now belongs. */
  drop: (place: (to: number) => void) => void;
  /** Abandoned: everything back where it was, and nothing written. */
  putBack: () => void;
}

const along = (axis: ShelfAxis, x: number, y: number) => (axis === "x" ? x : y);
const scrollOf = (el: HTMLElement | null, axis: ShelfAxis) =>
  el ? (axis === "x" ? el.scrollLeft : el.scrollTop) : 0;
const shift = (axis: ShelfAxis, px: number) => `${axis === "x" ? "translateX" : "translateY"}(${px}px)`;

/**
 * Carrying a board along its run — the half of the shelf's hold that only
 * runs once something has actually been picked up (`useBoardPress.ts` is the
 * half that decides whether it was). Kept in a file of its own so that it can
 * follow a dynamic import off the first paint: the press starts loading it the
 * moment a movable tab goes down, and the hold takes longer than the load.
 *
 * The run is measured once, at the pick-up, in the scroller's content
 * coordinates, so the edge-scroll can move the shelf under a held board
 * without anything measured going stale. Everything is written straight onto
 * the elements — the carried board's transform, its neighbours' — and taken
 * off again before the drop is written, so the one render the drop causes
 * finds every board already standing where it will be drawn.
 */
export function pickUp(
  el: HTMLElement,
  run: readonly string[],
  axis: ShelfAxis,
  x: number,
  y: number,
): Carry | null {
  const list = el.closest('[role="tablist"]');
  if (run.length < 2 || !list) return null;
  const scroller = el.closest<HTMLElement>("[data-shelf-scroll]");
  const byId = new Map<string, HTMLElement>();
  list.querySelectorAll<HTMLElement>("[data-board-id]").forEach((node) => {
    if (node.dataset.boardId) byId.set(node.dataset.boardId, node);
  });
  const found = run.map((key) => byId.get(key));
  if (found.some((node) => !node)) return null;
  const els = found as HTMLElement[];
  const from = els.indexOf(el);
  if (from < 0) return null;
  const scrolled = scrollOf(scroller, axis);
  const slots: Slot[] = els.map((node) => {
    const r = node.getBoundingClientRect();
    return axis === "x"
      ? { start: r.left + scrolled, size: r.width }
      : { start: r.top + scrolled, size: r.height };
  });
  const origin = along(axis, x, y) + scrolled;
  let to = from;
  let at = along(axis, x, y);
  let frame: number | null = null;
  if (scroller) scroller.dataset.reordering = "true";

  function draw() {
    const offset = clampOffset(slots, from, at + scrollOf(scroller, axis) - origin);
    const next = dropIndex(slots, from, offset);
    el.style.transform = shift(axis, offset);
    if (next === to) return;
    const glide = reducedMotion() ? "" : `transform ${MAKE_WAY_MS}ms ${ENTER}`;
    els.forEach((node, i) => {
      if (i === from) return;
      const by = makeWay(slots, from, next, i);
      node.style.transition = glide;
      node.style.transform = by ? shift(axis, by) : "";
    });
    to = next;
  }

  /** The shelf scrolls under the board while it rests near either end. */
  function tick() {
    frame = null;
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    const step = edgeScroll(at, axis === "x" ? r.left : r.top, axis === "x" ? r.right : r.bottom);
    if (step) {
      const before = scrollOf(scroller, axis);
      if (axis === "x") scroller.scrollLeft += step;
      else scroller.scrollTop += step;
      if (scrollOf(scroller, axis) !== before) draw();
    }
    frame = requestAnimationFrame(tick);
  }

  /** Takes everything this wrote back off, and says where the board was seen. */
  function clear(): DOMRect {
    const was = el.getBoundingClientRect();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (scroller) delete scroller.dataset.reordering;
    for (const node of els) {
      node.style.transform = "";
      node.style.transition = "";
    }
    return was;
  }

  /** The board drawn from where it was seen to wherever it now stands. */
  function settle(was: DOMRect, duration: number) {
    requestAnimationFrame(() => {
      if (!animates(el)) return;
      const now = el.getBoundingClientRect();
      const d = axis === "x" ? was.left - now.left : was.top - now.top;
      if (Math.abs(d) < 0.5) return;
      el.animate([{ transform: shift(axis, d) }, { transform: "none" }], { duration, easing: ENTER });
    });
  }

  return {
    follow: (nx, ny) => {
      at = along(axis, nx, ny);
      if (frame === null) frame = requestAnimationFrame(tick);
      draw();
    },
    drop: (place) => {
      const was = clear();
      if (to !== from) {
        place(to);
        settle(was, SHELF_DROP_MS);
      } else {
        settle(was, SETTLE_BACK_MS);
      }
    },
    putBack: () => settle(clear(), SETTLE_BACK_MS),
  };
}
