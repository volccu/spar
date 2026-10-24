import { nowIso } from "../lib/when";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, UserBoard } from "../types";
import {
  adoptInspiration as adoptList,
  createBoard as makeBoard,
  foldersOf,
  inspirationOf,
  lensOrderOf,
  placedOnShelf,
  shelfOrderOf,
  withBoardHidden,
  type BuiltInKey,
  orderLenses,
  placeBoard as putBoard,
  placeInRun,
  removeBoard as dropBoard,
  renameBoard as editBoard,
  setBoardLook as dressBoard,
  setBoardAwake as wakeBoard,
  withFolders,
  withLensOrder,
  INBOX_ALL,
} from "../lib/boards";
import { nameOfBoard } from "../lib/movedWords";
import { getMeta, setMeta } from "./db";

const BOARDS_KEY = "boards";
/**
 * The date the Inbox starts at — the answer to the first-open question, stored
 * beside the folders because it is the same kind of thing: one small preference,
 * synced whole (SPEC §6, `lib/boards.ts`'s `INBOX_ALL`). `null` means the
 * question has not been answered on any device yet.
 */
const SINCE_KEY = "inboxSince";
/** ISO stamp of the last local change — the version a push is crossed off by. */
const AT_KEY = "boardsAt";
/**
 * Whether a change to the **folder list** here is still waiting to go up.
 *
 * Deliberately not the same flag as `SINCE_DIRTY_KEY`, though both live in one
 * row and go up in one request. The row holds two unrelated things — a list the
 * user built by hand, and a date the app may answer *for* them — and one flag
 * meant answering the date offered the folder list for upload too. On a device
 * whose store had just been cleared that list was empty, and it went up over a
 * shelf of four real folders. A flag per field is what keeps a push saying only
 * what somebody actually changed.
 */
const DIRTY_KEY = "boardsDirty";
/** Whether the Inbox date here is still waiting to go up. */
const SINCE_DIRTY_KEY = "inboxSinceDirty";
/**
 * The server's folder list as this device last saw it — the third list the
 * merge needs (`lib/boardsMerge.ts`) to tell a folder deleted here from one
 * made on another device. Written whenever a server list is laid over this
 * device's (never while a change here waits — audit DATA-2) and
 * whenever a merge goes up.
 */
const BASE_KEY = "boardsBase";


/**
 * The user's own folder boards. A folder is created, renamed and deleted here
 * (`lib/boards.ts`'s pure functions do the actual list surgery); a *note*'s
 * membership in one lives on the note itself (`board_id`, ordinary
 * `CONFLICT_FIELDS` sync) and is not this hook's business.
 *
 * Modelled on the pinned-tag boards this replaces (see git history): one
 * small ordered list, synced whole rather than row by row, because a person
 * has a handful of folders, not thousands of them.
 */
export function useBoards() {
  /**
   * The list exactly as it is stored and synced: the folders, and — once
   * somebody has moved a lens — the one entry carrying the lens order
   * (`SHELF_ORDER_ID` in `lib/boards.ts`). Only sync sees this; everything
   * else in the app is handed `boards`, which is the folders alone.
   */
  const [stored, setBoards] = useState<UserBoard[]>([]);
  const boards = useMemo(() => foldersOf(stored), [stored]);
  const lensOrder = useMemo(() => lensOrderOf(stored), [stored]);
  /** The shelf's whole shape: the app side's order, Archive's seat, the hidden boards. */
  const shelfOrder = useMemo(() => shelfOrderOf(stored), [stored]);
  /** The stored entry that is the Inspiration board, or null before it is adopted. */
  const inspiration = useMemo(() => inspirationOf(stored), [stored]);
  const [inboxSince, setSince] = useState<string | null>(null);
  const [boardsAt, setBoardsAt] = useState<string>(INBOX_ALL);
  const [boardsDirty, setBoardsDirty] = useState(false);
  const [sinceDirty, setSinceDirty] = useState(false);
  /**
   * Whether the stored preferences have been read off this device yet.
   *
   * The first-open question must not be asked on the strength of a value that
   * has not loaded: `inboxSince` is `null` for one render on every single start,
   * and `null` is also what "never answered" looks like.
   */
  const [prefsReady, setPrefsReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  /**
   * Writes IndexedDB refused, newest per key — the notes' `failedWrites`
   * for a row that is written as five keys. These went out as eleven bare
   * `write(...)`, so a full quota lost a folder, or the flag that
   * would have pushed it, with nothing on screen and an unhandled rejection
   * for a record.
   */
  const failedWrites = useRef(new Map<string, unknown>());
  /** Mounted — a write that answers after the store has gone sets no state (see `useNotes`). */
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const write = useCallback((key: string, value: unknown) => {
    failedWrites.current.set(key, value);
    setMeta(key, value).then(
      () => {
        if (failedWrites.current.get(key) === value) failedWrites.current.delete(key);
        if (alive.current && failedWrites.current.size === 0) setStorageError(null);
      },
      () => {
        failedWrites.current.set(key, value);
        if (alive.current) setStorageError("This change is visible, but it is not saved on this device yet.");
      },
    );
  }, []);
  const retryStorage = useCallback(async () => {
    if (failedWrites.current.size === 0) {
      setStorageError(null);
      return;
    }
    for (const [key, value] of failedWrites.current) write(key, value);
  }, [write]);
  /** Bumped by every change, so sync can push promptly. */
  const [version, setVersion] = useState(0);
  // `clearDirty` is called from the sync loop well after a change's own
  // render, so it needs the *current* stamp rather than one a stale closure
  // captured — the same reason `useSync` keeps `notesRef`/`canvasRef`.
  const atRef = useRef(boardsAt);
  atRef.current = boardsAt;
  /**
   * What is queued *now*, for `applyRemote`. The sync loop reads the two flags
   * at the start of a tick and then goes to the network; a folder made while
   * that pull was in flight is dirty by the time the row comes back, and the
   * row must not be laid over it. React state is a render late for that
   * question — the same reason `atRef` exists. `canvasSync` re-reads its
   * outbox after the pull for the same reason; this is that check for a row
   * whose outbox is two booleans.
   */
  const queued = useRef({ boards: false, since: false });
  /** See `BASE_KEY`. A ref: only the sync loop reads it, never a render. */
  const baseRef = useRef<UserBoard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getMeta<UserBoard[]>(BOARDS_KEY),
      getMeta<string>(AT_KEY),
      getMeta<boolean>(DIRTY_KEY),
      getMeta<string>(SINCE_KEY),
      getMeta<boolean>(SINCE_DIRTY_KEY),
      getMeta<UserBoard[]>(BASE_KEY),
    ]).then(([stored, at, dirty, since, sinceQueued, base]) => {
      if (cancelled) return;
      if (stored) setBoards(stored);
      // A device from before the merge has no base. If nothing is queued, the
      // list it holds is the last one the server gave it, which is exactly
      // what a base is; if something is queued, it has none, and may only add.
      baseRef.current = base ?? (dirty ? null : (stored ?? null));
      if (at) setBoardsAt(at);
      if (dirty) {
        queued.current.boards = true;
        setBoardsDirty(true);
      }
      if (since) setSince(since);
      if (sinceQueued) {
        queued.current.since = true;
        setSinceDirty(true);
      }
      setPrefsReady(true);
    }).catch((error: unknown) => {
      // Nothing read means an empty shelf until the next pull restores it
      // from the server; holding `prefsReady` false forever would stop that
      // pull from ever being applied, so the flag goes up regardless.
      console.error("board preferences failed to load", error);
      if (!cancelled) setPrefsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * One local change to the preferences row, naming the field it touched.
   *
   * The stamp is shared — there is one row and one version of it — but the queue
   * is not: only the field that actually changed is offered for upload. See
   * `DIRTY_KEY` for what happened the day they were one flag.
   */
  const stampDirty = useCallback((field: "boards" | "since") => {
    // Always later than the last stamp, and known to the sync loop at once:
    // two changes in the same millisecond used to share a stamp, so crossing
    // off the first push crossed off the second change too, and a merge
    // coming back read it as already sent (the server's test run, 2026-10-09).
    const now = nowIso();
    const stamp =
      now > atRef.current ? now : new Date(Date.parse(atRef.current) + 1).toISOString();
    atRef.current = stamp;
    write(AT_KEY, stamp);
    setBoardsAt(stamp);
    if (field === "boards") {
      queued.current.boards = true;
      write(DIRTY_KEY, true);
      setBoardsDirty(true);
    } else {
      queued.current.since = true;
      write(SINCE_DIRTY_KEY, true);
      setSinceDirty(true);
    }
    setVersion((n) => n + 1);
  }, [write]);

  // The list as it is now, for a reversal that runs long after the render that
  // created it — the undo stack keeps its `run` for as long as Ctrl+Z can reach
  // it — and for several changes made in one handler, which is what the Keep
  // import's labels do. `commit` moves it at once rather than a render later,
  // so the second of two changes in one tick is made to the list the first left.
  // It holds the stored list, order entry and all; `foldersOf` it for folders.
  const listRef = useRef(stored);
  listRef.current = stored;

  const commit = useCallback(
    (next: UserBoard[]) => {
      listRef.current = next;
      write(BOARDS_KEY, next);
      setBoards(next);
      stampDirty("boards");
      return next;
    },
    [stampDirty, write],
  );

  /**
   * A change to the folders, written with the lens order kept. Every verb below
   * that changes folders goes through this rather than `commit`, because it is
   * handed the folders alone and the stored list is more than that.
   */
  const commitFolders = useCallback(
    (folders: UserBoard[]) => commit(withFolders(listRef.current, folders)),
    [commit],
  );

  /**
   * Answering the first-open question, or changing the answer later from the
   * menu. One value, two answers — see `INBOX_ALL`. It rides in the same row the
   * folders do, so a device that has answered pushes its answer and a device that
   * has not takes whatever the server says — but on a **flag of its own**, so
   * answering the date never offers this device's folder list up alongside it.
   */
  const setInboxSince = useCallback(
    (since: string | null) => {
      write(SINCE_KEY, since);
      setSince(since);
      stampDirty("since");
    },
    [stampDirty, write],
  );

  const create = useCallback(
    (name: string) => {
      // A folder already called this (any case) is that board: every door that
      // makes one by name (Tidy up, Move) files into it rather than a twin.
      const wanted = name.trim().toLowerCase();
      const same = boards.find((b) => b.name.trim().toLowerCase() === wanted);
      if (same) return same;
      const created = makeBoard(name, boards);
      commitFolders([...boards, created]);
      return created;
    },
    [boards, commitFolders],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      commitFolders(editBoard(boards, id, name));
    },
    [boards, commitFolders],
  );

  /**
   * Takes one folder off the list *as it is now*, not as the render that made
   * this function saw it. Two callers hold it long after that render: the undo
   * of a move that made its folder (`lib/useSelectionVerbs.ts`) runs whenever
   * Ctrl+Z is pressed, and by then a folder may have been made, renamed or
   * dressed here, or brought in by sync. Filtering the render's own list wrote
   * all of that back to how it was and sent it up. An id that is not on the
   * list writes nothing, so a removal that finds the folder already gone does
   * not queue a change nobody made.
   */
  const remove = useCallback(
    (id: string) => {
      const folders = foldersOf(listRef.current);
      if (!folders.some((b) => b.id === id)) return;
      commitFolders(dropBoard(folders, id));
    },
    [commitFolders],
  );

  /**
   * Any change to the list at all, made to the list as it is *now* and written
   * as one change to the row — for the Keep import, which makes the boards its
   * labels asked for in one go and takes them off again on its undo
   * (`lib/keepImport.ts`, where the list surgery lives, off the first paint).
   * `create` reads the list off the render, so called in a loop it would have
   * made each new board over the list the render began with and kept only the
   * last. An edit that hands back the list it was given writes nothing.
   */
  const edit = useCallback(
    (change: (list: UserBoard[]) => UserBoard[]) => {
      const folders = foldersOf(listRef.current);
      const next = change(folders);
      if (next !== folders) commitFolders(next);
    },
    [commitFolders],
  );

  /**
   * Putting a deleted folder back — its own id, name, place on the shelf and
   * look, so the notes that named it are filed into it again rather than into a
   * look-alike. A folder already on the shelf under that id (the other device
   * restored it too) is left alone.
   */
  const restore = useCallback(
    (board: UserBoard) => {
      const list = listRef.current;
      if (list.some((b) => b.id === board.id)) return;
      commit([...list, board]);
    },
    [commit],
  );

  /**
   * A board put down at `to` in its own run — a folder among the folders, a
   * lens among Todos, Links and Files (`shelfRun` in `lib/boards.ts` decides
   * which run, and the caller hands an index into it). Same write as a rename:
   * through `commit`, into the one preferences row, queued on the folder-list
   * flag, so the order you put your shelf in travels to the other device with
   * the folders themselves. No migration and no new store — `position` has
   * been on `UserBoard` since folders existed, and the lens order rides in the
   * same list as one entry of its own (`SHELF_ORDER_ID`).
   *
   * A drop that changes nothing — back where it started, off either end, an
   * id that is in neither run — writes nothing. Committing it would stamp the
   * row dirty and push a change nobody made, and on a synced preferences row
   * that is not nothing: it is this device's folder list offered up against
   * the other device's.
   */
  const place = useCallback(
    (id: string, to: number, shelf?: { boards: readonly Board[]; run: readonly string[] }) => {
      // Handed the shelf as drawn, any movable board is carried along its run
      // (`placedOnShelf`): Archive among the folders, the app's own boards
      // among themselves (2026-10-23). Without it, the older two runs.
      if (shelf) {
        const next = placedOnShelf(listRef.current, shelf.boards, shelf.run, id, to);
        if (next !== listRef.current) commit(next);
        return;
      }
      if (boards.some((b) => b.id === id)) {
        const next = putBoard(boards, id, to);
        if (next !== boards) commitFolders(next);
        return;
      }
      const lenses = orderLenses(lensOrder).map((lens) => lens.id);
      const next = placeInRun(lenses, id, to);
      if (next !== lenses) commit(withLensOrder(listRef.current, next));
    },
    [boards, lensOrder, commit, commitFolders],
  );

  /**
   * A built-in board taken off the shelf or put back (Settings). Synced with
   * the shelf's order in the one preferences row, so both devices hide it.
   * Nothing about a note changes: its board stays where it was.
   */
  const hideBoard = useCallback(
    (key: BuiltInKey, hide: boolean) => {
      const next = withBoardHidden(listRef.current, key, hide);
      if (next !== listRef.current) commit(next);
    },
    [commit],
  );

  /**
   * A board's mark, its hue, or both. Written the same way a rename is —
   * straight into the one preferences row, queued on the folder-list flag —
   * because it *is* part of the folder list: how a board looks is one of the
   * few things about a board that is worth carrying to the other device.
   */
  const dress = useCallback(
    (id: string, look: { icon?: string | null; color?: string | null }) => {
      commitFolders(dressBoard(boards, id, look));
    },
    [boards, commitFolders],
  );

  /** Whether a folder's notes keep the screen on — synced the way its look is. */
  const awaken = useCallback(
    (id: string, on: boolean) => {
      commitFolders(wakeBoard(boards, id, on));
    },
    [boards, commitFolders],
  );

  /**
   * One-time adoption of the Inspiration board (`adoptInspiration` in
   * `lib/boards.ts`) — the caller decides *when* (`shouldAdoptInspiration`),
   * this only writes. Goes through `commit`, so it is one change to the one
   * preferences row, queued on the folder-list flag, and a call that changes
   * nothing stamps nothing.
   */
  const adoptInspiration = useCallback(() => {
    const next = adoptList(listRef.current);
    if (next !== listRef.current) commit(next);
  }, [commit]);

  /**
   * A board list that arrived from the server. Not queued for upload —
   * pushing back what was just pulled is how a sync loop starts talking to
   * itself, the same rule `applyRemotePinnedTags` followed.
   *
   * Refused, field by field, for anything queued *at this moment*. The pull
   * was decided on the flags as they stood when the tick began; a folder made
   * during its round trip is queued now, and laying the server's list over it
   * would take the folder off the shelf and out of the store with nothing
   * left to push. The window is one request wide and it opens on nearly every
   * tick, which is how it was found: it used to set both flags false here, on
   * the strength of what they had been a round trip ago.
   */
  const applyRemote = useCallback(
    (next: UserBoard[], at: string, since?: string | null) => {
      const { boards: boardsQueued, since: sinceQueued } = queued.current;
      // The base moves only with the list. A queued change was made against
      // the base as it stands, and is merged against it on its way up; had
      // this list become the base, the merge would read a folder the other
      // device just made as "deleted here", bring back what it deleted and
      // undo its renames (audit DATA-2, 2026-10-10). The merge that sends the
      // change brings this list in, and `applyMerged` sets the base then.
      if (!boardsQueued) {
        baseRef.current = next;
        write(BASE_KEY, next);
        listRef.current = next;
        setBoards(next);
        write(BOARDS_KEY, next);
      }
      // `undefined` means the server has nothing to say about the Inbox date —
      // it has not run migration 0018 — which is not the same as "nobody has
      // answered" and must not overwrite the answer given here.
      if (since !== undefined && !sinceQueued) {
        setSince(since);
        write(SINCE_KEY, since);
      }
      // The stamp is shared by both fields: it is the version the next push is
      // crossed off by, and while anything is still queued it has to stay the
      // local one — the server's is older, and `clearDirty` compares by it.
      if (boardsQueued || sinceQueued) return;
      setBoardsAt(at);
      write(AT_KEY, at);
    },
    [write],
  );

  /**
   * The folder list a push just sent — the server's merged with this device's
   * change — becomes this device's list and its base. A change made while the
   * push was in flight is merged into it the same way, so a folder made on the
   * other device and brought in by the merge is not then read as "deleted here"
   * on the next turn.
   */
  const applyMerged = useCallback(
    (
      merged: UserBoard[],
      sentAt: string,
      mergeBoards: (server: UserBoard[], local: UserBoard[], base: UserBoard[] | null) => UserBoard[],
    ) => {
      const before = baseRef.current;
      baseRef.current = merged;
      write(BASE_KEY, merged);
      const next = atRef.current === sentAt ? merged : mergeBoards(merged, listRef.current, before);
      listRef.current = next;
      setBoards(next);
      write(BOARDS_KEY, next);
    },
    [write],
  );

  /**
   * The account's Inbox date, taken over the one this device answered before it
   * had ever seen the account's row (audit DATA-11; `yieldedSince` in
   * `boardSync.ts`). Only while that answer is still the one queued: a change
   * made since is this person's own, and goes up on the next turn.
   */
  const yieldSince = useCallback((since: string, sentAt: string) => {
    if (atRef.current !== sentAt) return;
    queued.current.since = false;
    setSinceDirty(false);
    write(SINCE_DIRTY_KEY, false);
    setSince(since);
    write(SINCE_KEY, since);
  }, [write]);

  /**
   * Crosses off a push, but only if it still names the version that went up —
   * the outbox rule applied to a single stamp instead of a map. A change made
   * while the upload was in flight re-stamps `boardsAt`, so it survives here
   * and goes up on the next sync instead of being silently dropped.
   */
  const clearDirty = useCallback((sentAt: string) => {
    if (atRef.current !== sentAt) return;
    queued.current = { boards: false, since: false };
    setBoardsDirty(false);
    setSinceDirty(false);
    write(DIRTY_KEY, false);
    write(SINCE_DIRTY_KEY, false);
  }, [write]);

  const nameOf = useCallback((id: string | null) => nameOfBoard(listRef.current, id), []);

  return {
    boards,
    /** The list as stored and synced — for the sync loop, and nothing else. */
    storedBoards: stored,
    /** A board's name by id (null is the Inbox), a folder made a moment ago included. */
    nameOf,
    lensOrder,
    shelfOrder,
    hideBoard,
    inspiration,
    adoptInspiration,
    inboxSince,
    setInboxSince,
    prefsReady,
    storageError,
    retryStorage,
    createBoard: create,
    editBoards: edit,
    renameBoard: rename,
    removeBoard: remove,
    restoreBoard: restore,
    placeBoard: place,
    setBoardLook: dress,
    setBoardAwake: awaken,
    boardsAt,
    boardsDirty,
    sinceDirty,
    boardsVersion: version,
    applyRemoteBoards: applyRemote,
    applyMergedBoards: applyMerged,
    yieldInboxSince: yieldSince,
    /** The server's list as last seen here, read by the sync loop at push time. */
    boardsBase: baseRef,
    clearBoardsDirty: clearDirty,
  };
}
