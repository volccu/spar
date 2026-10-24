// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Count, rollOf } from "./Count";

/** jsdom has no Web Animations: a stand-in that records and finishes on demand. */
let played: { el: Element; frames: Keyframe[] }[] = [];
let finishers: (() => void)[] = [];
const proto = Element.prototype as unknown as { animate?: unknown };
const had = proto.animate;

beforeEach(() => {
  played = [];
  finishers = [];
  proto.animate = function (this: Element, frames: Keyframe[]) {
    const a: { onfinish: (() => void) | null; cancel: () => void } = { onfinish: null, cancel() {} };
    played.push({ el: this, frames });
    finishers.push(() => a.onfinish?.());
    return a;
  };
});
afterEach(() => {
  proto.animate = had;
  document.documentElement.removeAttribute("data-motion");
});

describe("rollOf", () => {
  it("rolls one number into another and nothing else", () => {
    expect(rollOf("9", "10")).toEqual({ from: "9", to: "10", rest: "" });
    expect(rollOf("12 found", "3 found")).toEqual({ from: "12", to: "3", rest: " found" });
    expect(rollOf("1 reminder", "2 reminders")).toMatchObject({ from: "1", to: "2" });
    expect(rollOf("3 selected", "2 found")).toBeNull();
    expect(rollOf("5", "5")).toBeNull();
    expect(rollOf("", "5")).toBeNull();
  });
});

describe("Count", () => {
  it("is plain text on first paint, and never moves for it", () => {
    const { container } = render(<Count className="tab-n" text={12} />);
    expect(container.textContent).toBe("12");
    expect(container.querySelector(".roll-d")).toBeNull();
    expect(played).toHaveLength(0);
  });

  it("turns only the digit that changed, with the old one hidden from a reader", () => {
    const { container, rerender } = render(<Count className="tab-n" text={12} />);
    rerender(<Count className="tab-n" text={13} />);
    const slots = container.querySelectorAll("[data-roll]");
    expect(slots).toHaveLength(1);
    expect(container.querySelector(".roll-d:not([data-roll])")?.textContent).toBe("1");
    expect(slots[0].querySelector(".roll-old")?.getAttribute("aria-hidden")).toBe("true");
    expect(slots[0].querySelector(".roll-old")?.textContent).toBe("2");
    expect(played.map((p) => Object.keys(p.frames[0])[0])).toEqual(["transform", "transform"]);
  });

  it("goes back to one plain text when the move ends", () => {
    const { container, rerender } = render(<Count className="tab-n" text={4} />);
    rerender(<Count className="tab-n" text={3} />);
    expect(container.querySelector("[data-roll]")).not.toBeNull();
    act(() => finishers[finishers.length - 1]());
    expect(container.querySelector(".roll-d")).toBeNull();
    expect(container.textContent).toBe("3");
  });

  it("grows a digit and shrinks one without a width jump (blank cell, not nothing)", () => {
    const { container, rerender } = render(<Count text={9} />);
    rerender(<Count text={10} />);
    expect(container.querySelectorAll(".roll-d")).toHaveLength(2);
    act(() => finishers[finishers.length - 1]());
    expect(container.textContent).toBe("10");
    rerender(<Count text={9} />);
    expect(container.querySelectorAll(".roll-d")).toHaveLength(2);
  });

  it("does not move while the app is still reading its notes", () => {
    const { container, rerender } = render(<Count text={0} still />);
    rerender(<Count text={81} still />);
    expect(container.textContent).toBe("81");
    expect(container.querySelector(".roll-d")).toBeNull();
    expect(played).toHaveLength(0);
  });

  it("does not move when the app finishes arriving in the render that brings the number", () => {
    const { container, rerender } = render(<Count text={0} still />);
    rerender(<Count text={29} still={false} />);
    expect(container.textContent).toBe("29");
    expect(container.querySelector(".roll-d")).toBeNull();
    rerender(<Count text={30} still={false} />);
    expect(container.querySelector("[data-roll]")).not.toBeNull();
  });

  it("does not move under reduced motion", () => {
    document.documentElement.dataset.motion = "reduced";
    const { container, rerender } = render(<Count text={4} />);
    rerender(<Count text={5} />);
    expect(container.querySelector(".roll-d")).toBeNull();
    expect(container.textContent).toBe("5");
  });

  it("is plain when the words after the number change", () => {
    const { container, rerender } = render(<Count text="3 selected" />);
    rerender(<Count text="2 found" />);
    expect(container.querySelector(".roll-d")).toBeNull();
    expect(container.textContent).toBe("2 found");
  });

  it("falls back to plain text if the animation never reports finishing", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(<Count text={7} />);
      rerender(<Count text={8} />);
      expect(container.querySelector("[data-roll]")).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector(".roll-d")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
