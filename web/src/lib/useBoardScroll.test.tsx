// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENTER, SLIDE_IN_MS } from "./motion";
import { useBoardScroll } from "./useBoardScroll";

/**
 * The hook on its own: what is remembered against which board, and how the
 * way to the top moves. `App.boardScroll.test.tsx` drives the same rules
 * through the strip, the drawer and the swipe; this file holds the two things
 * that are easier to see without the app in the way — that a mode's scrolling
 * is written against nothing, and the shape of the move to the top, which
 * needs a stand-in `animate` because jsdom has no Web Animations.
 */

type Scroll = ReturnType<typeof useBoardScroll>;
let hook: Scroll;

function Harness({ owner }: { owner: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);
  hook = useBoardScroll({ scrollRef, deckRef, owner });
  return (
    <div ref={scrollRef} data-testid="scroll" onScroll={hook.onScroll}>
      <div ref={deckRef} data-testid="deck" />
    </div>
  );
}

const scroller = () => screen.getByTestId("scroll");
const deck = () => screen.getByTestId("deck");

function scrollTo(top: number) {
  scroller().scrollTop = top;
  fireEvent.scroll(scroller());
}

afterEach(cleanup);

describe("useBoardScroll", () => {
  it("puts each board back where it was left", () => {
    const { rerender } = render(<Harness owner="inbox" />);
    scrollTo(400);
    rerender(<Harness owner="all" />);
    expect(scroller().scrollTop).toBe(0);
    scrollTo(90);
    rerender(<Harness owner="inbox" />);
    expect(scroller().scrollTop).toBe(400);
    expect(hook.remembered("inbox")).toBe(400);
    expect(hook.remembered("all")).toBe(90);
  });

  it("writes nothing against a board while a mode has the scroller", () => {
    const { rerender } = render(<Harness owner="inbox" />);
    scrollTo(400);
    rerender(<Harness owner={null} />);
    scrollTo(20);
    expect(hook.remembered("inbox")).toBe(400);
    rerender(<Harness owner="inbox" />);
    expect(scroller().scrollTop).toBe(400);
  });

  it("takes an offset handed in for a board that has not arrived yet", () => {
    const { rerender } = render(<Harness owner="inbox" />);
    act(() => hook.remember("archive", 1200));
    rerender(<Harness owner="archive" />);
    expect(scroller().scrollTop).toBe(1200);
  });

  it("goes to the top, and says so only when there was somewhere to go", () => {
    render(<Harness owner="inbox" />);
    expect(hook.toTop()).toBe(false);
    scrollTo(300);
    expect(hook.toTop()).toBe(true);
    expect(scroller().scrollTop).toBe(0);
    expect(hook.remembered("inbox")).toBe(0);
  });

  it("plays the last screen of the way on the arrival curve, never more", () => {
    render(<Harness owner="inbox" />);
    const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);
    deck().animate = animate as unknown as HTMLElement["animate"];
    deck().getAnimations = () => [];
    Object.defineProperty(scroller(), "clientHeight", { configurable: true, value: 800 });

    // Within a screen: the deck starts exactly where the view was.
    scrollTo(300);
    hook.toTop();
    expect(animate).toHaveBeenLastCalledWith(
      [{ transform: "translate3d(0px, -300px, 0)" }, { transform: "translate3d(0px, 0px, 0)" }],
      { duration: SLIDE_IN_MS, easing: ENTER, fill: "backwards" },
    );

    // From further down, one screen short of the top — the move is a
    // screen at most however long the board is.
    scrollTo(5000);
    hook.toTop();
    expect(animate).toHaveBeenLastCalledWith(
      [{ transform: "translate3d(0px, -800px, 0)" }, { transform: "translate3d(0px, 0px, 0)" }],
      expect.objectContaining({ easing: ENTER }),
    );
  });
});
