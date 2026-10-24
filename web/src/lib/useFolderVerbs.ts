import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Mark } from "../components/Vanish";
import { liveSteps, type Undo, type UndoStep } from "../store/useUndo";
import type { Board, Note, UserBoard } from "../types";
import { isBoardName, reseatShelf, shelfRun } from "./boards";
import { robotSays } from "./mascotMoments";

/** The folder already called this, ignoring case and outer spaces — never
 *  `exceptId`, the folder being renamed. */
function sameName(folders: UserBoard[], name: string, exceptId?: string): UserBoard | undefined {
  const wanted = name.trim().toLowerCase();
  return folders.find((b) => b.id !== exceptId && b.name.trim().toLowerCase() === wanted);
}

interface Options {
  /** The shelf as drawn, Inbox first. */
  boards: Board[];
  /** The board on screen, and its seat. */
  board: Board;
  boardIndex: number;
  inTrash: boolean;
  /** The folders the user made, as stored. */
  userBoards: UserBoard[];
  /** The notes as they are at the moment a handler runs. */
  notesRef: RefObject<Note[]>;
  /** The same write over several notes at once. */
  bulkUpdate: (ids: string[], patch: Partial<Note>) => void;
  /** Offer a reversal on the undo strip. */
  pushUndo: (entry: Omit<Undo, "key">) => void;
  /** Which mark a card leaving the board shrinks into. */
  leaveMark: RefObject<Mark | null>;
  /** The folder-list writes (`store/useBoards.ts`). */
  createBoard: (name: string) => UserBoard;
  renameBoard: (id: string, name: string) => void;
  removeBoard: (id: string) => void;
  restoreBoard: (board: UserBoard) => void;
  placeBoard: (id: string, to: number, shelf?: { boards: readonly Board[]; run: readonly string[] }) => void;
  /** Move the seat number without paging (the board did not change). */
  stayOnBoard: (index: number) => void;
  /** Page to a seat on the shelf. */
  goToBoard: (index: number) => void;
  /** Open the board at a seat the way choosing its row does (a note or canvas over it closes). */
  openBoard: (index: number) => void;
  /** The board whose menu is open, if any. */
  boardMenu: { id: string } | null;
  /** The new-board field, open or not, and what is typed in it. */
  setCreatingBoard: (open: boolean) => void;
  setNewBoardName: (name: string) => void;
}

/**
 * What the shelf does to a folder: delete, rename, put down somewhere else
 * along its run, and make (audit 2026-10-10, CODE-6, moved out of `App.tsx`
 * whole; the comments are the ones they had there). The state they act on —
 * which menu is open, the new-board field — stays in `App.tsx`, because the
 * layer table reads it long before these are built; what is worked out from
 * it for the menu (`menuRun`, `menuAt`, `menuIsFolder`) lives here.
 */
export function useFolderVerbs({
  boards,
  board,
  boardIndex,
  inTrash,
  userBoards,
  notesRef,
  bulkUpdate,
  pushUndo,
  leaveMark,
  createBoard,
  renameBoard,
  removeBoard,
  restoreBoard,
  placeBoard,
  stayOnBoard,
  goToBoard,
  openBoard,
  boardMenu,
  setCreatingBoard,
  setNewBoardName,
}: Options) {
  /** The run the board whose menu is open can move along — its fellow folders,
   *  or Todos, Links and Files for a lens (`shelfRun`) — and where it sits in
   *  it, or -1 for none. The two reorder rows are drawn off this alone. */
  const menuRun = boardMenu ? (shelfRun(boards, boardMenu.id) ?? []) : [];
  const menuAt = boardMenu ? menuRun.indexOf(boardMenu.id) : -1;
  /** Only a folder the user made can be renamed, dressed or deleted; a lens's
   *  menu is its two Move rows and nothing else. */
  const menuIsFolder = boardMenu
    ? boards.some((b) => b.id === boardMenu.id && b.kind === "folder")
    : false;

  /**
   * Taking a folder away shrinks the shelf out from under `boardIndex` — the
   * same reason unpinning a tag used to jump back to the catch-all board first.
   * So when the folder is the board you're standing on, back to board 0, the
   * same way any other board switch pages there. Board 0 is the Inbox and stays
   * the Inbox whatever else moves on the shelf (`buildBoards`), and that is the
   * right answer for every way a folder goes: when it is deleted, the notes
   * that were in it are archived, so the board you land on is the one holding
   * whatever is left to deal with; when it is a move's own new board, taken
   * away again by that move's undo (`lib/useSelectionVerbs.ts`), nothing is in
   * it at all. Called by both, so there is one place that says where you go.
   *
   * Through refs, because the undo calls it from a closure made when the move
   * ran, and by then the board on screen — and the `goToBoard` that pages from
   * it — are not the ones that render had.
   */
  const standing = useRef(board);
  standing.current = board;
  const pageTo = useRef(goToBoard);
  pageTo.current = goToBoard;
  const leaveBoard = useCallback((id: string) => {
    if (standing.current.kind === "folder" && standing.current.id === id) pageTo.current(0);
  }, []);

  /** `bulkUpdate`, skipped for nobody: an empty write would still render. */
  const writeAll = useCallback(
    (ids: string[], patch: Partial<Note>) => {
      if (ids.length > 0) bulkUpdate(ids, patch);
    },
    [bulkUpdate],
  );

  /**
   * Deleting a folder archives every note filed there — never trashes them,
   * never leaves them stranded on a board that no longer exists — and clears
   * their `board_id` so an unarchive later finds them unfiled rather than
   * pointing at a folder that is gone. Confirmed first: this is the one
   * board action that touches more than the shelf.
   *
   * **Both halves are per-note, and they are not the same set.** The clearing
   * is for *every* note that names this folder whatever state it is in; the
   * archiving is only for the ones that are still active. That distinction was
   * missing — one filter did both jobs, keyed on `status === "active"` — and
   * the notes it skipped are the majority: of the notes filed into folders
   * here, well under a third are active. An archived note that kept a
   * `board_id` naming a deleted folder was a note with nowhere to be. It reads
   * as filed (`isFiled` is a nullish test), so the Inbox will not have it; it
   * matches no folder on the shelf, because there is no such folder; and the
   * open note draws no folder row for it, because the name cannot be looked
   * up. Restore it from the Archive or the Trash a month later and it appears
   * on All and nowhere else, with nothing on screen saying why. The dialog
   * already promises "every note filed here goes to the archive"; this is the
   * code finally meaning all of it.
   *
   * Two writes, not one per note: the active ones and the rest each take one
   * patch, so each is one `bulkUpdate` — a folder of four hundred notes is two
   * renders and two disk batches, not four hundred of each.
   */
  const handleDeleteBoard = useCallback(
    (id: string) => {
      const folder = userBoards.find((b) => b.id === id);
      const naming = notesRef.current.filter((n) => n.board_id === id);
      leaveMark.current = "archive";
      const active = naming.filter((n) => n.status === "active").map((n) => n.id);
      const rest = naming.filter((n) => n.status !== "active").map((n) => n.id);
      const archived: Partial<Note> = { board_id: null, status: "archived" };
      const unfiled: Partial<Note> = { board_id: null };
      const steps: UndoStep[] = [
        ...active.map((noteId) => ({
          id: noteId,
          expect: archived,
          revert: { board_id: id, status: "active" as const },
        })),
        ...rest.map((noteId) => ({ id: noteId, expect: unfiled, revert: { board_id: id } })),
      ];
      writeAll(active, archived);
      writeAll(rest, unfiled);
      removeBoard(id);
      // Every other path that takes notes off the board offers them back, and
      // this one takes a whole folder's worth — and the filing, which is the part
      // nobody can redo by hand. The reversal puts the folder back under its own
      // id first, then each note the other device has not since moved on: the
      // same per-note guard every `UndoStep` carries, asked of `useUndo` itself
      // (`liveSteps`) rather than written out a second time here.
      if (folder) {
        pushUndo({
          message: `Deleted ${folder.name}`,
          steps: [],
          run: () => {
            restoreBoard(folder);
            const live = liveSteps(steps, new Map(notesRef.current.map((n) => [n.id, n])));
            writeAll(
              live.filter((step) => step.expect === archived).map((step) => step.id),
              { board_id: id, status: "active" },
            );
            writeAll(
              live.filter((step) => step.expect === unfiled).map((step) => step.id),
              { board_id: id },
            );
          },
        });
      }
      leaveBoard(id);
    },
    [writeAll, leaveBoard, leaveMark, notesRef, pushUndo, removeBoard, restoreBoard, userBoards],
  );

  const handleRenameBoard = useCallback(
    (id: string, name: string) => {
      if (!isBoardName(name)) return;
      // Another folder already has that name (any case): the chooser and the
      // Keep import read a same name as the same board, so a second one would
      // never be reachable by name. Said in words; nothing is written. The
      // folder's own name in another case is a rename like any other.
      const taken = sameName(userBoards, name, id);
      if (taken) {
        robotSays(`Hm. There's already a board called ${taken.name}.`);
        return;
      }
      renameBoard(id, name);
    },
    [renameBoard, userBoards],
  );

  /**
   * A board put down at `to` in its own run — the drop a carry on the shelf
   * ends with, and the menu's one step (`handleMoveBoard`, below) said the same
   * way. Written through the same synced preferences row a rename goes through
   * (`placeBoard` in store/useBoards.ts).
   *
   * The board on screen is followed rather than left behind. A move shuffles
   * the seats of one run, so if the board you are standing on is in it,
   * `boardIndex` would otherwise go on naming a seat that now holds a different
   * board and hand you somebody else's notes. `useFollowSeat` would put that
   * right a frame later; doing it here, in the same batch as the write, means
   * that frame never paints. `stayOnBoard` moves the number without paging,
   * because nothing arrived — you are still on the board you were on.
   */
  const handlePlaceBoard = useCallback(
    (id: string, to: number) => {
      const run = shelfRun(boards, id);
      if (!run) return;
      if (!inTrash) {
        const seat = reseatShelf(boards.map((b) => b.id), run, id, to).indexOf(board.id);
        if (seat >= 0 && seat !== boardIndex) stayOnBoard(seat);
      }
      placeBoard(id, to, { boards, run });
    },
    [board, boardIndex, boards, inTrash, placeBoard, stayOnBoard],
  );

  /**
   * One step along the run, from the board's own menu — the path that needs
   * no drag, for a keyboard (the context-menu key opens the menu on a focused
   * tab) or anyone who would rather tap.
   *
   * The menu stays open afterwards on purpose. Walking a board from the far
   * end up next to the Inbox is several steps, and re-opening the menu between
   * each of them would make an order you can change in theory and not in
   * practice. The rows re-decide themselves from `menuRun` on the next render,
   * so the one that has run out of shelf simply stops being drawn — which is
   * also how the panel says you have arrived.
   */
  const handleMoveBoard = useCallback(
    (step: -1 | 1) => {
      if (!boardMenu || menuAt < 0) return;
      handlePlaceBoard(boardMenu.id, menuAt + step);
    },
    [boardMenu, handlePlaceBoard, menuAt],
  );

  const opening = useRef<string | null>(null);
  const handleCreateBoard = useCallback(
    (name: string) => {
      if (!isBoardName(name)) return;
      // A folder by that name (any case) is that board, as it is in the Move
      // chooser: go to it rather than make a second. Built-in boards' names
      // are not folders, so a lookalike of one is still allowed.
      const existing = sameName(userBoards, name);
      if (existing) {
        const seat = boards.findIndex((b) => b.id === existing.id);
        if (seat >= 0) openBoard(seat);
      } else {
        // The new board is on the shelf a render from now: go there then.
        opening.current = createBoard(name).id;
      }
      setCreatingBoard(false);
      setNewBoardName("");
    },
    [boards, createBoard, openBoard, setCreatingBoard, setNewBoardName, userBoards],
  );
  useEffect(() => {
    if (!opening.current) return;
    const seat = boards.findIndex((b) => b.id === opening.current);
    if (seat < 0) return;
    opening.current = null;
    openBoard(seat);
  }, [boards, openBoard]);

  return {
    menuRun,
    menuAt,
    menuIsFolder,
    leaveBoard,
    handleDeleteBoard,
    handleRenameBoard,
    handlePlaceBoard,
    handleMoveBoard,
    handleCreateBoard,
  };
}
