// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import { allNotes, claimForOwner, dirtyEntries, putNote, setMeta, unsentWorkCount, UnsentWork } from "./db";
import { stashUnsaved } from "./unsavedStash";
import { note as base } from "../test/fixtures";

const note = (id: string): Note =>
  base({
    id,
    raw_content: "private",
    body: "private",
    created_at: "2026-08-12T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
  });

/**
 * Binding the local store to an account.
 *
 * Its own file because the interesting case destroys the whole store, and a
 * test that empties the database is a bad neighbour.
 */

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";


describe("claiming the local store for an account", () => {
  /**
   * The ordinary first sign-in, including from device-only mode where the
   * local notes are the only copy there is. Emptying it would be a destructive
   * answer to a question nobody asked.
   */
  it("adopts an unclaimed store rather than emptying it", async () => {
    await putNote(note("mine"));

    expect(await claimForOwner(ALICE)).toBe(false);
    expect((await allNotes()).map((n) => n.id)).toEqual(["mine"]);
  });

  it("does nothing at all when the same person signs in again", async () => {
    expect(await claimForOwner(ALICE)).toBe(false);
    expect(await allNotes()).toHaveLength(1);
  });

  /**
   * But not while the previous account's work is still here and nowhere else.
   * `putNote` queues the note for upload, and it never went, so emptying the
   * store would destroy the only copy. The switch refuses, says how much, and
   * leaves everything — owner included — exactly as it was.
   */
  it("refuses to empty a store still holding unsent work, and says how much", async () => {
    const refused = claimForOwner(BOB);
    await expect(refused).rejects.toBeInstanceOf(UnsentWork);
    await expect(refused).rejects.toMatchObject({ count: 1 });
    expect((await allNotes()).map((n) => n.id)).toEqual(["mine"]);
    expect(await dirtyEntries()).toHaveLength(1);
    // Still Alice's: nothing was claimed while the question stood.
    expect(await claimForOwner(ALICE)).toBe(false);
  });

  /**
   * The leak this exists to close. Signing out ends the session and touches
   * nothing else, so a second account signing in on the same browser opened
   * onto the first one's whole archive — read straight out of IndexedDB,
   * before a single request, where no amount of row level security on the
   * server has any say. With unsent work present it is cleared only when the
   * person says so.
   */
  it("empties the store when a different person signs in and it is cleared anyway", async () => {
    expect(await claimForOwner(BOB, { evenIfUnsent: true })).toBe(true);
    expect(await allNotes()).toEqual([]);
  });

  /**
   * And the outbox goes with it. Left behind, the previous account's unsent
   * notes would have been uploaded under the new account's id — turning a
   * display leak into a permanent copy in somebody else's archive.
   */
  it("takes the previous account's outbox with it", async () => {
    expect(await dirtyEntries()).toEqual([]);
  });

  /**
   * The purge clears `meta` too, so the new owner has to be written after it.
   * Written before, the store would read as unclaimed on the next open — and
   * the reload the app does after a switch would ask again, switch again, and
   * reload for ever.
   */
  it("records the new owner, so the switch settles instead of looping", async () => {
    expect(await claimForOwner(BOB)).toBe(false);
  });
});

/**
 * Audit DATA-8 (2026-10-10). The switch counted the notes' outbox, unsent
 * files, canvases and deletes — and not a folder change or an Inbox date still
 * queued, nor a note only the failed-write stash held. All of those were
 * emptied by the purge with nothing said. (The store is Bob's here, and empty.)
 */
describe("unsent work that is not a note in the outbox", () => {
  it("counts a folder change and an Inbox date still queued", async () => {
    expect(await unsentWorkCount()).toBe(0);
    await setMeta("boardsDirty", true);
    await setMeta("inboxSinceDirty", true);
    expect(await unsentWorkCount()).toBe(2);
    await expect(claimForOwner(ALICE)).rejects.toMatchObject({ count: 2 });
    await setMeta("boardsDirty", false);
    await setMeta("inboxSinceDirty", false);
    expect(await unsentWorkCount()).toBe(0);
  });

  it("counts a note only the failed-write stash holds, once however it is also queued", async () => {
    stashUnsaved([note("stashed")]);
    expect(await unsentWorkCount()).toBe(1);
    await putNote(note("stashed"));
    expect(await unsentWorkCount()).toBe(1);
    await expect(claimForOwner(ALICE)).rejects.toMatchObject({ count: 1 });
    stashUnsaved([]);
  });
});
