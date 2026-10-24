import { describe, expect, it } from "vitest";
import { hiddenTabs, sidewaysWheel } from "./stripOverflow";

describe("hiddenTabs", () => {
  const tabs = [
    { left: 0, right: 100 },
    { left: 100, right: 200 },
    { left: 200, right: 300 },
    { left: 300, right: 400 },
    { left: 400, right: 500 },
  ];

  it("counts nothing hidden when every tab fits", () => {
    expect(hiddenTabs({ left: 0, right: 500 }, tabs)).toEqual({ before: 0, after: 0 });
  });

  it("counts the tabs past the right edge, by their middles", () => {
    // 260 shows more than half of the third tab, so it is not counted.
    expect(hiddenTabs({ left: 0, right: 260 }, tabs)).toEqual({ before: 0, after: 2 });
    expect(hiddenTabs({ left: 0, right: 240 }, tabs)).toEqual({ before: 0, after: 3 });
  });

  it("counts both sides once the strip is scrolled into the middle", () => {
    expect(hiddenTabs({ left: 140, right: 340 }, tabs)).toEqual({ before: 1, after: 2 });
  });

  it("treats a tab under the fade as out of sight", () => {
    // 260 alone shows the third tab; with a 28px fade it is only 232 deep.
    expect(hiddenTabs({ left: 0, right: 260 }, tabs, 0, 28)).toEqual({ before: 0, after: 3 });
  });
});

describe("sidewaysWheel", () => {
  it("turns a mouse wheel's vertical movement sideways", () => {
    expect(sidewaysWheel({ deltaX: 0, deltaY: 120, deltaMode: 0 }, 1000)).toBe(120);
    expect(sidewaysWheel({ deltaX: 0, deltaY: -120, deltaMode: 0 }, 1000)).toBe(-120);
  });

  it("leaves a sideways gesture to the browser, which already scrolls it", () => {
    expect(sidewaysWheel({ deltaX: 40, deltaY: 10, deltaMode: 0 }, 1000)).toBe(0);
    expect(sidewaysWheel({ deltaX: 0, deltaY: 0, deltaMode: 0 }, 1000)).toBe(0);
  });

  it("measures a wheel that speaks in lines or pages", () => {
    expect(sidewaysWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 1000)).toBe(48);
    expect(sidewaysWheel({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 900)).toBe(900);
  });
});
