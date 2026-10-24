import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  animates,
  clipOfRect,
  CLOSE_MS,
  ENTER,
  EXIT,
  finishOnce,
  FULL_CLIP,
  OPEN_MS,
  SETTLE_BACK_MS,
  SLIDE_IN_MS,
  SLIDE_OUT_MS,
  stopAnimations,
} from "./motion";
import { receipt } from "./haptics";
import { useRestoreFocus } from "./useRestoreFocus";
import { cycleTab } from "./focusTrap";
import {
  axisOf,
  commits,
  dragPose,
  isSwipe,
  pastTheLine,
  settleBack,
  TILT_MAX,
  type SwipeStart,
} from "./swipe";

interface Options {
  /** How many things are in the pile; the mode closes past the last. */
  count: number;
  /** The rect of the line this was entered from — the shape it grows out of. */
  origin: DOMRect | null;
  onClose: () => void;
  /** Where the focus goes when it shuts. */
  restoreTo: RefObject<HTMLButtonElement | null>;
  /**
   * What a sideways swipe means, for a mode that spends it on something other
   * than stepping. Left and right as the finger went, not as the pile moves —
   * a mode that answers a swipe with a decision has to know which way the hand
   * went, and "forward" is already a different sentence.
   *
   * Left out, a swipe steps through the pile, which is what the Ticker still
   * wants and what the Sorter wanted until keep-and-bin took the gesture over.
   *
   * **A mode that answers with a decision carries its card on the way**
   * (review 2026-10-01, UX-08): the `faceRef` element follows the finger one
   * for one, leans a little, and writes `--swipe-right` / `--swipe-left`
   * (0 to 1) onto itself for the word the mode draws in a corner of the card.
   * Let go past `commitDistance` and the card is flung off the side it was
   * taken to before `onSwipe` runs; let go short and it settles back and
   * nothing is answered. Direct manipulation, like the canvas: no state per
   * frame, no easing on anything a finger holds. Under reduced motion the card
   * stays where it is and only the word comes up, and the answer is made on
   * release as it always was.
   */
  onSwipe?: (way: "left" | "right") => void;
  /**
   * Called instead of closing when `advance` runs past the last one, for a
   * mode with something to say about the run. Left out, the end of the pile is
   * the end of the mode, which is what the Ticker still wants.
   */
  onEnd?: () => void;
}

/**
 * The shell of a mode: the Sorter's, said once so the Ticker could be the
 * Sorter's shape without being the Sorter's code a second time.
 *
 * A mode is a full-screen layer over the board. It grows its `clip-path` out
 * of the row it was entered from (`clipOfRect`), closes back into it, holds
 * one thing from a pile at a time, steps along the pile with the gestures a
 * mode may respend inside its own screen (SPEC §6) — a horizontal swipe, and
 * the caller's own keys — and slides the next thing in from the side it was
 * asked for, the way a board arrives on the shelf.
 *
 * The layer takes the focus itself on open, not a control in it. `App.tsx`
 * puts the board behind a mode `inert`, so a layer that took nothing had
 * focus drop to the body — outside the element, where its Escape and arrow
 * handlers sat on a div no keystroke ever reached; Escape did not close the
 * Sorter at all. And not the first control, because in the Sorter that
 * would leave a folder one stray Enter away from being filed into, and in
 * the Ticker an item one stray Enter away from being ticked. The layer is
 * labelled and `aria-modal`, so a reader is told where it has arrived.
 *
 * Closing has the fallback the Lightbox has and the two modes lacked: a
 * backgrounded tab never fires `onfinish`, and a mode must not be able to
 * strand itself over the board. `onClose` fires once either way.
 *
 * **And Tab stays inside it.** `App.tsx` marks the board and the grid behind a
 * mode `inert`, which covers most of the page and deliberately not all of it:
 * the header is outside it, and the mascot puts `tabindex="0"` on itself. So
 * Tab off the last control walked out of a layer that declares
 * `aria-modal="true"` and landed on the creature — announced by nothing,
 * because a screen reader has been told that everything outside this layer
 * does not exist. `trapTab` is the same `cycleTab` `Dialog`, `Lightbox` and
 * `NoteView` use; the modes each hand it their Tab.
 */
export function useModeLayer({ count, origin, onClose, restoreTo, onSwipe, onEnd }: Options) {
  const [at, setAt] = useState(0);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  const leaving = useRef(false);
  const touch = useRef<SwipeStart | null>(null);
  /** The fling is in the air: a new finger waits, and the answer is made once. */
  const flinging = useRef(false);
  /** The carried card is past the line where letting go decides (see `pastTheLine`). */
  const past = useRef(false);
  /** Calls off the fling's backup timer (`finishOnce`). */
  const timer = useRef<(() => void) | null>(null);
  /** Calls off the close's backup timer. */
  const late = useRef<(() => void) | null>(null);
  // Read through a ref: the fling's fallback timer fires after the render that
  // scheduled it and has to call the mode's latest answer, not a stale one.
  const answer = useRef(onSwipe);
  answer.current = onSwipe;

  useRestoreFocus(restoreTo);

  // A fling still in the air must not answer after the mode has gone, and a
  // close must not end a layer that is no longer there.
  useEffect(
    () => () => {
      timer.current?.();
      late.current?.();
    },
    [],
  );

  useLayoutEffect(() => {
    const el = layerRef.current;
    if (animates(el)) {
      el.animate(
        origin
          ? [{ clipPath: clipOfRect(origin) }, { clipPath: FULL_CLIP }]
          : [{ opacity: 0 }, { opacity: 1 }],
        { duration: OPEN_MS, easing: ENTER },
      );
    }
    layerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open only.
  }, []);

  function close() {
    if (leaving.current) return;
    const el = layerRef.current;
    if (!animates(el)) {
      onClose();
      return;
    }
    leaving.current = true;
    const out = el.animate(
      origin
        ? [{ clipPath: FULL_CLIP }, { clipPath: clipOfRect(origin) }]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: CLOSE_MS, easing: EXIT, fill: "forwards" },
    );
    // A backgrounded tab never fires onfinish, and a mode must not be able to
    // strand itself over the board.
    late.current = finishOnce(out, onClose, CLOSE_MS + 140);
  }

  /** On to the next one, or out — the end of the pile is the end of the job,
   *  unless the mode has something to say about the run (`onEnd`). */
  function advance() {
    if (at + 1 >= count) {
      if (onEnd) onEnd();
      else close();
      return;
    }
    setAt(at + 1);
    slide(1);
  }

  function step(by: -1 | 1) {
    const next = at + by;
    if (next < 0 || next >= count) return;
    setAt(next);
    slide(by);
  }

  /** The thing travels in from the side it was asked for, like a board arriving
   *  on the shelf — the direction is what says which way you went. */
  function slide(from: -1 | 1) {
    const el = faceRef.current;
    if (!animates(el)) return;
    const width = window.innerWidth || 1;
    el.animate(
      [
        { transform: `translate3d(${from * width}px, 0, 0)`, opacity: 0 },
        { transform: "translate3d(0px, 0px, 0)", opacity: 1 },
      ],
      // Backwards, never both: a filled animation outranks an inline style
      // forever, and the next swipe writes one.
      { duration: SLIDE_IN_MS, easing: ENTER, fill: "backwards" },
    );
  }

  function onTouchStart(e: React.TouchEvent) {
    if (flinging.current) return;
    // A second finger is a pinch or a palm, never a verdict.
    if (e.touches.length > 1) {
      release(true);
      touch.current = null;
      return;
    }
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, axis: "?" };
    past.current = false;
  }

  /** The card follows the finger: only for a mode that answers its swipe. */
  function onTouchMove(e: React.TouchEvent) {
    const start = touch.current;
    if (!start || !onSwipe || flinging.current) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Decide once which way this touch is going and stay decided: a card that
    // slides sideways while the note under it is being scrolled is unusable.
    if (start.axis === "?") {
      start.axis = axisOf(dx, dy);
      if (start.axis === "?") return;
      // The card may still be arriving from the side; a finger on it wins.
      if (start.axis === "x") stopAnimations(faceRef.current);
    }
    if (start.axis !== "x") return;
    const el = faceRef.current;
    if (!el) return;
    const pose = dragPose(dx, window.innerWidth);
    if (animates(el)) {
      el.style.transform = `translate3d(${pose.x}px, 0, 0) rotate(${pose.tilt}deg)`;
      el.dataset.carried = "true";
    }
    // The one tick, as the card crosses the point of no return (joy review
    // 2026-10-14, #6): a detent in a dial. Once per crossing, never while the
    // card stays past; going back under the line re-arms it.
    const now = pastTheLine(past.current, dx, dy, window.innerWidth);
    if (now && !past.current) receipt();
    past.current = now;
    el.style.setProperty("--swipe-right", String(dx > 0 ? pose.cue : 0));
    el.style.setProperty("--swipe-left", String(dx < 0 ? pose.cue : 0));
  }

  /**
   * Takes the card's word down and, when `settle`, puts the card back. The
   * word eases out over the same settle the card takes, so the two end
   * together rather than the word vanishing under a card still gliding home.
   */
  function release(settle: boolean) {
    const el = faceRef.current;
    if (!el) return;
    const cues =
      settle && animates(el) ? Array.from(el.querySelectorAll<HTMLElement>("[data-cue]")) : [];
    const shown = cues.map((cue) => Number.parseFloat(getComputedStyle(cue).opacity) || 0);
    past.current = false;
    el.style.removeProperty("--swipe-right");
    el.style.removeProperty("--swipe-left");
    delete el.dataset.carried;
    if (settle) settleBack(el);
    else el.style.transform = "";
    cues.forEach((cue, i) => {
      if (shown[i] > 0) {
        cue.animate([{ opacity: shown[i] }, { opacity: 0 }], {
          duration: SETTLE_BACK_MS,
          easing: ENTER,
        });
      }
    });
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || flinging.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const way = dx < 0 ? "left" : "right";
    if (!onSwipe) {
      // A vertical drag is reading the thing, not stepping off it.
      if (!isSwipe(dx, dy)) return;
      step(dx < 0 ? 1 : -1);
      return;
    }
    // Short of the line, or not flat enough: the hand changed its mind, and the
    // card goes home having answered nothing.
    if (!commits(dx, dy, window.innerWidth)) {
      release(true);
      return;
    }
    const el = faceRef.current;
    if (!animates(el)) {
      release(false);
      onSwipe(way);
      return;
    }
    // Carry on from wherever the finger left it, so the drag and the throw are
    // one movement rather than a snap back followed by a slide.
    const width = window.innerWidth || 1;
    const dir = dx < 0 ? -1 : 1;
    const held = el.style.transform || "translate3d(0px, 0px, 0)";
    el.style.transform = "";
    flinging.current = true;
    const out = el.animate(
      [
        { transform: held, opacity: 1 },
        {
          transform: `translate3d(${dir * width * 1.1}px, 0, 0) rotate(${dir * TILT_MAX}deg)`,
          opacity: 0,
        },
      ],
      { duration: SLIDE_OUT_MS, easing: EXIT, fill: "forwards" },
    );
    const finish = () => {
      timer.current = null;
      // Cancelled and answered in the same turn: the next card's own slide-in
      // starts from off the edge, so the old one is never seen back at rest.
      out.cancel();
      flinging.current = false;
      release(false);
      answer.current?.(way);
    };
    // A tab switched away from mid-fling never fires onfinish, and the note
    // would then never be answered.
    timer.current = finishOnce(out, finish, SLIDE_OUT_MS + 120);
  }

  /** The browser took the touch for itself — a system gesture, say. */
  function onTouchCancel() {
    touch.current = null;
    if (!flinging.current) release(true);
  }

  /** Tab, kept inside the layer. Handed the event by each mode's own keys. */
  function trapTab(e: React.KeyboardEvent) {
    cycleTab(e, layerRef.current);
  }

  return {
    at,
    layerRef,
    faceRef,
    close,
    advance,
    step,
    trapTab,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
