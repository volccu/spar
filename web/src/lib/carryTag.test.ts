import { describe, expect, it } from "vitest";
import type { Board } from "../types";
import { note } from "../test/fixtures";
import { carryWords } from "./carryTag";
import type { MergeDrag } from "./useMergeDrag";

const kitchen = { id: "k", name: "Kitchen", kind: "folder" } as Board;
const inbox = { id: "inbox", name: "Inbox", kind: "inbox" } as Board;
const archive = { id: "archive", name: "Archive", kind: "archive" } as Board;
const boards = [inbox, kitchen, archive];
const notes = [
  note({ id: "a", body: "\n- [ ] buy oat milk\nand bread" }),
  note({ id: "b", body: "second note" }),
  note({ id: "c", body: "filed note", board_id: "k" }),
];
const drag = (over: Partial<MergeDrag>): MergeDrag => ({ sourceIds: ["a"], targetId: null, ...over });

/** Review 2026-10-24, UX-17: a small tag follows the pointer, and words what letting go would do. */
describe("what the carried-note tag says", () => {
  it("is the note's first line, with no verb while nothing is under the pointer", () => {
    expect(carryWords(drag({}), notes, boards)).toEqual({ what: "buy oat milk", verb: null });
  });

  it("is the words beside an address, as the card shows, or the address when there are none", () => {
    const linked = [
      note({ id: "w", body: "https://www.bbc.com/news check this later" }),
      note({ id: "x", body: "https://www.bbc.com/news" }),
    ];
    expect(carryWords(drag({ sourceIds: ["w"] }), linked, boards).what).toBe("check this later");
    expect(carryWords(drag({ sourceIds: ["x"] }), linked, boards).what).toBe("https://www.bbc.com/news");
  });

  it("is a count when several are carried", () => {
    expect(carryWords(drag({ sourceIds: ["a", "b"] }), notes, boards).what).toBe("2 notes");
  });

  it("cuts a long first line", () => {
    const long = [note({ id: "l", body: "a very long first line that goes on and on past any tag" })];
    const { what } = carryWords(drag({ sourceIds: ["l"] }), long, boards);
    expect(what.length).toBeLessThanOrEqual(28);
    expect(what.endsWith("…")).toBe(true);
  });

  it("says Merge over another card, Archive over the creature", () => {
    expect(carryWords(drag({ targetId: "b" }), notes, boards).verb).toBe("Merge");
    expect(carryWords(drag({ onRobot: true }), notes, boards).verb).toBe("Archive");
  });

  it("says what the board's own verb is, and nothing over one that refuses", () => {
    expect(carryWords(drag({ shelfId: "k" }), notes, boards).verb).toBe("Move to Kitchen");
    expect(carryWords(drag({ shelfId: "inbox", sourceIds: ["c"] }), notes, boards).verb).toBe("Move to Inbox");
    expect(carryWords(drag({ shelfId: "archive" }), notes, boards).verb).toBe("Archive");
    expect(carryWords(drag({ shelfId: "trash" }), notes, boards).verb).toBe("Delete");
    expect(carryWords(drag({ shelfId: "nowhere" }), notes, boards).verb).toBeNull();
  });
});
