// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { boardIdUnder, dropVerb } from "./shelfDrop";
import { note } from "../test/fixtures";
import type { BoardKind } from "../types";

const board = (kind: BoardKind, id = kind) => ({ id, kind });
const plain = note({ id: "a", body: "words", board_id: null, status: "active" });
const filed = note({ id: "b", body: "words", board_id: "f1", status: "active" });
const linked = note({ id: "c", body: "see https://example.com/page", board_id: null, status: "active" });

describe("what a drop on each board does", () => {
  it("moves into a folder or Inspiration, and to the Inbox as no board", () => {
    expect(dropVerb(board("folder", "f1"), [plain])).toEqual({ kind: "move", boardId: "f1" });
    expect(dropVerb(board("inspiration", "insp"), [plain])).toEqual({ kind: "move", boardId: "insp" });
    expect(dropVerb(board("inbox"), [filed])).toEqual({ kind: "move", boardId: null });
  });

  it("refuses a move that would change nothing", () => {
    expect(dropVerb(board("folder", "f1"), [filed])).toBeNull();
    expect(dropVerb(board("inbox"), [plain])).toBeNull();
    // One of two already there is still a move for the other.
    expect(dropVerb(board("folder", "f1"), [filed, plain])).toEqual({ kind: "move", boardId: "f1" });
  });

  it("archives, and deletes to the trash", () => {
    expect(dropVerb(board("archive"), [plain])).toEqual({ kind: "archive" });
    expect(dropVerb(board("archive"), [{ ...plain, status: "archived" }])).toBeNull();
    expect(dropVerb(board("trash"), [plain])).toEqual({ kind: "trash" });
  });

  it("takes notes on to Links only when every one carries an address", () => {
    expect(dropVerb(board("links"), [linked])).toEqual({ kind: "links" });
    expect(dropVerb(board("links"), [linked, plain])).toBeNull();
  });

  it("refuses the lenses, which hold nothing of their own", () => {
    for (const kind of ["recent", "todos", "files"] as const) {
      expect(dropVerb(board(kind), [plain]), kind).toBeNull();
    }
  });
});

describe("the board under the finger", () => {
  it("is a strip tab, the Trash tab, or a row of the drop drawer — and nothing else", () => {
    document.body.innerHTML = `
      <div class="boards"><button data-board-id="f1"><span id="inside">F</span></button></div>
      <button id="board-tab-trash"><span id="bin">T</span></button>
      <div class="shelf-drop"><div data-drop-board="f2"><span id="row">R</span></div></div>
      <div class="shelf"><button data-board-id="f3" id="modal">M</button></div>`;
    expect(boardIdUnder(document.getElementById("inside"))).toBe("f1");
    expect(boardIdUnder(document.getElementById("bin"))).toBe("trash");
    expect(boardIdUnder(document.getElementById("row"))).toBe("f2");
    expect(boardIdUnder(document.getElementById("modal"))).toBeNull();
    expect(boardIdUnder(null)).toBeNull();
  });
});
