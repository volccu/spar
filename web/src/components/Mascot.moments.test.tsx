// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mascot } from "./Mascot";
import { MASCOT_TAG, isLate, mascotCatching, mascotPlay, mascotSign, setLateClock, type MascotState } from "./mascot-element";

/**
 * The creature's moments of 2026-10-16: the one-shot moves, the milestone's
 * sign, a card carried over it, the spin, drowsy late at night, and the
 * antenna blinking while offline changes wait.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date(2026, 9, 16, 14, 0));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  stubReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduce : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function mount(state: MascotState = "idle", props: { waiting?: boolean; onPoke?: () => void } = {}) {
  const { container, rerender } = render(<Mascot state={state} {...props} />);
  const host = container.querySelector(MASCOT_TAG) as HTMLElement;
  const q = (sel: string) => host.shadowRoot!.querySelector(sel);
  const svg = () => host.shadowRoot!.querySelector("svg")!;
  return { host, q, svg, rerender };
}

describe("the moves", () => {
  it("plays a move for its length, wearing its face over the calm one", () => {
    const { q, svg } = mount("idle");
    act(() => mascotPlay("yes"));
    expect(svg().classList.contains("g-yes")).toBe(true);
    // Pleased: the eyes are two arcs, not dots.
    expect(q(".face .eye")).toBeNull();
    act(() => void vi.advanceTimersByTime(1200));
    expect(svg().classList.contains("g-yes")).toBe(false);
    act(() => void vi.advanceTimersByTime(200));
    expect(q(".face .eye")).not.toBeNull();
  });

  it("lets the newest move win", () => {
    const { svg } = mount("idle");
    act(() => mascotPlay("shrug"));
    act(() => mascotPlay("shake"));
    expect(svg().classList.contains("g-shrug")).toBe(false);
    expect(svg().classList.contains("g-shake")).toBe(true);
  });

  it("keeps a busy or offline face, and moves nothing under reduced motion", () => {
    const offline = mount("offline");
    act(() => mascotPlay("shrug"));
    expect(offline.svg().classList.contains("g-shrug")).toBe(true);
    expect(offline.q(".face")!.innerHTML).toBe("");
    cleanup();

    stubReducedMotion(true);
    const reduced = mount("idle");
    act(() => mascotPlay("hop"));
    expect(reduced.svg().classList.contains("g-hop")).toBe(false);
  });

  it("holds a milestone's number up on a sign, then puts it away", () => {
    const { q, svg } = mount("idle");
    act(() => mascotSign(500));
    expect(q(".sign-n")!.textContent).toBe("500");
    expect(svg().classList.contains("g-hop")).toBe(true);
    act(() => void vi.advanceTimersByTime(2700));
    expect(q(".sign-n")).toBeNull();
  });

  it("opens its mouth for a card carried over it, and closes it after", () => {
    const { q } = mount("idle");
    act(() => mascotCatching(true));
    act(() => void vi.advanceTimersByTime(100));
    expect(q(".face .o")).not.toBeNull();
    act(() => mascotCatching(false));
    act(() => void vi.advanceTimersByTime(100));
    expect(q(".face .o")).toBeNull();
  });
});

describe("a sideways swipe across it", () => {
  it("spins it round, and is not a poke", () => {
    const onPoke = vi.fn();
    const { host, svg } = mount("idle", { onPoke });
    fireEvent.pointerDown(host, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(host, { clientX: 60, clientY: 14 });
    fireEvent.click(host);
    expect(svg().classList.contains("g-spin")).toBe(true);
    expect(onPoke).not.toHaveBeenCalled();
  });

  it("leaves a plain tap a poke", () => {
    const onPoke = vi.fn();
    const { host, svg } = mount("idle", { onPoke });
    fireEvent.pointerDown(host, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(host, { clientX: 12, clientY: 11 });
    fireEvent.click(host);
    expect(svg().classList.contains("g-spin")).toBe(false);
    expect(onPoke).toHaveBeenCalledTimes(1);
  });
});

describe("late at night", () => {
  // The shared setup keeps every other test in the daytime (src/test/daytime.ts).
  beforeEach(() => setLateClock());
  afterEach(() => setLateClock(() => false));

  it("is late from eleven at night until five in the morning", () => {
    expect(isLate(new Date(2026, 9, 16, 22, 59))).toBe(false);
    expect(isLate(new Date(2026, 9, 16, 23, 0))).toBe(true);
    expect(isLate(new Date(2026, 9, 17, 4, 59))).toBe(true);
    expect(isLate(new Date(2026, 9, 17, 5, 0))).toBe(false);
  });

  it("droops its eyes, and a poke wakes it", () => {
    vi.setSystemTime(new Date(2026, 9, 16, 23, 30));
    const { host, q } = mount("idle");
    expect(q(".face .lid")).not.toBeNull();
    fireEvent.click(host);
    act(() => void vi.advanceTimersByTime(100));
    expect(q(".face .lid")).toBeNull();
  });

  it("is wide awake in the afternoon", () => {
    const { q } = mount("idle");
    expect(q(".face .lid")).toBeNull();
  });
});

describe("offline, with changes still to send", () => {
  it("blinks its antenna until they have gone", () => {
    const { svg, rerender } = mount("offline", { waiting: true });
    expect(svg().classList.contains("waiting")).toBe(true);
    rerender(<Mascot state="offline" waiting={false} />);
    expect(svg().classList.contains("waiting")).toBe(false);
  });
});
