import type { RefObject } from "react";
import { copyText, joinNotes } from "./clipboard";
import { filePatch, isBoardName, isTodoNote, keptOnLinks, linksPatch } from "./boards";
import { markFor, type Mark } from "../components/Vanish";
import { markedWords, type Undo } from "../store/useUndo";
import { movedWords, putBackWords } from "./movedWords";
import type { Board, Note, UserBoard } from "../types";

interface Options {
  /** The picked ids, in the order they were picked. */
  selected: string[];
  /** The same, as notes. */
  selectedNotes: Note[];
  /** Replace the selection — every verb lets it go with `[]`. */
  setSelected: (ids: string[]) => void;
  /** One note's field write. */
  update: (id: string, patch: Partial<Note>) => void;
  /** The same write over several notes at once. */
  bulkUpdate: (ids: string[], patch: Partial<Note>) => void;
  /** Offer a reversal on the undo strip. */
  pushUndo: (entry: Omit<Undo, "key">) => void;
  /** Which mark a card leaving the board shrinks into. */
  leaveMark: RefObject<Mark | null>;
  /** The notes as they are at the moment a verb runs. */
  notesRef: RefObject<Note[]>;
  /** A note leaving the idea it is in (`lib/useIdeaVerbs.ts`). */
  leaveIdea: (ideaId: string, noteId: string) => { restore: () => void };
  /** Make a folder, for the Move chooser's typed name. */
  createBoard: (name: string) => UserBoard;
  /** Take a folder away again — only the one a move just made, when undone. */
  removeBoard: (id: string) => void;
  /** Step off a folder that is about to go — to the Inbox, if it is the one on
   *  screen (`useFolderVerbs`, the same step deleting a folder takes). */
  leaveBoard: (id: string) => void;
  /** Open or shut the Move chooser. */
  setMoving: (on: boolean) => void;
  /** What the Move chooser says is wrong with a typed name. */
  setMoveError: (error: string | null) => void;
  /** A board's name, for the offer that says where notes went (null is the Inbox). */
  nameOf: (id: string | null) => string | undefined;
  /** The shelf, for where a Put back lands. */
  boards: readonly Board[];
}

/**
 * What the selection's panel does to the notes picked — Archive, Copy,
 * Important, to-do, Move, Links, Delete and Put back — each with its own undo
 * (review PL-10 moved them out of `App.tsx` whole; the comments are the ones
 * they had there). Merge stays in App, beside the canvas it opens.
 */
export function useSelectionVerbs({
  selected,
  selectedNotes,
  setSelected,
  update,
  bulkUpdate,
  pushUndo,
  leaveMark,
  notesRef,
  leaveIdea,
  createBoard,
  removeBoard,
  leaveBoard,
  setMoving,
  setMoveError,
  nameOf,
  boards,
}: Options) {
  /**
   * After a verb the selection lets go — all of it for the panel's verbs, and
   * for a carry only the notes it carried: one unselected card dragged to a
   * board while others are picked leaves the others picked.
   */
  function letGo(ids: readonly string[], given?: Note[]) {
    setSelected(given ? selected.filter((id) => !ids.includes(id)) : []);
  }

  function doArchive() {
    const anyArchived = selectedNotes.some((n) => n.status === "archived");
    const next = anyArchived ? "active" : "archived";
    const ids = selected;
    const before = selectedNotes.map((n) => ({ id: n.id, status: n.status }));
    leaveMark.current = markFor(next);
    bulkUpdate(ids, { status: next });
    setSelected([]);
    pushUndo({
      message: `${next === "archived" ? "Archived" : "Unarchived"} ${ids.length}`,
      steps: before.map((b) => ({
        id: b.id,
        expect: { status: next },
        revert: { status: b.status },
      })),
    });
  }

  /**
   * The selection's text onto the clipboard, in the order it was picked, one
   * blank line between notes. Nothing about the notes changes, so there is
   * nothing to undo — the strip says "Copied 3" with no Undo beside it
   * (`undoable`), and the selection lets go the way it does after any other
   * verb. A refused write says so instead, rather than pretending.
   */
  function doCopy() {
    const count = selectedNotes.length;
    const text = joinNotes(selectedNotes.map((n) => n.body));
    void copyText(text).then((ok) => {
      setSelected([]);
      pushUndo({
        message: ok ? `Copied ${count}` : "Could not copy",
        steps: [],
      });
    });
  }

  function doPriority() {
    const raise = selectedNotes.some((n) => n.priority === 0);
    const next = raise ? 1 : 0;
    // Each note's own previous mark, not a blanket one: a selection is usually
    // mixed, which is the whole reason `raise` has to be worked out at all.
    const before = selectedNotes.map((n) => ({ id: n.id, priority: n.priority }));
    bulkUpdate(selected, { priority: next });
    setSelected([]);
    pushUndo({
      // The verb the panel's Important toggle performed (CD-02).
      message: markedWords("important", raise, before.length),
      steps: before.map((b) => ({
        id: b.id,
        expect: { priority: next },
        revert: { priority: b.priority },
      })),
    });
  }

  /**
   * Marking a whole selection as todos — the second place `note_type` is set
   * by hand, beside the open note's own Todo-toggle (`handleToggleTodo`), and
   * the same write, so the two controls cannot drift apart.
   *
   * This is filing, not editing: `matchesBoard` puts a note typed `todo` on
   * the Todos board, and nothing about the note's text changes. So it follows
   * Move's precedent exactly and does not bump the `body` clock (`editedAt`,
   * `lib/versions.ts`) — marking twelve notes as todos must not drag all
   * twelve to the top of a board sorted on the last edit.
   *
   * A switch in both directions, like Archive: a selection with anything that
   * is not a todo in it gets marked, and a selection that is already all todos
   * gets turned off. Each note's own previous type is what undo restores, since
   * a mixed selection is the ordinary case — the same reason `doPriority` keeps
   * a per-note `before` rather than one blanket value.
   *
   * "Already a todo" is `isTodoNote`, not `note_type === "todo"`, and turning
   * off writes `"note"` rather than `null` — both for the reason stated in
   * `lib/boards.ts`: a note whose every line is a tick box is on Todos by its
   * own text, so a selection of checklists read as "none of these are todos"
   * and clearing them to null took none of them off the board. The row and the
   * open note's mark ask the same question and make the same write, so a
   * selection can never report the opposite of what the note reports about
   * itself.
   */
  function doTodo() {
    const allTodo = selectedNotes.every(isTodoNote);
    const next: Note["note_type"] = allTodo ? "note" : "todo";
    const ids = selected;
    if (ids.length === 0) return;
    const before = selectedNotes.map((n) => ({ id: n.id, note_type: n.note_type }));
    // Clearing the type takes a note off the Todos board, so it leaves into
    // the same mark the open note's toggle uses.
    leaveMark.current = "todo";
    bulkUpdate(ids, { note_type: next });
    setSelected([]);
    pushUndo({
      // The verb the panel's To-do toggle performed (CD-02).
      message: markedWords("to-do", next === "todo", ids.length),
      steps: before.map((b) => ({
        id: b.id,
        expect: { note_type: next },
        revert: { note_type: b.note_type },
      })),
    });
  }

  /**
   * Filing a selection into a board sets `board_id` and nothing else — no
   * text is touched, so this deliberately does not bump the `body` clock and
   * does not reorder a board sorted on the last edit (`sortForBoard`,
   * `lib/boards.ts`). A note already in the chosen board still counts and
   * still reverts on undo, unlike the old tag write: filing is idempotent by
   * nature (there's only one board_id to set), so there's nothing to skip.
   *
   * `given` is the notes a card carried onto a board in the shelf (`useMergeDrag`)
   * — the same move, said with the hand rather than the chooser.
   */
  function doMove(boardId: string | null, made?: UserBoard, given?: Note[]) {
    const picked = given ?? selectedNotes;
    const ids = given ? given.map((n) => n.id) : selected;
    if (ids.length === 0) return;
    const before = picked.map((n) => ({
      id: n.id,
      board_id: n.board_id,
      note_type: n.note_type,
      patch: filePatch(n, boardId),
    }));
    leaveMark.current = "move";
    bulkUpdate(ids, { board_id: boardId });
    // A note the user had put on Links leaves it on the way (`filePatch`).
    const offLinks = picked.filter(keptOnLinks).map((n) => n.id);
    if (offLinks.length > 0) bulkUpdate(offLinks, { note_type: null });
    setMoving(false);
    letGo(ids, given);
    pushUndo({
      message: movedWords(ids.length, nameOf(boardId)),
      steps: before.map((b) => ({
        id: b.id,
        expect: b.patch,
        revert: "note_type" in b.patch
          ? { board_id: b.board_id, note_type: b.note_type }
          : { board_id: b.board_id },
      })),
      // A board this move made goes with it, if nothing is filed there any
      // more: the opposite of making it, never a deletion of anything the user
      // put there. "Anything" is every note still naming it, in any state —
      // including one of the moved notes whose step was skipped because it had
      // moved on, which stays where it is. The notes the steps just wrote are
      // read as the steps left them: the board has not drawn them yet.
      after: made
        ? (fired) => {
            const written = new Map(fired.map((step) => [step.id, step.revert]));
            const named = notesRef.current.some(
              (n) => ({ ...n, ...written.get(n.id) }).board_id === made.id,
            );
            if (named) return;
            removeBoard(made.id);
            // Standing on it, you are taken home like deleting it would (`leaveBoard`).
            leaveBoard(made.id);
          }
        : undefined,
    });
  }

  /**
   * The chooser's Links row, for a selection: every picked note leaves its
   * folder and goes on Links by hand (`keptOnLinks`). Offered only when every
   * picked note carries an address, so nothing lands on a board that means
   * *notes with addresses* without one. Undo puts back each note's own two
   * fields, the same per-note `before` the Move above keeps.
   */
  function doMoveLinks(given?: Note[]) {
    const ids = given ? given.map((n) => n.id) : selected;
    if (ids.length === 0) return;
    const patch = linksPatch();
    const before = (given ?? selectedNotes).map((n) => ({
      id: n.id,
      board_id: n.board_id,
      note_type: n.note_type,
    }));
    leaveMark.current = "move";
    bulkUpdate(ids, patch);
    setMoving(false);
    letGo(ids, given);
    pushUndo({
      message: `Moved ${ids.length} to Links`,
      steps: before.map((b) => ({
        id: b.id,
        expect: patch,
        revert: { board_id: b.board_id, note_type: b.note_type },
      })),
    });
  }

  /** A name typed into the Move chooser that matched no existing board —
   *  makes one, then files the selection into it in the same motion. */
  function doMoveCreate(name: string) {
    if (!isBoardName(name)) {
      setMoveError("A board name is 1 to 40 characters.");
      return;
    }
    setMoveError(null);
    const made = createBoard(name);
    doMove(made.id, made);
  }

  /** Delete is a move to the trash, and it is undoable like everything else.
   *  `given`: notes carried onto the Trash tab, as for `doMove`. */
  function doTrash(given?: Note[]) {
    const ids = given ? given.map((n) => n.id) : selected;
    leaveMark.current = "trash";

    // A selected note that still belongs to an idea has to leave it on the
    // way to the trash, the same bookkeeping the single-note path runs.
    // Everyone else is a plain status change, said the ordinary way.
    const leaves: { id: string; ideaId: string; was: Note["status"]; restore: () => void }[] = [];
    const plain: { id: string; status: Note["status"] }[] = [];
    for (const note of given ?? selectedNotes) {
      const ideaId = note.merged_into ?? null;
      const idea = ideaId ? notesRef.current.find((n) => n.id === ideaId) : undefined;
      if (idea) {
        const { restore } = leaveIdea(idea.id, note.id);
        leaves.push({ id: note.id, ideaId: idea.id, was: note.status, restore });
      } else {
        plain.push({ id: note.id, status: note.status });
      }
    }

    bulkUpdate(ids, { status: "trashed" });
    for (const leave of leaves) update(leave.id, { merged_into: null });
    letGo(ids, given);

    // `run` and `steps` cannot both fire — undo only ever tries one — so the
    // moment any note in the batch needs idea bookkeeping, one `run` has to
    // speak for the whole selection, plain notes included.
    pushUndo(
      leaves.length === 0
        ? {
            message: `Deleted ${ids.length}`,
            steps: plain.map((b) => ({
              id: b.id,
              expect: { status: "trashed" as const },
              revert: { status: b.status },
            })),
          }
        : {
            message: `Deleted ${ids.length}`,
            steps: [],
            run: () => {
              for (const p of plain) update(p.id, { status: p.status });
              for (const leave of leaves) {
                update(leave.id, { status: leave.was, merged_into: leave.ideaId });
                leave.restore();
              }
            },
          },
    );
  }

  function doRestoreFromTrash() {
    const ids = selected;
    leaveMark.current = "restore";
    bulkUpdate(ids, { status: "active" });
    setSelected([]);
    pushUndo({
      message: putBackWords(selectedNotes, boards),
      steps: ids.map((id) => ({
        id,
        expect: { status: "active" as const },
        revert: { status: "trashed" as const },
      })),
    });
  }

  return {
    doArchive,
    doCopy,
    doPriority,
    doTodo,
    doMove,
    doMoveLinks,
    doMoveCreate,
    doTrash,
    doRestoreFromTrash,
  };
}
