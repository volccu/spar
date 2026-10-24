import { useEffect, useRef } from "react";
import type React from "react";
import { LONG_PRESS_MS } from "../components/NoteCard";
import { receipt } from "./haptics";
import type { Carry, ShelfAxis } from "./shelfCarry";

export type { ShelfAxis } from "./shelfCarry";

/** The board a held tab or drawer row names. */
export interface PressedBoard {
  id: string;
  name: string;
}

/**
 * How far a finger may wander before a press stops being a hold. Past this
 * before the hold completes, the press was the start of a scroll — the strip's
 * sideways one, the drawer's up-and-down — and it is left to be one; past it
 * after, the held board has started to travel.
 */
const HOLD_SLOP = 8;

interface Options {
  /** The run this board may be carried along, in shelf order, or null for a
   *  board that holds its seat — `shelfRun` in `lib/boards.ts`. */
  runOf: (id: string) => readonly string[] | null;
  /** Whether a hold let go of in place has a menu to open. */
  hasMenu: (id: string) => boolean;
  onMenu: (board: PressedBoard) => void;
  /** Put `id` down at `to` in its run. Only called for a real move. */
  onPlace: (id: string, to: number) => void;
}

/** The props a tab or a drawer row spreads to be held, carried and let go. */
export interface BoardPressProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
}

export interface BoardPress {
  /** The handlers for one tab or row, naming its board and its shelf's axis. */
  bind: (board: PressedBoard, axis: ShelfAxis) => BoardPressProps;
  /** A tab's click, with the one a hold or a carry ends with swallowed. */
  click: (e: React.MouseEvent, go: () => void) => void;
}

/**
 * The carrying half (`shelfCarry.ts`), which follows a dynamic import off the
 * first paint: asked for the moment a movable board goes down, and in hand
 * long before a hold can complete. A hold that somehow beats it still opens
 * the menu on release; it only cannot travel.
 */
let carrying: typeof import("./shelfCarry") | null = null;
let asked = false;
function loadCarry() {
  if (asked) return;
  asked = true;
  void import("./shelfCarry").then(
    (loaded) => {
      carrying = loaded;
    },
    () => {
      asked = false;
    },
  );
}

/**
 * Holding a board on the shelf picks it up; carrying it moves it; letting go
 * where it was opens its menu. The strip's tabs and the drawer's rows both go
 * through this, so there is one gesture with two shapes (`web/CLAUDE.md`).
 *
 * **Hold, then let go = the menu, exactly as before.** It is the only way to
 * rename, dress or delete a folder, and the owner's ask (2026-09-29) was for a
 * drag *as well as*, never instead of. So the menu waits for the release rather
 * than opening under the finger: a hold that goes on to travel is a move, and a
 * menu that had already opened would have to be taken away again.
 * **Hold, then carry = a move.** The board lifts (a tone step and a heavier
 * rule, `[data-lifted]` in styles.css) with the app's one pulse in the hand,
 * follows the pointer along its own run and no further, and its neighbours
 * step aside to show the seat it would take. Let go and it takes it; Escape,
 * or the browser taking the pointer away, puts it back with nothing written.
 * A press that moves before the hold completes is a scroll and is left to be
 * one, and a plain tap is still a tap. Right-click is still the menu at once.
 *
 * Nothing during a hold goes through React state: the strip is drawn inline in
 * App.tsx, and a state update per pointer frame would re-render the whole app
 * to move one tab. The one thing that does is the drop itself, as one write.
 */
export function useBoardPress(options: Options): BoardPress {
  const latest = useRef(options);
  latest.current = options;
  const engine = useRef<ReturnType<typeof shelfPress> | null>(null);
  if (!engine.current) engine.current = shelfPress(latest);
  useEffect(() => () => engine.current?.dispose(), []);
  return engine.current;
}

interface Press {
  phase: "idle" | "pending" | "held" | "abandoned";
  pointerId: number;
  board: PressedBoard;
  axis: ShelfAxis;
  el: HTMLElement;
  /** Where the press went down, where the hold completed, and where it is. */
  down: { x: number; y: number };
  lift: { x: number; y: number };
  at: { x: number; y: number };
  /** Whether the held board has travelled past the slop since it lifted. */
  moved: boolean;
  timer: number | null;
  carry: Carry | null;
}

function shelfPress(opts: { readonly current: Options }): BoardPress & { dispose: () => void } {
  let p: Press | null = null;
  /** The next click is the one a hold ended with, and goes nowhere. */
  let swallow = false;

  /** A board carried with the finger must not also scroll the page under it.
   *  Only ever attached once the board has lifted — before that the same
   *  touch is free to be the scroll it may turn out to be. */
  const block = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || p?.phase !== "held") return;
    // Taken before the app's own Escape, which would otherwise also leave a
    // mode or clear a selection for the same key.
    e.preventDefault();
    e.stopPropagation();
    p.carry?.putBack();
    p.carry = null;
    letGo();
    p.phase = "abandoned";
  };

  /** Everything the hold put on the page, taken off again. */
  function letGo() {
    if (!p) return;
    if (p.timer !== null) window.clearTimeout(p.timer);
    p.timer = null;
    delete p.el.dataset.lifted;
    document.removeEventListener("touchmove", block);
    window.removeEventListener("keydown", onKey, true);
  }

  function end() {
    p?.carry?.putBack();
    letGo();
    p = null;
  }

  function lift() {
    if (!p || p.phase !== "pending") return;
    p.timer = null;
    p.phase = "held";
    p.lift = { ...p.at };
    swallow = true;
    receipt();
    p.el.dataset.lifted = "true";
    try {
      p.el.setPointerCapture?.(p.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; the carry
      // still follows it for as long as it stays over the board.
    }
    document.addEventListener("touchmove", block, { passive: false });
    window.addEventListener("keydown", onKey, true);
    const run = opts.current.runOf(p.board.id);
    p.carry = run && carrying ? carrying.pickUp(p.el, run, p.axis, p.at.x, p.at.y) : null;
  }

  function down(e: React.PointerEvent<HTMLElement>, board: PressedBoard, axis: ShelfAxis) {
    swallow = false;
    // A right-click is the menu said the desktop way, answered whole by the
    // context menu below; arming a hold for it too answered it twice.
    if (e.button !== 0) return;
    end();
    const o = opts.current;
    const run = o.runOf(board.id);
    if (!run && !o.hasMenu(board.id)) return;
    if (run && run.length > 1) loadCarry();
    const at = { x: e.clientX, y: e.clientY };
    p = {
      phase: "pending",
      pointerId: e.pointerId,
      board,
      axis,
      el: e.currentTarget,
      down: at,
      lift: at,
      at,
      moved: false,
      timer: window.setTimeout(lift, LONG_PRESS_MS),
      carry: null,
    };
  }

  function move(e: React.PointerEvent<HTMLElement>) {
    if (!p || e.pointerId !== p.pointerId) return;
    p.at = { x: e.clientX, y: e.clientY };
    if (p.phase === "pending") {
      if (Math.hypot(p.at.x - p.down.x, p.at.y - p.down.y) > HOLD_SLOP) end();
      return;
    }
    if (p.phase !== "held") return;
    e.preventDefault();
    if (!p.moved && Math.hypot(p.at.x - p.lift.x, p.at.y - p.lift.y) <= HOLD_SLOP) return;
    p.moved = true;
    p.carry?.follow(p.at.x, p.at.y);
  }

  function up(e: React.PointerEvent<HTMLElement>) {
    if (!p || e.pointerId !== p.pointerId) return;
    const { phase, board, carry, moved, el } = p;
    p.carry = null;
    letGo();
    p = null;
    if (phase !== "held") return;
    try {
      el.releasePointerCapture?.(e.pointerId);
    } catch {
      // Already released with the pointer; nothing to give back.
    }
    if (moved) {
      carry?.drop((to) => opts.current.onPlace(board.id, to));
      return;
    }
    carry?.putBack();
    // Held and let go where it was: the menu. A turn later, so the click this
    // release is about to produce lands on the tab it started on (and is
    // swallowed there) rather than on the menu's own dismiss layer.
    if (opts.current.hasMenu(board.id)) {
      window.setTimeout(() => opts.current.onMenu(board), 0);
    }
  }

  /** The browser took the pointer — a second finger, the window losing it. */
  function cancel(e: React.PointerEvent<HTMLElement>) {
    if (p && e.pointerId === p.pointerId) end();
  }

  /** A mouse that leaves the tab before its hold completes was not holding it. */
  function leave(e: React.PointerEvent<HTMLElement>) {
    if (p?.phase === "pending" && e.pointerId === p.pointerId) end();
  }

  function contextMenu(e: React.MouseEvent<HTMLElement>, board: PressedBoard) {
    // A long touch press fires this too, on Android at about the moment the
    // hold completes. The hold is already answering it, and answering it here
    // as well would open the menu under a finger that is about to carry.
    if (p) {
      e.preventDefault();
      return;
    }
    if (!opts.current.hasMenu(board.id)) return;
    e.preventDefault();
    opts.current.onMenu(board);
  }

  return {
    bind: (board, axis) => ({
      onPointerDown: (e) => down(e, board, axis),
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: cancel,
      onPointerLeave: leave,
      onContextMenu: (e) => contextMenu(e, board),
    }),
    click: (e, go) => {
      // `detail` is 0 for a click the keyboard made, which no hold can have
      // ended — so a stale flag can never eat Enter on a tab.
      if (swallow && e.detail !== 0) {
        swallow = false;
        return;
      }
      swallow = false;
      go();
    },
    dispose: end,
  };
}
