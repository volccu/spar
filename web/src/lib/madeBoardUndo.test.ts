import { describe, expect, it, vi } from "vitest";
import type { UserBoard } from "../types";
import { note } from "../test/fixtures";
import { createWithUndo } from "./madeBoardUndo";
import type { Undo } from "../store/useUndo";

const kitchen: UserBoard = { id: "k", name: "Kitchen", position: 0 };

function rig(known: UserBoard[], made: UserBoard, filed: string[] = []) {
  const pushed: Omit<Undo, "key">[] = [];
  const removeBoard = vi.fn();
  const leaveBoard = vi.fn();
  const returned = createWithUndo(made.name, {
    createBoard: () => made,
    known,
    pushUndo: (e) => pushed.push(e),
    notesRef: { current: filed.map((board_id, i) => note({ id: `n${i}`, board_id })) },
    removeBoard,
    leaveBoard,
  });
  return { pushed, removeBoard, leaveBoard, returned };
}

describe("a board made from the capture bar", () => {
  it("is offered back, and undo takes it away and leaves it", () => {
    const { pushed, removeBoard, leaveBoard, returned } = rig([], kitchen);
    expect(returned).toBe(kitchen);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].message).toBe("Made board Kitchen");
    pushed[0].run?.();
    expect(removeBoard).toHaveBeenCalledWith("k");
    expect(leaveBoard).toHaveBeenCalledWith("k");
  });

  it("stays when a note has been filed there since", () => {
    const { pushed, removeBoard } = rig([], kitchen, ["k"]);
    pushed[0].run?.();
    expect(removeBoard).not.toHaveBeenCalled();
  });

  it("offers nothing for a name that was already a board", () => {
    const { pushed } = rig([kitchen], kitchen);
    expect(pushed).toHaveLength(0);
  });
});
