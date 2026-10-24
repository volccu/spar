// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Undo } from "../store/useUndo";
import { board as userBoard, note } from "../test/fixtures";
import type { Board, Note } from "../types";
import { resetMoments, useMoment } from "./mascotMoments";
import { useFolderVerbs } from "./useFolderVerbs";

/*
 * Audit 2026-10-10, CODE-6 (3): deleting a folder writes its notes as two
 * batches, and its undo asks `useUndo`'s own guard which notes it may still
 * put back.
 */
describe("deleting a folder", () => {
  function setup() {
    const folder = userBoard({ id: "f1", name: "Recipes" });
    const notes: Note[] = [
      note({ id: "a", board_id: "f1", status: "active" }),
      note({ id: "b", board_id: "f1", status: "active" }),
      note({ id: "c", board_id: "f1", status: "archived" }),
      note({ id: "d", board_id: null, status: "active" }),
    ];
    const notesRef = { current: notes };
    const bulkUpdate = vi.fn((ids: string[], patch: Partial<Note>) => {
      notesRef.current = notesRef.current.map((n) => (ids.includes(n.id) ? { ...n, ...patch } : n));
    });
    const undos: Omit<Undo, "key">[] = [];
    const restoreBoard = vi.fn();
    const removeBoard = vi.fn();
    const goToBoard = vi.fn();
    const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" } as Board;
    const { result } = renderHook(() =>
      useFolderVerbs({
        boards: [inbox],
        board: inbox,
        boardIndex: 0,
        inTrash: false,
        userBoards: [folder],
        notesRef,
        bulkUpdate,
        pushUndo: (entry) => undos.push(entry),
        leaveMark: { current: null },
        createBoard: vi.fn(),
        renameBoard: vi.fn(),
        removeBoard,
        restoreBoard,
        placeBoard: vi.fn(),
        stayOnBoard: vi.fn(),
        goToBoard,
        boardMenu: null,
        setCreatingBoard: vi.fn(),
        setNewBoardName: vi.fn(),
      }),
    );
    return { result, notesRef, bulkUpdate, undos, restoreBoard, removeBoard, folder };
  }

  const pick = (notes: Note[], id: string) => notes.find((n) => n.id === id)!;

  it("archives the active notes and unfiles the rest in one write each", () => {
    const { result, notesRef, bulkUpdate, removeBoard } = setup();
    result.current.handleDeleteBoard("f1");
    expect(bulkUpdate).toHaveBeenCalledTimes(2);
    expect(bulkUpdate).toHaveBeenCalledWith(["a", "b"], { board_id: null, status: "archived" });
    expect(bulkUpdate).toHaveBeenCalledWith(["c"], { board_id: null });
    expect(removeBoard).toHaveBeenCalledWith("f1");
    expect(pick(notesRef.current, "d")).toMatchObject({ board_id: null, status: "active" });
  });

  it("puts the folder back first, then only the notes nothing has moved since", () => {
    const { result, notesRef, undos, restoreBoard, folder } = setup();
    result.current.handleDeleteBoard("f1");
    // The other device files one of the archived notes somewhere else.
    notesRef.current = notesRef.current.map((n) => (n.id === "b" ? { ...n, board_id: "elsewhere" } : n));

    expect(undos).toHaveLength(1);
    undos[0].run!();
    expect(restoreBoard).toHaveBeenCalledWith(folder);
    expect(pick(notesRef.current, "a")).toMatchObject({ board_id: "f1", status: "active" });
    expect(pick(notesRef.current, "b")).toMatchObject({ board_id: "elsewhere", status: "archived" });
    expect(pick(notesRef.current, "c")).toMatchObject({ board_id: "f1", status: "archived" });
  });
});

/** The chooser and the Keep import read a same name as the same board; so do these. */
describe("making and renaming a folder onto a name already taken", () => {
  afterEach(() => resetMoments());

  function setup() {
    const recipes = userBoard({ id: "f1", name: "Recipes" });
    const trips = userBoard({ id: "f2", name: "Trips" });
    const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" } as Board;
    const shelf = [inbox, { ...recipes, kind: "folder" } as unknown as Board, { ...trips, kind: "folder" } as unknown as Board];
    const createBoard = vi.fn((name: string) => userBoard({ id: `new-${name}`, name }));
    const renameBoard = vi.fn();
    const goToBoard = vi.fn();
    const openBoard = vi.fn();
    const setCreatingBoard = vi.fn();
    const setNewBoardName = vi.fn();
    const { result } = renderHook(() =>
      useFolderVerbs({
        boards: shelf,
        board: inbox,
        boardIndex: 0,
        inTrash: false,
        userBoards: [recipes, trips],
        notesRef: { current: [] },
        bulkUpdate: vi.fn(),
        pushUndo: vi.fn(),
        leaveMark: { current: null },
        createBoard,
        renameBoard,
        removeBoard: vi.fn(),
        restoreBoard: vi.fn(),
        placeBoard: vi.fn(),
        stayOnBoard: vi.fn(),
        goToBoard,
        openBoard,
        boardMenu: null,
        setCreatingBoard,
        setNewBoardName,
      }),
    );
    return { result, createBoard, renameBoard, openBoard, setCreatingBoard, setNewBoardName };
  }

  it("goes to the folder that has the name instead of making a second", () => {
    const { result, createBoard, openBoard, setCreatingBoard } = setup();
    result.current.handleCreateBoard("  recipes ");
    expect(createBoard).not.toHaveBeenCalled();
    expect(openBoard).toHaveBeenCalledWith(1);
    expect(setCreatingBoard).toHaveBeenCalledWith(false);
  });

  it("still makes a board for a new name, and for a built-in board's name", () => {
    const { result, createBoard } = setup();
    result.current.handleCreateBoard("Garden");
    result.current.handleCreateBoard("Inbox");
    expect(createBoard.mock.calls).toEqual([["Garden"], ["Inbox"]]);
  });

  it("does not rename onto another folder's name, and says so", () => {
    const { result, renameBoard } = setup();
    act(() => result.current.handleRenameBoard("f2", "RECIPES"));
    expect(renameBoard).not.toHaveBeenCalled();
    const said = renderHook(() => useMoment());
    expect(said.result.current?.words).toBe("Hm. There's already a board called Recipes.");
  });

  it("renames a folder to its own name in another case", () => {
    const { result, renameBoard } = setup();
    result.current.handleRenameBoard("f1", "recipes");
    expect(renameBoard).toHaveBeenCalledWith("f1", "recipes");
  });
});

/**
 * Taking away the folder you are standing on takes you to the Inbox — when it is
 * deleted, and when an undo takes away the board a move had made
 * (`lib/useSelectionVerbs.ts`), which reaches for it long after the render that
 * offered the undo.
 */
describe("leaving the folder that is going", () => {
  const inbox = { id: "inbox", name: "Inbox", kind: "inbox" } as Board;
  const recipes = { id: "f1", name: "Recipes", kind: "folder" } as unknown as Board;
  const folder = userBoard({ id: "f1", name: "Recipes" });

  function setup(standingOn: Board) {
    const goToBoard = vi.fn();
    const view = renderHook(
      ({ board, go }: { board: Board; go: (index: number) => void }) =>
        useFolderVerbs({
          boards: [inbox, recipes],
          board,
          boardIndex: board === inbox ? 0 : 1,
          inTrash: false,
          userBoards: [folder],
          notesRef: { current: [] },
          bulkUpdate: vi.fn(),
          pushUndo: vi.fn(),
          leaveMark: { current: null },
          createBoard: vi.fn(),
          renameBoard: vi.fn(),
          removeBoard: vi.fn(),
          restoreBoard: vi.fn(),
          placeBoard: vi.fn(),
          stayOnBoard: vi.fn(),
          goToBoard: go,
          openBoard: vi.fn(),
          boardMenu: null,
          setCreatingBoard: vi.fn(),
          setNewBoardName: vi.fn(),
        }),
      { initialProps: { board: standingOn, go: goToBoard } },
    );
    return { ...view, goToBoard };
  }

  it("goes to the Inbox when the folder is the board on screen", () => {
    const { result, goToBoard } = setup(recipes);
    result.current.leaveBoard("f1");
    expect(goToBoard).toHaveBeenCalledWith(0);
  });

  it("stays put when another board is on screen", () => {
    const { result, goToBoard } = setup(inbox);
    result.current.leaveBoard("f1");
    expect(goToBoard).not.toHaveBeenCalled();
  });

  it("deleting the folder you stand on goes the same way", () => {
    const { result, goToBoard } = setup(recipes);
    result.current.handleDeleteBoard("f1");
    expect(goToBoard).toHaveBeenCalledWith(0);
  });

  it("asks the board that is on screen now, not the one the render that made it had", () => {
    const { result, rerender, goToBoard } = setup(inbox);
    const leave = result.current.leaveBoard;
    const laterGo = vi.fn();
    rerender({ board: recipes, go: laterGo });
    leave("f1");
    expect(laterGo).toHaveBeenCalledWith(0);
    expect(goToBoard).not.toHaveBeenCalled();
  });
});
