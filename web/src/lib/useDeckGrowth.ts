import { useEffect, useState, type RefObject } from "react";

/**
 * useDeckGrowth — a long board mounts a few screens of cards, and more as the
 * reader nears the end of them (audit PERF-3, PERF-6).
 *
 * Every note on a board used to be a live card. At 3,000 notes that was some
 * 37,000 elements and a 1.5-second freeze before the first card, and every
 * letter typed into search mounted every result ("k" mounted 2,900 cards).
 * `content-visibility` spares the painting of what is off screen, but React
 * still had to build all of it. Now a view mounts `DECK_PAGE` cards, and a
 * sentinel just past the last one asks for the next `DECK_PAGE` when it comes
 * within a screen and a half of the bottom of the scroller — so the cards are
 * there before a flick reaches them.
 *
 * This is the first step the audit named, not windowing: cards scrolled past
 * stay mounted, so a board read all the way down ends as it did before. What
 * it buys is the arrival — first paint, paging, each search letter — which is
 * where the freezes were.
 *
 * Only the DOM is limited. Everything that *reads* the board — the counts,
 * select-all, stepping from note to note — keeps reading `visible` whole, the
 * same bargain `useGridFill` makes.
 *
 * `view` names what the grid shows; a new one starts again at one page.
 * `whole` mounts a view whole as it arrives, for a board coming back to a
 * scroll offset that the first page could not reach (`useBoardScroll`, the
 * back-from-a-link boot): read only when `view` changes. `need` is a count the
 * deck must reach whatever the scroll says — the open note's place, so the
 * card a closing note shrinks into is there. Without `IntersectionObserver`
 * (jsdom, very old browsers) there is nothing to grow on, so every card mounts,
 * as before.
 */

/** Several screens of cards on the widest grid; a phone's column shows four or five. */
export const DECK_PAGE = 120;

/** How far below the scroller's bottom edge the sentinel starts the next page. */
const GROW_MARGIN = "0px 0px 150% 0px";

export function useDeckGrowth(
  view: string,
  total: number,
  sentinel: Element | null,
  /** The scroller the cards are in: the margin is measured against it, as
   *  the viewport's own edge is clipped by its overflow. */
  scroller: RefObject<Element | null>,
  whole: boolean,
  need = 0,
): number {
  const grows = typeof IntersectionObserver === "function";
  const start = whole ? Number.POSITIVE_INFINITY : DECK_PAGE;
  // One state for both facts, reset during render, so the first commit of a
  // new view already holds one page (the same pattern as `useGridFill`).
  const [state, setState] = useState({ view, limit: start });
  if (state.view !== view) setState({ view, limit: start });
  const limit = Math.max(state.view !== view ? start : state.limit, need);

  useEffect(() => {
    if (!grows || !sentinel || limit >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setState((s) =>
          s.view === view ? { view, limit: Math.max(s.limit, limit) + DECK_PAGE } : s,
        );
      },
      { root: scroller.current, rootMargin: GROW_MARGIN },
    );
    // A sentinel still in reach after a page lands fires again on the new
    // observer, so a tall screen fills itself without a scroll.
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [grows, sentinel, scroller, view, limit, total]);

  return grows ? Math.min(total, limit) : total;
}
