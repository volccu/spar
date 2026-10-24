import { useEffect, useRef, type RefObject } from "react";
import { TRASH_BOARD } from "./boards";
import { isReturnNavigation, provideReturnSpot, takeReturn } from "./returnState";

interface Options {
  /** The note open now, if any — stashed, and a reason not to restore. */
  openId: string | null;
  /** The board standing on now. */
  board: { id: string };
  /** The scroller whose position is stashed and put back. */
  scrollRef: RefObject<HTMLElement | null>;
  /** The archive is still being read. */
  loading: boolean;
  /** The folder list has been read, so a folder's id can be found. */
  prefsReady: boolean;
  /** The shelf, to find the stashed board's seat on it. */
  boards: ReadonlyArray<{ id: string }>;
  /** The Trash's seat, which hangs off the end of `boards`. */
  trashIndex: number;
  goToBoard: (index: number) => void;
  /**
   * Writes a board's scroll offset down for when it arrives
   * (`useBoardScroll`). A board reached by `goToBoard` is put back where it
   * was *last left in this session*, which on a fresh boot is the top — so
   * the stashed offset has to be handed over as that board's own, or the
   * arrival would scroll straight past it.
   */
  remember: (boardId: string, top: number) => void;
  /** Opens the stashed note by id alone. */
  onReopen: (id: string) => void;
}

/**
 * The way back from a link that took the window (lib/returnState.ts).
 *
 * The first effect keeps the stash provider pointed at the current spot, so
 * the anchor deep in the reader never needs the board or the scroll threaded
 * down to it. The second consumes the stash exactly once per boot, after the
 * archive and the folder list are in — and applies it only on a back/forward
 * boot, the one kind that means "a link navigated this window and the user
 * pressed Back". A bfcache resume never reaches this code, which is the
 * better outcome: the page simply still is where it was. A notification's
 * `?note=` open wins over the stash, which is consumed and dropped.
 */
export function useReturnSpot({
  openId,
  board,
  scrollRef,
  loading,
  prefsReady,
  boards,
  trashIndex,
  goToBoard,
  remember,
  onReopen,
}: Options): void {
  useEffect(() => {
    provideReturnSpot(() => ({
      openId,
      boardId: board.id,
      scrollTop: scrollRef.current?.scrollTop ?? 0,
    }));
    return () => provideReturnSpot(null);
  }, [openId, board, scrollRef]);

  const returnTaken = useRef(false);
  useEffect(() => {
    if (returnTaken.current || loading || !prefsReady) return;
    returnTaken.current = true;
    const spot = takeReturn();
    if (!spot || !isReturnNavigation() || openId) return;
    const idx =
      spot.boardId === TRASH_BOARD.id
        ? trashIndex
        : boards.findIndex((b) => b.id === spot.boardId);
    if (idx >= 0 && spot.boardId !== board.id) {
      // Another board: its offset goes with it, and it arrives there.
      remember(spot.boardId, spot.scrollTop);
      goToBoard(idx);
    } else if (scrollRef.current) {
      // The board already on screen (or one that is gone): nothing will
      // arrive, so the scroller is put back directly.
      scrollRef.current.scrollTop = spot.scrollTop;
    }
    if (spot.openId) onReopen(spot.openId);
  }, [loading, prefsReady, openId, board, boards, trashIndex, goToBoard, remember, onReopen, scrollRef]);
}
