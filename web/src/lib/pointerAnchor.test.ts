import { describe, expect, it } from "vitest";
import { insideLeft, keepAbove, pointerAnchor } from "./pointerAnchor";

const view = { width: 1440, height: 900 };

describe("pointerAnchor", () => {
  it("opens to the right of a pointer in the left half", () => {
    expect(pointerAnchor({ x: 100, y: 200 }, view)).toMatchObject({
      left: 100,
      right: "auto",
      top: 200,
      bottom: "auto",
    });
  });

  it("opens to the left of a pointer in the right half", () => {
    expect(pointerAnchor({ x: 1300, y: 200 }, view)).toMatchObject({ left: "auto", right: 140 });
  });
});

describe("keepAbove", () => {
  it("leaves a panel that already ends above the floor", () => {
    expect(keepAbove(200, 400, 842)).toBe(200);
  });

  it("lifts a panel just far enough to end above the floor", () => {
    expect(keepAbove(420, 470, 842)).toBe(842 - 8 - 470);
  });

  it("never lifts it past the top of the window", () => {
    expect(keepAbove(420, 2000, 842)).toBe(8);
  });
});

describe("insideLeft", () => {
  it("leaves a panel that fits where it is", () => {
    expect(insideLeft(100, 196, 1024)).toBeNull();
  });
  it("slides one that stood off the left edge back in", () => {
    // Opened leftwards from x=180 in a 360px window: 196 wide, from -16.
    expect(insideLeft(-16, 196, 360)).toBe(8);
  });
  it("slides one past the right edge back in", () => {
    expect(insideLeft(300, 196, 400)).toBe(400 - 8 - 196);
  });
  it("keeps the left edge when the window is narrower than the panel", () => {
    expect(insideLeft(-40, 500, 360)).toBe(8);
  });
});
