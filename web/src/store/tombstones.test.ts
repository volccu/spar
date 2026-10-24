// @vitest-environment jsdom
import { forgetServerClock, noteServerDate } from "./serverClock";
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Note } from "../types";

/**
 * Permanent deletion, end to end.
 *
 * This is the only path in the app that destroys anything, and until now it was
 * the only part of sync with no test at all. Everything else in `sync.test.ts`
 * is about a server that is *behind* the client; this file is about a server
 * that **disagrees** with it — which is where the two ways a note can be lost
 * both live:
 *
 *   1. the server refuses the delete and the note is already gone from here, so
 *      unless something fetches it back it exists on the server, past the pull
 *      cursor, and is invisible on this device for ever;
 *   2. the bytes of a file that never finished uploading are the only copy in
 *      existence, so they may not be destroyed until the server has agreed.
 *
 * The local store is real (`fake-indexeddb`) rather than mocked. The point of
 * these tests is the conversation between `sync.ts` and `db.ts` — a mocked
 * `db.ts` would only assert that the mock does what the mock does.
 */

/** The paths `removeRemote` was asked to delete, in order. */
let removedRemote: string[] = [];
/** The notes whose whole storage folder `removeNoteFolders` was asked to clear. */
let clearedFolders: string[] = [];

vi.mock("./attachments", () => ({
  // Storage is the one thing not modelled here: it has no bearing on whether a
  // delete is durable, and `pruneCache` runs on the same tick as the sweep.
  removeRemote: async (atts: Attachment[]) => {
    removedRemote.push(...atts.map((a) => a.path ?? "(unuploaded)"));
  },
  removeNoteFolders: async (ids: string[]) => {
    clearedFolders.push(...ids);
  },
  pruneCache: async () => 0,
  uploadPending: async () => ({ uploaded: [], failed: null }),
}));

/**
 * The fake server, deliberately split in two.
 *
 * `page` is what a cursor pull returns — rows changed since this device last
 * looked. `rows` is what a fetch *by id* finds, whatever the cursor says. Those
 * being two different things is the entire mechanism behind the bug this file
 * was written for: a note whose delete was refused sits in `rows` and not in
 * `page`, so an ordinary pull will never mention it again however long it runs.
 */
const server = {
  page: [] as Record<string, unknown>[],
  rows: new Map<string, Record<string, unknown>>(),
  tombstones: [] as { note_id: string; deleted_at: string }[],
  /** Notes the RPC answers `false` for — no longer trashed there, or moved on. */
  refuse: new Set<string>(),
  /** Notes the RPC cannot be asked about at all — the network, not a verdict. */
  rpcFails: new Set<string>(),
  /** A note the notes upsert will not take (migration 0011's resurrection guard). */
  poisoned: null as string | null,
  /** What happens the first time the poisoned row is refused. */
  onPoisoned: null as (() => void) | null,
  rpcCalls: [] as { id: string; expected: string }[],
  upserted: [] as Record<string, unknown>[],
  /** Narrow one-row writes, so a delivered trashing can be seen. */
  updated: [] as { id: string; patch: Record<string, unknown> }[],
  byIdRequests: [] as string[][],
  /** Makes the by-id re-fetch fail, to prove the ids are not thrown away. */
  byIdFails: false,
  /** Makes the one-row read `deliverTrashing` starts with fail. */
  readByIdFails: false,
  /** Makes the narrow write that delivers a trashing fail. */
  updateFails: false,
};

vi.mock("./supabase", () => {
  const table = (name: string) => ({
    select(cols: string) {
      // A probe names one column; a real read names a list. The same
      // discrimination the client's own `columnProbe` relies on.
      if (!cols.includes(",")) {
        return { limit: async () => ({ data: [], error: null }) };
      }
      const chain = {
        // Reading one row by id — what `deliverTrashing` asks before it decides
        // whether a refused delete is a restore or an undelivered trashing.
        eq: (_column: string, id: string) => ({
          limit: async () =>
            server.readByIdFails
              ? { data: null, error: { code: "08006", message: "connection lost" } }
              : { data: server.rows.has(id) ? [server.rows.get(id)] : [], error: null },
        }),
        or: () => chain,
        order: () => chain,
        limit: async () => ({
          data: name === "note_tombstones" ? server.tombstones : server.page,
          error: null,
        }),
        in: async (_column: string, ids: string[]) => {
          server.byIdRequests.push(ids);
          if (server.byIdFails) {
            return { data: null, error: { code: "08006", message: "connection lost" } };
          }
          return {
            data: ids.map((id) => server.rows.get(id)).filter(Boolean),
            error: null,
          };
        },
      };
      return chain;
    },
    // A narrow write to one row, which is how an undelivered "trashed" is
    // delivered. Never an upsert: a row that is genuinely gone must not be
    // re-created as a stub.
    update(patch: Record<string, unknown>) {
      return {
        eq: async (_column: string, id: string) => {
          if (server.updateFails) return { error: { message: "connection lost" } };
          const row = server.rows.get(id);
          if (!row) return { error: null };
          server.rows.set(id, { ...row, ...patch });
          server.updated.push({ id, patch });
          return { error: null };
        },
      };
    },
    async upsert(rows: Record<string, unknown>[]) {
      if (server.poisoned && rows.some((r) => r.id === server.poisoned)) {
        server.onPoisoned?.();
        server.onPoisoned = null;
        return { error: { message: `note ${server.poisoned} has been permanently deleted` } };
      }
      server.upserted.push(...rows);
      return { error: null };
    },
  });

  return {
    // Held back until the grid is drawn in the app; here there is no grid.
    shellReady: () => {},
    syncConfigured: true,
    getSupabase: async () => ({
      from: (name: string) => table(name),
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      async rpc(_fn: string, args: { p_note_id: string; p_expected_updated_at: string }) {
        server.rpcCalls.push({ id: args.p_note_id, expected: args.p_expected_updated_at });
        if (server.rpcFails.has(args.p_note_id)) {
          return { data: null, error: { message: "could not reach the server" } };
        }
        // The real `permanently_delete_note` refuses two ways, and the
        // difference is the whole of what `deliverTrashing` is for: the row is
        // not `trashed` there, or its clocks have run past what was expected.
        // `refuse` models the second; the status test models the first, off the
        // row itself, so a test that delivers the trashing can then succeed.
        const held = server.rows.get(args.p_note_id);
        if (held && held.status !== "trashed") return { data: false, error: null };
        if (server.refuse.has(args.p_note_id)) return { data: false, error: null };
        server.rows.delete(args.p_note_id);
        server.tombstones.push({
          note_id: args.p_note_id,
          deleted_at: "2026-08-20T12:00:00.000Z",
        });
        return { data: true, error: null };
      },
    }),
  };
});

import {
  allNotes,
  allTombstones,
  deleteNotes,
  dirtyTombstoneEntries,
  getFile,
  getMeta,
  markSeeded,
  purgeEverything,
  putFile,
  putNote,
  putNotesFromServer,
} from "./db";
import { resetServerCapabilities, syncOnce } from "./sync";
import { expiredInTrash, TRASH_DAYS } from "../lib/trash";
import { useNotes } from "./useNotes";
import { attachment, note as base } from "../test/fixtures";

// Unmounted after every case, so no store is left running its write and retry
// timers once the file ends: Testing Library cleans up by itself only where
// the runner's globals are on, and here they are not. A timer firing after
// jsdom was torn down sent React's scheduler looking for `window`.
afterEach(() => cleanup());

const note = (over: Partial<Note> = {}): Note =>
  base({
    raw_content: "a note",
    body: "a note",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    status: "trashed",
    merged_into: null,
    link_previews: [],
    ...over,
  });

const DAY = 86_400_000;



/** The same note as the server would hand it back. */
function row(n: Note): Record<string, unknown> {
  return { ...n } as Record<string, unknown>;
}

beforeEach(async () => {
  await purgeEverything();
  resetServerCapabilities();
  // The trash sweep will not destroy anything on a clock no server has
  // confirmed (`store/serverClock.ts`), so a test that expects it to run has
  // to let the server speak first — which is what an app that has synced at
  // all has already had happen.
  forgetServerClock();
  noteServerDate(new Date().toUTCString());
  removedRemote = [];
  clearedFolders = [];
  server.page = [];
  server.rows = new Map();
  server.tombstones = [];
  server.refuse = new Set();
  server.rpcFails = new Set();
  server.updated = [];
  server.poisoned = null;
  server.onPoisoned = null;
  server.rpcCalls = [];
  server.upserted = [];
  server.byIdRequests = [];
  server.byIdFails = false;
  server.readByIdFails = false;
  server.updateFails = false;
});

describe("a delete the server takes", () => {
  it("is asked for by id and version, and crosses itself off", async () => {
    const n = note({ attachments: [attachment()] });
    await putNote(n);
    await putFile("a1", new Blob(["abc"]));
    server.rows.set(n.id, row(n));

    await deleteNotes([n.id]);
    expect(await dirtyTombstoneEntries()).toHaveLength(1);

    await syncOnce([]);

    expect(server.rpcCalls).toEqual([{ id: "n1", expected: n.updated_at }]);
    expect(await dirtyTombstoneEntries()).toHaveLength(0);
    // The marker stays behind. It is what stops a pull resurrecting the note.
    expect((await allTombstones()).map((t) => t.id)).toEqual(["n1"]);
  });

  it("only then destroys the bytes, here and in storage", async () => {
    const n = note({ attachments: [attachment()] });
    await putNote(n);
    await putFile("a1", new Blob(["abc"]));
    server.rows.set(n.id, row(n));

    await deleteNotes([n.id]);
    // Still here: the server has not agreed to anything yet.
    expect(await getFile("a1")).toBeDefined();

    await syncOnce([]);

    expect(await getFile("a1")).toBeUndefined();
    expect(removedRemote).toEqual(["u1/n1/a1"]);
    // And the note's whole folder, for paths this device never learned (DATA-5).
    expect(clearedFolders).toEqual(["n1"]);
    // The spent list is dropped from the marker, which itself remains.
    expect((await allTombstones())[0].attachments).toBeUndefined();
  });
});

describe("a delete the server refuses", () => {
  /**
   * The regression test for the bug this pass was opened on.
   *
   * `destroy` removes the note from the screen and from IndexedDB before the
   * server is asked anything. When the answer is "no", the note is still on the
   * server — and behind the pull cursor, which is why `server.page` is empty
   * here while `server.rows` still holds it. Before the fix, nothing in the
   * client ever named that id again: it was gone on this device, present on the
   * other, and no error was raised anywhere.
   */
  it("puts the note back on this device, by fetching it again by id", async () => {
    const n = note();
    await putNote(n);
    server.rows.set(n.id, row(n));
    server.refuse.add(n.id);

    await deleteNotes([n.id]);
    expect(await allNotes()).toHaveLength(0);

    const outcome = await syncOnce([]);

    // Asked for by id, because the cursor page never mentions it.
    expect(server.byIdRequests).toEqual([["n1"]]);
    expect((await allNotes()).map((x) => x.id)).toEqual(["n1"]);
    expect(outcome.pulled.map((x) => x.id)).toContain("n1");
  });

  it("drops the delete marker, so nothing blocks the note coming back", async () => {
    const n = note();
    await putNote(n);
    server.rows.set(n.id, row(n));
    server.refuse.add(n.id);

    await deleteNotes([n.id]);
    await syncOnce([]);

    expect(await allTombstones()).toHaveLength(0);
    expect(await dirtyTombstoneEntries()).toHaveLength(0);
  });

  it("keeps the file bytes, because the note is coming back to hold them", async () => {
    const n = note({ attachments: [attachment({ path: null })] });
    await putNote(n);
    await putFile("a1", new Blob(["abc"]));
    server.rows.set(n.id, row(n));
    server.refuse.add(n.id);

    await deleteNotes([n.id]);
    await syncOnce([]);

    // An unuploaded file's local bytes are the only copy there is.
    expect(await getFile("a1")).toBeDefined();
    expect(removedRemote).toEqual([]);
    expect(clearedFolders).toEqual([]);
  });

  it("stops asking once the note is back", async () => {
    const n = note();
    await putNote(n);
    server.rows.set(n.id, row(n));
    server.refuse.add(n.id);

    await deleteNotes([n.id]);
    await syncOnce([]);
    expect(await getMeta<string[]>("deferredPullIds")).toEqual([]);

    server.byIdRequests = [];
    await syncOnce(await allNotes());
    expect(server.byIdRequests).toEqual([]);
  });

  it("keeps the id if the re-fetch itself fails, rather than forgetting it", async () => {
    const n = note();
    await putNote(n);
    server.rows.set(n.id, row(n));
    server.refuse.add(n.id);
    server.byIdFails = true;

    await deleteNotes([n.id]);
    await syncOnce([]);

    // The note is still missing — but the id survives, so the next turn asks.
    expect(await allNotes()).toHaveLength(0);
    expect(await getMeta<string[]>("deferredPullIds")).toEqual(["n1"]);

    server.byIdFails = false;
    await syncOnce([]);
    expect((await allNotes()).map((x) => x.id)).toEqual(["n1"]);
  });
});

describe("a delete the server cannot be asked about", () => {
  it("stays queued, keeps its bytes, and reports the failure", async () => {
    const n = note({ attachments: [attachment()] });
    await putNote(n);
    await putFile("a1", new Blob(["abc"]));
    server.rows.set(n.id, row(n));
    server.rpcFails.add(n.id);

    await deleteNotes([n.id]);
    const outcome = await syncOnce([]);

    expect(outcome.refused?.message).toContain("delete n1");
    expect((await dirtyTombstoneEntries()).map((e) => e.id)).toEqual(["n1"]);
    expect(await getFile("a1")).toBeDefined();
    // A dropped connection is not a verdict, so nothing is fetched back either.
    expect(await getMeta<string[]>("deferredPullIds")).toEqual([]);
  });
});

describe("a delete made on the other device", () => {
  it("takes the note and its bytes here, without queueing a delete of its own", async () => {
    const n = note({ status: "active", attachments: [attachment()] });
    await putNote(n);
    await putFile("a1", new Blob(["abc"]));
    server.tombstones = [{ note_id: "n1", deleted_at: "2026-08-20T12:00:00.000Z" }];

    const outcome = await syncOnce([n]);

    expect(await allNotes()).toHaveLength(0);
    expect(await getFile("a1")).toBeUndefined();
    expect((await allTombstones()).map((t) => t.id)).toEqual(["n1"]);
    // Nothing to tell the server: it is the one that said so.
    expect(await dirtyTombstoneEntries()).toHaveLength(0);
    expect(server.rpcCalls).toEqual([]);
    expect(outcome.pulled.some((x) => (x as { __deleted?: true }).__deleted)).toBe(true);
  });

  it("keeps the server's own instant on the marker, so it is pruned on time", async () => {
    const n = note({ status: "active" });
    await putNote(n);
    server.tombstones = [{ note_id: "n1", deleted_at: "2026-08-20T12:00:00.000Z" }];

    await syncOnce([n]);

    // Stamped "now" instead, a fresh device pulling a year of old deletes
    // would have kept every one of them for a further year.
    expect((await allTombstones())[0].deleted_at).toBe("2026-08-20T12:00:00.000Z");
  });

  it("keeps what this device already held about the same delete", async () => {
    // Both devices emptied the trash; this one's marker still lists the
    // files it has to purge from storage once the server agrees.
    const n = note({ status: "trashed", attachments: [attachment()] });
    await putNote(n);
    await deleteNotes([n.id]);
    const mine = (await allTombstones())[0];
    expect(mine.attachments).toHaveLength(1);
    server.tombstones = [{ note_id: "n1", deleted_at: "2026-08-20T12:00:00.000Z" }];

    await syncOnce([]);

    const after = (await allTombstones())[0];
    expect(after.attachments).toEqual(mine.attachments);
    expect(after.deleted_at).toBe("2026-08-20T12:00:00.000Z");
  });

  it("takes the bytes that marker was still holding, since nothing is coming back for them", async () => {
    const n = note({ status: "trashed", attachments: [attachment()] });
    await putNote(n);
    await putFile("a1", new Blob(["abc"]));
    await deleteNotes([n.id]);
    // Held back by this device's own delete, which the server has not taken.
    expect(await getFile("a1")).toBeDefined();
    server.tombstones = [{ note_id: "n1", deleted_at: "2026-08-20T12:00:00.000Z" }];

    await syncOnce([]);

    expect(await getFile("a1")).toBeUndefined();
  });

  it("is never undone by a pull that still carries the note", async () => {
    const n = note({ status: "active" });
    await putNote(n);
    server.tombstones = [{ note_id: "n1", deleted_at: "2026-08-20T12:00:00.000Z" }];
    // The other device destroyed it; this page was read a moment before that.
    server.page = [row({ ...n, updated_at: "2026-08-21T12:00:00.000Z" })];

    await syncOnce([n]);

    expect(await allNotes()).toHaveLength(0);
  });

  it("is refused by the store directly, whatever route the row arrives by", async () => {
    const n = note({ status: "active" });
    await putNote(n);
    await deleteNotes([n.id]);

    const { accepted } = await putNotesFromServer([
      { ...n, updated_at: "2026-09-01T00:00:00.000Z" },
    ]);

    expect(accepted).toEqual([]);
    expect(await allNotes()).toHaveLength(0);
  });
});

describe("a note the other device destroyed while this one was editing it", () => {
  /**
   * Migration 0011's anti-resurrection trigger, seen from the client's side.
   * The upsert is one statement, so the refused row takes every note batched
   * with it down; `send` bisects to find it, and `syncOnce` then asks for the
   * deletes it has not heard about yet and offers the rest again.
   */
  it("is dropped from the batch, and everything beside it still goes up", async () => {
    const doomed = note({ id: "n1", status: "active" });
    const other = note({ id: "n2", status: "active" });
    await putNote(doomed);
    await putNote(other);
    server.poisoned = "n1";
    // Refusing the row is the server saying "that note is gone for good" — so
    // that is the moment its tombstone becomes visible to a pull.
    server.onPoisoned = () => {
      server.tombstones = [{ note_id: "n1", deleted_at: "2026-08-20T12:00:00.000Z" }];
    };

    const outcome = await syncOnce([doomed, other]);

    expect(server.upserted.map((r) => r.id)).toEqual(["n2"]);
    expect(outcome.refused).toBeNull();
    expect((await allNotes()).map((x) => x.id)).toEqual(["n2"]);
  });
});

describe("the month-old sweep, from open to server", () => {
  it("destroys what is out of time and queues the delete", async () => {
    await markSeeded();
    const old = new Date(Date.now() - (TRASH_DAYS + 1) * DAY).toISOString();
    await putNote(note({ id: "n1", status: "trashed", updated_at: old }));
    await putNote(note({ id: "n2", status: "trashed", updated_at: new Date().toISOString() }));
    await putNote(note({ id: "n3", status: "active" }));

    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await waitFor(async () => expect(await dirtyTombstoneEntries()).toHaveLength(1));

    expect((await allTombstones()).map((t) => t.id)).toEqual(["n1"]);
    expect((await allNotes()).map((x) => x.id).sort()).toEqual(["n2", "n3"]);
    expect(hook.result.current.notes.map((x) => x.id).sort()).toEqual(["n2", "n3"]);
  });

  it("agrees with `expiredInTrash` about what is out of time", () => {
    const old = new Date(Date.now() - (TRASH_DAYS + 1) * DAY).toISOString();
    const notes = [
      note({ id: "n1", status: "trashed", updated_at: old }),
      note({ id: "n2", status: "trashed", updated_at: new Date().toISOString() }),
      note({ id: "n3", status: "active", updated_at: old }),
    ];
    expect(expiredInTrash(notes).map((n) => n.id)).toEqual(["n1"]);
  });

  it("refuses to destroy a note that is not in the trash", async () => {
    await markSeeded();
    await putNote(note({ id: "n1", status: "archived" }));

    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await hook.result.current.destroy(["n1"]);
    });

    expect(await allTombstones()).toHaveLength(0);
    expect((await allNotes()).map((x) => x.id)).toEqual(["n1"]);
  });
});

describe("a delete pushed before the trashing that authorises it", () => {
  /**
   * Trash a note offline, then empty the trash offline.
   *
   * `deleteNotes` throws away the note *and* its outbox entry in one
   * transaction, so the write that says "this note is trashed" can never go up;
   * `pushTombstones` runs ahead of the notes push in any case. When the
   * connection comes back the delete is offered to a server that still believes
   * the note is active, and `permanently_delete_note` declines — it will only
   * destroy a note that is trashed there.
   *
   * **This was a known-open bug and is the reason this file carried a
   * failing-by-design test.** The refusal was read as "the other device
   * restored it": the marker was dropped, the note was fetched back by id, and
   * a note the user had deliberately destroyed reappeared on the board as an
   * ordinary **active** note. That is better than the silence it replaced, and
   * it was still wrong.
   *
   * `deliverTrashing` tells the two refusals apart by the one thing only a
   * client ever writes — the per-field clock on `status` — and where the server
   * has never heard of the trashing, it delivers it and asks again.
   */
  it("delivers the trashing the server never saw, and destroys the note in both places", async () => {
    const active = note({ id: "n1", status: "active" });
    // What the server has: the trashing never reached it.
    server.rows.set("n1", row(active));
    // What this device has: trashed locally, the write still in the outbox.
    await putNote({ ...active, status: "trashed", updated_at: "2026-08-11T10:00:00.000Z" });

    await deleteNotes(["n1"]);
    await syncOnce([]);

    expect(await allNotes()).toEqual([]);
    expect(server.rows.has("n1")).toBe(false);
    // One narrow write, not an upsert — a row that is genuinely gone must not
    // be re-created as a stub on its way to being deleted.
    expect(server.updated.map((u) => u.id)).toEqual(["n1"]);
    expect(server.updated[0].patch.status).toBe("trashed");
  });

  /**
   * The other refusal, which must go on behaving exactly as it did: the note
   * really was restored on the other device, and it is entitled to come back.
   * What distinguishes it is that a restore is a *client* write, so it carries
   * a `status` clock, and that clock is newer than the one this device held
   * when it destroyed the note.
   */
  it("still hands back a note the other device really did restore", async () => {
    const mine = note({ id: "n1", status: "trashed", updated_at: "2026-08-11T10:00:00.000Z" });
    await putNote({ ...mine, field_updated_at: { status: "2026-08-11T10:00:00.000Z" } });
    server.rows.set(
      "n1",
      row({
        ...mine,
        status: "active",
        updated_at: "2026-08-12T10:00:00.000Z",
        field_updated_at: { status: "2026-08-12T10:00:00.000Z" },
      }),
    );

    await deleteNotes(["n1"]);
    await syncOnce([]);

    // Nothing was written over their restore, and the note is back here.
    expect(server.updated).toEqual([]);
    expect((await allNotes()).map((x) => x.id)).toEqual(["n1"]);
    expect((await allNotes())[0].status).toBe("active");
  });

  /**
   * The repair needs the server again — a read, a write, the delete a second
   * time — and any of those can fail. That used to be answered as "restored",
   * so a dropped connection halfway through fetched the destroyed note back
   * onto the board as active. Not knowing is not a verdict.
   */
  it.each([
    ["the read", "readByIdFails"],
    ["the write", "updateFails"],
  ] as const)("keeps the delete queued when %s fails, and finishes it next time", async (_what, flag) => {
    const active = note({ id: "n1", status: "active" });
    server.rows.set("n1", row(active));
    await putNote({ ...active, status: "trashed", updated_at: "2026-08-11T10:00:00.000Z" });
    server[flag] = true;

    await deleteNotes(["n1"]);
    const outcome = await syncOnce([]);

    expect(outcome.refused?.message).toContain("delete n1");
    expect(await allNotes()).toEqual([]);
    expect((await dirtyTombstoneEntries()).map((e) => e.id)).toEqual(["n1"]);
    expect((await allTombstones()).map((t) => t.id)).toEqual(["n1"]);
    expect(await getMeta<string[]>("deferredPullIds")).toEqual([]);

    server[flag] = false;
    await syncOnce([]);

    expect(server.rows.has("n1")).toBe(false);
    expect(await dirtyTombstoneEntries()).toHaveLength(0);
    expect(await allNotes()).toEqual([]);
  });
});
