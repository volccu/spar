import { describe, expect, it } from "vitest";
import { constrainShape, shapePoints, shapeStroke } from "./shapes";
import { strokePath } from "./strokePath";

describe("a shape's outline", () => {
  it("closes a rectangle through its four corners, whichever way it was dragged", () => {
    expect(shapePoints("rect", [100, 80], [0, 0], 4)).toEqual([[0, 0], [100, 0], [100, 80], [0, 80], [0, 0]]);
  });

  it("goes all the way round an ellipse and ends where it began", () => {
    const pts = shapePoints("ellipse", [0, 0], [200, 100], 4);
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    for (const [x, y] of pts) {
      expect(((x - 100) / 100) ** 2 + ((y - 50) / 50) ** 2).toBeCloseTo(1, 1);
    }
  });

  it("points an arrow at where the drag let go", () => {
    const pts = shapePoints("arrow", [0, 0], [100, 0], 2);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[1]).toEqual([100, 0]);
    // Both barbs fall back from the tip, one either side of the shaft.
    expect(pts[2][0]).toBeLessThan(100);
    expect(pts[4][0]).toBeLessThan(100);
    expect(Math.sign(pts[2][1])).toBe(-Math.sign(pts[4][1]));
  });

  it("is drawn straight, and closed when it comes back to its start", () => {
    const rect = shapeStroke("r", "rect", [0, 0], [10, 10], { color: "var(--ink)", width: 2, fill: false });
    expect(strokePath(rect, 0)).toBe("M 0 0 L 10 0 L 10 10 L 0 10 L 0 0 Z");
    expect(strokePath({ ...rect, shape: undefined }, 0)).toContain("Q");
  });

  it("takes a fill only when it closes", () => {
    const pen = { color: "var(--ink)", width: 2, fill: true };
    expect(shapeStroke("a", "ellipse", [0, 0], [9, 9], pen).fill).toBe(true);
    expect(shapeStroke("b", "line", [0, 0], [9, 9], pen).fill).toBeUndefined();
  });
});

describe("constraining a drag", () => {
  it("makes a square with Shift", () => {
    expect(constrainShape("rect", [0, 0], [100, 40], true)).toEqual([100, 100]);
    expect(constrainShape("rect", [0, 0], [100, 40], false)).toEqual([100, 40]);
  });

  it("settles a nearly level line onto the level without Shift", () => {
    const [x, y] = constrainShape("line", [0, 0], [100, 4], false);
    expect(y).toBeCloseTo(0, 5);
    expect(x).toBeCloseTo(Math.hypot(100, 4), 5);
  });

  it("leaves a line at a real slant where it is", () => {
    expect(constrainShape("line", [0, 0], [100, 30], false)).toEqual([100, 30]);
  });
});
