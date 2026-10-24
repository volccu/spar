import { describe, expect, it } from "vitest";
import type { Canvas, DrawingStroke } from "../types";
import { restoreStrokes } from "./canvas";
import { ERASE_REACH, pathBetween, strokeHit } from "./strokeErase";

const line = (id: string, points: [number, number][], width = 4): DrawingStroke => ({
  id,
  points,
  color: "var(--ink)",
  width,
});

describe("strokeHit", () => {
  const s = line("a", [[0, 0], [100, 0]]);

  it("hits along a segment, not only at its points", () => {
    expect(strokeHit(s, 50, 0, 10)).toBe(true);
    expect(strokeHit(s, 50, 8, 10)).toBe(true);
  });

  it("counts half the pen's own width as part of the line", () => {
    expect(strokeHit(s, 50, 11, 10)).toBe(true);
    expect(strokeHit(s, 50, 13, 10)).toBe(false);
  });

  it("misses beyond the ends and beyond the reach", () => {
    expect(strokeHit(s, 150, 0, 10)).toBe(false);
    expect(strokeHit(s, 50, 40, 10)).toBe(false);
  });

  it("handles a stroke of one point, and of none", () => {
    expect(strokeHit(line("p", [[5, 5]]), 8, 5, 10)).toBe(true);
    expect(strokeHit(line("e", []), 0, 0, 10)).toBe(false);
  });
});

describe("pathBetween", () => {
  it("starts from nothing at the point itself", () => {
    expect(pathBetween(null, [3, 4], ERASE_REACH)).toEqual([[3, 4]]);
  });

  it("walks a long gap in steps no longer than half the reach", () => {
    const path = pathBetween([0, 0], [100, 0], 10);
    expect(path.length).toBeGreaterThanOrEqual(20);
    expect(path[path.length - 1]).toEqual([100, 0]);
  });
});

describe("restoreStrokes", () => {
  const base = (strokes: DrawingStroke[]): Canvas => ({
    id: "c",
    idea_id: "c",
    items: [],
    strokes,
    image_widths: {},
    created_at: "2026-08-12T12:00:00.000Z",
    updated_at: "2026-08-12T12:00:00.000Z",
  });
  const [a, b, c] = ["a", "b", "c"].map((id) => line(id, [[0, 0], [1, 1]]));

  it("puts strokes back at the places they held", () => {
    const next = restoreStrokes(base([b]), [
      { stroke: c, index: 2 },
      { stroke: a, index: 0 },
    ]);
    expect(next.strokes.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves alone a stroke that is already there", () => {
    const next = restoreStrokes(base([a, b]), [{ stroke: a, index: 0 }]);
    expect(next.strokes.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("puts a stroke on the end when its place is gone", () => {
    const next = restoreStrokes(base([a]), [{ stroke: c, index: 9 }]);
    expect(next.strokes.map((s) => s.id)).toEqual(["a", "c"]);
  });
});
