import type { RefObject } from "react";
import type { Note, UserBoard } from "../types";
import type { Undo } from "../store/useUndo";

/**
 * A board made on its own, from the capture bar's board mark — not as a step of
 * moving notes (that move's undo takes its board away itself,
 * `lib/useSelectionVerbs.ts`). Making it is a change like any other, so it is
 * offered back: "Made board Kitchen · Undo". Undo takes the board off the shelf
 * again, only while nothing is filed there, and takes you home if you stand on it
 * (`leaveBoard`) — the same rule, so one place says what undoing a made board is.
 *
 * A name that already was a board makes nothing (`createBoard` hands back the one
 * that exists), so it offers nothing.
 */
export function createWithUndo(
  name: string,
  deps: {
    createBoard: (name: string) => UserBoard;
    /** The shelf as it was before this name was made. */
    known: UserBoard[];
    pushUndo: (entry: Omit<Undo, "key">) => void;
    notesRef: RefObject<Note[]>;
    removeBoard: (id: string) => void;
    leaveBoard: (id: string) => void;
  },
): UserBoard {
  const made = deps.createBoard(name);
  if (deps.known.some((b) => b.id === made.id)) return made;
  deps.pushUndo({
    message: `Made board ${made.name}`,
    steps: [],
    // Through `run`, because there is no note to put back. Read at the moment
    // of the undo: a note may have been filed there in the eight seconds since,
    // and that board is then no longer the empty thing this made.
    run: () => {
      if (deps.notesRef.current.some((n) => n.board_id === made.id)) return;
      deps.removeBoard(made.id);
      deps.leaveBoard(made.id);
    },
  });
  return made;
}
