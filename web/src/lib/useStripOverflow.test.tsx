// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStripOverflow } from "./useStripOverflow";

/**
 * The desktop strip gives the app's own boards a mark and a count instead of
 * their names, but only when the full-width strip would run past its edge
 * (review UX-08, 2026-10-13). jsdom has no layout, so the widths are stood in
 * for on the element; what is held here is the decision, not the pixels.
 */

let widths = { scroll: 900, client: 1000 };

function Harness() {
  const { boardsScroll } = useStripOverflow({
    boards: [],
    counts: [],
    searchOpen: false,
    remindersOpen: false,
    isPhone: false,
  });
  return (
    <div
      data-testid="strip"
      ref={(el) => {
        boardsScroll.current = el;
        if (!el) return;
        Object.defineProperty(el, "scrollWidth", { configurable: true, get: () => widths.scroll });
        Object.defineProperty(el, "clientWidth", { configurable: true, get: () => widths.client });
      }}
    />
  );
}

const strip = () => screen.getByTestId("strip");

afterEach(cleanup);

describe("the strip's compact mode", () => {
  it("leaves every name on when the strip fits", () => {
    widths = { scroll: 900, client: 1000 };
    render(<Harness />);
    expect(strip().dataset.compact).toBeUndefined();
  });

  it("shortens the app's own boards when it would not fit", () => {
    widths = { scroll: 1100, client: 1000 };
    render(<Harness />);
    expect(strip().dataset.compact).toBe("true");
  });

  it("measures again on a resize, and takes it off once there is room", () => {
    widths = { scroll: 1100, client: 1000 };
    render(<Harness />);
    expect(strip().dataset.compact).toBe("true");
    widths = { scroll: 1100, client: 1200 };
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(strip().dataset.compact).toBeUndefined();
  });
});
