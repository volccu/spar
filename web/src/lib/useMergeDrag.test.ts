// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../types";
import { useMergeDrag } from "./useMergeDrag";

const note = (id: string) => ({ id, status: "active" }) as unknown as Note;

describe("useMergeDrag", () => {
  // Every memoised card on the board is handed `startMergeDrag`. If it were a
  // new function after each selection tap, every card would redraw on every
  // tap (audit PERF-2: 850 ms at 2,300 cards).
  it("keeps startMergeDrag the same function while the selection changes", () => {
    const notesRef = { current: [note("a"), note("b"), note("c")] };
    const mergeNotes = vi.fn();
    const { result, rerender } = renderHook(
      ({ selected }: { selected: string[] }) =>
        useMergeDrag({ inTrash: false, selected, notesRef, mergeNotes }),
      { initialProps: { selected: [] as string[] } },
    );
    const first = result.current.startMergeDrag;
    rerender({ selected: ["a"] });
    rerender({ selected: ["a", "b"] });
    expect(result.current.startMergeDrag).toBe(first);
  });

  it("still carries the selection as it is at the moment of the hold", () => {
    const notesRef = { current: [note("a"), note("b"), note("c")] };
    const { result, rerender } = renderHook(
      ({ selected }: { selected: string[] }) =>
        useMergeDrag({ inTrash: false, selected, notesRef, mergeNotes: vi.fn() }),
      { initialProps: { selected: [] as string[] } },
    );
    rerender({ selected: ["a", "b"] });
    act(() => result.current.startMergeDrag(note("a")));
    expect(result.current.mergeDrag?.sourceIds).toEqual(["a", "b"]);
    act(() => result.current.endMergeDrag(note("c")));
    act(() => result.current.startMergeDrag(note("c")));
    expect(result.current.mergeDrag?.sourceIds).toEqual(["c"]);
  });

  it("archives what is let go on the creature, and merges nothing", () => {
    const notesRef = { current: [note("a"), note("b"), { ...note("c"), status: "archived" } as Note] };
    const mergeNotes = vi.fn();
    const archiveNotes = vi.fn();
    const robot = document.createElement("spar-mascot");
    document.body.append(robot);
    (document as { elementFromPoint?: unknown }).elementFromPoint = () => robot;
    const { result } = renderHook(() =>
      useMergeDrag({ inTrash: false, selected: ["a", "c"], notesRef, mergeNotes, archiveNotes }),
    );
    act(() => result.current.startMergeDrag(note("a")));
    act(() => result.current.moveMergeDrag(note("a"), 5, 5));
    expect(result.current.mergeDrag?.onRobot).toBe(true);
    act(() => result.current.endMergeDrag(note("a")));
    // The one already archived is not archived again.
    expect(archiveNotes).toHaveBeenCalledWith([notesRef.current[0]]);
    expect(mergeNotes).not.toHaveBeenCalled();
    robot.remove();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it("archives nothing when a drag over the creature is cancelled", () => {
    const notesRef = { current: [note("a")] };
    const archiveNotes = vi.fn();
    const robot = document.createElement("spar-mascot");
    document.body.append(robot);
    (document as { elementFromPoint?: unknown }).elementFromPoint = (x: number) => (x < 0 ? null : robot);
    const { result } = renderHook(() =>
      useMergeDrag({ inTrash: false, selected: [], notesRef, mergeNotes: vi.fn(), archiveNotes }),
    );
    act(() => result.current.startMergeDrag(note("a")));
    act(() => result.current.moveMergeDrag(note("a"), 5, 5));
    // NoteCard's cancel: off the board, then the end, in one handler.
    act(() => {
      result.current.moveMergeDrag(note("a"), -1, -1);
      result.current.endMergeDrag(note("a"));
    });
    expect(archiveNotes).not.toHaveBeenCalled();
    robot.remove();
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });

  it("carries nothing out of the Trash", () => {
    const notesRef = { current: [note("a")] };
    const { result, rerender } = renderHook(
      ({ inTrash }: { inTrash: boolean }) =>
        useMergeDrag({ inTrash, selected: [], notesRef, mergeNotes: vi.fn() }),
      { initialProps: { inTrash: false } },
    );
    rerender({ inTrash: true });
    act(() => result.current.startMergeDrag(note("a")));
    expect(result.current.mergeDrag).toBeNull();
  });
});
