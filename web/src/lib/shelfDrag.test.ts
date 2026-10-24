import { describe, expect, it } from "vitest";
import { clampOffset, dropIndex, edgeScroll, makeWay, type Slot } from "./shelfDrag";

/** Three tabs edge to edge, of different widths — a real strip's are. */
const slots: Slot[] = [
  { start: 100, size: 80 },
  { start: 180, size: 120 },
  { start: 300, size: 60 },
];

describe("carrying a board along its run", () => {
  it("stops the carried board at the ends of its own run", () => {
    // The middle tab may go back to the first tab's leading edge…
    expect(clampOffset(slots, 1, -500)).toBe(-80);
    // …and forward until its trailing edge meets the last tab's.
    expect(clampOffset(slots, 1, 500)).toBe(60);
    expect(clampOffset(slots, 1, 20)).toBe(20);
  });

  it("takes a neighbour's seat once its travelling edge reaches the neighbour's middle", () => {
    // The middle tab's front edge is at 180; the first tab's middle is 140.
    expect(dropIndex(slots, 1, -39)).toBe(1);
    expect(dropIndex(slots, 1, -40)).toBe(0);
    // Its back edge is at 300; the last tab's middle is 330.
    expect(dropIndex(slots, 1, 29)).toBe(1);
    expect(dropIndex(slots, 1, 30)).toBe(2);
    // Carried from the first seat past both.
    expect(dropIndex(slots, 0, 250)).toBe(2);
  });

  /** A wide tab pressed hard against the end of its run sits in the end seat,
   *  and must land there — the case a middle-to-middle test gets wrong. */
  it("lands in the end seat when carried hard against either end of its run", () => {
    for (const from of [0, 1, 2]) {
      expect(dropIndex(slots, from, clampOffset(slots, from, -10_000))).toBe(0);
      expect(dropIndex(slots, from, clampOffset(slots, from, 10_000))).toBe(2);
    }
    const even: Slot[] = [
      { start: 0, size: 100 },
      { start: 100, size: 100 },
      { start: 200, size: 100 },
    ];
    expect(dropIndex(even, 2, clampOffset(even, 2, -10_000))).toBe(0);
    expect(dropIndex(even, 0, clampOffset(even, 0, 10_000))).toBe(2);
  });

  it("moves exactly the boards between the two seats, by the carried board's length", () => {
    // First tab (80 wide) carried to the last seat: the other two step back 80.
    expect([0, 1, 2].map((i) => makeWay(slots, 0, 2, i))).toEqual([0, -80, -80]);
    // Last tab (60 wide) carried to the first seat: the others step on 60.
    expect([0, 1, 2].map((i) => makeWay(slots, 2, 0, i))).toEqual([60, 60, 0]);
    // Not moved at all: nobody steps anywhere.
    expect([0, 1, 2].map((i) => makeWay(slots, 1, 1, i))).toEqual([0, 0, 0]);
  });

  it("scrolls only near an edge, faster the closer it gets", () => {
    expect(edgeScroll(500, 0, 1000)).toBe(0);
    expect(edgeScroll(0, 0, 1000)).toBeLessThan(edgeScroll(20, 0, 1000));
    expect(edgeScroll(20, 0, 1000)).toBeLessThan(0);
    expect(edgeScroll(1000, 0, 1000)).toBeGreaterThan(edgeScroll(980, 0, 1000));
    expect(edgeScroll(980, 0, 1000)).toBeGreaterThan(0);
  });
});
