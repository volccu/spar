// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clipOfCentre, clipOfRect, finishOnce, FULL_CLIP } from "./motion";

/** jsdom's window is 1024×768 unless something says otherwise. */
const W = window.innerWidth;
const H = window.innerHeight;

describe("clipOfRect", () => {
  it("expresses a card's rect as insets from the four edges", () => {
    expect(
      clipOfRect({ top: 100, right: 300, bottom: 260, left: 40 }),
    ).toBe(`inset(100px ${W - 300}px ${H - 260}px 40px)`);
  });

  it("opens all the way out when the rect is the whole screen", () => {
    expect(clipOfRect({ top: 0, right: W, bottom: H, left: 0 })).toBe(FULL_CLIP);
  });

  it("never asks for a negative inset", () => {
    // A card scrolled half off the top, and one hanging off the bottom. An
    // inset below zero is invalid and the whole animation is dropped, so the
    // note would appear with no transition at all — from the one position
    // where you most need to see where it came from.
    const high = clipOfRect({ top: -80, right: 300, bottom: 90, left: -20 });
    const low = clipOfRect({ top: H - 30, right: 300, bottom: H + 200, left: 40 });
    for (const clip of [high, low]) {
      for (const n of clip.match(/-?[\d.]+(?=px)/g) ?? []) {
        expect(Number(n)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("clipOfCentre", () => {
  it("leaves a square of the asked-for size in the middle", () => {
    const clip = clipOfCentre(100);
    const [top, right, bottom, left] = (clip.match(/[\d.]+(?=px)/g) ?? []).map(
      Number,
    );
    expect(H - top - bottom).toBeCloseTo(100);
    expect(W - left - right).toBeCloseTo(100);
    expect(top).toBeCloseTo(bottom);
    expect(left).toBeCloseTo(right);
  });

  it("collapses to the middle rather than inverting on a narrow screen", () => {
    const clip = clipOfCentre(W + 400);
    for (const n of clip.match(/-?[\d.]+(?=px)/g) ?? []) {
      expect(Number(n)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("finishOnce", () => {
  afterEach(() => vi.useRealTimers());
  /** An animation as far as the helper reads one: something with `onfinish`. */
  const running = () => ({ onfinish: null as null | (() => void) }) as unknown as Animation;

  it("is done when the animation finishes, and its timer is called off", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const a = running();
    finishOnce(a, done, 260);
    expect(done).not.toHaveBeenCalled();
    a.onfinish?.call(a, {} as AnimationPlaybackEvent);
    expect(done).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is done by the timer when the animation never finishes, and only once", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const a = running();
    finishOnce(a, done, 260);
    vi.advanceTimersByTime(259);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);
    // A tab brought back finishes the animation late: nothing more happens.
    a.onfinish?.call(a, {} as AnimationPlaybackEvent);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("hands back what calls the timer off, for a caller that goes first", () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const callOff = finishOnce(running(), done, 260);
    callOff();
    vi.advanceTimersByTime(10_000);
    expect(done).not.toHaveBeenCalled();
  });
});
