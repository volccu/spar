// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSorterVerbs } from "./useSorterVerbs";

/**
 * Tidy up's "Put back N" puts each note back where it was binned from. A run
 * over the Archive used to send every binned note to the Inbox as active
 * (bughunt 2026-10-15).
 */
describe("putting a run's deletes back", () => {
  it("returns each note to the status it had before it was binned", () => {
    const bulkUpdate = vi.fn();
    const pushUndo = vi.fn();
    const { result } = renderHook(() =>
      useSorterVerbs({
        update: vi.fn(),
        bulkUpdate,
        pushUndo,
        notesRef: { current: [] },
        leaveMark: { current: null },
        setReminder: vi.fn(),
        nameOf: () => undefined,
      }),
    );
    result.current.sortRestore([
      { id: "a", status: "archived" },
      { id: "b", status: "active" },
      { id: "c", status: "archived" },
    ]);
    expect(bulkUpdate).toHaveBeenCalledWith(["a", "c"], { status: "archived" });
    expect(bulkUpdate).toHaveBeenCalledWith(["b"], { status: "active" });
    const steps = pushUndo.mock.calls[0][0].steps;
    expect(steps[0]).toEqual({ id: "a", expect: { status: "archived" }, revert: { status: "trashed" } });
  });
});

describe("filing one note from Tidy up", () => {
  it("says which board it went to", () => {
    const pushUndo = vi.fn();
    const { result } = renderHook(() =>
      useSorterVerbs({
        update: vi.fn(),
        bulkUpdate: vi.fn(),
        pushUndo,
        notesRef: { current: [] },
        leaveMark: { current: null },
        setReminder: vi.fn(),
        nameOf: (id) => (id === "k" ? "Kitchen" : undefined),
      }),
    );
    result.current.sortFile({ id: "a", board_id: null, note_type: null } as never, "k");
    expect(pushUndo.mock.calls[0][0].message).toBe("Moved 1 to Kitchen");
  });
});
