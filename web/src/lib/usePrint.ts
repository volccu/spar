import { useCallback, useLayoutEffect, useRef, type SyntheticEvent } from "react";
import { ENTER, EXIT, PRINT_MS, animates } from "./motion";

/**
 * A browser's own cache answers in a few milliseconds, and a picture that took
 * no longer than this to arrive was not late: it is drawn at once.
 */
export const PRINT_QUICK_MS = 60;

/** Where the first, faint stage of the print stops, as a share of its end. */
const GHOST = 0.2;
/** The point in the run where the ghost is reached; the front is slow, then done. */
const GHOST_AT = 0.4;

/** An address that is this device's own bytes: already here, never "late". */
const ON_DEVICE = /^(data|blob):/i;

/** What an element's keyframes are, given the opacity the stylesheet leaves it at. */
export function printFrames(end: number): Keyframe[] {
  return [
    { opacity: 0, easing: EXIT },
    { opacity: end * GHOST, offset: GHOST_AT, easing: ENTER },
    { opacity: end },
  ];
}

/**
 * Whether a picture that has just finished loading should come up rather than
 * appear. Late means: it was not already decoded when first drawn, its bytes
 * are not this device's own (`data:` / `blob:`), and it took longer than a
 * cache's answer to arrive.
 */
export function comesLate(
  img: { currentSrc?: string; src: string },
  wasHere: boolean,
  waitedMs: number,
): boolean {
  if (wasHere) return false;
  if (ON_DEVICE.test(img.currentSrc || img.src)) return false;
  return waitedMs >= PRINT_QUICK_MS;
}

/**
 * The print: a picture that arrives late comes up out of the dark, slowly at
 * first and then done, in `PRINT_MS` (`lib/motion.ts`). A picture already
 * decoded when first drawn, one that is the device's own bytes, and one that
 * came out of the browser's cache are drawn at once with no effect at all.
 *
 * Spread the result onto the `<img>` (`{...print}`), or call `ref` and
 * `onLoad` from the caller's own where it already has them. Only the first
 * load of each `key` is ever considered: a thumbnail's sharper replacement is
 * the same picture and must not blink. The effect is the element's own opacity
 * run from nothing up to what the stylesheet gives it (`--shot-opacity` and the
 * rest are read, never restated), and is gone when it ends, so the end state is
 * exactly what it was before. Skipped under reduced motion.
 */
export function usePrint(key?: string) {
  const el = useRef<HTMLImageElement | null>(null);
  const turn = useRef({ born: 0, here: false, spent: false });
  const watch = useRef<IntersectionObserver | null>(null);

  const arm = useCallback(() => {
    const img = el.current;
    watch.current?.disconnect();
    watch.current = null;
    const lazy = img?.getAttribute("loading") === "lazy" && typeof IntersectionObserver === "function";
    turn.current = {
      // A lazy picture's clock starts when it comes into view, not when it is
      // drawn: the browser fetches it on its own schedule, so a picture from
      // the cache that loads on the way in has not kept anybody waiting, and
      // one that lands before it is in view was never seen arriving (it reads
      // as already here). Only a load that finishes while you look is late.
      born: lazy ? Number.POSITIVE_INFINITY : performance.now(),
      here: Boolean(img && img.complete && img.naturalWidth > 0),
      spent: false,
    };
    if (!lazy || !img) return;
    const t = turn.current;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      t.born = performance.now();
      seen.disconnect();
    });
    seen.observe(img);
    watch.current = seen;
  }, []);

  useLayoutEffect(() => () => watch.current?.disconnect(), []);

  // A new picture in the same element (the viewer walking to the next file)
  // is a new arrival.
  useLayoutEffect(arm, [key, arm]);

  // And so is a new element: a card whose picture came and went.
  const ref = useCallback(
    (node: HTMLImageElement | null) => {
      const fresh = node !== null && node !== el.current;
      el.current = node;
      if (fresh) arm();
      if (node === null) watch.current?.disconnect();
    },
    [arm],
  );

  const onLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const t = turn.current;
    if (t.spent) return;
    t.spent = true;
    const img = e.currentTarget;
    if (!comesLate(img, t.here, performance.now() - t.born)) return;
    if (!animates(img)) return;
    const end = Number.parseFloat(getComputedStyle(img).opacity);
    img.animate(printFrames(Number.isFinite(end) ? end : 1), { duration: PRINT_MS });
  }, []);

  return { ref, onLoad };
}
