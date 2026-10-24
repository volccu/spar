import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { animates, ENTER, EXIT, PEEK_MS } from "./motion";

interface Options {
  /** The card. */
  el: RefObject<HTMLElement | null>;
  /** How long a pointer or a focus has to rest before the card grows. */
  wait: number;
  /** A selection is on; nothing grows, and a grown card drops. */
  selecting: boolean;
  /** Whether growing this card would show anything it is not already showing. */
  canPeek: boolean;
  /**
   * Called with the resting card just before it grows, in the same batch as
   * the growth — the one moment its place on screen is known and the grown
   * face has not been drawn (`NoteCard` measures the room under it here).
   */
  onBeforePeek?: (node: HTMLElement) => void;
}

/**
 * How many lines of words a grown card may hold when only `room` px lie between
 * its top and the write bar (review UI-B-01).
 *
 * `chrome` is everything on the card that is not words (padding, gap, footer,
 * and a row's name line). Never fewer than `floor` — the lines the card already
 * shows at rest, so a card is never smaller grown — and never more than `ceil`.
 * Whole lines, so the fade lands on a full line like a resting card's.
 */
export function peekLinesFor(
  room: number,
  chrome: number,
  lineHeight: number,
  floor: number,
  ceil: number,
): number {
  const fit = Math.floor((room - chrome) / lineHeight);
  return Math.max(floor, Math.min(ceil, fit));
}

/**
 * A resting pointer grows the card it is on, and the grid does not move
 * (`web/CLAUDE.md`, "Motion"). The card is drawn at full height from the first
 * frame and revealed by its clip — the same move the note sheet makes out of
 * a card — and put back the same way. Nothing here scales.
 *
 * Lived inside `NoteCard` as six refs, a state, three layout effects and two
 * copies of the timer start (the resting mouse and the keyboard's landing
 * focus each had their own). One copy now; the card keeps only what is its
 * own — which pointer started the rest, and what to do with the rect.
 */
export function usePeek({ el, wait, selecting, canPeek, onBeforePeek }: Options) {
  const [peek, setPeek] = useState(false);
  /** Mirrors `peek` for the handlers, which run outside a render. */
  const peeking = useRef(false);
  /** Whether the most recent focus came from a pointer rather than a keyboard.
   *  A tap focuses a card on the way to pressing it, which is not the resting
   *  hand the peek answers — only a keyboard walk should grow a card the way a
   *  resting mouse does. Set by the card's pointer-down, read by `startPeek`'s
   *  focus caller. */
  const pointerFocus = useRef(false);
  const timer = useRef<number | null>(null);
  const anim = useRef<Animation | null>(null);
  /** The card's height before it grew — what the clip closes back down to. */
  const collapsed = useRef(0);

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  /**
   * Put the card back in its row.
   *
   * `soft` plays the clip shut and lets the finished animation hold the closed
   * shape until React collapses the box in the layout effect below — so the two
   * happen on the same frame and the card never flashes at full height. The hard
   * version is for opening the note, where the sheet is about to cover it.
   */
  const dropPeek = useCallback(
    (soft: boolean) => {
      clearTimer();
      if (!peeking.current) return;
      peeking.current = false;
      const node = el.current;
      const extra = node ? node.offsetHeight - collapsed.current : 0;
      anim.current?.cancel();
      anim.current = null;
      if (!soft || !animates(node) || extra <= 0) {
        setPeek(false);
        return;
      }
      const a = node.animate(
        [{ clipPath: "inset(0 0 0 0)" }, { clipPath: `inset(0 0 ${extra}px 0)` }],
        { duration: PEEK_MS, easing: EXIT, fill: "both" },
      );
      anim.current = a;
      a.onfinish = () => setPeek(false);
    },
    [el],
  );

  /** Starts the rest that grows the card; the wait is the whole feel of it. */
  function startPeek() {
    if (selecting || !canPeek || peeking.current) return;
    clearTimer();
    // A close still playing from the last time the pointer left. `peek` is
    // still true until it finishes, so the card is still at full height: come
    // back inside those 200ms and the wait below measured the *grown* card as
    // its collapsed height and set `peeking` — and then the close landed and
    // set `peek` false underneath it. The card could never peek again, and
    // opened out of a rect taller than it was. So the close is finished now:
    // its `onfinish` goes, and `peek` drops here instead — the layout effect
    // cancels the filled animation in the same commit the box collapses, the
    // same frame the soft close was always going to land on.
    if (anim.current) {
      anim.current.onfinish = null;
      setPeek(false);
    }
    timer.current = window.setTimeout(() => {
      const node = el.current;
      if (!node) return;
      collapsed.current = node.offsetHeight;
      peeking.current = true;
      onBeforePeek?.(node);
      setPeek(true);
    }, wait);
  }

  // The grown card is drawn at full height from the first frame and revealed by
  // its clip, the same move the note sheet makes out of a card. Nothing here
  // scales: the words are set once, at the size they keep.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    if (!peek) {
      anim.current?.cancel();
      anim.current = null;
      return;
    }
    const extra = node.offsetHeight - collapsed.current;
    if (!animates(node) || extra <= 0) return;
    anim.current?.cancel();
    anim.current = node.animate(
      [{ clipPath: `inset(0 0 ${extra}px 0)` }, { clipPath: "inset(0 0 0 0)" }],
      { duration: PEEK_MS, easing: ENTER },
    );
  }, [peek, el]);

  // Selection is a different job with a different pointer rhythm — clicking a
  // run of cards fast is not the moment to be growing any of them.
  useLayoutEffect(() => {
    if (selecting) dropPeek(false);
  }, [selecting, dropPeek]);

  useLayoutEffect(
    () => () => {
      clearTimer();
      anim.current?.cancel();
    },
    [],
  );

  return { peek, peeking, collapsed, pointerFocus, startPeek, dropPeek };
}
