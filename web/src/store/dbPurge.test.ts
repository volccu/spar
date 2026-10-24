// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANSWER_INBOX } from "../lib/reminderActions";
import { SHARE_INBOX } from "../lib/shareTarget";
import { allImageText, allPdfText, purgeEverything, putImageText, putPdfText } from "./db";

/**
 * The handoff purge, and the part of it that is not in the database.
 *
 * Its own file for the reason `dbOwner.test.ts` is: the thing under test
 * empties the whole store, and a test that does that is a bad neighbour.
 *
 * Everything the app keeps about one person's notes is in IndexedDB *except*
 * three things, and an exception a purge does not know about is a leak. The
 * reading positions in `localStorage` were already taken; the two the service
 * workers park in Cache Storage were not — `share-inbox` holds the bytes and
 * the filenames of a share the app never came back to collect, and
 * `reminder-answers` holds note ids. Sign out, hand the browser on, and the
 * photographs were still there.
 */

afterEach(() => vi.unstubAllGlobals());

describe("purgeEverything", () => {
  it("drops the two worker inboxes, and nothing else in Cache Storage", async () => {
    const dropped = vi.fn(async () => true);
    vi.stubGlobal("caches", { delete: dropped });

    await purgeEverything();

    // By name, never `caches.keys()` and a loop: the generated service worker
    // precaches the app shell into caches of its own, and taking those turns a
    // handoff into a full re-download — or, offline, into no app at all.
    expect(dropped.mock.calls.map((call) => call[0]).sort()).toEqual(
      [ANSWER_INBOX, SHARE_INBOX].sort(),
    );
  });

  /**
   * The purge has already emptied the database by the time the caches are
   * reached. A half-purged store is the exact state the account handoff exists
   * to prevent, so a storage layer that will not answer cannot be allowed to
   * throw the whole thing — a leftover share is the smaller of the two
   * failures.
   */
  it("finishes even when a cache refuses to go", async () => {
    vi.stubGlobal("caches", {
      delete: async () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(purgeEverything()).resolves.toBeUndefined();
  });

  /** The words read out of someone's pictures and documents are their words (FX-A-07). */
  it("empties the words read out of pictures and documents", async () => {
    await putImageText("pic", { v: 1, outcome: "text", text: "receipt" });
    await putPdfText("doc", { v: 1, outcome: "text", text: "lease" });
    await purgeEverything();
    expect((await allImageText()).size).toBe(0);
    expect((await allPdfText()).size).toBe(0);
  });

  /** jsdom has no `caches`, and neither does a non-secure origin. */
  it("finishes where there is no Cache Storage at all", async () => {
    await expect(purgeEverything()).resolves.toBeUndefined();
  });
});
