// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserBoard } from "../types";
import { loadSampleNotes } from "../demo/sampleNotes";
import { allNotes, claimForOwner, dirtyEntries, getMeta, purgeEverything, putNote, UnsentWork } from "./db";
import { useAccount } from "./useAccount";
import { useNotes } from "./useNotes";
import { note as base } from "../test/fixtures";

/**
 * From "Use on this device only" to an account, with the notes kept.
 *
 * Device-only mode (and the public demo, which is nothing else) writes every
 * note to this browser and nowhere else, so those notes are the only copy there
 * is. Signing in later — to a Supabase project or a spår server, as a brand-new
 * account — must *upload* them, not empty the store to make room for the
 * account. Two things make that true, and this file holds both end to end
 * against the real store:
 *
 * - every local write goes into the outbox whether or not there is a server
 *   (`putNote`/`putNotes`), so the notes are already queued for upload when the
 *   first session arrives; and
 * - a store nobody has claimed is **adopted** by the first account that signs
 *   in (`claimForOwner`), never purged — the web/CLAUDE.md rule "An unclaimed
 *   store is adopted, never emptied".
 *
 * The wiping the earlier audit found is the other direction and is deliberate:
 * choosing device-only *after signing out* is the browser changing hands, so it
 * purges (`useAccount`'s handoff). What follows it is a fresh, unclaimed store,
 * and the last case below shows it behaves exactly like any other.
 */

const NEW_ACCOUNT = "33333333-3333-3333-3333-333333333333";
const EARLIER = "44444444-4444-4444-4444-444444444444";

const realLocation = window.location;
const reload = vi.fn();

beforeEach(async () => {
  await purgeEverything();
  localStorage.clear();
  reload.mockReset();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, reload } });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

async function deviceOnlyStore() {
  const hook = renderHook(() => useNotes());
  await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });
  return hook.result;
}

describe("device-only notes, then an account", () => {
  it("keeps every note and queues it for upload when a new account signs in", async () => {
    const store = await deviceOnlyStore();

    // Written with no server at all: a capture, and the demo's whole sample set
    // through the import's door.
    act(() => {
      store.current.create("a thought written with no account");
    });
    let shelf: UserBoard[] = [];
    await act(async () => {
      await loadSampleNotes(
        {
          importNotes: store.current.importNotes,
          notes: () => store.current.notes,
          bulkUpdate: store.current.bulkUpdate,
          editBoards: (change) => {
            shelf = change(shelf);
          },
          pushUndo: () => {},
        },
        { picture: async () => null },
      );
    });
    await waitFor(async () => expect(await allNotes()).toHaveLength(store.current.notes.length));
    const written = await allNotes();
    expect(written.length).toBeGreaterThan(30);
    expect(shelf.length).toBeGreaterThan(0);

    // The first session this browser has ever seen.
    expect(await getMeta("owner")).toBeUndefined();
    expect(await claimForOwner(NEW_ACCOUNT)).toBe(false);

    // Nothing emptied, and every note is in the outbox at the version on disk —
    // which is what the first sync tick reads and sends (`dirtyEntries`).
    expect((await allNotes()).map((n) => n.id).sort()).toEqual(written.map((n) => n.id).sort());
    const outbox = new Map((await dirtyEntries()).map((entry) => [entry.id, entry.stamp]));
    for (const note of written) expect(outbox.get(note.id)).toBe(note.updated_at);
    expect(await getMeta("owner")).toBe(NEW_ACCOUNT);
  });

  it("lets sync start without a reload when the session arrives", async () => {
    await putNote(base({ id: "only-copy", body: "only copy", raw_content: "only copy" }));
    const { result, rerender } = renderHook(({ user }) => useAccount(user), {
      initialProps: { user: null as string | null },
    });
    act(() => result.current.stayOnThisDevice());
    expect(result.current.deviceOnly).toBe(true);

    rerender({ user: NEW_ACCOUNT });
    await waitFor(() => expect(result.current.ownerReady).toBe(true));
    expect(result.current.held).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    expect((await allNotes()).map((n) => n.id)).toEqual(["only-copy"]);
    expect((await dirtyEntries()).map((e) => e.id)).toEqual(["only-copy"]);
  });

  it("adopts the store again after a handover emptied it, whoever signs in next", async () => {
    // Somebody signed in once, signed out, and handed the browser over: the
    // handoff purges, meta and all, so the store is unclaimed again.
    await claimForOwner(EARLIER);
    await purgeEverything();
    await putNote(base({ id: "after-handover", body: "new owner's note", raw_content: "new owner's note" }));

    expect(await claimForOwner(NEW_ACCOUNT)).toBe(false);
    expect((await allNotes()).map((n) => n.id)).toEqual(["after-handover"]);
    expect((await dirtyEntries()).map((e) => e.id)).toEqual(["after-handover"]);
  });

  it("holds rather than wipes when the store still belongs to someone else", async () => {
    // Signed in as one account, then device-only without a handover (a reload
    // after signing out), then a *different* account: the notes may be the
    // earlier account's, so nothing is uploaded under the new one — and nothing
    // is destroyed either. The person chooses on the HeldWork screen.
    await claimForOwner(EARLIER);
    await putNote(base({ id: "unsent", body: "unsent", raw_content: "unsent" }));

    await expect(claimForOwner(NEW_ACCOUNT)).rejects.toBeInstanceOf(UnsentWork);
    expect((await allNotes()).map((n) => n.id)).toEqual(["unsent"]);
    expect(await getMeta("owner")).toBe(EARLIER);
  });
});
