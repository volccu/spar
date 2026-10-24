// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mascot } from "./Mascot";
import { MASCOT_TAG, mascotTap, type MascotState } from "./mascot-element";
import { emptiedJustNow, leftByHand, resetEmptiedByHand, useWakeOnEmptied, EMPTIED_WINDOW_MS } from "../lib/emptiedByHand";

/**
 * The joy picks of 2026-10-14 that live in the creature: tapping along to the
 * write box, opening one eye when the sleeping one is poked, and arriving
 * awake on a board you have just emptied.
 */

let frames: FrameRequestCallback[] = [];
let clock = 0;

beforeEach(() => {
  frames = [];
  clock = 1000;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEmptiedByHand();
});

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduce : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

/** Runs the animation frames for `ms` of time, a 60th of a second at a time. */
function run(ms: number) {
  const end = clock + ms;
  while (clock < end) {
    clock += 1000 / 60;
    const now = frames;
    frames = [];
    now.forEach((cb) => cb(clock));
  }
}

function mount(state: MascotState = "idle", wake = 0) {
  const { container, rerender } = render(<Mascot state={state} wake={wake} />);
  const host = container.querySelector(MASCOT_TAG)!;
  const q = (sel: string) => host.shadowRoot!.querySelector(sel);
  return { host, q, rerender };
}

/** The numbers out of a transform attribute, in order. */
function nums(el: Element | null): number[] {
  return (el?.getAttribute("transform") ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
}

describe("tapping along to the write box", () => {
  it("dips the body on a keystroke, keeps it on its legs, and comes to rest", () => {
    stubReducedMotion(false);
    const { q } = mount("idle");
    mascotTap();
    run(70);

    const body = nums(q(".tap-body"));
    // translate(0 drop) translate(50 75) scale(sx sy) translate(-50 -75)
    const drop = body[1];
    expect(drop).toBeGreaterThan(0.4);
    expect(drop).toBeLessThanOrEqual(2.4);
    expect(body[4]).toBeGreaterThan(1); // wider
    expect(body[5]).toBeLessThan(1); // shorter
    // The legs shorten by exactly the drop, about the feet: the body's base and
    // the legs' tops stay the same point.
    const legs = nums(q(".legs"));
    expect(legs[3]).toBeCloseTo((10 - drop) / 10, 3);
    // The antenna leans after it, and the eyes look down at the words.
    expect(q(".tap-antenna")!.getAttribute("transform")).toMatch(/^rotate\(/);
    expect(nums(q(".face"))[1]).toBeGreaterThan(0);

    // Long after the last key, every part is back where it was drawn.
    run(3000);
    expect(q(".tap-body")!.hasAttribute("transform")).toBe(false);
    expect(q(".legs")!.hasAttribute("transform")).toBe(false);
    expect(q(".tap-antenna")!.hasAttribute("transform")).toBe(false);
    expect(q(".face")!.hasAttribute("transform")).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("never dips further than the capture's own nod, however fast you type", () => {
    stubReducedMotion(false);
    const { q } = mount("idle");
    let deepest = 0;
    for (let i = 0; i < 40; i++) {
      mascotTap();
      run(50);
      deepest = Math.max(deepest, nums(q(".tap-body"))[1]);
    }
    // Two units is the nod's drop; the clamp allows a hair over for the spring.
    expect(deepest).toBeLessThanOrEqual(2.4);
  });

  it("does not tap along asleep, or under reduced motion", () => {
    stubReducedMotion(false);
    const asleep = mount("empty");
    mascotTap();
    run(100);
    expect(asleep.q(".tap-body")!.hasAttribute("transform")).toBe(false);
    cleanup();

    stubReducedMotion(true);
    const reduced = mount("idle");
    mascotTap();
    run(100);
    expect(reduced.q(".tap-body")!.hasAttribute("transform")).toBe(false);
  });
});

describe("the sleeping creature, poked, opens one eye", () => {
  it("looks at you with one eye, then goes back to sleep with fresh Zs", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { host, q } = mount("empty");
    expect(q(".face .eye")).toBeNull();
    expect(q(".extras .z")).not.toBeNull();

    fireEvent.click(host);
    // One eye open, the other still the sleeping line.
    expect(host.shadowRoot!.querySelectorAll(".face .eye")).toHaveLength(1);
    expect(q(".face line")).not.toBeNull();
    expect(q(".extras .z")).toBeNull();
    // Still the empty board's creature to a screen reader.
    expect(host.getAttribute("aria-label")).toBe("Nothing here yet");

    act(() => vi.advanceTimersByTime(1300 + 70));
    expect(q(".face .eye")).toBeNull();
    expect(q(".extras .z")).not.toBeNull();
  });

  it("does not open an eye under reduced motion", () => {
    stubReducedMotion(true);
    const { host, q } = mount("empty");
    fireEvent.click(host);
    expect(q(".face .eye")).toBeNull();
  });

  it("an awake creature poked only startles", () => {
    stubReducedMotion(false);
    const { host } = mount("idle");
    fireEvent.click(host);
    expect(host.shadowRoot!.querySelectorAll(".face .eye")).toHaveLength(2);
  });
});

describe("arriving awake on a board you just emptied", () => {
  it("is awake for a moment, then dims to sleep", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { q } = mount("empty", 1);
    expect(q("svg")!.classList.contains("is-idle")).toBe(true);
    expect(q(".face .eye")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1100 + 70));
    expect(q("svg")!.classList.contains("is-empty")).toBe(true);
    expect(q(".face .eye")).toBeNull();
    expect(q(".extras .z")).not.toBeNull();
  });

  it("is simply asleep on a board that was already empty", () => {
    stubReducedMotion(false);
    const { q } = mount("empty", 0);
    expect(q("svg")!.classList.contains("is-empty")).toBe(true);
    expect(q(".face .eye")).toBeNull();
  });

  it("wakes again when the board is emptied again while it is there", () => {
    stubReducedMotion(false);
    vi.useFakeTimers();
    const { q, rerender } = mount("empty", 0);
    rerender(<Mascot state="empty" wake={1} />);
    expect(q(".face .eye")).not.toBeNull();
  });
});

describe("knowing the board was emptied by hand", () => {
  it("counts a leave only for a moment", () => {
    leftByHand("undo", 10_000);
    expect(emptiedJustNow(10_000 + EMPTIED_WINDOW_MS)).toBe(true);
    expect(emptiedJustNow(10_000 + EMPTIED_WINDOW_MS + 1)).toBe(false);
  });

  it("starts awake right after a leave, counts later ones, and forgets while hidden", () => {
    leftByHand();
    const { result, rerender } = renderHook(({ shown }) => useWakeOnEmptied(shown), { initialProps: { shown: true } });
    expect(result.current).toBe(1);
    act(() => leftByHand());
    expect(result.current).toBe(2);
    rerender({ shown: false });
    expect(result.current).toBe(0);
    act(() => leftByHand());
    expect(result.current).toBe(0);
  });

  it("starts asleep when nothing was just taken away", () => {
    const { result } = renderHook(() => useWakeOnEmptied(true));
    expect(result.current).toBe(0);
  });

  /** Opening onto an empty board, then something offered elsewhere later
   *  (a folder deleted from the shelf): it did not empty this board. */
  it("ignores an offer long after the board went empty, but not a mode closing", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWakeOnEmptied(true));
    act(() => vi.advanceTimersByTime(EMPTIED_WINDOW_MS + 500));
    act(() => leftByHand("undo"));
    expect(result.current).toBe(0);
    // Tidy up closing over a board it emptied is the moment it shows.
    act(() => leftByHand("mode"));
    expect(result.current).toBe(1);
  });
});

describe("what counts as emptied by hand", () => {
  it("is never the trash sweep's notice, which takes nothing off a board", async () => {
    vi.useFakeTimers();
    const { useUndo } = await import("../store/useUndo");
    const { result: undo } = renderHook(() =>
      useUndo({ notesRef: { current: [] }, update: async () => {}, onReverting: () => {}, onReverted: () => {} } as unknown as Parameters<typeof useUndo>[0]),
    );
    act(() => vi.advanceTimersByTime(EMPTIED_WINDOW_MS + 500));
    act(() => undo.current.pushUndo({ message: "Cleared 3", steps: [] }));
    expect(emptiedJustNow()).toBe(false);
    act(() =>
      undo.current.pushUndo({ message: "Archived", steps: [{ id: "n", expect: { status: "archived" }, revert: { status: "active" } }] }),
    );
    expect(emptiedJustNow()).toBe(true);
  });
});
