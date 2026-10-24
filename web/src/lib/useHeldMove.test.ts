// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../types";
import { useHeldMove } from "./useHeldMove";

const note = (over: Partial<Note> = {}) =>
  ({ id: "a", board_id: null, note_type: "note", status: "active", ...over }) as unknown as Note;

/** Renders the hook with the note `openId` open; `offerNow` records the offers. */
function setup(openId: string | null = "a") {
  const offerNow = vi.fn();
  const hook = renderHook(
    ({ openId }: { openId: string | null }) => useHeldMove(offerNow, openId),
    { initialProps: { openId } },
  );
  return { offerNow, ...hook };
}

describe("useHeldMove", () => {
  it("holds a move while its note is open and offers it when the note closes", () => {
    const { offerNow, result, rerender } = setup("a");
    result.current.holdMove(note(), { board_id: "work" }, "Moved 1");
    rerender({ openId: "a" });
    expect(offerNow).not.toHaveBeenCalled();

    rerender({ openId: null });
    expect(offerNow).toHaveBeenCalledTimes(1);
    expect(offerNow).toHaveBeenCalledWith({
      message: "Moved 1",
      steps: [{ id: "a", expect: { board_id: "work" }, revert: { board_id: null } }],
    });

    // Spent: closing again offers nothing more.
    rerender({ openId: "b" });
    expect(offerNow).toHaveBeenCalledTimes(1);
  });

  it("is offered when the open note is swiped to another one", () => {
    const { offerNow, result, rerender } = setup("a");
    result.current.holdMove(note(), { board_id: "work" }, "Moved 1");
    rerender({ openId: "b" });
    expect(offerNow).toHaveBeenCalledTimes(1);
  });

  it("folds a second move of the same note into one entry that goes back to where it was opened", () => {
    const { offerNow, result, rerender } = setup("a");
    result.current.holdMove(note({ board_id: "home" }), { board_id: "work" }, "Moved 1");
    result.current.holdMove(note({ board_id: "work" }), { board_id: "later" }, "Moved 1 again");
    rerender({ openId: null });
    expect(offerNow).toHaveBeenCalledTimes(1);
    expect(offerNow).toHaveBeenCalledWith({
      message: "Moved 1 again",
      steps: [{ id: "a", expect: { board_id: "later" }, revert: { board_id: "home" } }],
    });
  });

  it("puts back the type too once any of the moves changed it", () => {
    const { offerNow, result, rerender } = setup("a");
    result.current.holdMove(
      note({ board_id: "home" }),
      { board_id: "links", note_type: "link" },
      "Moved 1",
    );
    // A later move without a type keeps the earlier move's type.
    result.current.holdMove(
      note({ board_id: "links", note_type: "link" }),
      { board_id: "work" },
      "Moved 1",
    );
    rerender({ openId: null });
    expect(offerNow.mock.calls[0][0].steps[0].revert).toEqual({
      board_id: "home",
      note_type: "note",
    });
  });

  it("puts a note moved out of the Trash back into it", () => {
    const { offerNow, result, rerender } = setup("a");
    result.current.holdMove(
      note({ status: "trashed" }),
      { board_id: "work", status: "active" },
      "Moved 1",
    );
    rerender({ openId: null });
    expect(offerNow.mock.calls[0][0].steps[0].revert).toEqual({
      board_id: null,
      status: "trashed",
    });
  });

  it("starts afresh for a different note", () => {
    const { offerNow, result, rerender } = setup("a");
    result.current.holdMove(note({ id: "a", board_id: "home" }), { board_id: "work" }, "Moved 1");
    result.current.holdMove(note({ id: "b", board_id: "x" }), { board_id: "y" }, "Moved 1 b");
    rerender({ openId: null });
    expect(offerNow).toHaveBeenCalledTimes(1);
    expect(offerNow.mock.calls[0][0].steps[0]).toMatchObject({
      id: "b",
      revert: { board_id: "x" },
    });
  });

  it("lets a held move out ahead of any other offer, in the order they happened", () => {
    const { offerNow, result } = setup("a");
    result.current.holdMove(note(), { board_id: "work" }, "Moved 1");
    result.current.pushUndo({ message: "Deleted 1", steps: [] });
    expect(offerNow.mock.calls.map((c) => c[0].message)).toEqual(["Moved 1", "Deleted 1"]);
  });

  it("pushUndo with nothing held is just the offer", () => {
    const { offerNow, result } = setup("a");
    result.current.pushUndo({ message: "Deleted 1", steps: [] });
    expect(offerNow.mock.calls.map((c) => c[0].message)).toEqual(["Deleted 1"]);
  });

  it("keeps holdMove the same function across renders", () => {
    const { result, rerender } = setup("a");
    const first = result.current.holdMove;
    rerender({ openId: "b" });
    expect(result.current.holdMove).toBe(first);
  });
});
