// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePeek } from "./usePeek";

const WAIT = 150;

interface FakeAnimation {
  onfinish: (() => void) | null;
  cancel: () => void;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A card that is 100px in its row and 200px grown, and records every animation
 * played on it. jsdom has neither layout nor Web Animations, so both are the
 * smallest stand-ins `usePeek` and `animates()` will accept.
 */
function mountCard() {
  const el = document.createElement("div");
  const played: FakeAnimation[] = [];
  let grown = false;
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => (grown ? 200 : 100) });
  (el as unknown as { animate: () => FakeAnimation }).animate = () => {
    const a: FakeAnimation = { onfinish: null, cancel: () => {} };
    played.push(a);
    return a;
  };
  const hook = renderHook(() => {
    const peek = usePeek({ el: { current: el }, wait: WAIT, selecting: false, canPeek: true });
    grown = peek.peek;
    return peek;
  });
  return { ...hook, played };
}

describe("a card the pointer comes back to while it is still closing", () => {
  it("peeks again, measured from its height in the row", () => {
    const { result, played } = mountCard();

    act(() => result.current.startPeek());
    act(() => {
      vi.advanceTimersByTime(WAIT);
    });
    expect(result.current.peek).toBe(true);
    expect(result.current.collapsed.current).toBe(100);

    // The pointer leaves: the clip starts to close, and `peek` stays true
    // until it has finished.
    act(() => result.current.dropPeek(true));
    const closing = played[played.length - 1];
    expect(result.current.peek).toBe(true);

    // ...and comes straight back, inside the close.
    act(() => result.current.startPeek());
    act(() => {
      vi.advanceTimersByTime(WAIT);
    });
    // The close finishing late must not take the new peek down with it.
    act(() => closing.onfinish?.());

    expect(result.current.peek).toBe(true);
    expect(result.current.peeking.current).toBe(true);
    expect(result.current.collapsed.current).toBe(100);
  });
});
