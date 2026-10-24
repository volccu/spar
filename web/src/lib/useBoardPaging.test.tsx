// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SLIDE_OUT_MS } from "./motion";
import { useBoardPaging } from "./useBoardPaging";

/**
 * The shelf's one screen gesture, on its own (SPEC §6): a horizontal swipe
 * walks the boards, a vertical one scrolls and never pages, the far end is a
 * dead end, and the near end is a dead end only where no drawer hangs off it.
 *
 * `App.test.tsx` and `Shelf.test.tsx` swipe the whole app; this file holds the
 * rules those depend on without the rest of the app in the way, including the
 * two things jsdom cannot show unaided — how far the deck follows a finger,
 * and what happens when the slide-out animation never finishes. For those the
 * deck is given a stand-in `animate`, since jsdom has no Web Animations and
 * the hook (through `animates()`) quite rightly does nothing without it.
 */

type Paging = ReturnType<typeof useBoardPaging>;
let paging: Paging;

function Harness({
  lastIndex = 4,
  frozen = false,
  onPullPastStart,
}: {
  lastIndex?: number;
  frozen?: boolean;
  onPullPastStart?: () => void;
}) {
  paging = useBoardPaging({ lastIndex, frozen, onPullPastStart });
  return (
    <div
      data-testid="scroll"
      onTouchStart={paging.onTouchStart}
      onTouchMove={paging.onTouchMove}
      onTouchEnd={paging.onTouchEnd}
    >
      <div ref={paging.deckRef} data-testid="deck">
        {/* A card's row of pictures, one that holds more than it shows and one
            that fits (`useSquaresRow` in NoteCard.tsx). */}
        <div data-scrolls="true">
          <img data-testid="row-picture" alt="" />
        </div>
        <div data-scrolls="false">
          <img data-testid="fitting-picture" alt="" />
        </div>
      </div>
    </div>
  );
}

const scroller = () => screen.getByTestId("scroll");
const deck = () => screen.getByTestId("deck");

function press(x: number, y = 300) {
  fireEvent.touchStart(scroller(), { touches: [{ clientX: x, clientY: y }] });
}
function drag(x: number, y = 300) {
  fireEvent.touchMove(scroller(), { touches: [{ clientX: x, clientY: y }] });
}
function lift(x: number, y = 300) {
  fireEvent.touchEnd(scroller(), { changedTouches: [{ clientX: x, clientY: y }] });
}
function swipe(from: number, to: number, fromY = 300, toY = fromY) {
  press(from, fromY);
  drag(to, toY);
  lift(to, toY);
}

/** Leftwards is forwards along the shelf; rightwards is back. */
const forwards = () => swipe(300, 100);
const back = () => swipe(100, 300);

/** Gives the deck a Web Animations stand-in, and hands back every call. */
function animatable() {
  const played: { keyframes: Keyframe[]; animation: { onfinish: (() => void) | null } }[] = [];
  const el = deck();
  el.animate = vi.fn((keyframes: Keyframe[]) => {
    const animation = { onfinish: null as (() => void) | null, cancel: vi.fn() };
    played.push({ keyframes, animation });
    return animation as unknown as Animation;
  }) as unknown as HTMLElement["animate"];
  el.getAnimations = () => [];
  return played;
}

/** How far the deck is standing off its seat, in px, or 0. */
function offset(): number {
  const m = /translate3d\((-?[\d.]+)px/.exec(deck().style.transform);
  return m ? Number(m[1]) : 0;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useBoardPaging", () => {
  describe("walking the shelf", () => {
    it("opens on the first board, which is the Inbox", () => {
      render(<Harness />);
      expect(paging.boardIndex).toBe(0);
    });

    it("steps forwards on a leftward swipe and back on a rightward one", () => {
      render(<Harness />);
      forwards();
      expect(paging.boardIndex).toBe(1);
      forwards();
      expect(paging.boardIndex).toBe(2);
      back();
      expect(paging.boardIndex).toBe(1);
    });

    it("goes no further than the last board", () => {
      // The far end is a dead end: nothing hangs off it, so a swipe there
      // must not wrap round to the Inbox or step off the end of the list.
      render(<Harness lastIndex={1} />);
      forwards();
      forwards();
      forwards();
      expect(paging.boardIndex).toBe(1);
    });

    it("stays on the first board when there is nothing past it", () => {
      // A desktop passes no drawer: the strip is already on screen.
      render(<Harness />);
      back();
      expect(paging.boardIndex).toBe(0);
    });
  });

  describe("what does not page", () => {
    it("a vertical drag is a scroll, not a page", () => {
      render(<Harness />);
      swipe(200, 210, 100, 500);
      expect(paging.boardIndex).toBe(0);
    });

    it("a diagonal drag that is not clearly sideways does not page", () => {
      // 120 across and 100 down is more across than down, but not by enough
      // to be a swipe: a thumb scrolling a column wanders sideways too.
      render(<Harness />);
      swipe(300, 180, 200, 300);
      expect(paging.boardIndex).toBe(0);
    });

    it("a short sideways nudge is a tap, not a page", () => {
      render(<Harness />);
      swipe(300, 260);
      expect(paging.boardIndex).toBe(0);
    });

    it("a swipe that starts on a row of pictures that scrolls moves the pictures, not the board", () => {
      render(<Harness />);
      const picture = screen.getByTestId("row-picture");
      fireEvent.touchStart(picture, { touches: [{ clientX: 300, clientY: 300 }] });
      fireEvent.touchMove(picture, { touches: [{ clientX: 100, clientY: 300 }] });
      fireEvent.touchEnd(picture, { changedTouches: [{ clientX: 100, clientY: 300 }] });
      expect(paging.boardIndex).toBe(0);
      // And the next swipe, from anywhere else, pages as ever.
      forwards();
      expect(paging.boardIndex).toBe(1);
    });

    it("a row of pictures that fits pages like the rest of the card", () => {
      render(<Harness />);
      const picture = screen.getByTestId("fitting-picture");
      fireEvent.touchStart(picture, { touches: [{ clientX: 300, clientY: 300 }] });
      fireEvent.touchMove(picture, { touches: [{ clientX: 100, clientY: 300 }] });
      fireEvent.touchEnd(picture, { changedTouches: [{ clientX: 100, clientY: 300 }] });
      expect(paging.boardIndex).toBe(1);
    });

    it("nothing pages while frozen", () => {
      // Search and multi-select put something else under the finger; a
      // sideways drag then means neither "next board" nor anything at all.
      const pull = vi.fn();
      const { rerender } = render(<Harness frozen onPullPastStart={pull} />);
      forwards();
      back();
      expect(paging.boardIndex).toBe(0);
      expect(pull).not.toHaveBeenCalled();

      rerender(<Harness frozen={false} onPullPastStart={pull} />);
      forwards();
      expect(paging.boardIndex).toBe(1);
    });

    it("a frozen deck does not follow the finger either", () => {
      render(<Harness frozen />);
      animatable();
      press(300);
      drag(100);
      expect(deck().style.transform).toBe("");
    });
  });

  describe("pulling past the first board", () => {
    it("hands the pull to the drawer, and stays on the first board", () => {
      const pull = vi.fn();
      render(<Harness onPullPastStart={pull} />);
      back();
      expect(pull).toHaveBeenCalledTimes(1);
      expect(paging.boardIndex).toBe(0);
    });

    it("is an ordinary step back anywhere but the first board", () => {
      // The drawer is the next thing along only from the near end; from the
      // second board a rightward swipe is just the way back to the first.
      const pull = vi.fn();
      render(<Harness onPullPastStart={pull} />);
      forwards();
      back();
      expect(paging.boardIndex).toBe(0);
      expect(pull).not.toHaveBeenCalled();
    });

    it("does not fire for a pull too short to be a swipe", () => {
      const pull = vi.fn();
      render(<Harness onPullPastStart={pull} />);
      swipe(100, 140);
      expect(pull).not.toHaveBeenCalled();
    });

    it("leaves the deck where it was, because the drawer is what moves", () => {
      const pull = vi.fn();
      render(<Harness onPullPastStart={pull} />);
      animatable();
      press(100);
      drag(300);
      expect(offset()).toBeGreaterThan(0);
      lift(300);
      expect(pull).toHaveBeenCalledTimes(1);
      expect(deck().style.transform).toBe("");
    });
  });

  describe("the deck following the finger", () => {
    // 200px of drag is well inside every cap, so the rates can be read off
    // directly; the exact numbers are the hook's to tune, the ordering is not.
    function pulled(options: { at?: number; to: number; pull?: () => void; lastIndex?: number }) {
      render(<Harness lastIndex={options.lastIndex} onPullPastStart={options.pull} />);
      for (let i = 0; i < (options.at ?? 0); i++) forwards();
      animatable();
      press(300);
      drag(options.to);
      return offset();
    }

    it("travels with the finger in the direction it is pushed", () => {
      expect(pulled({ at: 1, to: 200 })).toBeLessThan(0);
      cleanup();
      expect(pulled({ at: 1, to: 400 })).toBeGreaterThan(0);
    });

    it("barely gives at a dead end, so the edge is felt without a message", () => {
      const middle = Math.abs(pulled({ at: 1, to: 200 }));
      cleanup();
      const farEnd = Math.abs(pulled({ at: 4, to: 200 }));
      cleanup();
      const nearEnd = Math.abs(pulled({ at: 0, to: 400 }));
      expect(farEnd).toBeGreaterThan(0);
      expect(farEnd).toBeLessThan(middle);
      expect(nearEnd).toBe(farEnd);
    });

    it("gives more at the near end when a drawer is behind it, but less than a page", () => {
      const deadEnd = Math.abs(pulled({ at: 0, to: 400 }));
      cleanup();
      const reveal = Math.abs(pulled({ at: 0, to: 400, pull: () => {} }));
      cleanup();
      const page = Math.abs(pulled({ at: 1, to: 400 }));
      expect(reveal).toBeGreaterThan(deadEnd);
      expect(reveal).toBeLessThan(page);
    });

    it("is held to a limit however far the finger goes", () => {
      const far = Math.abs(pulled({ at: 1, to: -2000 }));
      cleanup();
      const further = Math.abs(pulled({ at: 1, to: -4000 }));
      expect(far).toBeGreaterThan(0);
      expect(further).toBe(far);
    });

    it("stays put for a touch that was decided to be a scroll", () => {
      // Decided once, then stays decided: a grid that shifts sideways while
      // you are scrolling it is unusable, even if the finger drifts later.
      render(<Harness />);
      animatable();
      press(300, 100);
      drag(300, 200);
      drag(100, 210);
      expect(deck().style.transform).toBe("");
    });

    it("springs back when a drag is let go short of a swipe", () => {
      render(<Harness />);
      animatable();
      press(300);
      drag(260);
      expect(offset()).not.toBe(0);
      lift(260);
      expect(deck().style.transform).toBe("");
      expect(paging.boardIndex).toBe(0);
    });
  });

  describe("the slide between boards", () => {
    it("lands on the next board when the slide-out finishes", () => {
      render(<Harness />);
      const played = animatable();
      forwards();
      // Still on the old board while it leaves.
      expect(paging.boardIndex).toBe(0);
      act(() => played[0].animation.onfinish?.());
      expect(paging.boardIndex).toBe(1);
    });

    it("lands anyway if the slide-out never reports finishing", () => {
      // A tab switched away from mid-animation never fires onfinish; without
      // the fallback the board would never change at all.
      vi.useFakeTimers();
      render(<Harness />);
      animatable();
      forwards();
      expect(paging.boardIndex).toBe(0);
      act(() => vi.advanceTimersByTime(SLIDE_OUT_MS + 200));
      expect(paging.boardIndex).toBe(1);
    });

    it("does not pull you back once you have paged on again", () => {
      // The fallback outlives the slide it guards. A second press while the
      // first board is still leaving (a held arrow key, a double tap) leaves a
      // second fallback running for the same board, and it used to land after
      // the *next* page and carry the user back one board.
      vi.useFakeTimers();
      render(<Harness />);
      const played = animatable();
      act(() => paging.goToBoard(1));
      act(() => vi.advanceTimersByTime(SLIDE_OUT_MS - 20));
      act(() => paging.goToBoard(1));
      act(() => played[0].animation.onfinish?.());
      expect(paging.boardIndex).toBe(1);
      act(() => paging.goToBoard(2));
      act(() => played[played.length - 1].animation.onfinish?.());
      expect(paging.boardIndex).toBe(2);
      act(() => vi.advanceTimersByTime(SLIDE_OUT_MS * 4));
      expect(paging.boardIndex).toBe(2);
    });

    it("does not undo a seat change that came after the slide", () => {
      // The board you just paged to moves seat — a folder arriving by sync
      // shifts it along, and `useFollowSeat` follows it with `stayOnBoard`.
      // The fallback for the slide must not then put you back in the old seat,
      // which by now holds a different board.
      vi.useFakeTimers();
      render(<Harness />);
      const played = animatable();
      act(() => paging.goToBoard(3));
      act(() => played[0].animation.onfinish?.());
      expect(paging.boardIndex).toBe(3);
      act(() => paging.stayOnBoard(4));
      act(() => vi.advanceTimersByTime(SLIDE_OUT_MS * 4));
      expect(paging.boardIndex).toBe(4);
    });

    it("slides the new board in, and leaves where it scrolls to alone", () => {
      // Every arrival used to be scrolled to the top here. Each board now
      // comes back to where it was left, which is `useBoardScroll`'s to say —
      // this hook moves the deck sideways and never touches the scroller.
      render(<Harness />);
      const played = animatable();
      scroller().scrollTop = 500;
      forwards();
      act(() => played[0].animation.onfinish?.());
      expect(scroller().scrollTop).toBe(500);
      // Out, then in: the arrival is the second animation.
      expect(played).toHaveLength(2);
    });
  });

  describe("when the shelf changes under you", () => {
    it("never names a board past the end of a shelf that got shorter", () => {
      // Standing on the last board and deleting a folder — here or on the
      // other device — used to hand App an index with no board behind it.
      const { rerender } = render(<Harness lastIndex={4} />);
      for (let i = 0; i < 4; i++) forwards();
      expect(paging.boardIndex).toBe(4);
      rerender(<Harness lastIndex={2} />);
      expect(paging.boardIndex).toBe(2);
    });

    it("stays on the same board at a new seat without sliding", () => {
      // Reordering the shelf moves a folder's seat, not the reader: nothing
      // arrived, so nothing animates.
      render(<Harness />);
      const played = animatable();
      act(() => paging.stayOnBoard(3));
      expect(paging.boardIndex).toBe(3);
      expect(played).toHaveLength(0);
    });

    it("keeps a seat asked for from outside on the shelf", () => {
      render(<Harness lastIndex={2} />);
      act(() => paging.goToBoard(9));
      expect(paging.boardIndex).toBe(2);
      act(() => paging.goToBoard(-3));
      expect(paging.boardIndex).toBe(0);
      act(() => paging.stayOnBoard(9));
      expect(paging.boardIndex).toBe(2);
    });
  });
});
