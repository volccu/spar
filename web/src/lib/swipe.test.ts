// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ENTER, SETTLE_BACK_MS } from "./motion";
import { axisOf, commitDistance, commits, dragPose, isSwipe, pastTheLine, settleBack, TILT_MAX } from "./swipe";

/**
 * Pinned on both sides of every boundary, at the numbers board paging, the open
 * note's swipe and the Sorter and Ticker each wrote inline before they shared
 * one module — a retune is a decision made here, not a drift between files.
 */
describe("axisOf", () => {
  it("stays undecided inside the first ten pixels", () => {
    expect(axisOf(0, 0)).toBe("?");
    expect(axisOf(9, -9)).toBe("?");
  });

  it("decides the moment either axis reaches ten pixels", () => {
    expect(axisOf(10, 0)).toBe("x");
    expect(axisOf(0, -10)).toBe("y");
  });

  it("calls a touch sideways only when it is more than 1.4 times as far across as down", () => {
    expect(axisOf(-15, 10)).toBe("x");
    expect(axisOf(14, 10)).toBe("y");
  });
});

describe("isSwipe", () => {
  it("needs sixty pixels across, in either direction", () => {
    expect(isSwipe(59, 0)).toBe(false);
    expect(isSwipe(60, 0)).toBe(true);
    expect(isSwipe(-60, 0)).toBe(true);
  });

  it("refuses a drag less than one and a half times as far across as down", () => {
    expect(isSwipe(90, 60)).toBe(true);
    expect(isSwipe(89, -60)).toBe(false);
  });
});

describe("settleBack", () => {
  function dragged(transform: string) {
    const el = document.createElement("div");
    el.style.transform = transform;
    const animate = vi.fn();
    el.animate = animate as unknown as HTMLElement["animate"];
    return { el, animate };
  }

  it("clears the drag and animates back from where the finger left it", () => {
    const { el, animate } = dragged("translate3d(30px, 0px, 0px)");
    const held = el.style.transform;
    expect(held, "the drag must survive jsdom's style parser for this test to mean anything").not.toBe("");
    settleBack(el);
    expect(el.style.transform).toBe("");
    expect(animate).toHaveBeenCalledWith(
      [{ transform: held }, { transform: "translate3d(0px, 0px, 0)" }],
      { duration: SETTLE_BACK_MS, easing: ENTER },
    );
  });

  it("animates nothing when nothing was dragged, or there is no element", () => {
    const { el, animate } = dragged("");
    settleBack(el);
    settleBack(null);
    expect(animate).not.toHaveBeenCalled();
  });
});

/**
 * A card carried by the finger (review 2026-10-01, UX-08): the line it has to
 * cross, how it leans, and when its word is whole.
 */
describe("commitDistance", () => {
  it("is a fifth of the screen, never under a swipe's sixty or over 110", () => {
    expect(commitDistance(200)).toBe(60);
    expect(commitDistance(390)).toBeCloseTo(78);
    expect(commitDistance(1440)).toBe(110);
  });
});

describe("commits", () => {
  it("needs the distance, and flatness enough to mean it", () => {
    expect(commits(77, 0, 390)).toBe(false);
    expect(commits(79, 0, 390)).toBe(true);
    expect(commits(-79, 0, 390)).toBe(true);
    expect(commits(100, 80, 390)).toBe(false);
  });
});

describe("dragPose", () => {
  it("follows the finger one for one, and no further than the screen", () => {
    expect(dragPose(40, 390).x).toBe(40);
    expect(dragPose(-40, 390).x).toBe(-40);
    expect(dragPose(900, 390).x).toBe(390);
  });

  it("leans with the finger, a little, and stops at the tilt it is allowed", () => {
    expect(dragPose(50, 390).tilt).toBeGreaterThan(0);
    expect(dragPose(-50, 390).tilt).toBeLessThan(0);
    expect(dragPose(390, 390).tilt).toBe(TILT_MAX);
    expect(dragPose(-390, 390).tilt).toBe(-TILT_MAX);
  });

  it("says nothing for a resting thumb, and is whole where letting go would decide", () => {
    expect(dragPose(0, 390).cue).toBe(0);
    expect(dragPose(12, 390).cue).toBe(0);
    expect(dragPose(45, 390).cue).toBeGreaterThan(0);
    expect(dragPose(45, 390).cue).toBeLessThan(1);
    expect(dragPose(commitDistance(390), 390).cue).toBe(1);
    expect(dragPose(-commitDistance(390), 390).cue).toBe(1);
    expect(dragPose(300, 390).cue).toBe(1);
  });
});

describe("pastTheLine", () => {
  const W = 400; // the line is 80px here
  it("is past exactly where letting go would decide", () => {
    expect(pastTheLine(false, 79, 0, W)).toBe(false);
    expect(pastTheLine(false, 80, 0, W)).toBe(true);
    expect(pastTheLine(false, -80, 0, W)).toBe(true);
  });
  it("is not past on a mostly downward drag", () => {
    expect(pastTheLine(false, 90, 90, W)).toBe(false);
  });
  it("stays past for a few pixels back under the line, and lets go beyond them", () => {
    expect(pastTheLine(true, 75, 0, W)).toBe(true);
    expect(pastTheLine(true, 71, 0, W)).toBe(false);
    expect(pastTheLine(false, 75, 0, W)).toBe(false);
  });
});
