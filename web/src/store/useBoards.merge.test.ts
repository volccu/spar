// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserBoard } from "../types";
import { mergeBoards } from "../lib/boardsMerge";
import { useBoards } from "./useBoards";
import { getMeta } from "./db";

afterEach(cleanup);

/**
 * The store's half of the merge (2026-10-09): it remembers the server's list
 * as last seen (`boardsBase`), and lays a pushed merge back over its own list
 * without losing a change made while the push was in flight. One IndexedDB
 * store is shared down this file, so the cases run in order.
 */
const SERVER_AT = "2026-10-01T12:00:00.000Z";
const account: UserBoard[] = [
  { id: "srv-1", name: "Recipes", position: 0 },
  { id: "srv-2", name: "Work", position: 1 },
];

async function ready() {
  const hook = renderHook(() => useBoards());
  await waitFor(() => expect(hook.result.current.prefsReady).toBe(true));
  return hook.result;
}

/**
 * Every write the store started has landed and answered. A write that answers
 * after the file's environment is torn down calls `setStorageError` with no
 * `window`, which the server's slower run reported as an unhandled error and
 * the deploy hook refused (2026-10-09).
 */
async function settled(boards: UserBoard[], base: UserBoard[]) {
  await waitFor(async () => {
    expect(await getMeta<UserBoard[]>("boards")).toEqual(boards);
    expect(await getMeta<UserBoard[]>("boardsBase")).toEqual(base);
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

describe("the server's list as last seen", () => {
  it("is remembered whenever a server list is applied", async () => {
    const result = await ready();
    act(() => {
      result.current.applyRemoteBoards(account, SERVER_AT, null);
    });
    expect(result.current.boardsBase.current).toEqual(account);
    await settled(account, account);
  });

  it("keeps a folder made while a merge was on its way up", async () => {
    const result = await ready();
    act(() => {
      result.current.createBoard("Sent");
    });
    const sentAt = result.current.boardsAt;
    const sent = result.current.storedBoards;
    // Meanwhile the other device added a folder, and the merge brought it in.
    const merged = mergeBoards([...account, { id: "srv-3", name: "There", position: 2 }], sent, account);
    act(() => {
      result.current.createBoard("Made mid-push");
    });
    act(() => {
      result.current.applyMergedBoards(merged, sentAt, mergeBoards);
    });
    expect(result.current.boards.map((b) => b.name)).toEqual(["Recipes", "Work", "There", "Sent", "Made mid-push"]);
    expect(result.current.boardsBase.current).toEqual(merged);
    // Still queued: the folder made mid-push has not gone up yet.
    expect(result.current.boardsDirty).toBe(true);
    await settled(result.current.storedBoards, merged);
  });
});

describe("two changes in the same millisecond", () => {
  it("get two stamps, the second later than the first", async () => {
    const result = await ready();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T19:00:00.000Z"));
    try {
      act(() => {
        result.current.createBoard("First");
      });
      const first = result.current.boardsAt;
      act(() => {
        result.current.createBoard("Second");
      });
      expect(result.current.boardsAt > first).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    await settled(result.current.storedBoards, result.current.boardsBase.current ?? []);
  });
});

/**
 * Audit DATA-2 (2026-10-10). A server list that arrived while a folder change
 * here was still queued used to become the base at once — so the next merge
 * read the other device's new folder as "deleted here", brought back what it
 * had deleted and undid its renames.
 */
describe("a server list arriving while a folder change waits", () => {
  it("is not taken as the base the waiting change merges against", async () => {
    const result = await ready();
    const seen = result.current.boardsBase.current;
    act(() => {
      result.current.createBoard("Waiting");
    });
    expect(result.current.boardsDirty).toBe(true);
    const seenList = seen ?? [];
    const gone = seenList[0];
    // Meanwhile the other device added srv-3 and deleted the first folder.
    const there: UserBoard[] = [...seenList.slice(1), { id: "srv-3", name: "There", position: 9 }];
    act(() => {
      result.current.applyRemoteBoards(there, SERVER_AT, null);
    });
    expect(result.current.boardsBase.current).toEqual(seen);

    // The next push merges against the base as it was.
    const merged = mergeBoards(there, result.current.storedBoards, result.current.boardsBase.current);
    expect(merged.map((b) => b.id)).toContain("srv-3");
    expect(merged.map((b) => b.name)).toContain("Waiting");
    if (gone) expect(merged.map((b) => b.id)).not.toContain(gone.id);
    await settled(result.current.storedBoards, seenList);
  });

  it("is the base once nothing is waiting", async () => {
    const result = await ready();
    act(() => {
      result.current.clearBoardsDirty(result.current.boardsAt);
    });
    act(() => {
      result.current.applyRemoteBoards(account, SERVER_AT, null);
    });
    expect(result.current.boardsBase.current).toEqual(account);
    await settled(account, account);
  });
});

/** Audit DATA-11: the account's Inbox date taken over this device's first answer. */
describe("the account's Inbox date, over an answer given before sign-in", () => {
  it("replaces the queued answer while it is still the one queued", async () => {
    const result = await ready();
    act(() => {
      result.current.setInboxSince("1970-01-01T00:00:00.000Z");
    });
    expect(result.current.sinceDirty).toBe(true);
    const sentAt = result.current.boardsAt;
    act(() => {
      result.current.yieldInboxSince("2026-06-01T00:00:00.000Z", sentAt);
    });
    expect(result.current.inboxSince).toBe("2026-06-01T00:00:00.000Z");
    expect(result.current.sinceDirty).toBe(false);
    await waitFor(async () => {
      expect(await getMeta<string>("inboxSince")).toBe("2026-06-01T00:00:00.000Z");
      expect(await getMeta<boolean>("inboxSinceDirty")).toBe(false);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  });

  it("keeps an answer changed here while the turn was out", async () => {
    const result = await ready();
    act(() => {
      result.current.setInboxSince("1970-01-01T00:00:00.000Z");
    });
    const sentAt = result.current.boardsAt;
    act(() => {
      result.current.setInboxSince("2026-09-01T00:00:00.000Z");
    });
    act(() => {
      result.current.yieldInboxSince("2026-06-01T00:00:00.000Z", sentAt);
    });
    expect(result.current.inboxSince).toBe("2026-09-01T00:00:00.000Z");
    expect(result.current.sinceDirty).toBe(true);
    await waitFor(async () => expect(await getMeta<string>("inboxSince")).toBe("2026-09-01T00:00:00.000Z"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  });
});
