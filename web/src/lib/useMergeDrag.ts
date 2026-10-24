import { useCallback, useRef, useState, type RefObject } from "react";
import { MASCOT_TAG, mascotCatching, mascotPlay } from "../components/mascot-element";
import type { Board, Note } from "../types";
import { TRASH_BOARD } from "./boards";
import {
  besideDropDrawer,
  boardById,
  boardIdUnder,
  DRAWER_DWELL_MS,
  dropVerb,
  reachesBoardRow,
  shelfEdgeScroller,
  type DropVerb,
} from "./shelfDrop";

/** What is being carried, and the card it would land on if let go now. */
export interface MergeDrag {
  sourceIds: string[];
  targetId: string | null;
  /** Over the creature: let go, and it takes the notes for the archive. */
  onRobot?: boolean;
  /** Over a board in the shelf that will take them (`lib/shelfDrop.ts`). */
  shelfId?: string | null;
  /** The boards that would refuse these notes, drawn dimmed while they are carried. */
  refuses?: string[];
  /** A phone's finger reached the board row, and the drawer is open for the drop. */
  drawer?: boolean;
}

interface Options {
  /** Nothing in the Trash is carried anywhere. */
  inTrash: boolean;
  /** The selection, which a held card that is part of it carries whole. */
  selected: string[];
  /** The notes as they are at the moment the finger lifts. */
  notesRef: RefObject<Note[]>;
  /** What a release on another card does — `mergeNotes` in `lib/useIdeaVerbs.ts`. */
  mergeNotes: (sources: Note[]) => void;
  /** What a release on the creature does: archives them, offered back (2026-10-16, owner approved). */
  archiveNotes?: (sources: Note[]) => void;
  /** The shelf, in order (the Trash is added here). */
  boards?: readonly Board[];
  /** What a release on a board in the shelf does — the board's own verb (`shelfDrop.ts`). */
  dropOnShelf?: (sources: Note[], verb: DropVerb) => void;
  /** A phone, whose shelf is a drawer opened by reaching the board row. */
  phone?: boolean;
}

/**
 * useMergeDrag — a card long-pressed and carried on to another card merges
 * the pair (SPEC §6). The card reports the hold, the move and the release
 * (`NoteCard`'s three `onMergeDrag*` props); this is the board's half: which
 * notes are being carried, which card is under the finger, and what a release
 * over one does.
 *
 * Carried on to the header's creature instead, it opens its mouth for them,
 * and let go there it takes them for the archive (2026-10-16, owner approved).
 * Carried on to a board in the shelf, they go there (2026-10-23, owner's ask;
 * `lib/shelfDrop.ts`).
 */
export function useMergeDrag({
  inTrash,
  selected,
  notesRef,
  mergeNotes,
  archiveNotes,
  boards = [],
  dropOnShelf,
  phone = false,
}: Options) {
  const [mergeDrag, setMergeDrag] = useState<MergeDrag | null>(null);
  const mergeDragRef = useRef(mergeDrag);
  mergeDragRef.current = mergeDrag;

  // Read through refs so `startMergeDrag` is one function for the board's
  // whole life. It is handed to every memoised card, and a new one after each
  // selection tap redrew every card on the board (audit PERF-2).
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const inTrashRef = useRef(inTrash);
  inTrashRef.current = inTrash;
  const archiveRef = useRef(archiveNotes);
  archiveRef.current = archiveNotes;
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const dropRef = useRef(dropOnShelf);
  dropRef.current = dropOnShelf;
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const edge = useRef<ReturnType<typeof shelfEdgeScroller> | null>(null);
  /** Where the finger last was: the drop drawer may slide in under a finger that has stopped moving. */
  const lastAt = useRef({ x: -1, y: -1 });
  /** The pause on the board row that opens a phone's drop drawer (`DRAWER_DWELL_MS`). */
  const dwell = useRef(0);
  const stopDwell = () => {
    window.clearTimeout(dwell.current);
    dwell.current = 0;
  };
  /** In or out with the drawer; either way nothing under the old picture is still a target. */
  const setDrawer = (open: boolean) => {
    const current = mergeDragRef.current;
    if (!current || Boolean(current.drawer) === open) return;
    const next = { ...current, drawer: open, targetId: null, onRobot: false, shelfId: null };
    mergeDragRef.current = next;
    mascotCatching(false);
    setMergeDrag(next);
  };

  /** The carried notes, as they are now. */
  const carried = (ids: readonly string[]) =>
    ids
      .map((id) => notesRef.current.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is Note => Boolean(candidate));

  const startMergeDrag = useCallback((note: Note) => {
    if (inTrashRef.current || note.status === "trashed") return;
    const chosen = selectedRef.current;
    const sourceIds = chosen.includes(note.id) ? [...chosen] : [note.id];
    const sources = carried(sourceIds);
    const refuses = [...boardsRef.current, TRASH_BOARD]
      .filter((b) => dropVerb(b, sources) === null)
      .map((b) => b.id);
    const next: MergeDrag = { sourceIds, targetId: null, refuses };
    mergeDragRef.current = next;
    mascotCatching(false);
    edge.current?.stop();
    edge.current = shelfEdgeScroller();
    setMergeDrag(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads only refs
  }, []);

  const moveMergeDrag = useCallback((_note: Note, x: number, y: number) => {
    const element = document.elementFromPoint?.(x, y) ?? null;
    const current = mergeDragRef.current;
    if (!current) return;
    // A board in the shelf first: the strip sits over nothing else, and the
    // drawer opened for the drop stands over the cards.
    const shelf = boardIdUnder(element);
    const shelfId = shelf && !current.refuses?.includes(shelf) ? shelf : null;
    const card = !shelf && element instanceof Element ? element.closest<HTMLElement>(".card[data-id]") : null;
    const targetId = card?.dataset.id ?? null;
    const onRobot = !shelf && element instanceof Element && element.closest(MASCOT_TAG) !== null;
    lastAt.current = { x, y };
    if (x >= 0) edge.current?.follow(x, y);
    // A phone's drawer: in after a pause on the board row, out again when the
    // finger goes back past its edge to the cards.
    if (phoneRef.current && x >= 0) {
      if (!current.drawer && reachesBoardRow(x, y)) {
        if (!dwell.current) dwell.current = window.setTimeout(() => setDrawer(true), DRAWER_DWELL_MS);
      } else stopDwell();
      if (current.drawer && besideDropDrawer(x)) {
        setDrawer(false);
        return;
      }
    }
    const drawer = Boolean(current.drawer);
    mascotCatching(onRobot);
    const nextTarget = targetId && current.sourceIds.includes(targetId) ? null : targetId;
    if (
      nextTarget === current.targetId &&
      onRobot === Boolean(current.onRobot) &&
      shelfId === (current.shelfId ?? null) &&
      drawer === Boolean(current.drawer)
    ) {
      return;
    }
    // The ref moves with the state, not a render later: a cancel moves off the
    // board and ends in the same handler, and its end must see that move — or
    // it would merge into, or archive onto, whatever it was last over. While the
    // drawer is in, only its rows are targets: the cards and the creature are under it.
    const next = drawer
      ? { ...current, targetId: null, onRobot: false, shelfId }
      : { ...current, targetId: nextTarget, onRobot, shelfId };
    mergeDragRef.current = next;
    setMergeDrag(next);
  }, []);

  const endMergeDrag = useCallback((note: Note) => {
    const current = mergeDragRef.current;
    mergeDragRef.current = null;
    setMergeDrag(null);
    mascotCatching(false);
    edge.current?.stop();
    edge.current = null;
    stopDwell();
    if (!current || !current.sourceIds.includes(note.id)) return;
    const sources = carried(current.sourceIds);
    // The drawer arrived under a finger that did not move again: ask where it is now.
    const { x, y } = lastAt.current;
    const resting =
      current.drawer && !current.shelfId && x >= 0 ? boardIdUnder(document.elementFromPoint?.(x, y) ?? null) : null;
    const shelfId = current.shelfId ?? (resting && !current.refuses?.includes(resting) ? resting : null);
    if (shelfId) {
      const board = boardById(boardsRef.current, shelfId);
      const verb = board ? dropVerb(board, sources) : null;
      if (verb && dropRef.current) dropRef.current(sources, verb);
      return;
    }
    // Let go over the drawer but on no board it takes: nothing. The cards and
    // the creature are under it, so nothing there is what the finger meant.
    if (current.drawer) return;
    if (current.onRobot) {
      const taken = sources.filter((n) => n.status === "active");
      if (taken.length > 0 && archiveRef.current) {
        archiveRef.current(taken);
        mascotPlay("gulp");
      }
      return;
    }
    if (!current.targetId) return;
    const target = notesRef.current.find((n) => n.id === current.targetId);
    if (target && sources.length > 0) mergeNotes([...sources, target]);
    // Empty deps on purpose, and safe for a reason worth writing down: this
    // closes over `mergeNotes` as it was on the first render, and holds that
    // version forever. Nothing in that version reads React
    // state directly — the notes come from `notesRef`, the folders from
    // `canvasesRef`, the drag from `mergeDragRef`, and `pushUndo` updates the
    // stack functionally. Every mutable thing on this path is reached through
    // a ref or a functional update, which is the pattern the whole of
    // `App.tsx` uses.
    // If that ever stops being true here, this array has to grow with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mergeDrag, startMergeDrag, moveMergeDrag, endMergeDrag };
}
