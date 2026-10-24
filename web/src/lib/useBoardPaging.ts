import { useLayoutEffect, useRef, useState } from "react";
import { animates, ENTER, EXIT, SLIDE_IN_MS, SLIDE_OUT_MS, stopAnimations } from "./motion";
import { axisOf, isSwipe, settleBack, type SwipeStart } from "./swipe";

/**
 * useBoardPaging — boards are a shelf, and this is moving along it.
 *
 * Fifth of the groups pulled out of `App.tsx`. Boards used to swap between two
 * frames, which said a change had happened and nothing about which way you had
 * gone. Now the deck of cards travels: it follows your finger while you drag,
 * carries on out the side you pushed it, and the next board arrives from the
 * other side and settles. The direction of travel is the whole message — it is
 * what tells you the shelf is a line and where on it you now are.
 *
 * Everything here is one gesture's worth of state, and none of it is any use
 * to the rest of the screen: which board you are on, the element that slides,
 * which side the next one should arrive from, and the finger currently down.
 * What stays in `App.tsx` is what a board *is* — the filter, the tabs, the
 * counts — because that is a question about notes, not about movement.
 */

/** How far the deck follows the finger, and how far it is allowed to get. */
const DRAG_RATE = 0.36;
const DRAG_MAX = 96;
/** The same, at the ends of the shelf, where there is nowhere to go. */
const DRAG_EDGE_RATE = 0.11;
/**
 * And the same again at the near end when there *is* something past it — the
 * drawer. Between the two: more give than a dead end, so the pull reads as
 * uncovering something, and less than a page, so it never reads as a board on
 * its way in.
 */
const DRAG_REVEAL_RATE = 0.22;

interface Options {
  /** The highest board index there is — the trash tab, which is always last. */
  lastIndex: number;
  /**
   * The last board a swipe may reach, where that is short of `lastIndex`: a
   * Trash hidden in Settings is still a board you can be taken to (the menu's
   * Trash row), but swiping past All no longer finds it (2026-10-23).
   */
  swipeLast?: number;
  /**
   * Paging stands down entirely while this is true.
   *
   * Searching and multi-select both put something else under the finger, and a
   * horizontal drag then means neither "next board" nor nothing — it means the
   * app is fighting you. The gesture budget is fixed (SPEC §6): a horizontal
   * screen swipe is spent on paging and cannot also mean something else.
   */
  frozen: boolean;
  /**
   * A pull past the near end of the shelf — the one direction with no board on
   * the other side of it.
   *
   * The shelf runs left to right and the drawer hangs off its left edge, so
   * carrying on leftwards from the first board is not an edge at all: it is the
   * next thing along, and the drawer is what is there. Left undefined where
   * nothing is hiding off that edge — a desktop, where the strip is already on
   * screen — and the pull is a dead end again, resistance and all.
   */
  onPullPastStart?: () => void;
}

/**
 * Where a sideways swipe belongs to what is under the finger, not to the shelf:
 * a card's row of pictures that holds more than it shows (`useSquaresRow` in
 * `NoteCard.tsx`). A touch that starts there never pages; one that starts
 * anywhere else on the same card still does.
 */
export const SWIPES_ITSELF = '[data-scrolls="true"]';

export function useBoardPaging({
  lastIndex,
  swipeLast,
  frozen,
  onPullPastStart,
}: Options) {
  const swipeEnd = Math.min(lastIndex, swipeLast ?? lastIndex);
  const [seat, setSeat] = useState(0);
  /**
   * The shelf can get shorter while you are standing on it — a folder deleted
   * here, or one deleted on the other device and arriving through sync — and
   * the number in state then names a seat that is no longer on the shelf.
   * Every writer below clamps, but a clamp at write time cannot know about a
   * list that changes afterwards, and the reader (`boards[boardIndex]` in
   * `App.tsx`) handed back `undefined` and took the whole app down with it:
   * standing on the Trash and deleting a folder was a crash, from either
   * device. So the clamp is on the way *out* as well, where it cannot be
   * missed — whatever the shelf has just become, the index this hook hands
   * back names a board that is on it.
   *
   * *Which* board it ought to name after the list changes is a different
   * question, and not one this hook can answer: it knows how long the shelf is
   * and nothing about what is on it. `useFollowSeat` follows the board you were
   * standing on by identity. This is the guard that keeps
   * the render alive until it does.
   */
  const boardIndex = Math.min(seat, lastIndex);
  const setBoardIndex = setSeat;
  const deckRef = useRef<HTMLDivElement | null>(null);
  /** Which side the next board should arrive from. Only `goToBoard` sets it,
   *  so nothing animates on a board you did not move to. */
  const enterFrom = useRef(0);
  const touch = useRef<SwipeStart | null>(null);
  // The timeout below fires after the state it is guarding may have changed.
  const boardIndexRef = useRef(boardIndex);
  boardIndexRef.current = boardIndex;
  /** The backup for the slide still in flight, if any — see `goToBoard`. */
  const lateLanding = useRef<number | undefined>(undefined);
  /** Any newer change of seat takes the place of the one a backup was for. */
  function dropLateLanding() {
    window.clearTimeout(lateLanding.current);
    lateLanding.current = undefined;
  }

  function goToBoard(next: number) {
    const i = Math.min(lastIndex, Math.max(0, next));
    const el = deckRef.current;
    if (i === boardIndex) {
      settleBack(el);
      return;
    }
    const dir = i > boardIndex ? 1 : -1;
    dropLateLanding();
    if (!el || !animates(el)) {
      if (deckRef.current) deckRef.current.style.transform = "";
      enterFrom.current = 0;
      setBoardIndex(i);
      return;
    }
    // Carry on from wherever the finger left it, so the drag and the throw are
    // one movement rather than a snap back followed by a slide.
    const held = el.style.transform || "translate3d(0px, 0px, 0)";
    el.style.transform = "";
    enterFrom.current = dir;
    const out = el.animate(
      [
        { transform: held, opacity: 1 },
        { transform: `translate3d(${-dir * 64}px, 0, 0)`, opacity: 0 },
      ],
      { duration: SLIDE_OUT_MS, easing: EXIT, fill: "forwards" },
    );
    out.onfinish = () => setBoardIndex(i);
    // A tab switched away from mid-animation never fires onfinish, and the
    // board would then never change, so a backup lands it a little late. The
    // ref only spares it a second render when onfinish already landed; it
    // does nothing to stop the backup *moving* the user, since any board they
    // went to afterwards also differs from `i`. What stops that is the clear:
    // every later change of seat — another page, `stayOnBoard` — drops this
    // backup first, so it can never carry the user back a board.
    lateLanding.current = window.setTimeout(() => {
      lateLanding.current = undefined;
      if (boardIndexRef.current !== i) setBoardIndex(i);
    }, SLIDE_OUT_MS + 120);
  }

  // The other half: the new board arrives from the side it was reached from
  // and decelerates hard into place. Where it arrives *vertically* is not this
  // hook's business: it used to scroll every arrival to the top, and now each
  // board comes back to where it was left (`useBoardScroll`, in the same
  // commit, so the slide-in already carries the board at its offset).
  useLayoutEffect(() => {
    const el = deckRef.current;
    const dir = enterFrom.current;
    enterFrom.current = 0;
    if (!el) return;
    stopAnimations(el);
    el.style.transform = "";
    if (dir === 0 || !animates(el)) return;
    el.animate(
      [
        { transform: `translate3d(${dir * 72}px, 0, 0)`, opacity: 0 },
        { transform: "translate3d(0px, 0px, 0)", opacity: 1 },
      ],
      // Backwards, not both: a filled animation outranks an inline style
      // forever, and the next drag writes an inline style. Held after it
      // finished, this one would quietly freeze the deck.
      { duration: SLIDE_IN_MS, easing: ENTER, fill: "backwards" },
    );
  }, [boardIndex]);

  // Horizontal swipe pages between boards — the only screen gesture (SPEC §6).
  function onTouchStart(e: React.TouchEvent) {
    if ((e.target as Element | null)?.closest?.(SWIPES_ITSELF)) {
      touch.current = null;
      return;
    }
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, axis: "?" };
  }

  function onTouchMove(e: React.TouchEvent) {
    const start = touch.current;
    if (!start || frozen) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Decide once which way this touch is going, then stay decided — a grid
    // that shifts sideways while you are scrolling it is unusable.
    if (start.axis === "?") {
      start.axis = axisOf(dx, dy);
      if (start.axis === "?") return;
      // A board still arriving must give way to a finger on it.
      if (start.axis === "x") stopAnimations(deckRef.current);
    }
    if (start.axis !== "x") return;
    const el = deckRef.current;
    if (!animates(el)) return;
    // At the ends of the shelf the deck barely gives, which is how a physical
    // thing says "there is nothing past this" without a message. The near end
    // is only a dead end where nothing is behind it: with a drawer there, the
    // deck gives enough for the pull to feel like it is going somewhere.
    const pastStart = dx > 0 && boardIndex <= 0;
    const reveals = pastStart && !!onPullPastStart;
    const atEnd = (dx < 0 && boardIndex >= swipeEnd) || pastStart;
    const pull = dx * (reveals ? DRAG_REVEAL_RATE : atEnd ? DRAG_EDGE_RATE : DRAG_RATE);
    const clamped = Math.max(-DRAG_MAX, Math.min(DRAG_MAX, pull));
    el.style.transform = `translate3d(${clamped}px, 0, 0)`;
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || frozen) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!isSwipe(dx, dy)) {
      settleBack(deckRef.current);
      return;
    }
    // One board short of the first one is the drawer. The deck goes back where
    // it was — the drawer is what moves — and the same swipe that pages between
    // boards carries on into the shelf itself.
    if (dx > 0 && boardIndex <= 0 && onPullPastStart) {
      settleBack(deckRef.current);
      onPullPastStart();
      return;
    }
    if (dx < 0 && boardIndex >= swipeEnd) {
      settleBack(deckRef.current);
      return;
    }
    goToBoard(boardIndex + (dx < 0 ? 1 : -1));
  }

  /**
   * The same board, at a different index.
   *
   * `setBoardIndex` is deliberately not returned — everything outside goes
   * through `goToBoard`, which is what keeps the movement and the index from
   * disagreeing about which board you are on — and this is the one carve-out,
   * stated rather than leaked. Reordering the shelf moves a folder's *seat*
   * without moving the user: the board in front of you is still the one you
   * were reading, but the number naming it has changed, and left alone
   * `boardIndex` would quietly hand you whichever board took the old seat.
   *
   * Nothing animates, because nothing arrived. A page is how you get to another
   * board, and this is the opposite: it is how you stay on this one.
   */
  function stayOnBoard(next: number) {
    dropLateLanding();
    enterFrom.current = 0;
    setBoardIndex(Math.min(lastIndex, Math.max(0, next)));
  }

  return { boardIndex, goToBoard, stayOnBoard, deckRef, onTouchStart, onTouchMove, onTouchEnd };
}
