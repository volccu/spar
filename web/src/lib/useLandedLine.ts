import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { homeBoard, matchesBoard } from "./boards";
import type { BarLine } from "../components/CaptureLine";
import { isCanvasIdea } from "./canvas";
import { notesWithReminders } from "./reminders";
import { lazyLinkIndex, savedTwin } from "./savedLinks";
import { searchNotes } from "./search";
import type { Board, Canvas, Note } from "../types";

/**
 * How long the receipt for a capture that landed off the screen stays up
 * before it fades — long enough to read four words and reach for the fifth,
 * and short of the undo window, because it offers nothing to take back.
 */
const LANDED_MS = 5_000;

interface Options {
  /** The Reminders mode holds the grid. */
  remindersOpen: boolean;
  /** What is typed in the search row; a query holds the grid while it runs. */
  query: string;
  /** The board under the grid. */
  board: Board;
  /** The shelf, in order — where a note's home board is looked up. */
  boards: Board[];
  /** The archive, for "which note already holds this address". */
  notes: Note[];
  /** The archive as it is when a tap lands. */
  notesRef: RefObject<Note[]>;
  /** What the grid is holding, so a card is traced once it has arrived. */
  visible: Note[];
  /** Mark a card to draw its border once. */
  setTraceId: (id: string) => void;
  /** End search or the Reminders mode, whichever is up. */
  leaveMode: () => void;
  /** Page to a board by its seat on the shelf. */
  goToBoard: (index: number) => void;
  /** The grid's scroller, and the way back to its top (`useBoardScroll`). */
  scrollRef: RefObject<HTMLElement | null>;
  toTop: () => boolean;
  /** The canvas an idea opens as, made on first open. */
  ensureForIdea: (idea: Note, notes: Note[]) => Canvas;
  /** Open an idea's canvas. */
  setCanvasId: (id: string) => void;
  /** Open a note by id, with no card to grow out of. */
  openById: (id: string) => void;
}

/**
 * The capture bar's one line of words after a save (review PL-10 moved it out
 * of `App.tsx` whole; the comments are the ones it had there).
 */
export function useLandedLine({
  remindersOpen,
  query,
  board,
  boards,
  notes,
  notesRef,
  visible,
  setTraceId,
  leaveMode,
  goToBoard,
  scrollRef,
  toTop,
  ensureForIdea,
  setCanvasId,
  openById,
}: Options) {
  /**
   * Where a capture went, said only when the screen cannot show it — the
   * owner's call of 2026-09-27 (web/CLAUDE.md, "Gestures, and what the app
   * says back").
   *
   * A capture whose card lands in front of you is answered by the card's own
   * border trace and the mascot's nod, and that is still the whole answer
   * there. But written on Links, Files, the Archive or the Trash, under a
   * search, in the Reminders list, or with the bar's board mark pointing at a
   * folder you are not standing on, the note goes somewhere this screen does
   * not hold and only the nod said anything. Then — and only then — the bar
   * carries one line naming the board it went to, with a tap that goes there
   * and traces the card on arrival. It fades by itself; nothing waits on it.
   *
   * "On screen" is asked of the note that was just made, by the same
   * predicates that fill the grid — the mode's, or the board's
   * `matchesBoard` — rather than by looking for its card after the render,
   * so the answer is settled at the moment of the save and not by a race with
   * it. Where it went is `homeBoard`: the first board along the shelf that
   * holds it, which is also the board the tap goes to.
   */
  const [landedLine, setLandedLine] = useState<{
    key: string;
    said: string;
    place?: string;
    verb: string;
    noteId: string;
    /** The board the tap goes to — or `null`, where the tap opens the note. */
    boardId: string | null;
    /** The share's offer: a second verb for the same note. */
    also?: { verb: string; act: () => void };
    leaving: boolean;
  } | null>(null);
  const onScreen = useCallback(
    (note: Note): boolean => {
      if (remindersOpen) return notesWithReminders([note]).length > 0;
      if (query.trim()) return searchNotes([note], query).length > 0;
      return matchesBoard(note, board);
    },
    [remindersOpen, query, board],
  );

  /**
   * The grid is scrolled past its first card, so a note made now lands in the
   * part of the board that is above the screen: the capture asks of the
   * scroller, since the board's own predicates say it is on this board.
   */
  const scrolledPastTop = useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el) return false;
    return el.scrollTop > (el.querySelector<HTMLElement>(".card")?.offsetHeight ?? 0);
  }, [scrollRef]);

  /**
   * Which note already holds an address, for the bar's "Saved … · Open"
   * (`lib/savedLinks.ts`). The index is built on the first question after the
   * notes change and kept until they change again, so a keystroke in the bar
   * is a lookup, never a scan of the archive.
   */
  const indexFor = useMemo(() => lazyLinkIndex(), []);
  const findSaved = useCallback(
    (text: string, except?: string) => savedTwin(indexFor(notes), text, except),
    [indexFor, notes],
  );

  /**
   * What the bar says after a capture: the receipt, only when it landed off
   * the screen; a capture that is on screen clears whatever the last one left
   * up. (A page shared from the phone used to be told "Saved … · Open" here,
   * after the fact, because it was saved unseen; since review 2026-10-04,
   * FX-A-02, it waits in the field, where the bar's own line says it first.)
   *
   * `also` is the share's offer — a second verb for the same note. A picture
   * that arrived by the phone's share sheet is offered Inspiration even when
   * it landed on screen, so the line stands for the offer: "Saved · Open"
   * then, and the usual "In <board> · Go" when it landed off screen. Nothing
   * about a capture that carries no offer changes.
   */
  const landed = useCallback(
    (note: Note, also?: { verb: string; act: () => void }) => {
      // A capture on this board, with the board scrolled down, is the same
      // receipt for the same reason: it went to the top, and the top is out of
      // sight. Not under a search or the Reminders list, which have no top of
      // their own to go back to.
      const above = !remindersOpen && !query.trim() && scrolledPastTop();
      const home = onScreen(note) ? (above ? board : null) : homeBoard(note, boards);
      if (!home && !also) {
        setLandedLine(null);
        return;
      }
      setLandedLine({
        key: `landed:${note.id}`,
        said: home ? `In ${home.name}` : "Saved",
        place: home?.name,
        verb: home ? "Go" : "Open",
        noteId: note.id,
        boardId: home ? home.id : null,
        also,
        leaving: false,
      });
    },
    [onScreen, boards, board, remindersOpen, query, scrolledPastTop],
  );
  // Its few seconds, then it fades (`CaptureLine`) and is taken off.
  useEffect(() => {
    if (!landedLine || landedLine.leaving) return;
    const t = window.setTimeout(
      () => setLandedLine((l) => (l && l.key === landedLine.key ? { ...l, leaving: true } : l)),
      LANDED_MS,
    );
    return () => window.clearTimeout(t);
  }, [landedLine]);
  const dropLanded = useCallback(() => setLandedLine(null), []);
  /**
   * The card to trace once it is actually on the board the receipt went to.
   * Set by the tap, spent by the effect below the moment `visible` holds it,
   * because the board arrives after its slide-out and a trace drawn before
   * then would be drawn on a card that is not there yet.
   */
  const traceOnArrival = useRef<string | null>(null);
  useEffect(() => {
    const id = traceOnArrival.current;
    if (!id || !visible.some((n) => n.id === id)) return;
    traceOnArrival.current = null;
    setTraceId(id);
  }, [visible, setTraceId]);
  /** The receipt's tap: out of whatever mode was over the board, onto the
   *  board it named, and the card traced there once it has arrived. */
  const goToLanded = useCallback(
    (noteId: string, boardId: string) => {
      setLandedLine(null);
      // The board being stood on, scrolled down: up to the card, and trace it
      // now. Nothing changes under the grid, so the effect below that waits
      // for `visible` to hold the card would never fire.
      if (boardId === board.id && !remindersOpen && !query.trim()) {
        toTop();
        setTraceId(noteId);
        return;
      }
      leaveMode();
      const at = boards.findIndex((b) => b.id === boardId);
      traceOnArrival.current = noteId;
      if (at >= 0) goToBoard(at);
    },
    [leaveMode, boards, board, remindersOpen, query, toTop, setTraceId, goToBoard],
  );
  /**
   * "Open" on a note that already holds the address: the note itself, with no
   * card to grow out of — it is very likely on no board in front of you — the
   * way a tapped reminder opens one. An idea opens its canvas, as its card
   * would.
   */
  const openSaved = useCallback(
    (id: string) => {
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;
      setLandedLine(null);
      if (isCanvasIdea(note)) {
        setCanvasId(ensureForIdea(note, notesRef.current).id);
        return;
      }
      openById(note.id);
    },
    [ensureForIdea, openById, notesRef, setCanvasId],
  );
  const barLine = useMemo<BarLine | null>(
    () =>
      landedLine
        ? {
            key: landedLine.key,
            said: landedLine.said,
            place: landedLine.place,
            verb: landedLine.verb,
            act: () => {
              const { noteId, boardId } = landedLine;
              if (boardId) goToLanded(noteId, boardId);
              else openSaved(noteId);
            },
            also: landedLine.also && {
              verb: landedLine.also.verb,
              act: () => {
                setLandedLine(null);
                landedLine.also?.act();
              },
            },
            leaving: landedLine.leaving,
            onGone: dropLanded,
          }
        : null,
    [landedLine, goToLanded, openSaved, dropLanded],
  );

  return { landed, findSaved, openSaved, barLine };
}
