import { useEffect, useLayoutEffect, useRef } from "react";
import {
  DEAL_CARD_MS,
  DEAL_MAX_CARDS,
  DEAL_STEP_MS,
  DEAL_TOTAL_MS,
  ENTER,
  REFLOW_ARRIVE_MS,
  REFLOW_HOLD_MS,
  REFLOW_MS,
  animates,
  reducedMotion,
} from "./motion";

/**
 * The grid closes its own gaps.
 *
 * When a card leaves, every card after it jumps to a new slot between two
 * frames, and the whole grid re-forms under your eyes with no way to tell what
 * moved where. This measures the cards before and after the change, and plays
 * each one from where it *was* to where it now is — so the tiles visibly slide
 * together and the hole closes rather than never having existed.
 *
 * The measuring pass is also the only honest way to know what left: a card is
 * gone when it was in the last measurement and isn't in this one. Callers get
 * told, along with the rect it occupied, so something can be drawn in its place
 * as it goes.
 *
 * It deliberately does nothing when the *view* changes — paging to another
 * board or typing in search replaces the whole set, and animating a hundred
 * cards from wherever the last board happened to put them is noise, not
 * information. Those changes have their own motion.
 */

export interface Leaving {
  id: string;
  rect: { left: number; top: number; width: number; height: number };
  /** What the card was showing, so the thing that replaces it can look like it. */
  text: string;
}

interface Shot {
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
}

export function useGridReflow(
  grid: HTMLElement | null,
  /** Identifies the view. A change to it resets rather than animates. */
  view: string,
  /** The ids on screen, joined — what actually re-runs the measurement. */
  signature: string,
  onLeave: (leaving: Leaving[]) => void,
) {
  const last = useRef(new Map<string, Shot>());
  const lastView = useRef<string | null>(null);

  // A rotation or a resized window moves every card without anything having
  // happened to any of them. Forget the old positions rather than animating
  // the whole grid back from a layout that no longer exists.
  useEffect(() => {
    const forget = () => last.current.clear();
    window.addEventListener("resize", forget);
    return () => window.removeEventListener("resize", forget);
  }, []);

  useLayoutEffect(() => {
    if (!grid) {
      last.current.clear();
      lastView.current = null;
      return;
    }

    // Only what is on screen is worth reading the words of, or animating
    // (audit PERF-4). A card off screen before *and* after the change moved
    // where nobody could see it; on All that was some 3,000 animations and
    // as many text reads per capture. The words are only ever used for a card
    // that left from on screen, which is the one place they are kept.
    const h = window.innerHeight || 0;
    const seen = (r: { top: number; height: number }) => r.top < h && r.top + r.height > 0;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(".card[data-id]"));
    // Kept relative to the grid: the board scrolls inside its own box, which
    // moves every viewport rect without any card having moved.
    const origin = grid.getBoundingClientRect();
    const now = new Map<string, Shot>();
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      now.set(el.dataset.id ?? "", {
        left: r.left - origin.left,
        top: r.top - origin.top,
        width: r.width,
        height: r.height,
        text: seen(r) ? (el.querySelector(".card-body")?.textContent ?? "") : "",
      });
    }

    const prev = last.current;
    const sameView = lastView.current === view;
    last.current = now;
    lastView.current = view;
    if (!sameView || prev.size === 0 || reducedMotion()) return;

    const gone: Leaving[] = [];
    for (const [id, was] of prev) {
      if (now.has(id)) continue;
      // A card that left from off-screen has nothing to show going.
      if (!seen({ top: was.top + origin.top, height: was.height })) continue;
      gone.push({
        id,
        rect: { left: was.left + origin.left, top: was.top + origin.top, width: was.width, height: was.height },
        text: was.text,
      });
    }

    // If something is on its way out, the grid holds still until it has gone.
    // `fill: backwards` is what makes the hold real: without it the cards would
    // simply sit in their new slots for the delay, which is the jump we are
    // trying to avoid, only later.
    const hold = gone.length > 0 ? REFLOW_HOLD_MS : 0;

    for (const el of cards) {
      if (typeof el.animate !== "function") continue;
      const id = el.dataset.id ?? "";
      const was = prev.get(id);
      const is = now.get(id);
      if (!is) continue;
      if (!seen({ top: is.top + origin.top, height: is.height }) && (!was || !seen({ top: was.top + origin.top, height: was.height }))) continue;

      // Arriving: a note just captured, or one put back. It fades in where it
      // landed while everything below it is still travelling down.
      if (!was) {
        el.animate(
          [
            { opacity: 0, transform: "translateY(-7px)" },
            { opacity: 1, transform: "translateY(0px)" },
          ],
          { duration: REFLOW_ARRIVE_MS, delay: hold, easing: ENTER, fill: "backwards" },
        );
        continue;
      }

      const dx = was.left - is.left;
      const dy = was.top - is.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: "translate3d(0px, 0px, 0)" },
        ],
        { duration: REFLOW_MS, delay: hold, easing: ENTER, fill: "backwards" },
      );
    }

    if (gone.length > 0) onLeave(gone);
  }, [grid, view, signature, onLeave]);
}

/**
 * A new device is dealt a hand (joy review #15, 2026-10-14, owner approved).
 *
 * Only the first sync of a device whose store was empty once it had been read:
 * the first screenful of cards, as they land, is revealed one after another by
 * a clip along ENTER (never a scale, never a bare fade), the whole of it under
 * `DEAL_TOTAL_MS`. Nothing waits: the cards are in the DOM and take clicks
 * from the first frame. It is spent once per session, and it never runs on an
 * ordinary open (notes already here), when the first thing to land is a
 * single note the user wrote while the server had not yet answered, or under
 * reduced motion.
 */
export function useFirstDeal(
  grid: HTMLElement | null,
  loading: boolean,
  noteCount: number,
  answered: boolean,
) {
  // Armed: the store was read, held nothing, and the server has not spoken.
  const armed = useRef(false);
  const spent = useRef(false);
  useLayoutEffect(() => {
    if (spent.current) return;
    if (!armed.current) {
      if (!loading && noteCount === 0 && !answered) armed.current = true;
      return;
    }
    // One note is a capture made while waiting, not the archive arriving.
    if (noteCount === 1) {
      spent.current = true;
      return;
    }
    if (noteCount > 1 && grid) {
      spent.current = true;
      deal(grid);
      return;
    }
    if (answered) spent.current = true;
  }, [grid, loading, noteCount, answered]);
}

/** The cards on screen, in reading order, capped; each one clipped in. */
export function deal(grid: HTMLElement) {
  if (!animates(grid)) return;
  const h = window.innerHeight || 0;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>(".card[data-id]"))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < h && r.bottom >= 0;
    })
    .slice(0, DEAL_MAX_CARDS);
  const step = Math.min(DEAL_STEP_MS, (DEAL_TOTAL_MS - DEAL_CARD_MS) / Math.max(1, cards.length - 1));
  cards.forEach((el, i) => {
    el.animate(
      [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }],
      { duration: DEAL_CARD_MS, delay: i * step, easing: ENTER, fill: "backwards" },
    );
  });
}
