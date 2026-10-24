import { describe, expect, it } from "vitest";
import { note } from "../test/fixtures";
import { buildBoards } from "./boards";
import { movedWords, nameOfBoard, putBackWords } from "./movedWords";

const kitchen = { id: "k", name: "Kitchen", position: 0 };
const shelf = buildBoards([kitchen, { id: "g", name: "Garden", position: 1 }]);

describe("what a move says", () => {
  it("names the board it went to", () => {
    expect(movedWords(2, "Kitchen")).toBe("Moved 2 to Kitchen");
    expect(movedWords(1, "Inbox")).toBe("Moved 1 to Inbox");
  });

  it("falls back to the bare count when the board is not known", () => {
    expect(movedWords(2, undefined)).toBe("Moved 2");
  });

  it("reads a board's name from the stored list, null being the Inbox", () => {
    const wall = { id: "w", name: "insp", position: 2, kind: "inspiration" as const };
    expect(nameOfBoard([kitchen, wall], "k")).toBe("Kitchen");
    expect(nameOfBoard([kitchen, wall], null)).toBe("Inbox");
    expect(nameOfBoard([kitchen, wall], "w")).toBe("Inspiration");
    expect(nameOfBoard([kitchen], "gone")).toBeUndefined();
  });
});

describe("what Put back says", () => {
  const trashed = (id: string, board_id: string | null) => note({ id, status: "trashed", board_id });

  it("names the one place every note goes back to", () => {
    expect(putBackWords([trashed("a", "k")], shelf)).toBe("Put back 1 to Kitchen");
    expect(putBackWords([trashed("a", null), trashed("b", null)], shelf)).toBe("Put back 2 to Inbox");
  });

  it("names nothing when the notes scatter", () => {
    expect(putBackWords([trashed("a", "k"), trashed("b", "g")], shelf)).toBe("Put back 2");
  });
});
