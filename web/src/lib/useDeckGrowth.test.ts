// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DECK_PAGE, useDeckGrowth } from "./useDeckGrowth";

/** A stand-in observer the test fires by hand. */
let observers: { fire: (hit: boolean) => void; disconnected: boolean }[] = [];
class FakeObserver {
  private cb: IntersectionObserverCallback;
  disconnected = false;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    observers.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
  fire(hit: boolean) {
    this.cb([{ isIntersecting: hit } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
const live = () => observers.filter((o) => !o.disconnected);

describe("useDeckGrowth", () => {
  const sentinel = document.createElement("div");
  const scroller = { current: document.createElement("main") };
  beforeEach(() => {
    observers = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mounts one page of a long board, and the next as the end comes near", () => {
    const { result } = renderHook(() => useDeckGrowth("all", 3000, sentinel, scroller, false));
    expect(result.current).toBe(DECK_PAGE);
    act(() => live()[0].fire(true));
    expect(result.current).toBe(2 * DECK_PAGE);
    // A sentinel out of reach asks for nothing.
    act(() => live()[0].fire(false));
    expect(result.current).toBe(2 * DECK_PAGE);
  });

  it("starts again at one page when the view changes — a search letter, a new board", () => {
    const { result, rerender } = renderHook(({ view }) => useDeckGrowth(view, 3000, sentinel, scroller, false), {
      initialProps: { view: "q:k" },
    });
    act(() => live()[0].fire(true));
    expect(result.current).toBe(2 * DECK_PAGE);
    rerender({ view: "q:ke" });
    expect(result.current).toBe(DECK_PAGE);
  });

  it("mounts whole a view arriving at a remembered scroll offset", () => {
    const { result } = renderHook(() => useDeckGrowth("archive", 3000, sentinel, scroller, true));
    expect(result.current).toBe(3000);
  });

  it("reaches as far as it is told to, for the open note's card", () => {
    const { result } = renderHook(() => useDeckGrowth("all", 3000, sentinel, scroller, false, 700));
    expect(result.current).toBe(700);
  });

  it("never says more than the board holds, and watches nothing once it is all in", () => {
    const { result } = renderHook(() => useDeckGrowth("inbox", 30, sentinel, scroller, false));
    expect(result.current).toBe(30);
    expect(live()).toHaveLength(0);
  });

  it("mounts everything where nothing can say the end is near", () => {
    vi.unstubAllGlobals();
    const had = globalThis.IntersectionObserver;
    // @ts-expect-error — the browsers this guards against have none.
    delete globalThis.IntersectionObserver;
    try {
      const { result } = renderHook(() => useDeckGrowth("all", 3000, sentinel, scroller, false));
      expect(result.current).toBe(3000);
    } finally {
      if (had) globalThis.IntersectionObserver = had;
    }
  });
});
