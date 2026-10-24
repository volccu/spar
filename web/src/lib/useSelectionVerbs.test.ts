// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Note, UserBoard } from "../types";
import { useUndo } from "../store/useUndo";
import { note } from "../test/fixtures";
import { useSelectionVerbs } from "./useSelectionVerbs";

/**
 * The real stack and the real verbs, over a plain array of notes. `drawn: false`
 * is the app as it is inside one tick: its `notesRef` is the last render's, so
 * a write made a moment ago is not in it yet (`App.tsx` sets it from `notes`).
 */
function rig(notes: Note[], selected = ["a"], drawn = true) {
  const notesRef = { current: notes };
  const write = (id: string, patch: Partial<Note>) => {
    notesRef.current = notesRef.current.map((n) => (n.id === id ? { ...n, ...patch } : n));
  };
  const removeBoard = vi.fn();
  const leaveBoard = vi.fn();
  const made: UserBoard = { id: "new", name: "Kit", position: 0 };
  const view = renderHook(() => {
    const undo = useUndo({ notesRef, update: drawn ? write : vi.fn() });
    const verbs = useSelectionVerbs({
      selected,
      selectedNotes: notesRef.current.filter((n) => selected.includes(n.id)),
      setSelected: vi.fn(),
      update: write,
      bulkUpdate: (ids, patch) => ids.forEach((id) => write(id, patch)),
      pushUndo: undo.pushUndo,
      leaveMark: { current: null },
      notesRef,
      leaveIdea: () => ({ restore: vi.fn() }),
      createBoard: () => made,
      nameOf: (id) => (id === made.id ? made.name : undefined),
      removeBoard,
      leaveBoard,
      setMoving: vi.fn(),
      setMoveError: vi.fn(),
    });
    return { undo, verbs };
  });
  return { ...view, notesRef, removeBoard, leaveBoard, write };
}

describe("undoing a move that made its board", () => {
  it("takes the board away again while nothing else is filed there", () => {
    const { result, removeBoard, notesRef } = rig([note({ id: "a" })]);
    act(() => result.current.verbs.doMoveCreate("Kit"));
    expect(notesRef.current[0].board_id).toBe("new");
    act(() => {
      result.current.undo.undoLast();
    });
    expect(notesRef.current[0].board_id).toBeNull();
    expect(removeBoard).toHaveBeenCalledWith("new");
  });

  it("leaves the board when another note has been filed there since", () => {
    const { result, removeBoard, leaveBoard, write } = rig([note({ id: "a" }), note({ id: "b" })]);
    act(() => result.current.verbs.doMoveCreate("Kit"));
    write("b", { board_id: "new" });
    act(() => {
      result.current.undo.undoLast();
    });
    expect(removeBoard).not.toHaveBeenCalled();
    expect(leaveBoard).not.toHaveBeenCalled();
  });

  it("leaves the board for a note filed there that is archived or in the trash", () => {
    for (const status of ["archived", "trashed"] as const) {
      const { result, removeBoard, write } = rig([note({ id: "a" }), note({ id: "b" })]);
      act(() => result.current.verbs.doMoveCreate("Kit"));
      write("b", { board_id: "new", status });
      act(() => {
        result.current.undo.undoLast();
      });
      expect(removeBoard, status).not.toHaveBeenCalled();
    }
  });

  it("leaves the board for a moved note whose own step was skipped", () => {
    // `a` was on Links, so the move also took it off (`filePatch`); marking it a
    // to-do since means the undo no longer finds what it put there and leaves it
    // — still filed in the new board, which therefore has to stay.
    const { result, removeBoard, leaveBoard, notesRef, write } = rig(
      [note({ id: "a", note_type: "link" }), note({ id: "b" })],
      ["a", "b"],
    );
    act(() => result.current.verbs.doMoveCreate("Kit"));
    write("a", { note_type: "todo" });
    act(() => {
      result.current.undo.undoLast();
    });
    expect(notesRef.current.find((n) => n.id === "b")?.board_id).toBeNull();
    expect(notesRef.current.find((n) => n.id === "a")?.board_id).toBe("new");
    expect(removeBoard).not.toHaveBeenCalled();
    expect(leaveBoard).not.toHaveBeenCalled();
  });

  it("reads the moved notes as the undo left them, before the board has drawn that", () => {
    // Inside the tick the undo runs in, `notesRef` still holds the notes as they
    // were filed: the board is empty all the same, because every step fired.
    const { result, removeBoard, notesRef } = rig([note({ id: "a" }), note({ id: "b" })], ["a", "b"], false);
    act(() => result.current.verbs.doMoveCreate("Kit"));
    act(() => {
      result.current.undo.undoLast();
    });
    expect(notesRef.current.every((n) => n.board_id === "new")).toBe(true);
    expect(removeBoard).toHaveBeenCalledWith("new");
  });

  it("takes you off the board it takes away, after it is gone", () => {
    const { result, removeBoard, leaveBoard } = rig([note({ id: "a" })]);
    act(() => result.current.verbs.doMoveCreate("Kit"));
    act(() => {
      result.current.undo.undoLast();
    });
    expect(leaveBoard).toHaveBeenCalledWith("new");
    expect(removeBoard.mock.invocationCallOrder[0]).toBeLessThan(leaveBoard.mock.invocationCallOrder[0]);
  });

  it("never takes away a board the move did not make", () => {
    const { result, removeBoard, leaveBoard } = rig([note({ id: "a" })]);
    act(() => result.current.verbs.doMove("existing"));
    act(() => {
      result.current.undo.undoLast();
    });
    expect(removeBoard).not.toHaveBeenCalled();
    expect(leaveBoard).not.toHaveBeenCalled();
  });
});

/** Review 2026-10-24, UX-14: a pile of passed reminders is cleared in one go, and offered back. */
describe("clearing the reminders of a selection", () => {
  const ringing = { reminder_at: "2026-10-20T09:00:00.000Z", reminder_repeat: null };
  const repeating = { reminder_at: "2026-10-20T09:00:00.000Z", reminder_repeat: "week" as const };

  it("clears the time and the rule of every picked note that has one, and pushes an undo", () => {
    const { result, notesRef } = rig(
      [note({ id: "a", ...ringing }), note({ id: "b", ...repeating }), note({ id: "c" })],
      ["a", "b", "c"],
    );
    expect(result.current.undo.undos).toHaveLength(0);
    act(() => result.current.verbs.doClearReminder());
    expect(notesRef.current.map((n) => [n.reminder_at, n.reminder_repeat])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(result.current.undo.undos).toHaveLength(1);
    expect(result.current.undo.offer?.message).toBe("Cleared 2 reminders");
  });

  it("brings each note's own time and rule back on undo, and leaves the note without one alone", () => {
    const { result, notesRef } = rig(
      [note({ id: "a", ...ringing }), note({ id: "b", ...repeating }), note({ id: "c" })],
      ["a", "b", "c"],
    );
    act(() => result.current.verbs.doClearReminder());
    act(() => {
      result.current.undo.undoLast();
    });
    expect(notesRef.current.map((n) => [n.reminder_at, n.reminder_repeat])).toEqual([
      [ringing.reminder_at, null],
      [repeating.reminder_at, "week"],
      [null, null],
    ]);
  });
});
