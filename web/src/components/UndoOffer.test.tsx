// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UndoOffer } from "./UndoOffer";
import { UNDO_WORD_MS, type Undo } from "../store/useUndo";

afterEach(cleanup);

const offer = (key: number, message: string): Undo => ({
  key,
  message,
  steps: [{ id: "n1", expect: { status: "archived" }, revert: { status: "active" } }],
});

describe("the undo offer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // One short word for its first seconds, then the bare arrow: the word is
  // what tells a newcomer this is Undo and what it would undo, and its going
  // is what keeps the mark from growing into a strip (review 2026-10-01,
  // UX-09).
  it("says its verb for the first seconds, then settles to the arrow", () => {
    const { container, rerender } = render(
      <UndoOffer offer={offer(1, "Archived 3")} place="bar" onUndo={() => {}} />,
    );
    const button = () => container.querySelector<HTMLElement>("button.undo")!;
    expect(button().querySelector(".undo-word")?.textContent).toBe("Archived");
    expect(button().hasAttribute("data-said")).toBe(true);
    // The whole message is still the label.
    expect(button().getAttribute("aria-label")).toBe("Undo: Archived 3");

    act(() => {
      vi.advanceTimersByTime(UNDO_WORD_MS);
    });
    expect(button().querySelector(".undo-word")).toBeNull();
    expect(button().hasAttribute("data-said")).toBe(false);
    expect(button().textContent).toBe("");

    // A fresh offer starts with its word in the very first frame.
    rerender(<UndoOffer offer={offer(2, "Deleted 1")} place="bar" onUndo={() => {}} />);
    expect(button().querySelector(".undo-word")?.textContent).toBe("Deleted");
  });

  it("stands where the screen puts it", () => {
    for (const place of ["bar", "over"] as const) {
      const { container, unmount } = render(
        <UndoOffer offer={offer(1, "Moved 1")} place={place} onUndo={() => {}} />,
      );
      expect(container.querySelector(".undo-slot")?.classList.contains(`undo-slot-${place}`)).toBe(
        true,
      );
      unmount();
    }
  });
});
