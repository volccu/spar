import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { animates, ENTER, SLIDE_IN_MS, stopAnimations } from "./motion";

/**
 * useBoardScroll — each board keeps its place, and the tab you are on takes
 * you to the top of it.
 *
 * The boards share one scroller (`main.scroll` in `App.tsx`), so until this
 * existed a board had no scroll position of its own: paging away and back
 * landed at the top every time, forty cards down the Archive or not, and the
 * reader had to find their place again by reading. Now every board remembers
 * where it was left for as long as the app is open, and a board you page back
 * to — by swipe, strip tab or drawer — arrives already standing there.
 *
 * **In memory, not in `sessionStorage`, and that is a decision.** A fresh open
 * is supposed to land on the Inbox at the top; a board remembered across a
 * reload would open mid-pile on a pile that has since changed under it. The
 * one boot that *should* come back mid-board — Back out of a link that took
 * the window — already has its own stash (`lib/returnState.ts`), and it hands
 * its offset in here through `remember` so the board it restores arrives in
 * place too.
 *
 * **The scroller is lent, never shared.** Search and the Reminders list put
 * their own cards in the same scroller; `owner` is null while they do, so
 * nothing they scroll is written down against the board underneath, and
 * leaving the mode puts that board back where it was left. A note or a drawer
 * standing over the board changes nothing: the board is still the one being
 * shown, it is only covered, and the card a closing note shrinks back into is
 * still where the note grew out of.
 *
 * What it deliberately does *not* do is chase a capture. A new note lands at
 * the top of a board you may be scrolled far down, and the trace is how that
 * card says where it is — the same as before this hook existed. Dragging the
 * reader to the top on every save would spend their place to report a fact
 * the trace already reports.
 */

interface Options {
  /** The one scroller every board is shown in. */
  scrollRef: RefObject<HTMLElement | null>;
  /** The deck inside it — what moves when the board goes to the top. */
  deckRef: RefObject<HTMLElement | null>;
  /**
   * The board the scroller is showing, by id, or null while a mode (search,
   * the Reminders list) has borrowed the grid and nothing it scrolls belongs
   * to a board.
   */
  owner: string | null;
}

export function useBoardScroll({ scrollRef, deckRef, owner }: Options) {
  // One map for the life of the app, read during render by `remembered` — so a
  // piece of state that is never set, rather than a ref, which a render may
  // not read. Nothing about it needs React to redraw when it changes: every
  // write is a scroll the browser has already drawn.
  const [offsets] = useState(() => new Map<string, number>());
  /** Who the scroller is being scrolled for, as of the last commit. */
  const ownerRef = useRef(owner);

  const write = useCallback(
    (key: string, top: number) => {
      // Zero is the default, so it is kept as nothing rather than as a number.
      if (top > 0) offsets.set(key, top);
      else offsets.delete(key);
    },
    [offsets],
  );

  /**
   * The scroller's own `onScroll`. It reads the live `scrollTop` rather than
   * anything the event carries, so a scroll the browser dispatches a frame
   * late — the clamp after a shorter board came in — records where the
   * scroller actually is, under the board it is actually showing.
   */
  const onScroll = useCallback(() => {
    const key = ownerRef.current;
    const el = scrollRef.current;
    if (key === null || !el) return;
    write(key, el.scrollTop);
  }, [scrollRef, write]);

  /**
   * A board arriving, or coming back from a mode, stands where it was left.
   *
   * A layout effect, in the commit that puts the new board's cards in: the
   * paging hook's slide-in starts in that same commit, so the board slides in
   * already at its offset and never jumps after landing. A board with nothing
   * remembered goes to the top, which is what every arrival did before.
   * Where the board has got shorter since, the browser clamps the offset and
   * the clamped value is what is kept — the same place the reader would find
   * by scrolling to the bottom.
   */
  useLayoutEffect(() => {
    if (ownerRef.current === owner) return;
    ownerRef.current = owner;
    const el = scrollRef.current;
    if (owner === null || !el) return;
    el.scrollTop = offsets.get(owner) ?? 0;
    write(owner, el.scrollTop);
  }, [owner, scrollRef, offsets, write]);

  /**
   * What this board will arrive at, for `useGridFill`. A board that arrives
   * a screenful at a time cannot also arrive a thousand pixels down: the
   * offset would be clamped against the forty cards that are in, and the
   * reader dropped somewhere else. So a board with a place to come back to
   * mounts whole, and pays the one bigger commit for arriving where it was.
   */
  const remembered = useCallback((key: string | null) => (key ? (offsets.get(key) ?? 0) : 0), [
    offsets,
  ]);

  /** Set before a board is arrived at by some other road than scrolling it. */
  const remember = write;

  /**
   * The tab you are already on, pressed again: back to the top of the board.
   *
   * Returns false when there is nowhere to go — already at the top — so the
   * caller can do what that press did before. The scroller jumps and the deck
   * plays the last stretch of the way: it starts drawn where the old view was
   * (or one screen short of the top, from further down, so the move is never
   * longer than a screen) and settles onto the top on the app's own arrival
   * curve and timing. It is a scroll said in the motion language, and costs a
   * transform however long the board is; under reduced motion it is the jump
   * alone.
   */
  const toTop = useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el || el.scrollTop <= 0) return false;
    const from = Math.min(el.scrollTop, el.clientHeight || el.scrollTop);
    el.scrollTop = 0;
    if (ownerRef.current !== null) write(ownerRef.current, 0);
    const deck = deckRef.current;
    if (animates(deck)) {
      stopAnimations(deck);
      deck.animate(
        [
          { transform: `translate3d(0px, ${-from}px, 0)` },
          { transform: "translate3d(0px, 0px, 0)" },
        ],
        // Backwards, never both, for the paging hook's reason: the next swipe
        // writes an inline transform, which a filled animation would outrank.
        { duration: SLIDE_IN_MS, easing: ENTER, fill: "backwards" },
      );
    }
    return true;
  }, [scrollRef, deckRef, write]);

  return { onScroll, remembered, remember, toTop };
}
