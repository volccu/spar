import { useEffect, useRef } from "react";
import { INBOX_BOARD, TRASH_BOARD } from "./boards";

interface Options {
  /** The shelf, in order — the Trash hangs off its end and is added here. */
  boards: ReadonlyArray<{ id: string }>;
  /** The seat `useBoardPaging` says you are in. */
  boardIndex: number;
  /** `useBoardPaging`'s way to change the seat without paging. */
  stayOnBoard: (next: number) => void;
}

/**
 * The seat follows the board you are on, not the number naming it.
 *
 * `boardIndex` is a position on the shelf, and the shelf changes length
 * without asking: a folder deleted here, a folder *made or deleted on the
 * other device* and arriving through sync — which no handler on this screen
 * ever sees. Three things then went wrong at once. Standing on the Trash and
 * losing a folder put `boardIndex` past the end and `boards[boardIndex]` came
 * back `undefined`, which took the whole app down to the error screen (the
 * clamp in `useBoardPaging` is the guard for that, and it is only a guard).
 * Standing on **All** and losing a folder slid the Trash into the seat All
 * had been in, so the user was moved to the Trash without asking. And a
 * folder *arriving* shifts Archive and every lens one seat along, so a phone
 * sitting on All quietly became a phone sitting on Files.
 *
 * `handleMoveBoard` has always followed the board across a reorder, for
 * exactly this reason, by hand. This is the same rule stated once for every
 * way the list can change, including the ones no local handler is standing
 * next to: remember which board the seat holds, and when the *list* changes
 * underneath it — not when the user moves, which is the other reason these
 * two can disagree — put the number back on the board it named. A board that
 * is genuinely gone (deleted elsewhere, or hidden in Settings) lands on the
 * Inbox, where every other way off a vanished board lands (2026-10-23).
 */
export function useFollowSeat({ boards, boardIndex, stayOnBoard }: Options): void {
  const seatRef = useRef<{ id: string; shelf: string }>({ id: INBOX_BOARD.id, shelf: "" });
  useEffect(() => {
    const ids = [...boards.map((b) => b.id), TRASH_BOARD.id];
    const shelf = ids.join("\n");
    if (shelf === seatRef.current.shelf) {
      // The shelf held still, so a change of seat is the user's own doing.
      seatRef.current.id = ids[boardIndex] ?? seatRef.current.id;
      return;
    }
    seatRef.current.shelf = shelf;
    const moved = ids.indexOf(seatRef.current.id);
    if (moved >= 0 && moved !== boardIndex) {
      stayOnBoard(moved);
      return;
    }
    // The board you stood on left the shelf (hidden in Settings, or a folder
    // deleted on the other device): the Inbox, where every other way off a
    // vanished board lands, rather than whichever board slid into its seat.
    if (moved < 0 && boardIndex !== 0) {
      seatRef.current.id = ids[0];
      stayOnBoard(0);
      return;
    }
    seatRef.current.id = ids[boardIndex] ?? ids[0];
  }, [boards, boardIndex, stayOnBoard]);
}
