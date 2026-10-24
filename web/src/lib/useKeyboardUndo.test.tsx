// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import type { Undo } from "../store/useUndo";
import { resetMoments, useMoment } from "./mascotMoments";
import { undoneWords, useKeyboardUndo } from "./useKeyboardUndo";

afterEach(() => {
  cleanup();
  resetMoments();
  vi.restoreAllMocks();
});

function rig(entry: Undo | null, openId: string | null = null) {
  const undoLast = { current: vi.fn(() => entry) };
  const grid = document.createElement("div");
  grid.innerHTML = `<button class="card" data-id="a"></button><button class="card" data-id="b"></button>`;
  document.body.append(grid);
  const view = renderHook(() => {
    useKeyboardUndo({ openId: { current: openId }, undoLast, grid });
    return useMoment();
  });
  return { ...view, undoLast, grid };
}

const entry = (message: string): Undo => ({
  key: 1,
  message,
  steps: [{ id: "b", expect: {}, revert: {} }],
});

describe("Ctrl+Z on the board", () => {
  it("says what it undid, in the creature's words", () => {
    const { result, undoLast } = rig(entry("Archived 3"));
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    expect(undoLast.current).toHaveBeenCalledTimes(1);
    expect(result.current?.words).toBe("Undid: archived 3 notes");
  });

  it("says so when there is nothing left to undo", () => {
    const { result } = rig(null);
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    expect(result.current?.words).toBe("Hm. Nothing to undo");
  });

  it("gives the focus to the card acted on once it is back", async () => {
    const { grid } = rig(entry("Moved 1"));
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(grid.querySelector('[data-id="b"]')));
  });

  /* A mouse user scrolled down a board, focus on the page: the undo takes a
     note off it, and the first card used to take the focus — and the page to
     the top with it. */
  it("leaves the focus alone when nothing held a card and the note left the board", async () => {
    const { grid } = rig({ key: 1, message: "Added 1", steps: [{ id: "gone", expect: {}, revert: {} }] });
    (document.activeElement as HTMLElement | null)?.blur();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    expect(grid.querySelector(".card")).toBeTruthy();
  });

  it("still lands a keyboard user on the neighbour when the card they held leaves", async () => {
    const { grid } = rig({ key: 1, message: "Added 1", steps: [{ id: "a", expect: {}, revert: {} }] });
    grid.insertAdjacentHTML("beforeend", `<button class="card" data-id="c"></button>`);
    const held = grid.querySelector<HTMLElement>('[data-id="a"]')!;
    held.focus();
    act(() => {
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    });
    held.remove();
    await vi.waitFor(() => expect(document.activeElement).toBe(grid.querySelector('[data-id="b"]')));
  });

  it("stands down in a note, in a field, and for Shift+Z", () => {
    const { undoLast } = rig(entry("Archived 3"), "open-note");
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    cleanup();
    const second = rig(entry("Archived 3"));
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(undoLast.current).not.toHaveBeenCalled();
    expect(second.undoLast.current).not.toHaveBeenCalled();
  });

  it("puts a message that names its own thing as it is", () => {
    expect(undoneWords(entry("Deleted Recipes"))).toBe("Undid: deleted Recipes");
    expect(undoneWords(entry("Added 53 sample notes"))).toBe("Undid: added 53 sample notes");
  });
});

