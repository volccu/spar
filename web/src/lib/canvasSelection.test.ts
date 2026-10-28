import { describe, expect, it } from "vitest";
import type { DrawingStroke } from "../types";
import { carryStroke, carryText, insideLoop, pick, selectionBounds, stretchScale, STILL } from "./canvasSelection";

const line = (id: string, points: [number, number][]): DrawingStroke => ({ id, points, color: "var(--ink)", width: 4 });
const square: [number, number][] = [[0, 0], [100, 0], [100, 100], [0, 100]];

describe("what a loop takes", () => {
  it("knows inside from outside", () => {
    expect(insideLoop([50, 50], square)).toBe(true);
    expect(insideLoop([150, 50], square)).toBe(false);
  });

  it("takes a stroke most of which is inside, and leaves one it only clips", () => {
    const inside = line("in", [[10, 10], [20, 20], [30, 30], [40, 40]]);
    const clipped = line("clipped", [[90, 50], [130, 50], [170, 50], [210, 50]]);
    const picked = pick({ loop: square }, [inside, clipped], [], []);
    expect(picked.strokes).toEqual(["in"]);
  });

  it("takes a label or a picture by its middle", () => {
    const picked = pick(
      { box: { x: 0, y: 0, w: 100, h: 100 } },
      [],
      [{ id: "label", box: { x: 10, y: 10, w: 60, h: 20 } }, { id: "far", box: { x: 80, y: 80, w: 200, h: 200 } }],
      [{ id: "pic", box: { x: 20, y: 20, w: 40, h: 30 } }],
    );
    expect(picked.texts).toEqual(["label"]);
    expect(picked.images).toEqual(["pic"]);
  });
});

describe("the box round a selection", () => {
  it("counts a stroke's own thickness", () => {
    const box = selectionBounds({ strokes: ["a"], texts: [], images: [] }, [line("a", [[0, 0], [100, 0]])], [], []);
    expect(box).toEqual({ x: -2, y: -2, w: 104, h: 4 });
  });

  it("is nothing when what was picked has gone", () => {
    expect(selectionBounds({ strokes: ["gone"], texts: [], images: [] }, [], [], [])).toBeNull();
  });
});

describe("carrying and stretching", () => {
  it("moves every point by the drag", () => {
    expect(carryStroke(line("a", [[0, 0], [10, 0]]), { ...STILL, dx: 5, dy: 7 }).points).toEqual([[5, 7], [15, 7]]);
  });

  it("stretches away from the corner that stays put, keeping the pen's thickness", () => {
    const out = carryStroke(line("a", [[10, 10], [20, 20]]), { dx: 0, dy: 0, scale: 2, anchor: [10, 10] });
    expect(out.points).toEqual([[10, 10], [30, 30]]);
    expect(out.width).toBe(4);
  });

  it("stretches a label's width inside its limits", () => {
    const t = { id: "t", x: 0, y: 0, text: "Hi", width: 400 };
    expect(carryText(t, { dx: 0, dy: 0, scale: 2, anchor: [0, 0] }, 400).width).toBe(600);
  });

  it("never shrinks a selection to nothing under the finger", () => {
    expect(stretchScale({ x: 0, y: 0, w: 100, h: 50 }, -500, 0)).toBeGreaterThan(0);
  });
});
