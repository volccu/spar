// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UserBoard } from "../types";
import { useBoards } from "./useBoards";
import { getMeta } from "./db";

afterEach(cleanup);

const SERVER_AT = "2026-09-01T09:00:00.000Z";
const theirs: UserBoard[] = [{ id: "srv-1", name: "Recipes", position: 0 }];

async function ready() {
  const hook = renderHook(() => useBoards());
  await waitFor(() => expect(hook.result.current.prefsReady).toBe(true));
  return hook.result;
}

/**
 * The sync loop reads the dirty flags when a tick begins, then goes to the
 * network. A folder made while that pull is in flight is queued by the time
 * the server's row comes back, and `applyRemote` used to lay the row over it
 * and clear the flag — the folder left the shelf and the store with nothing
 * left to push it. One IndexedDB store is shared down this file, so the
 * cases are written in the order they run.
 */
describe("a pull that lands on a queued change", () => {
  it("is applied when nothing is queued", async () => {
    const result = await ready();
    act(() => {
      result.current.applyRemoteBoards(theirs, SERVER_AT, null);
    });
    expect(result.current.boards.map((b) => b.name)).toEqual(["Recipes"]);
    expect(result.current.boardsAt).toBe(SERVER_AT);
    expect(result.current.boardsDirty).toBe(false);
  });

  it("keeps a folder made while the pull was in flight, still queued", async () => {
    const result = await ready();
    act(() => {
      result.current.createBoard("Made mid-tick");
    });
    const localAt = result.current.boardsAt;

    act(() => {
      result.current.applyRemoteBoards(theirs, SERVER_AT, null);
    });
    expect(result.current.boards.map((b) => b.name)).toEqual(["Recipes", "Made mid-tick"]);
    expect(result.current.boardsDirty).toBe(true);
    // The stamp stays local: it is what the next push is crossed off by.
    expect(result.current.boardsAt).toBe(localAt);
    await waitFor(async () => {
      expect((await getMeta<UserBoard[]>("boards"))?.map((b) => b.name)).toEqual([
        "Recipes",
        "Made mid-tick",
      ]);
    });
  });

  it("takes the server's date while only the folder list is queued, and not the other way round", async () => {
    const result = await ready();
    // Still queued from the case above: the list is refused, the date is not.
    act(() => {
      result.current.applyRemoteBoards(theirs, SERVER_AT, "2026-08-01T00:00:00.000Z");
    });
    expect(result.current.inboxSince).toBe("2026-08-01T00:00:00.000Z");
    expect(result.current.boards.map((b) => b.name)).toContain("Made mid-tick");

    // Crossed off: now the list is taken, and a date answered here is kept.
    act(() => {
      result.current.clearBoardsDirty(result.current.boardsAt);
    });
    act(() => {
      result.current.setInboxSince("2026-09-05T00:00:00.000Z");
    });
    act(() => {
      result.current.applyRemoteBoards(theirs, SERVER_AT, "2026-08-01T00:00:00.000Z");
    });
    expect(result.current.boards.map((b) => b.name)).toEqual(["Recipes"]);
    expect(result.current.inboxSince).toBe("2026-09-05T00:00:00.000Z");
    expect(result.current.sinceDirty).toBe(true);
  });
});

/**
 * The lens order rides in the folder list as one entry of its own, because
 * the preferences row has nowhere else to put it without a migration. It must
 * go up with the list and come down with it, and nothing that reads the list
 * as folders may ever see it. Runs after the cases above, on the same store.
 */
describe("the lens order, carried in the folder list", () => {
  it("is written when a lens moves, and is never offered as a folder", async () => {
    const result = await ready();
    const foldersBefore = result.current.boards.map((b) => b.id);

    act(() => {
      result.current.placeBoard("files", 0);
    });
    expect(result.current.lensOrder).toEqual(["files", "todos", "links"]);
    // Folders are the folders: the entry is not one, and nothing about them moved.
    expect(result.current.boards.map((b) => b.id)).toEqual(foldersBefore);
    // Sync is handed the whole list, order entry and all, and queued.
    expect(result.current.storedBoards.map((b) => b.id)).toContain("shelf-order");
    expect(result.current.boardsDirty).toBe(true);
    await waitFor(async () => {
      expect((await getMeta<UserBoard[]>("boards"))?.map((b) => b.id)).toContain("shelf-order");
    });
  });

  it("survives a folder being made, renamed and moved after it", async () => {
    const result = await ready();
    expect(result.current.lensOrder).toEqual(["files", "todos", "links"]);
    act(() => {
      result.current.createBoard("After the lens");
    });
    const made = result.current.boards.find((b) => b.name === "After the lens")!;
    // Appended after the real folders, not after the entry's far-off position.
    expect(made.position).toBeLessThan(1000);
    act(() => {
      result.current.placeBoard(made.id, 0);
    });
    expect(result.current.boards[0]?.id).toBe(made.id);
    expect(result.current.lensOrder).toEqual(["files", "todos", "links"]);
  });

  it("writes nothing for a drop that changes nothing", async () => {
    const result = await ready();
    act(() => {
      result.current.clearBoardsDirty(result.current.boardsAt);
    });
    const before = result.current.storedBoards;
    act(() => {
      result.current.placeBoard("files", 0);
      result.current.placeBoard("inbox", 2);
      result.current.placeBoard("nope", 1);
    });
    expect(result.current.storedBoards).toBe(before);
    expect(result.current.boardsDirty).toBe(false);
  });

  it("arrives from the server with the list, and a list without it is the default order", async () => {
    const result = await ready();
    act(() => {
      result.current.applyRemoteBoards(
        [...theirs, { id: "shelf-order", name: "Shelf order", position: 1_000_000, lenses: ["links"] } as UserBoard],
        SERVER_AT,
        null,
      );
    });
    expect(result.current.boards.map((b) => b.name)).toEqual(["Recipes"]);
    expect(result.current.lensOrder).toEqual(["links"]);
    act(() => {
      result.current.applyRemoteBoards(theirs, SERVER_AT, null);
    });
    expect(result.current.lensOrder).toBeNull();
  });
});
