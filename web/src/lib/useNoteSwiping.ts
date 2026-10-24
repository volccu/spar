import { useEffect, useRef, type RefObject } from "react";
import { animates, EXIT, SLIDE_OUT_MS, stopAnimations } from "./motion";
import { axisOf, isSwipe, settleBack, type SwipeStart } from "./swipe";

/**
 * useNoteSwiping — a horizontal swipe on the open note moves to the note
 * beside it on the board.
 *
 * The board deck travels because a board is a shelf and paging moves along it
 * (useBoardPaging.ts); an open note is full screen and its neighbour is the
 * note beside it in the same ordered list the grid drew, so the body travels
 * the same way — but the bar above it is the note's own header, not part of
 * the shelf, and stays exactly where it is, the same way the board's tabs
 * never move while its deck pages. Everything here is one gesture's worth of
 * state — where the finger started, which way it is going, how far the body
 * has followed it — and none of it is any use to the rest of the screen.
 * Whether the neighbour exists is the board's business (`canPrev`/`canNext`,
 * handed in by App), not the gesture's.
 */

/** How far the body follows the finger, and how far it is allowed to get. */
const DRAG_RATE = 0.5;
const DRAG_MAX = 0.3;
/** The same, at the ends of the board, where there is nowhere to go. */
const EDGE_RATE = 0.12;

interface Options {
  /** The element that follows the finger while dragging — the note's body,
   *  not the sheet as a whole, so the header above it never travels. */
  targetRef: RefObject<HTMLElement | null>;
  /** Whether this note has a neighbour in the swipe direction. */
  canPrev: boolean;
  canNext: boolean;
  /** Stands down while something else owns the finger — the editor, a panel,
   *  the full-screen picture, a confirm, or the sheet closing. */
  frozen: boolean;
  /** Called once a swipe to the previous / next note commits. */
  onPrev: () => void;
  onNext: () => void;
}

export function useNoteSwiping({
  targetRef,
  canPrev,
  canNext,
  frozen,
  onPrev,
  onNext,
}: Options) {
  const touch = useRef<SwipeStart | null>(null);
  /** Whether the committed swipe has already fired. Guards the animation's
   *  onfinish against the timeout fallback, and the fallback against a note
   *  that closed underneath it. */
  const fired = useRef(false);
  const timer = useRef<number | null>(null);
  // Read through refs: the timeout fallback fires after the render that
  // scheduled it, and has to call the latest callbacks, not stale ones.
  const callbacks = useRef({ onPrev, onNext });
  callbacks.current = { onPrev, onNext };
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  // A committed swipe must not fire after the note has closed underneath it.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function onTouchStart(e: React.TouchEvent) {
    // A new finger down stands down any swipe still on its way out — the user
    // has changed their mind, and it must not commit behind them.
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, axis: "?" };
  }

  function onTouchMove(e: React.TouchEvent) {
    const start = touch.current;
    if (!start || frozen) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Decide once which way this touch is going, then stay decided — a note
    // that shifts sideways while you are scrolling it is unusable.
    if (start.axis === "?") {
      start.axis = axisOf(dx, dy);
      if (start.axis === "?") return;
      // The body may still be arriving from the side; a finger on it wins.
      if (start.axis === "x") stopAnimations(targetRef.current);
    }
    if (start.axis !== "x") return;
    const el = targetRef.current;
    if (!animates(el)) return;
    // At the ends of the board the sheet barely gives, which is how a physical
    // thing says "there is nothing past this" without a message.
    const atEnd = (dx < 0 && !canNext) || (dx > 0 && !canPrev);
    const pull = dx * (atEnd ? EDGE_RATE : DRAG_RATE);
    const max = window.innerWidth * DRAG_MAX || 1;
    const clamped = Math.max(-max, Math.min(max, pull));
    el.style.transform = `translate3d(${clamped}px, 0, 0)`;
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || frozen) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!isSwipe(dx, dy)) {
      settleBack(targetRef.current);
      return;
    }
    const goingNext = dx < 0;
    const reachable = goingNext ? canNext : canPrev;
    if (!reachable) {
      settleBack(targetRef.current);
      return;
    }
    const el = targetRef.current;
    // Reduced motion, or an environment without animations (jsdom): the note
    // changes at once, with nothing sliding.
    if (!el || !animates(el)) {
      (goingNext ? callbacks.current.onNext : callbacks.current.onPrev)();
      return;
    }
    // Carry on from wherever the finger left it, so the drag and the throw are
    // one movement rather than a snap back followed by a slide.
    const width = window.innerWidth || 1;
    const dir = goingNext ? -1 : 1;
    const held = el.style.transform || "translate3d(0px, 0px, 0)";
    el.style.transform = "";
    fired.current = false;
    const finish = () => {
      if (fired.current || frozenRef.current) return;
      fired.current = true;
      (goingNext ? callbacks.current.onNext : callbacks.current.onPrev)();
    };
    const out = el.animate(
      [
        { transform: held, opacity: 1 },
        { transform: `translate3d(${dir * width}px, 0, 0)`, opacity: 0 },
      ],
      { duration: SLIDE_OUT_MS, easing: EXIT, fill: "forwards" },
    );
    out.onfinish = finish;
    // A tab switched away from mid-animation never fires onfinish, and the
    // note would then never change.
    timer.current = window.setTimeout(finish, SLIDE_OUT_MS + 120);
  }

  return { onTouchStart, onTouchMove, onTouchEnd };
}