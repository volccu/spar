// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Note } from "../types";
import { markedWords, undoable, undoWord, useUndo } from "./useUndo";
import { note } from "../test/fixtures";


function stack(notes: Note[]) {
  const update = vi.fn();
  const onReverted = vi.fn();
  const onReverting = vi.fn();
  const notesRef = { current: notes };
  const view = renderHook(() =>
    useUndo({ notesRef, update, onReverted, onReverting }),
  );
  return { ...view, update, onReverted, onReverting, notesRef };
}

/**
 * `onReverted` is how the board is told to close whatever a reversal left open
 * — merge opens its new idea, so putting the sources back has to close it. It
 * is therefore a statement that something *happened*, and firing it on a press
 * that reversed nothing closed the open canvas for free: Ctrl+Z stands down
 * over an open note and has never stood down over an idea's canvas.
 */
describe("what a reversal reports", () => {
  it("says nothing happened when the stack is empty", () => {
    const { result, onReverted, update } = stack([note()]);
    act(() => result.current.undoLast());
    expect(update).not.toHaveBeenCalled();
    expect(onReverted).not.toHaveBeenCalled();
  });

  it("says nothing happened when every step has been overtaken", () => {
    // The note was archived and then put back by hand on the other device, so
    // the step no longer finds what it put there and must not fire.
    const { result, onReverted, onReverting, update } = stack([
      note({ id: "a", status: "active" }),
    ]);
    act(() =>
      result.current.pushUndo({
        message: "Archived 1",
        steps: [{ id: "a", expect: { status: "archived" }, revert: { status: "active" } }],
      }),
    );
    act(() => result.current.undoLast());
    expect(update).not.toHaveBeenCalled();
    expect(onReverting).not.toHaveBeenCalled();
    expect(onReverted).not.toHaveBeenCalled();
  });

  it("reports a reversal that did happen, and sends the opposite", () => {
    const { result, onReverted, onReverting, update } = stack([
      note({ id: "a", status: "archived" }),
    ]);
    act(() =>
      result.current.pushUndo({
        message: "Archived 1",
        steps: [{ id: "a", expect: { status: "archived" }, revert: { status: "active" } }],
      }),
    );
    act(() => result.current.undoLast());
    expect(update).toHaveBeenCalledWith("a", { status: "active" });
    expect(onReverting).toHaveBeenCalledTimes(1);
    expect(onReverted).toHaveBeenCalledTimes(1);
  });

  it("reports a reversal that brought its own run", () => {
    const { result, onReverted } = stack([note()]);
    const run = vi.fn();
    act(() => result.current.pushUndo({ message: "Merged 2", steps: [], run }));
    act(() => result.current.undoLast());
    expect(run).toHaveBeenCalledTimes(1);
    expect(onReverted).toHaveBeenCalledTimes(1);
  });

  it("walks past a dead entry to the live one behind it", () => {
    const { result, update, onReverted } = stack([note({ id: "a", status: "archived" })]);
    act(() =>
      result.current.pushUndo({
        message: "Archived 1",
        steps: [{ id: "a", expect: { status: "archived" }, revert: { status: "active" } }],
      }),
    );
    act(() =>
      result.current.pushUndo({
        message: "Moved 1",
        steps: [{ id: "gone", expect: { board_id: "f1" }, revert: { board_id: null } }],
      }),
    );
    act(() => result.current.undoLast());
    expect(update).toHaveBeenCalledWith("a", { status: "active" });
    expect(onReverted).toHaveBeenCalledTimes(1);
  });

  /**
   * Untick all is reversed from inside the open note, and the board closes the
   * open note on `onReverted` — so the entry that was reversed is handed over,
   * and one marked `inPlace` is how the board knows to leave the note standing.
   */
  it("hands over the entry it reversed, in-place flag and all", () => {
    const { result, onReverted, update } = stack([note({ id: "a", body: "[ ] milk" })]);
    act(() =>
      result.current.pushUndo({
        message: "Unticked 1",
        inPlace: true,
        steps: [{ id: "a", expect: { body: "[ ] milk" }, revert: { body: "[x] milk" } }],
      }),
    );
    act(() => result.current.undoLast());
    expect(update).toHaveBeenCalledWith("a", { body: "[x] milk" });
    expect(onReverted).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Unticked 1", inPlace: true }),
    );
  });

  /**
   * `after` is what goes with the steps — a move's new board goes away with it
   * — and it is told which steps fired, because the notes they wrote are not on
   * the board yet and a read of the board cannot say.
   */
  it("hands `after` the steps that fired, and never calls it when none did", () => {
    const { result } = stack([note({ id: "a", status: "archived" }), note({ id: "b", status: "active" })]);
    const after = vi.fn();
    act(() =>
      result.current.pushUndo({
        message: "Archived 2",
        steps: [
          { id: "a", expect: { status: "archived" }, revert: { status: "active" } },
          { id: "b", expect: { status: "archived" }, revert: { status: "active" } },
        ],
        after,
      }),
    );
    act(() => result.current.undoLast());
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith([
      { id: "a", expect: { status: "archived" }, revert: { status: "active" } },
    ]);

    const overtaken = stack([note({ id: "a", status: "active" })]);
    const never = vi.fn();
    act(() =>
      overtaken.result.current.pushUndo({
        message: "Archived 1",
        steps: [{ id: "a", expect: { status: "archived" }, revert: { status: "active" } }],
        after: never,
      }),
    );
    act(() => overtaken.result.current.undoLast());
    expect(never).not.toHaveBeenCalled();
  });

  /** A notice — "Copied 3" — is on the stack but carries no button. */
  it("draws no Undo button for an entry with nothing of its own to reverse", () => {
    expect(undoable({ key: 1, message: "Copied 3", steps: [] })).toBe(false);
    expect(undoable({ key: 2, message: "Merged 2", steps: [], run: () => {} })).toBe(true);
  });
});

describe("undoWord", () => {
  // The one word the offer shows beside its arrow for its first seconds: the
  // verb of what it would undo, never the count or the rest of the sentence.
  it("takes the verb off the front of the message", () => {
    expect(undoWord("Deleted 1")).toBe("Deleted");
    expect(undoWord("Archived 3")).toBe("Archived");
    expect(undoWord("Moved 1 to Links")).toBe("Moved");
    expect(undoWord("Merged 2")).toBe("Merged");
    expect(undoWord("Deleted Kitchen")).toBe("Deleted");
    expect(undoWord("Split into a new note")).toBe("Split");
    expect(undoWord("Dissolved the idea")).toBe("Dissolved");
  });

  it("says the few verbs that are not one word whole", () => {
    expect(undoWord("Put back 4")).toBe("Put back");
    expect(undoWord("Took 1 out")).toBe("Took out");
  });

  it("says a flag going on or off as the verb it was, never the flag's name alone", () => {
    expect(markedWords("important", true, 3)).toBe("Marked important 3");
    expect(markedWords("important", false, 3)).toBe("Unmarked 3");
    expect(markedWords("to-do", true, 1)).toBe("Marked to-do 1");
    expect(undoWord(markedWords("important", true, 3))).toBe("Marked");
    expect(undoWord(markedWords("to-do", false, 2))).toBe("Unmarked");
  });
});
