import type { Board, BoardKind, Note } from "../types";
import { canKeepOnLinks, keptOnLinks, TRASH_BOARD } from "./boards";
import { edgeScroll } from "./shelfDrag";

/**
 * Carrying notes on to a board in the shelf (2026-10-23, owner: "hold notes and
 * drag them to a board at the top to move them there").
 *
 * The same hold that carries a card on to another card to merge it, and on to
 * the creature to archive it (`useMergeDrag`): a third kind of thing to let go
 * over. It is not a swipe, which is why it is allowed where swipe-to-file is
 * refused (SPEC §6) — a swipe has to *mean* one of several places, and a carry
 * ends on the one place the finger is resting on, named and lit.
 *
 * What a drop on each board does is the same thing its own verb does
 * elsewhere, never a new write: Move for a place, Archive, Delete (the trash,
 * undoable), and Links only for notes that all carry an address — the Move
 * chooser's own rule. A lens holds nothing of its own, so All, Todos and Files
 * refuse; and so does a drop that would change nothing.
 */
export type DropVerb =
  | { kind: "move"; boardId: string | null }
  | { kind: "archive" }
  | { kind: "trash" }
  | { kind: "links" };

/** The board a drop would land in, or null for a refusal. */
export function dropVerb(board: { id: string; kind: BoardKind }, notes: readonly Note[]): DropVerb | null {
  if (notes.length === 0) return null;
  switch (board.kind) {
    case "folder":
    case "inspiration":
    case "inbox": {
      const boardId = board.kind === "inbox" ? null : board.id;
      // Already all there, and none is waiting on Links to be taken off it.
      const already = notes.every((n) => (n.board_id ?? null) === boardId && !keptOnLinks(n));
      return already ? null : { kind: "move", boardId };
    }
    case "archive":
      return notes.every((n) => n.status === "archived") ? null : { kind: "archive" };
    case "trash":
      return { kind: "trash" };
    case "links":
      return notes.every(canKeepOnLinks) ? { kind: "links" } : null;
    default:
      return null;
  }
}

/**
 * The board under the finger: a tab of the desktop strip, the pinned Trash
 * tab, or a row of the drawer a phone opens for the drop (`data-drop-board`).
 */
export function boardIdUnder(element: Element | null): string | null {
  if (!element) return null;
  const hit = element.closest<HTMLElement>("[data-drop-board], .boards [data-board-id], #board-tab-trash");
  if (!hit) return null;
  return hit.dataset.dropBoard ?? hit.dataset.boardId ?? TRASH_BOARD.id;
}

/**
 * How long a carried note rests on the board row before the drawer comes in.
 * The row sits right under the header, so a finger on its way to the creature
 * crosses it: passing through must not open a drawer over the creature (review
 * 2026-10-23). A pause on the row is the ask.
 */
export const DRAWER_DWELL_MS = 250;

/** On a phone the shelf is a drawer: resting on the board row opens it for the drop. */
export function reachesBoardRow(x: number, y: number): boolean {
  const row = document.querySelector(".board-row");
  if (!row) return false;
  const r = row.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** The finger has gone out past the drop drawer's edge, back over the board: the drawer goes. */
export function besideDropDrawer(x: number): boolean {
  const drawer = document.querySelector(".shelf-drop");
  if (!drawer) return false;
  const r = drawer.getBoundingClientRect();
  return r.width > 0 && x > r.right;
}

/** A board by id, the Trash included — the strip's list leaves it out. */
export function boardById(boards: readonly Board[], id: string): Board | null {
  if (id === TRASH_BOARD.id) return TRASH_BOARD;
  return boards.find((b) => b.id === id) ?? null;
}

/**
 * Scrolls the shelf while a carried note rests near either end of it — the
 * strip along x, the drop drawer along y — at the rate the board carry uses
 * (`edgeScroll`). One frame loop for the length of the carry, reading the last
 * place the finger was, so a finger held still at the edge keeps it running.
 */
export function shelfEdgeScroller() {
  let frame = 0;
  let at = { x: -1, y: -1 };
  const tick = () => {
    frame = 0;
    const hit = document.elementFromPoint?.(at.x, at.y);
    const strip = hit?.closest<HTMLElement>(".boards[data-shelf-scroll]");
    const drawer = hit?.closest<HTMLElement>(".shelf-drop");
    const scroller = strip ?? drawer;
    if (!scroller) return;
    const r = scroller.getBoundingClientRect();
    const v = strip ? edgeScroll(at.x, r.left, r.right) : edgeScroll(at.y, r.top, r.bottom);
    if (v === 0) return;
    if (strip) scroller.scrollLeft += v;
    else scroller.scrollTop += v;
    frame = requestAnimationFrame(tick);
  };
  return {
    follow(x: number, y: number) {
      at = { x, y };
      if (!frame && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(tick);
    },
    stop() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
