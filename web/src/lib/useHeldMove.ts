import { useCallback, useEffect, useRef } from "react";
import type { Note } from "../types";
import type { Undo } from "../store/useUndo";

/** What `useUndo` offers: a reversal, kept for Ctrl+Z and shown on the strip. */
type Offer = (entry: Omit<Undo, "key">) => void;

/**
 * useHeldMove — a move made from the open note, held until the note closes
 * (review UX-B-03). Filing from the note's Move chooser took it off its board
 * with no offer back, while Move from a selection and Archive from the same
 * note both made one. It is offered on the board because that is where an
 * offer can be seen and pressed — only an `inPlace` offer stands over the
 * sheet, and Ctrl+Z stands down while a note is open — so pushed at the moment
 * of the move it would spend its eight seconds under the sheet. Held, every
 * move made while the note was open folds into one entry that puts back the
 * board (and the Links mark) it was opened with.
 *
 * Anything else offered meanwhile goes on the stack *after* it (`pushUndo`),
 * so Delete pressed on a note just moved is undone first, the move second —
 * the order they happened in.
 *
 * `offerNow` is `useUndo`'s own `pushUndo`; `openId` is the note that is open.
 * What comes back is `holdMove`, to be called where a move is made from the
 * open note, and `pushUndo`, which every other offer goes through so a held
 * move is let out ahead of it.
 */
export function useHeldMove(offerNow: Offer, openId: string | null) {
  const heldMove = useRef<{
    id: string;
    message: string;
    before: Pick<Note, "board_id" | "note_type"> & Partial<Pick<Note, "status">>;
    typed: boolean;
    expect: Partial<Note>;
  } | null>(null);
  const offerHeldMove = useCallback(() => {
    const held = heldMove.current;
    if (!held) return;
    heldMove.current = null;
    offerNow({
      message: held.message,
      steps: [
        {
          id: held.id,
          expect: held.expect,
          revert: {
            ...(held.typed ? held.before : { board_id: held.before.board_id }),
            // A note moved out of the Trash goes back into it (audit UX-2).
            ...(held.before.status ? { status: held.before.status } : {}),
          },
        },
      ],
    });
  }, [offerNow]);
  const pushUndo = useCallback(
    (entry: Parameters<typeof offerNow>[0]) => {
      offerHeldMove();
      offerNow(entry);
    },
    [offerHeldMove, offerNow],
  );

  /** Holds one open-note move to be offered back when the note closes. A
   *  second move of the same note keeps the first one's `before`, so undo
   *  returns it to where it was opened. */
  const holdMove = useCallback((note: Note, patch: Partial<Note>, message: string) => {
    const was = heldMove.current?.id === note.id ? heldMove.current : null;
    heldMove.current = {
      id: note.id,
      message,
      before: was?.before ?? {
        board_id: note.board_id,
        note_type: note.note_type,
        ...(note.status === "trashed" ? { status: note.status } : {}),
      },
      typed: (was?.typed ?? false) || "note_type" in patch,
      expect: patch,
    };
  }, []);

  // The note it was made in has closed — or been swiped past — so the held
  // move is offered on the board now.
  useEffect(() => {
    if (heldMove.current && heldMove.current.id !== openId) offerHeldMove();
  }, [openId, offerHeldMove]);

  return { holdMove, pushUndo };
}
