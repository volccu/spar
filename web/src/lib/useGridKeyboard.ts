import { isTypingTarget } from "./hotkeys";
import { useEffect, useRef } from "react";
import type { Note } from "../types";
import { ARCHIVE_KEY, FLAG_KEY, MOVE_KEY } from "./hotkeys";

/**
 * Every key the grid answers to. Anything else is somebody else's. Exported
 * for the one test that holds the About page's list of keys to it
 * (`lib/shortcuts.test.ts`).
 */
export const GRID_KEYS: ReadonlySet<string> = new Set([
  "Delete",
  "Backspace",
  "Home",
  "End",
  "ArrowRight",
  "ArrowLeft",
  "ArrowDown",
  "ArrowUp",
  ARCHIVE_KEY,
  MOVE_KEY,
  FLAG_KEY,
]);

/** A verb the letter keys ask for, said by the selection panel's own name. */
export type GridVerb = "archive" | "move" | "flag";

/**
 * The key of a bare press, or null when it is not the board's to take: Ctrl,
 * Cmd or Alt held, or aimed at something being typed into. A letter is read
 * lower-case unless Shift is down (Shift+E is not E, and Caps Lock must not
 * hide one). The grid and the selection panel's own keys both ask this, so the
 * two can never disagree about what counts as a bare press.
 */
export function bareKey(e: KeyboardEvent): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (isTypingTarget(e.target)) return null;
  return e.key.length === 1 && !e.shiftKey ? e.key.toLowerCase() : e.key;
}

/** The verb E, M or F asks for, or null for any other key. */
export function verbOfKey(key: string): GridVerb | null {
  return key === ARCHIVE_KEY ? "archive" : key === MOVE_KEY ? "move" : key === FLAG_KEY ? "flag" : null;
}

interface Options {
  /** The grid element, or null while there is none on screen. */
  grid: HTMLElement | null;
  /** A layer has the grid; every key is somebody else's. */
  covered: boolean;
  /** A selection exists, and Delete falls to it rather than to the focused card. */
  selecting: boolean;
  /** The archive as it stands, read at the keystroke rather than closed over. */
  notesRef: { readonly current: Note[] };
  /** What Delete does when there is a selection. */
  onTrashSelection: () => void;
  /** What Delete does to the one focused card. */
  onTrashFocused: (id: string) => void;
  /**
   * E, M and F (review 2026-10-04, FX-A-05): the selection panel's Archive,
   * Move and Important rows, or — with nothing selected — the same for the
   * one focused card (`id`). Each goes through the path the panel and the
   * open note use, so the undo is the usual one.
   */
  onVerb: (verb: GridVerb, id: string | null) => void;
}

/**
 * The cards in the order a person reads the board. On the uniform grid that is
 * the DOM order; on the Inspiration wall the DOM is column by column, so the
 * tiles carry their board position (`data-pos`) and are put back in it. The
 * first row of the wall is the first `columns` tiles — each stands at the top of
 * its own column — so the arrows' row-by-measuring-tops still counts a row.
 */
export function inReadingOrder(cards: HTMLElement[]): HTMLElement[] {
  if (!cards.some((c) => c.dataset.pos !== undefined)) return cards;
  return [...cards].sort((a, b) => Number(a.dataset.pos) - Number(b.dataset.pos));
}

/**
 * The grid is walkable from the keyboard: arrows and Home/End move focus
 * between cards, Delete and Backspace trash the selection or the focused card
 * (`web/CLAUDE.md`, "The keyboard").
 *
 * Lived inside `App.tsx` as one effect, and its dependency array was wrong in
 * both directions: it named two values its body never read, and it named
 * `notes` for one existence check — so the window listener was torn down and
 * re-registered on every keystroke in an open note and every sync pull. The
 * check reads `notesRef` now, and the listener is registered once per grid.
 *
 * The two verbs are taken by value and held in refs, because they are
 * recreated every render and the listener is not: a ref is what lets a
 * listener registered once reach whatever is selected *now*.
 */
/**
 * Puts the focus back on a slot in the grid once the card that held it has
 * gone: the card after it fills the slot, or the last card if it was the last.
 * Delete and the archive key (`App.tsx`) both keep the cursor this way rather
 * than dropping it to the top of the document.
 */
export function focusSlot(grid: HTMLElement | null, slot: number) {
  window.setTimeout(() => {
    const now = inReadingOrder(
      Array.from(grid?.querySelectorAll<HTMLElement>(".card[data-id]") ?? []),
    );
    now[Math.max(0, Math.min(slot, now.length - 1))]?.focus();
  }, 0);
}

export function useGridKeyboard({
  grid,
  covered,
  selecting,
  notesRef,
  onTrashSelection,
  onTrashFocused,
  onVerb,
}: Options): void {
  const trashSelection = useRef(onTrashSelection);
  trashSelection.current = onTrashSelection;
  const trashFocused = useRef(onTrashFocused);
  trashFocused.current = onTrashFocused;
  const verb = useRef(onVerb);
  verb.current = onVerb;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (covered) return;
      // Never a modified key, and never one aimed at something being typed into.
      const key = bareKey(e);
      if (key === null) return;
      // Settle what this key is before touching the DOM. Measuring the grid
      // means reading every card's position back out of the browser, and doing
      // that for every keystroke in the app to discover that the key was "e"
      // is a layout the screen never needed.
      if (!GRID_KEYS.has(key)) return;
      if (!grid) return;
      const cards = inReadingOrder(Array.from(grid.querySelectorAll<HTMLElement>(".card[data-id]")));
      if (cards.length === 0) return;
      const at = cards.findIndex((c) => c === document.activeElement);

      const named = verbOfKey(key);
      if (named) {
        const id = at >= 0 ? (cards[at].dataset.id ?? null) : null;
        // What is selected wins over what holds focus, as Delete's does; with
        // neither there is nothing for the key to act on.
        if (!selecting && id === null) return;
        e.preventDefault();
        verb.current(named, selecting ? null : id);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        // Whatever is picked out wins over whatever happens to hold focus: you
        // selected those five notes in order to do something to those five.
        if (selecting) {
          e.preventDefault();
          trashSelection.current();
          return;
        }
        if (at < 0) return;
        e.preventDefault();
        const id = cards[at].dataset.id;
        if (!id) return;
        const note = notesRef.current.find((n) => n.id === id);
        if (!note) return;
        // Through the one trash path, not a second copy of it. Written out
        // here, this branch set the mark and the status by hand and never ran
        // the idea bookkeeping, so deleting a note that belonged to an idea —
        // reachable from the Archive board, where a merged source is an
        // ordinary card — left the canvas holding an item pointing at a note
        // in the bin. That is exactly what the comment on `handleSetStatus`
        // says its idea branch exists to prevent.
        trashFocused.current(id);
        // The slot is about to be filled by the card after it; keep the cursor
        // on the slot rather than dropping focus to the top of the document.
        focusSlot(grid, at);
        return;
      }

      // Count the cards on the first row rather than reading the grid's
      // template. The template is a formula — "repeat(auto-fill, minmax(260px,
      // 1fr))" — and only the browser knows what it resolved to. The cards
      // themselves always know where they are. Measured here rather than above,
      // because only the arrows move by a row: Delete never needed it.
      const top = cards[0].getBoundingClientRect().top;
      let cols = 0;
      while (
        cols < cards.length &&
        Math.abs(cards[cols].getBoundingClientRect().top - top) < 1
      ) {
        cols++;
      }
      cols = Math.max(1, cols);

      const step: Record<string, number> = {
        ArrowRight: 1,
        ArrowLeft: -1,
        ArrowDown: cols,
        ArrowUp: -cols,
      };
      let next: number;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = cards.length - 1;
      else if (e.key in step) {
        // Nothing focused yet: the first arrow picks up the first card rather
        // than doing nothing and making you wonder if the keys work at all.
        // Nothing focused yet: the first arrow picks up where Tab would
        // have — the grid's one roving stop — and on a grid running no
        // roving tabindex every card reads 0, so this is the first card
        // exactly as before.
        const roving = cards.findIndex((c) => c.tabIndex === 0);
        next = at < 0 ? Math.max(0, roving) : at + step[e.key];
      } else return;

      e.preventDefault();
      cards[Math.max(0, Math.min(cards.length - 1, next))]?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered, selecting, grid, notesRef]);
}
