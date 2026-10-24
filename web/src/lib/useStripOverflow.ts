import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Board } from "../types";
import { hiddenTabs, sidewaysWheel, type Hidden } from "./stripOverflow";

interface Options {
  /** The shelf, in order — a board added or removed changes what fits. */
  boards: Board[];
  /** Each board's count, in shelf order — a count changes a tab's width. */
  counts: number[];
  /** Search holds the board row, and the strip is not drawn. */
  searchOpen: boolean;
  /** The Reminders mode holds the board row, and the strip is not drawn. */
  remindersOpen: boolean;
  /** A phone draws a drawer, not a strip. */
  isPhone: boolean;
}

/**
 * The desktop strip saying when it holds more boards than it shows: the fades
 * at its edges, the count of boards out of sight and the click that brings
 * them in, and a mouse wheel turned sideways over it (review UX-04). Moved
 * out of `App.tsx` whole (review PL-10); the comments are the ones it had
 * there.
 */
export function useStripOverflow({ boards, counts, searchOpen, remindersOpen, isPhone }: Options) {
  const boardsScroll = useRef<HTMLElement | null>(null);
  /** How many boards the desktop strip has scrolled out of sight on each side,
   *  or null while every one of them fits (`lib/stripOverflow.ts`). */
  const [stripHidden, setStripHidden] = useState<Hidden | null>(null);

  /**
   * Whether the strip has more tabs off past either edge, written straight
   * onto the DOM node rather than through React state — this runs on every
   * scroll frame while a finger drags the strip, and a state update per
   * frame would re-render the whole board row for something two CSS
   * attribute selectors can answer on their own (`.board-tab` fade rules in
   * styles.css). Read on mount, on scroll, on a board added or removed
   * (making a folder changes how many tabs there are to fit), and on resize
   * (a narrower window can turn "everything fits" into "it doesn't").
   */
  function updateBoardsFade() {
    const el = boardsScroll.current;
    if (!el) return;
    const fadeLeft = el.scrollLeft > 1;
    const fadeRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    el.dataset.fadeLeft = fadeLeft ? "true" : "false";
    el.dataset.fadeRight = fadeRight ? "true" : "false";
    // How many boards are out of sight, for the count beside the strip
    // (review UX-04). State, unlike the fades, because it is drawn — but set
    // only when a number actually changes, so a scroll frame that hides no new
    // tab costs no render.
    const overflows = el.scrollWidth > el.clientWidth + 1;
    el.dataset.overflow = overflows ? "true" : "false";
    if (!overflows) {
      setStripHidden((prev) => (prev === null ? prev : null));
      return;
    }
    const view = el.getBoundingClientRect();
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'), (t) => {
      const r = t.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    // 28px is the mask's own width (`.boards[data-fade-*]` in styles.css).
    const next = hiddenTabs(view, tabs, fadeLeft ? 28 : 0, fadeRight ? 28 : 0);
    setStripHidden((prev) =>
      prev && prev.before === next.before && prev.after === next.after ? prev : next,
    );
  }

  /**
   * The app's own boards give up their names, and stand as a mark and a count,
   * when the full-width strip would not fit (review UX-08, 2026-10-13): four
   * folders at 1280px used to push Todos, Links, Files and All behind a count,
   * and SPEC §6 promises every board one click away. Measured the honest way:
   * take the attribute off, ask whether the strip then overflows, put it on if
   * it does. Folders keep their names; only a built-in board is ever shortened
   * (`.boards[data-compact]` in styles.css). Not on the scroll path: the width
   * of a tab does not change while a finger drags it.
   */
  function fitBoards(el: HTMLElement | null) {
    if (!el) return;
    delete el.dataset.compact;
    if (el.scrollWidth > el.clientWidth + 1) el.dataset.compact = "true";
  }

  /** The count beside the strip, clicked: the next window of boards, or back
   *  to the start once there is nothing further on. */
  function pageStrip(direction: 1 | -1) {
    const el = boardsScroll.current;
    if (!el) return;
    if (direction < 0) el.scrollTo?.({ left: 0, behavior: "smooth" });
    else el.scrollBy?.({ left: el.clientWidth - 56, behavior: "smooth" });
  }

  // Counts change a tab's width, so a capture can push one past the edge.
  const countsKey = counts.join(",");
  useLayoutEffect(() => {
    if (searchOpen || remindersOpen || isPhone) return;
    const fitAndFade = () => {
      fitBoards(boardsScroll.current);
      updateBoardsFade();
    };
    fitAndFade();
    window.addEventListener("resize", fitAndFade);
    // The strip's own width changes without the window's — the count beside it
    // arriving or leaving is one — and every such change can hide a tab.
    const el = boardsScroll.current;
    const watch =
      el && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fitAndFade()) : null;
    if (el) watch?.observe(el);
    return () => {
      window.removeEventListener("resize", fitAndFade);
      watch?.disconnect();
    };
  }, [boards, searchOpen, remindersOpen, isPhone, countsKey]);

  /**
   * A mouse wheel over the strip moves it sideways (review UX-04). The strip
   * only scrolls on that axis and a wheel only speaks on the other, so a
   * vertical wheel here did nothing at all and the boards past the edge could
   * only be reached by dragging. Native rather than React's `onWheel`, which
   * is passive and cannot keep the turn from also being read as a scroll of
   * whatever is underneath. `scrollBy`, not `scrollLeft +=`: the strip snaps
   * to tabs, and a relative scroll is the one the browser snaps *onwards*
   * rather than back to the tab it started at.
   */
  useEffect(() => {
    const el = boardsScroll.current;
    if (!el || searchOpen || remindersOpen || isPhone) return;
    function onWheel(e: WheelEvent) {
      if (!el || el.scrollWidth <= el.clientWidth + 1) return;
      const dx = sidewaysWheel(e, el.clientWidth);
      if (!dx) return;
      e.preventDefault();
      el.scrollBy?.({ left: dx });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [searchOpen, remindersOpen, isPhone]);

  return { boardsScroll, stripHidden, updateBoardsFade, pageStrip };
}
