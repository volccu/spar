import { useMemo } from "react";
import type { Board, Note } from "../types";
import { hasOpenBox } from "./blocks";
import { notesForBoard } from "./boards";

interface Options {
  /** The board under the grid. */
  board: Board;
  /** A query is running. */
  searching: boolean;
  /** The Reminders mode holds the grid. */
  remindersOpen: boolean;
  /** The notes as the board sees them (deferred while a note is open). */
  gridNotes: Note[];
  /** What the grid is holding. */
  visible: Note[];
  /** The archive by id. */
  noteById: Map<string, Note>;
  /** The Sorter's snapshot of ids, or null while it is shut. */
  sortingIds: string[] | null;
  /** The Ticker's snapshot of ids, or null while it is shut. */
  tickingIds: string[] | null;
}

/**
 * `ids` with the notes in `left` moved to the back, each group in its own
 * order. Tidy up opens on what the last run did not leave alone (review
 * 2026-10-04, FX-B-02).
 */
export function leftToBack(ids: string[], left: ReadonlySet<string>): string[] {
  if (left.size === 0) return ids;
  return [...ids.filter((id) => !left.has(id)), ...ids.filter((id) => left.has(id))];
}

/**
 * The piles the two modes work through: what the menu offers to tidy or tick
 * on this board, and the notes each open mode is showing (review PL-10 moved
 * them out of `App.tsx` whole; the comments are the ones they had there).
 */
export function useModePiles({
  board,
  searching,
  remindersOpen,
  gridNotes,
  visible,
  noteById,
  sortingIds,
  tickingIds,
}: Options) {
  /**
   * The Inbox's own pile, whatever is currently on screen.
   *
   * Deliberately **not** `visible`, and this is the fix for the one layout
   * shift a person actually reported. The Sort line is the first thing in the
   * scroller on the landing board, and it used to be drawn on `!searching`: so
   * the first character typed into the search field took a 40px row out from
   * under the grid and every card on screen jumped up by it, with the row
   * dropping back in when the query was cleared. `web/CLAUDE.md` already
   * states the rule this broke — search opens *in* the board row precisely so
   * that nothing else on screen moves — and it was being kept forty pixels
   * higher up and broken forty pixels lower down.
   *
   * So the row keeps its box for as long as you are standing on the Inbox,
   * and search only takes away what is *in* it (see `data-hidden` on
   * `.sort-entry`). It still says nothing about the search results, which are
   * a mode over every board at once and are not a pile to sort.
   */
  const tidyPile = useMemo(
    () =>
      // Todos has a mode of its own and the Trash is not a pile to tidy — a
      // note in there has already been decided about, and the folders, the
      // Archive and the bin all mean nothing to one.
      board.kind === "todos" || board.kind === "trash"
        ? []
        : searching || remindersOpen
          ? notesForBoard(gridNotes, board)
          : visible,
    [board, searching, remindersOpen, gridNotes, visible],
  );

  /** The Inbox's own share of that, which is what the first-open question
   *  and its "Tidy up" answer are about — they speak for the Inbox alone. */
  const inboxPile = useMemo(
    () => (board.kind === "inbox" ? tidyPile : []),
    [board.kind, tidyPile],
  );

  /**
   * The Todos board's own pile: the lists with something still open in them.
   *
   * The Ticker's equivalent of `inboxPile`, and it answers the searching
   * question the same way and for the same reason — the row keeps its box on
   * Todos too, so the first character typed does not pull the grid up by forty
   * pixels. That rule was learned once on the Inbox and it belongs to any board
   * carrying one of these lines.
   *
   * A note is in it only if a box in it is still unticked. Todos holds notes
   * that are a checklist *or* have been marked as a to-do, and a note in the
   * second group may have no boxes at all — there is nothing for this mode to
   * do with one, and a screen of nothing to tick is a screen that should not
   * have been offered.
   */
  const todoPile = useMemo(
    () =>
      board.kind !== "todos"
        ? []
        : (searching || remindersOpen ? notesForBoard(gridNotes, board) : visible).filter((n) =>
            hasOpenBox(n.body),
          ),
    [board, searching, remindersOpen, gridNotes, visible],
  );

  /**
   * Which line stands at the top of this board, if any.
   *
   * One row, one place that decides what it says and what it opens. The two
   * modes are the same offer about different work — a pile of unfiled notes,
   * a pile of unfinished lists — so the alternative is the same markup twice
   * with two chances to forget the searching rule.
   */
  const modeEntry = useMemo(() => {
    // Search and the reminders list borrow the grid, so the board behind them
    // is not what is under the reader's hands and its pile is not what the
    // menu should be offering to work through. The old line on the board had
    // to stay in the layout and merely empty itself (`data-hidden`), because
    // a row that leaves takes the whole grid up with it; a row inside a panel
    // has no such problem and is simply not drawn.
    if (searching || remindersOpen) return null;
    // Todos first: it is the one board that has a mode of its own, and both
    // arms would otherwise be true there.
    if (board.kind === "todos") {
      if (todoPile.length === 0) return null;
      const n = todoPile.length;
      return {
        mode: "ticker" as const,
        pile: todoPile,
        label: `Tick off ${n} list${n === 1 ? "" : "s"}`,
      };
    }
    if (tidyPile.length > 0) {
      const n = tidyPile.length;
      return {
        mode: "sorter" as const,
        pile: tidyPile,
        label: `Tidy up ${n} note${n === 1 ? "" : "s"}`,
      };
    }
    return null;
  }, [board.kind, tidyPile, todoPile, searching, remindersOpen]);

  /**
   * The pile the Sorter is working through: the notes those snapshotted ids
   * still name, in the order the Inbox had them. Read back out of `notes` on
   * every render rather than held as objects, so a note edited on the other
   * device — or by an undo here — is the note the Sorter shows. One deleted
   * elsewhere simply drops out.
   */
  const pile = useMemo(
    () =>
      (sortingIds ?? [])
        .map((id) => noteById.get(id))
        .filter((n): n is Note => Boolean(n)),
    [sortingIds, noteById],
  );

  /**
   * The Ticker's pile, read back the same way and for the same reasons — a tick
   * lands on `body`, so the list on screen has to be the note as it is now, not
   * the copy that was snapshotted when the mode opened.
   *
   * A list whose last box has just been ticked **stays** in the pile, which is
   * why this filters on nothing. Dropping it would take the screen out from
   * under the thumb that finished it, and a mis-tick would then have to be
   * undone from somewhere else entirely.
   */
  const ticking = useMemo(
    () =>
      (tickingIds ?? [])
        .map((id) => noteById.get(id))
        .filter((n): n is Note => Boolean(n)),
    [tickingIds, noteById],
  );

  return { inboxPile, modeEntry, pile, ticking };
}
