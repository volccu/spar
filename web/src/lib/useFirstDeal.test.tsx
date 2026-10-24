// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFirstDeal } from "./useGridReflow";
import { DEAL_MAX_CARDS, DEAL_TOTAL_MS, ENTER } from "./motion";

const proto = Element.prototype as unknown as { animate?: unknown };
const had = proto.animate;
let played: { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }[] = [];

function gridOf(n: number): HTMLElement {
  const grid = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const c = document.createElement("div");
    c.className = "card";
    c.dataset.id = String(i);
    grid.appendChild(c);
  }
  document.body.appendChild(grid);
  return grid;
}

interface P {
  grid: HTMLElement | null;
  loading: boolean;
  n: number;
  answered: boolean;
}
const run = (initial: P) =>
  renderHook((p: P) => useFirstDeal(p.grid, p.loading, p.n, p.answered), { initialProps: initial });

beforeEach(() => {
  played = [];
  proto.animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    played.push({ el: this, frames, opts });
    return {};
  };
});
afterEach(() => {
  proto.animate = had;
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-motion");
});

describe("a new device is dealt a hand", () => {
  it("deals the first screenful, one after another, by clip along ENTER, inside the ceiling", () => {
    const grid = gridOf(30);
    const h = run({ grid: null, loading: false, n: 0, answered: false });
    h.rerender({ grid, loading: false, n: 30, answered: false });
    expect(played).toHaveLength(DEAL_MAX_CARDS);
    for (const p of played) {
      expect(Object.keys(p.frames[0])).toEqual(["clipPath"]);
      expect(p.opts.easing).toBe(ENTER);
      expect(p.opts.fill).toBe("backwards");
    }
    const delays = played.map((p) => Number(p.opts.delay));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(DEAL_MAX_CARDS);
    const last = played[played.length - 1];
    expect(Number(last.opts.delay) + Number(last.opts.duration)).toBeLessThanOrEqual(DEAL_TOTAL_MS);
  });

  it("waits for the grid when the notes land on an empty board first", () => {
    const grid = gridOf(5);
    const h = run({ grid: null, loading: false, n: 0, answered: false });
    h.rerender({ grid: null, loading: false, n: 40, answered: false });
    expect(played).toHaveLength(0);
    h.rerender({ grid, loading: false, n: 40, answered: false });
    expect(played).toHaveLength(5);
  });

  it("deals once, never again this session", () => {
    const grid = gridOf(3);
    const h = run({ grid: null, loading: false, n: 0, answered: false });
    h.rerender({ grid, loading: false, n: 3, answered: false });
    h.rerender({ grid, loading: false, n: 4, answered: true });
    expect(played).toHaveLength(3);
  });

  it("never on an ordinary open: notes were already on the device", () => {
    const grid = gridOf(10);
    const h = run({ grid: null, loading: true, n: 0, answered: false });
    h.rerender({ grid, loading: false, n: 10, answered: false });
    h.rerender({ grid, loading: false, n: 11, answered: true });
    expect(played).toHaveLength(0);
  });

  it("never for a note written while the server had not yet answered", () => {
    const grid = gridOf(1);
    const h = run({ grid: null, loading: false, n: 0, answered: false });
    h.rerender({ grid, loading: false, n: 1, answered: false });
    h.rerender({ grid: gridOf(20), loading: false, n: 20, answered: false });
    expect(played).toHaveLength(0);
  });

  it("never when the account is simply empty", () => {
    const h = run({ grid: null, loading: false, n: 0, answered: false });
    h.rerender({ grid: null, loading: false, n: 0, answered: true });
    h.rerender({ grid: gridOf(2), loading: false, n: 2, answered: true });
    expect(played).toHaveLength(0);
  });

  it("never under reduced motion", () => {
    document.documentElement.dataset.motion = "reduced";
    const grid = gridOf(6);
    const h = run({ grid: null, loading: false, n: 0, answered: false });
    h.rerender({ grid, loading: false, n: 6, answered: false });
    expect(played).toHaveLength(0);
  });
});
