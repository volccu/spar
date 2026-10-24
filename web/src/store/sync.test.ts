import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Note } from "../types";
import { note as base } from "../test/fixtures";

const note = (over: Partial<Note> = {}): Note =>
  base({
    raw_content: "shot.png",
    body: "shot.png",
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    attachments: [file],
    ...over,
  });

/**
 * The window where the client knows about files and the server does not.
 *
 * The two are deployed from different places, so for some stretch of time they
 * disagree, and the app has to keep working throughout — including not
 * destroying anything on the way. That is the whole subject of this file.
 */

/** What the fake server will do when asked for the attachments column. */
let columnExists = true;
/** Rows the fake server hands back from a pull. */
let remoteRows: Record<string, unknown>[] = [];
let tombstoneRows: Record<string, unknown>[] = [];
/** Rows the client tried to push, for inspection. */
let pushedRows: Record<string, unknown>[] = [];
/** The outbox: note id -> the `updated_at` of the version waiting to go up. */
let outbox = new Map<string, string>();
/** Something that happens while an upload is on the wire. Usually nothing. */
let duringUpload: (() => void) | null = null;
let pulledToStore: Note[] = [];
let cursorFilters: { table: string; expression: string }[] = [];
/** A note this fake server refuses, and what it says about it. */
let poisoned: string | null = null;
/** A failure of the request itself: no code, because no row was ever read. */
let transportError: string | null = null;
/** How many upsert requests were made, so bisecting can be counted. */
let upserts = 0;
/** The most rows one upsert may carry before the server answers 413, or null for no limit. */
let maxRequestRows: number | null = null;
/** A failure the capability probe hits that is *not* a missing column. */
let probeError: { code?: string; message: string } | null = null;
/** Columns this fake server has genuinely not been migrated to yet. */
let missing = new Set<string>();
/** How many pulls named the whole column list, i.e. read the notes table. */
let pullSelects = 0;
/** The tombstone rows the client applied, in order. */
let tombstonesApplied: string[] = [];
/** A failure of the tombstone table read, the one a refused upload asks. */
let tombstoneReadError: string | null = null;

vi.mock("./supabase", () => {
  const builder = (table: string) => ({
    select(cols: string) {
      // The one-row probe that asks whether a column is there at all. A probe
      // names exactly one column; a pull names the whole list.
      if (!cols.includes(",")) {
        const absent = missing.has(cols) || (cols === "attachments" && !columnExists);
        return {
          limit: async () => {
            if (probeError) return { data: null, error: probeError };
            return absent
              ? {
                  data: null,
                  error: { code: "42703", message: `column notes.${cols} does not exist` },
                }
              : { data: [], error: null };
          },
        };
      }
      if (!columnExists && cols.includes("attachments")) {
        throw new Error("asked for a column the server has not got");
      }
      pullSelects += 1;
      const chain = {
        or: (expression: string) => {
          cursorFilters.push({ table, expression });
          return chain;
        },
        gt: () => chain,
        order: () => chain,
        limit: async () =>
          table === "note_tombstones" && tombstoneReadError
            ? { data: null, error: { message: tombstoneReadError } }
            : { data: table === "note_tombstones" ? tombstoneRows : remoteRows, error: null },
      };
      return chain;
    },
    async upsert(rows: Record<string, unknown>[]) {
      upserts += 1;
      if (!columnExists && rows.some((r) => "attachments" in r)) {
        return { error: { code: "42703", message: "column does not exist" } };
      }
      // Whatever is wrong with the connection today, said the way supabase-js
      // says it: resolved, not thrown, and with no `code` at all, because
      // nothing server-side ever read the rows. `send` must not blame them.
      if (transportError) {
        return { error: { message: transportError } };
      }
      // Too large for the server (or a proxy): said only in the status.
      if (maxRequestRows !== null && rows.length > maxRequestRows) {
        return { error: { message: "Payload Too Large", code: "" }, status: 413 };
      }
      // One statement, one verdict: a row the server will not take fails every
      // row sent with it. That is the whole reason `send` bisects.
      //
      // `P0001` is a `raise` in a trigger, which is how both of the refusals
      // this models actually arrive — the anti-resurrection check from 0011
      // and the `raw_content` immutability trigger from 0001. The code is not
      // decoration: it is the whole of how `send` tells a row it must stop
      // sending from a request it should simply try again.
      if (poisoned && rows.some((r) => r.id === poisoned)) {
        return {
          error: { code: "P0001", message: "note has been permanently deleted" },
        };
      }
      pushedRows.push(...rows);
      // An upload takes long enough to type into, so the test is allowed to.
      duringUpload?.();
      return { error: null };
    },
    table,
  });

  return {
    getSupabase: async () => ({ from: (t: string) => builder(t) }),
    syncConfigured: true,
  };
});

/**
 * The refusal book, kept faithful to `held.ts` (which is tested on its own)
 * so this file can say what `push` and `send` *do* with it.
 */
const HOLD_AFTER = 5;
let book = new Map<string, { stamp: string; message: string; count: number }>();
/** Ids whose refusals were forgotten, in order. */
let forgotten: string[] = [];

vi.mock("./held", () => ({
  HOLD_AFTER,
  recordRefusal: async (id: string, stamp: string, message: string) => {
    const seen = book.get(id);
    const count = seen && seen.stamp === stamp ? seen.count + 1 : 1;
    book.set(id, { stamp, message, count });
    return count >= HOLD_AFTER;
  },
  clearRefusals: async (ids: string[]) => {
    for (const id of ids) if (book.delete(id)) forgotten.push(id);
  },
  heldNotes: async () =>
    [...book].filter(([, s]) => s.count >= HOLD_AFTER).map(([id, s]) => ({ id, ...s })),
  isHeld: (held: { id: string; stamp: string }[], id: string, stamp: string) =>
    held.some((n) => n.id === id && n.stamp === stamp),
}));

vi.mock("./db", () => ({
  dirtyEntries: async () =>
    [...outbox].map(([id, stamp]) => ({ id, stamp })),
    clearDirtySent: async (sent: { id: string; stamp: string }[]) => {
    for (const { id, stamp } of sent) {
      if (outbox.get(id) === stamp) outbox.delete(id);
    }
    },
  allTombstones: async () => [],
  applyRemoteTombstones: async (rows: { id: string }[]) => {
    tombstonesApplied.push(...rows.map((row) => row.id));
    return [];
  },
  clearTombstoneDirtySent: async () => {},
  dirtyTombstoneEntries: async () => [],
  getMeta: async () => undefined,
  putNotesFromServer: async (notes: Note[]) => {
    pulledToStore.push(...notes);
    return { accepted: notes, deferred: [] };
  },
  setMeta: async () => {},
}));

const STAMP = "2026-08-10T10:00:00.000Z";

const file: Attachment = {
  id: "a1",
  name: "shot.png",
  mime: "image/png",
  size: 100,
  width: 10,
  height: 10,
  thumb: "data:image/jpeg;base64,xx",
  path: null,
  added_at: "2026-08-10T00:00:00.000Z",
};


/** The row the server would return: same note, one minute newer, no column. */
const newerRowWithoutColumn = {
  id: "n1",
  raw_content: "shot.png",
  body: "shot.png",
  source: "web",
  created_at: "2026-08-10T10:00:00.000Z",
  updated_at: "2026-08-10T10:01:00.000Z",
  tags: [],
  status: "active",
  priority: 0,
};

describe("syncing against a server that has not been migrated", () => {
  beforeEach(() => {
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    outbox = new Map([["n1", STAMP]]);
    duringUpload = null;
    pulledToStore = [];
    cursorFilters = [];
    poisoned = null;
    transportError = null;
    upserts = 0;
    probeError = null;
    missing = new Set<string>();
    vi.resetModules();
  });

  it("does not send an empty UUID as the first cursor tie-breaker", async () => {
    columnExists = true;
    const { syncOnce } = await import("./sync");
    await syncOnce([]);

    // No id at all — and the start is the epoch stepped back over the repair
    // window, as every pull now reads from (`repairStart`).
    expect(cursorFilters.find((filter) => filter.table === "note_tombstones")?.expression)
      .toBe("deleted_at.gt.1969-12-31T23:58:00.000Z");
  });

  it("still pushes the note, without the column it hasn't got", async () => {
    columnExists = false;
    const { syncOnce } = await import("./sync");
    const pushed = await syncOnce([note()]);
    expect(pushed.pushed).toBe(1);
    expect(pushedRows).toHaveLength(1);
    expect("attachments" in pushedRows[0]).toBe(false);
  });

  /**
   * The bug this exists to prevent. Attach a file, and the note is pushed up
   * without it, comes back a minute newer with no attachments in the row, and
   * — read literally — replaces the local note with one carrying nothing. The
   * file is destroyed by an ordinary sync, on the machine that made it.
   */
  it("never lets an empty row take a file off a note", async () => {
    columnExists = false;
    remoteRows = [newerRowWithoutColumn];
    const { syncOnce } = await import("./sync");
    const { pulled } = await syncOnce([note()]);

    expect(pulled).toHaveLength(1);
    expect(pulled[0].attachments).toHaveLength(1);
    expect(pulled[0].attachments[0].id).toBe("a1");
    // …and it is genuinely the newer row otherwise, not the local one kept whole.
    expect(pulled[0].updated_at).toBe("2026-08-10T10:01:00.000Z");
  });

  it("hands the column back once the server has it", async () => {
    columnExists = true;
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);
    expect(pushedRows).toHaveLength(1);
    expect(pushedRows[0].attachments).toEqual([file]);
  });
});

/**
 * The outbox is a list of notes waiting to go up, and sync crosses one off
 * after the server has taken it. An upload is a few hundred milliseconds long
 * and the app is entirely usable throughout, so the interesting question is
 * what happens to an edit made in the middle of one.
 */
describe("crossing a note off the outbox", () => {
  beforeEach(() => {
    columnExists = true;
    pushedRows = [];
    remoteRows = [];
    outbox = new Map([["n1", STAMP]]);
    duringUpload = null;
    poisoned = null;
    transportError = null;
    upserts = 0;
    probeError = null;
    missing = new Set<string>();
    vi.resetModules();
  });

  it("crosses off the version that went up", async () => {
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);
    expect(outbox.size).toBe(0);
  });

  /**
   * The bug this exists to prevent. Typing during a sync re-queued the note,
   * and the sync then crossed off the entry it had never sent — so the edit sat
   * on that device with nothing left to say it needed uploading. It would go up
   * only if the note happened to be touched again. Worse, editing the same note
   * on the other device would then pull a newer copy down over the top of it,
   * and the edit was gone for good.
   */
  it("leaves an edit made while the upload was in flight", async () => {
    duringUpload = () => outbox.set("n1", "2026-08-10T10:00:05.000Z");
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);

    expect(outbox.get("n1")).toBe("2026-08-10T10:00:05.000Z");
  });

  /** …and the next run sends it, which is the whole point of leaving it. */
  it("sends that edit on the next run", async () => {
    duringUpload = () => outbox.set("n1", "2026-08-10T10:00:05.000Z");
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);

    duringUpload = null;
    const edited = note({ body: "typed mid-sync", updated_at: "2026-08-10T10:00:05.000Z" });
    await syncOnce([edited]);

    expect(pushedRows).toHaveLength(2);
    expect(pushedRows[1].body).toBe("typed mid-sync");
    expect(outbox.size).toBe(0);
  });

  it("persists a remote note before acknowledging the pull", async () => {
    columnExists = true;
    outbox = new Map();
    remoteRows = [
      {
        id: "new-note",
        raw_content: "recovery",
        body: "recovery",
        source: "web",
        created_at: "2026-08-13T08:00:00.000Z",
        updated_at: "2026-08-13T08:00:00.000Z",
        tags: [],
        status: "active",
        priority: 0,
      },
    ];
    const { syncOnce } = await import("./sync");

    const result = await syncOnce([]);

    expect(result.pulled.map((n) => n.id)).toEqual(["new-note"]);
    expect(pulledToStore.map((n) => n.id)).toEqual(["new-note"]);
  });
});

describe("field-level conflict merging", () => {
  it("keeps an offline body edit while accepting an unrelated remote field", async () => {
    const { mergeNoteFields } = await import("./sync");
    const local = note({
      body: "local body",
      updated_at: "2026-08-10T10:02:00.000Z",
      field_updated_at: {
        body: "2026-08-10T10:02:00.000Z",
        tags: "2026-08-10T10:00:00.000Z",
      },
    } as Partial<Note> & { field_updated_at: Record<string, string> });
    const remote = note({
      tags: ["remote-tag"],
      updated_at: "2026-08-10T10:03:00.000Z",
      field_updated_at: {
        body: "2026-08-10T10:00:00.000Z",
        tags: "2026-08-10T10:03:00.000Z",
      },
    } as Partial<Note> & { field_updated_at: Record<string, string> });

    const merged = mergeNoteFields(local, remote);
    expect(merged.body).toBe("local body");
    expect(merged.tags).toEqual(["remote-tag"]);
  });
});

/**
 * What happens when the server will not take one particular note.
 *
 * It is not a rare shape: the anti-resurrection trigger from migration 0011
 * refuses a note the other device permanently deleted, and the immutability
 * trigger from 0001 refuses one whose `raw_content` ever drifted. An upsert is
 * a single statement, so that one row used to fail all five hundred sent with
 * it — and because the outbox is only crossed off on success, every note behind
 * it stopped syncing for good, with "sync failed" as the entire explanation.
 */
describe("a note the server refuses", () => {
  beforeEach(() => {
    columnExists = true;
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    pulledToStore = [];
    cursorFilters = [];
    duringUpload = null;
    poisoned = null;
    transportError = null;
    upserts = 0;
    probeError = null;
    missing = new Set<string>();
    vi.resetModules();
  });

  it("does not take the other notes down with it", async () => {
    poisoned = "bad";
    outbox = new Map([
      ["bad", STAMP],
      ["good-1", STAMP],
      ["good-2", STAMP],
      ["good-3", STAMP],
    ]);
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([
      note({ id: "bad" }),
      note({ id: "good-1" }),
      note({ id: "good-2" }),
      note({ id: "good-3" }),
    ]);

    expect(pushedRows.map((r) => r.id).sort()).toEqual(["good-1", "good-2", "good-3"]);
    expect(result.pushed).toBe(3);
    // Found by halving, so it took more than the one request a clean page does.
    expect(upserts).toBeGreaterThan(1);
  });

  /**
   * The other half of "refused", and the one that was doing real harm.
   *
   * A failure of the *request* — a dead wifi, a captive portal, an expired
   * token — used to be read as every note in the batch being individually
   * unacceptable. The batch was then bisected, which asks the same broken
   * question up to 2N−1 times, and each note was charged a refusal; five
   * ticks of that (which a phone can produce in seconds, since focus, coming
   * back online and any local edit each run one immediately) held the entire
   * outbox and turned the sync mark calm over an archive that had stopped
   * syncing. Nothing here may be blamed on a row.
   */
  it("blames no note when the request itself fails, and asks only once", async () => {
    transportError = "TypeError: Failed to fetch";
    outbox = new Map([
      ["a", STAMP],
      ["b", STAMP],
      ["c", STAMP],
      ["d", STAMP],
    ]);
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([
      note({ id: "a" }),
      note({ id: "b" }),
      note({ id: "c" }),
      note({ id: "d" }),
    ]);

    // One request for the batch. No bisection: halving a broken connection
    // only breaks it in smaller pieces.
    expect(upserts).toBe(1);
    expect(result.pushed).toBe(0);
    // Still reported, so the mark stays honest and the backoff climbs.
    expect(result.refused?.message).toContain("Failed to fetch");
    // And every note is still queued, unblamed, ready for the next tick.
    expect([...outbox.keys()].sort()).toEqual(["a", "b", "c", "d"]);
  });

  /** Audit DATA-10 (2026-10-10): a 413 was retried as it was, on every tick, for ever. */
  it("splits a batch the server says is too large, and blames no note for it", async () => {
    maxRequestRows = 1;
    outbox = new Map([
      ["a", STAMP],
      ["b", STAMP],
      ["c", STAMP],
    ]);
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([note({ id: "a" }), note({ id: "b" }), note({ id: "c" })]);
    expect(result.refused).toBeNull();
    expect(result.pushed).toBe(3);
    expect(pushedRows.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
    expect(outbox.size).toBe(0);
    maxRequestRows = null;
  });

  it("finds a refused note in the second half, reports it, and sends the rest", async () => {
    poisoned = "bad-late";
    outbox = new Map([
      ["a", STAMP],
      ["b", STAMP],
      ["c", STAMP],
      ["bad-late", STAMP],
    ]);
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([note({ id: "a" }), note({ id: "b" }), note({ id: "c" }), note({ id: "bad-late" })]);
    expect(result.pushed).toBe(3);
    expect(result.refused?.message).toContain("bad-late");
    expect([...outbox.keys()]).toEqual(["bad-late"]);
    // All four, then [a, b] and [c, bad-late], then [c] and [bad-late] on their own.
    expect(upserts).toBe(5);
  });

  it("splits a batch too large to take, then finds the refused note inside a half", async () => {
    maxRequestRows = 2;
    poisoned = "bad-half";
    outbox = new Map([
      ["a", STAMP],
      ["b", STAMP],
      ["bad-half", STAMP],
    ]);
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([note({ id: "a" }), note({ id: "b" }), note({ id: "bad-half" })]);
    expect(result.pushed).toBe(2);
    expect(pushedRows.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(result.refused?.message).toContain("note bad-half");
    expect([...outbox.keys()]).toEqual(["bad-half"]);
    // All three (413), then [a, b], then [bad-half] alone.
    expect(upserts).toBe(3);
    maxRequestRows = null;
  });

  it("cuts the outbox by size as well as by count", async () => {
    const { rowBytes, uploadBatches } = await import("./sync");
    const caps = { attachments: true, linkPreviews: true, mergedInto: true, fieldVersions: true, boardId: true, reminderRepeat: true };
    const big = "x".repeat(1000);
    const pending = ["a", "b", "c", "d", "e"].map((id) => ({ note: note({ id, body: big }) }));
    // Room for two such rows a request, not three.
    const one = rowBytes(pending[0].note, caps as never);
    const batches = uploadBatches(pending, caps as never, Math.floor(one * 2.5));
    expect(batches.map((b) => b.map((p) => p.note.id))).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    // A row larger than the cap goes alone rather than not at all.
    expect(uploadBatches(pending.slice(0, 2), caps as never, 10).map((b) => b.length)).toEqual([1, 1]);
  });

  it("blames no note when the token has expired either", async () => {
    transportError = "JWT expired";
    outbox = new Map([["a", STAMP], ["b", STAMP]]);
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([note({ id: "a" }), note({ id: "b" })]);
    expect(upserts).toBe(1);
    expect(result.refused).not.toBeNull();
    expect([...outbox.keys()].sort()).toEqual(["a", "b"]);
  });

  it("leaves only the refused note in the outbox", async () => {
    poisoned = "bad";
    outbox = new Map([["bad", STAMP], ["good-1", STAMP]]);
    const { syncOnce } = await import("./sync");
    await syncOnce([note({ id: "bad" }), note({ id: "good-1" })]);
    expect([...outbox.keys()]).toEqual(["bad"]);
  });

  it("names the note in the failure, rather than only that something failed", async () => {
    poisoned = "bad";
    outbox = new Map([["bad", STAMP]]);
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([note({ id: "bad" })]);
    expect(result.refused?.message).toContain("bad");
    expect(result.refused?.message).toContain("permanently deleted");
  });

  /**
   * The half of this that matters most. The other device's notes are already on
   * the server and this one is entitled to them whatever went wrong on the way
   * up — the old code threw before the pull, so one stuck note meant the device
   * stopped *receiving* as well, silently, for as long as it stayed stuck.
   */
  it("still receives what the other device sent", async () => {
    poisoned = "bad";
    outbox = new Map([["bad", STAMP]]);
    remoteRows = [
      {
        id: "from-the-phone",
        raw_content: "hello",
        body: "hello",
        source: "web",
        created_at: "2026-08-13T08:00:00.000Z",
        updated_at: "2026-08-13T08:00:00.000Z",
        tags: [],
        status: "active",
        priority: 0,
      },
    ];
    const { syncOnce } = await import("./sync");
    const result = await syncOnce([note({ id: "bad" })]);

    expect(result.refused).not.toBeNull();
    expect(result.pulled.map((n) => n.id)).toContain("from-the-phone");
    expect(pulledToStore.map((n) => n.id)).toContain("from-the-phone");
  });
});

/**
 * The capability probes ask the server once whether it has a column and
 * remember the answer for the session. Remembering a "no" that was really a
 * dropped connection downgraded the whole protocol until the tab was reloaded:
 * files stopped uploading, deletes stopped propagating, and per-field merging
 * quietly fell back to whole-row last-write-wins.
 */
describe("asking the server what it supports", () => {
  beforeEach(() => {
    columnExists = true;
    remoteRows = [];
    tombstoneRows = [];
    probeError = null;
    missing = new Set<string>();
    vi.resetModules();
  });

  it("remembers a column that genuinely is not there", async () => {
    const { serverKnowsAttachments, resetServerCapabilities } = await import("./sync");
    resetServerCapabilities();
    columnExists = false;
    expect(await serverKnowsAttachments()).toBe(false);
    // Now the migration lands. The answer stays cached, because it was real.
    columnExists = true;
    expect(await serverKnowsAttachments()).toBe(false);
  });

  /**
   * The one that used to cost a whole session. A phone waking up makes its
   * first request before the token has refreshed; the probe came back 401, was
   * read as "this server has no attachments column", and files stopped
   * uploading until the tab was reloaded — which nobody knew to do, because
   * nothing said so.
   */
  it("asks again after a request that merely failed", async () => {
    const { serverKnowsAttachments, resetServerCapabilities } = await import("./sync");
    resetServerCapabilities();
    probeError = { code: "PGRST301", message: "JWT expired" };
    expect(await serverKnowsAttachments()).toBe(false);
    probeError = null;
    expect(await serverKnowsAttachments()).toBe(true);
  });

  it("asks again after a network failure with no code at all", async () => {
    const { serverKnowsAttachments, resetServerCapabilities } = await import("./sync");
    resetServerCapabilities();
    probeError = { message: "Failed to fetch" };
    expect(await serverKnowsAttachments()).toBe(false);
    probeError = null;
    expect(await serverKnowsAttachments()).toBe(true);
  });
});

/**
 * The failure that was actually happening, in the shape it happened in.
 *
 * Migration 0009 adds `notes.merged_into`; it was written and never applied to
 * the live project. Migration 0011 then shipped a merge trigger that names that
 * column. The client sent a clock for every mergeable field regardless, so an
 * ordinary second edit — one clock moves, the other thirteen stay where they
 * are — sent the trigger into `new.merged_into = old.merged_into`, and Postgres
 * answered `42703: record "new" has no field "merged_into"`. One statement, so
 * every note in the batch failed with it; the outbox is only crossed off on
 * success, so they were still queued next tick, and the next, for ever.
 */
describe("a clock for a column the server has not got", () => {
  beforeEach(() => {
    columnExists = true;
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    pulledToStore = [];
    cursorFilters = [];
    duringUpload = null;
    poisoned = null;
    transportError = null;
    upserts = 0;
    probeError = null;
    missing = new Set<string>();
    outbox = new Map([["n1", STAMP]]);
    vi.resetModules();
  });

  it("is not sent at all", async () => {
    missing = new Set(["merged_into"]);
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);

    const clocks = pushedRows[0].field_updated_at as Record<string, string>;
    expect("merged_into" in clocks).toBe(false);
    // The row omits the column, so the clocks have to agree with the row.
    expect("merged_into" in pushedRows[0]).toBe(false);
    expect(clocks.body).toBeDefined();
  });

  it("is sent once the migration has landed", async () => {
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);
    const clocks = pushedRows[0].field_updated_at as Record<string, string>;
    expect(clocks.merged_into).toBeDefined();
  });

  /*
   * A note made in the app carries a clock for what it touched and nothing
   * else ({ body } for a capture). The server writes a field sent without a
   * clock outright and drops its own clock for it, so an edit to the words
   * from a device that had not yet heard of an archive elsewhere undid the
   * archive (bughunt 2026-10-15). Every field goes up with a clock; one this
   * device never touched carries the note's birth, which loses to any other.
   */
  it("carries a clock for every field, the untouched ones at the note's birth", async () => {
    const { syncOnce } = await import("./sync");
    const { CONFLICT_FIELDS } = await import("../lib/versions");
    await syncOnce([note({ updated_at: "2026-08-11T09:00:00.000Z", field_updated_at: { body: "2026-08-11T09:00:00.000Z" } })]);
    const clocks = pushedRows[0].field_updated_at as Record<string, string>;
    expect(Object.keys(clocks).sort()).toEqual([...CONFLICT_FIELDS].sort());
    expect(clocks.body).toBe("2026-08-11T09:00:00.000Z");
    expect(clocks.status).toBe("2026-08-10T10:00:00.000Z");
  });

  it("drops the file clocks too when the server predates files", async () => {
    columnExists = false;
    missing = new Set(["attachments", "link_previews"]);
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);
    const clocks = pushedRows[0].field_updated_at as Record<string, string>;
    expect("attachments" in clocks).toBe(false);
    expect("link_previews" in clocks).toBe(false);
  });
});

/**
 * The combined pull (`pullChanges.ts`) brings the tick's tombstones and notes
 * down before `syncOnce` runs. Given them, the turn must apply them exactly
 * as it would its own reads, and read the tables only for what a full page
 * may have left behind.
 */
describe("a turn given the combined pull's answer", () => {
  beforeEach(() => {
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    outbox = new Map();
    pulledToStore = [];
    cursorFilters = [];
    pullSelects = 0;
    tombstonesApplied = [];
  });

  it("applies the deletes and the notes it was handed, and asks the tables for nothing", async () => {
    const { syncOnce } = await import("./sync");
    const theirs = note({ id: "n2", body: "from the phone", updated_at: "2026-08-11T00:00:00.000Z" });
    const { pulled } = await syncOnce([note()], {
      notes: { rows: [theirs], cursor: { at: theirs.updated_at, id: "n2" }, complete: true },
      tombstones: { rows: [{ id: "gone", deleted_at: STAMP }], cursor: { at: STAMP, id: "gone" }, complete: true },
      folders: { rows: [], cursor: null, complete: true },
      prefs: null,
    });

    expect(tombstonesApplied).toEqual(["gone"]);
    expect(pulledToStore.map((n) => n.id)).toEqual(["n2"]);
    expect(pulled.map((n) => n.id)).toEqual(["n2", "gone"]);
    expect(pullSelects).toBe(0);
  });

  it("reads the notes table only for what lies behind a full page, from where it ended", async () => {
    const { syncOnce } = await import("./sync");
    const theirs = note({ id: "n2", updated_at: "2026-08-11T00:00:00.000Z" });
    remoteRows = [];
    await syncOnce([], {
      notes: { rows: [theirs], cursor: { at: theirs.updated_at, id: "n2" }, complete: false },
      tombstones: { rows: [], cursor: null, complete: true },
      folders: { rows: [], cursor: null, complete: true },
      prefs: null,
    });

    expect(pullSelects).toBe(1);
    expect(cursorFilters[0].expression).toContain("id.gt.n2");
    expect(pulledToStore.map((n) => n.id)).toEqual(["n2"]);
  });
});

/**
 * A note the server refuses for a reason that is still true tomorrow used to
 * be re-sent on every tick forever: bisected out of the batch each time, the
 * sync mark red over an archive that was otherwise fine, and no screen able
 * to name it. After enough refusals it is held instead — see `held.ts`.
 */
describe("a note the server keeps refusing", () => {
  beforeEach(() => {
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    pulledToStore = [];
    outbox = new Map([["n1", STAMP]]);
    poisoned = "n1";
    missing = new Set<string>();
    probeError = null;
    columnExists = true;
    upserts = 0;
    book = new Map();
    forgotten = [];
  });

  it("is offered again, and reported, for the first few refusals", async () => {
    const { syncOnce } = await import("./sync");
    const outcome = await syncOnce([note()]);

    // A refused row never reaches `pushedRows`; the request count is what
    // says whether the note was offered at all.
    expect(upserts).toBeGreaterThan(0);
    expect(outcome.refused?.message).toContain("permanently deleted");
    expect(outcome.held).toEqual([]);
    expect(book.get("n1")?.count).toBe(1);
  });

  it("is held once refused enough times: not sent, and no longer a failed sync", async () => {
    const { syncOnce } = await import("./sync");
    const mine = note();
    for (let i = 0; i < HOLD_AFTER - 1; i++) await syncOnce([mine]);
    upserts = 0;

    const outcome = await syncOnce([mine]);

    // The refusal that reaches the limit is still a real attempt, so the row
    // did go up once more; what changes is what is done with the answer.
    expect(upserts).toBeGreaterThan(0);
    expect(outcome.refused).toBeNull();
    expect(outcome.held).toEqual([
      { id: "n1", stamp: STAMP, message: "note has been permanently deleted", count: HOLD_AFTER },
    ]);

    // And from here on it is not offered at all, while staying in the outbox.
    upserts = 0;
    const after = await syncOnce([mine]);
    expect(upserts).toBe(0);
    expect(after.refused).toBeNull();
    expect(after.held).toHaveLength(1);
  });

  it("is offered again the moment it is edited, because the count is per version", async () => {
    const { syncOnce } = await import("./sync");
    const mine = note();
    for (let i = 0; i < HOLD_AFTER; i++) await syncOnce([mine]);
    upserts = 0;

    const edited = note({ updated_at: "2026-08-10T11:00:00.000Z" });
    outbox = new Map([["n1", edited.updated_at]]);
    await syncOnce([edited]);

    expect(upserts).toBeGreaterThan(0);
    expect(book.get("n1")?.count).toBe(1);
  });

  it("is forgotten as soon as one finally goes up", async () => {
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);
    expect(book.has("n1")).toBe(true);

    poisoned = null;
    transportError = null;
    await syncOnce([note()]);

    expect(forgotten).toContain("n1");
    expect(book.has("n1")).toBe(false);
  });
});

/**
 * The pull is a keyset over `updated_at`, and the server keeps whatever stamp a
 * client sends. A note written offline and uploaded hours later went up with
 * its hours-old stamp, behind a cursor the other device had already passed,
 * and never reached it. It now goes up no earlier than the server's clock —
 * the row only; the note and its outbox entry keep their own stamp.
 */
describe("the stamp a note goes up with", () => {
  const SERVER_SAYS = "Sat, 12 Sep 2026 12:00:00 GMT";

  beforeEach(() => {
    columnExists = true;
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    pulledToStore = [];
    outbox = new Map([["n1", STAMP]]);
    duringUpload = null;
    poisoned = null;
    transportError = null;
    tombstoneReadError = null;
    upserts = 0;
    probeError = null;
    missing = new Set<string>();
    book = new Map();
    vi.resetModules();
  });

  it("is the server's clock when the note was written before it, and is crossed off by its own", async () => {
    const { syncOnce } = await import("./sync");
    const { noteServerDate } = await import("./serverClock");
    const { forgetSent, isOwnEcho } = await import("./echo");
    forgetSent();
    noteServerDate(SERVER_SAYS);

    const mine = note();
    await syncOnce([mine]);

    const sent = String(pushedRows[0].updated_at);
    expect(Date.parse(sent)).toBeGreaterThanOrEqual(Date.parse("2026-09-12T12:00:00Z"));
    // The note itself is not restamped, and its outbox entry named its own.
    expect(mine.updated_at).toBe(STAMP);
    expect(outbox.size).toBe(0);
    // The realtime echo carries the sent stamp, in the server's spelling.
    expect(isOwnEcho("notes", { id: "n1", updated_at: sent.replace("Z", "+00:00") })).toBe(true);
  });

  it("is the note's own when that is the later of the two", async () => {
    const { syncOnce } = await import("./sync");
    const { noteServerDate } = await import("./serverClock");
    noteServerDate("Mon, 10 Aug 2026 09:00:00 GMT");

    await syncOnce([note()]);

    expect(pushedRows[0].updated_at).toBe(STAMP);
  });

  it("goes as it is before the server has said what time it is", async () => {
    const { syncOnce } = await import("./sync");
    await syncOnce([note()]);
    expect(pushedRows[0].updated_at).toBe(STAMP);
  });

  it("counts a refusal against the note's own stamp, not the one it was sent with", async () => {
    poisoned = "n1";
    const { syncOnce } = await import("./sync");
    const { noteServerDate } = await import("./serverClock");
    noteServerDate(SERVER_SAYS);

    await syncOnce([note()]);

    expect(book.get("n1")?.stamp).toBe(STAMP);
  });
});

/**
 * A refused upload asks the tombstone table whether the note was deleted
 * elsewhere. That read sat outside any `try`, so when it failed the turn threw
 * after the combined pull's deletes were already applied and their cursor
 * stored — and those ids never reached the screen.
 */
describe("a tombstone read that fails after a refused upload", () => {
  beforeEach(() => {
    columnExists = true;
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    pulledToStore = [];
    tombstonesApplied = [];
    outbox = new Map([["bad", STAMP]]);
    duringUpload = null;
    poisoned = "bad";
    transportError = null;
    tombstoneReadError = "connection reset";
    upserts = 0;
    probeError = null;
    missing = new Set<string>();
    book = new Map();
    vi.resetModules();
  });

  it("still finishes the turn, returns the deletes already applied, and reports the refusal", async () => {
    const { syncOnce } = await import("./sync");
    const outcome = await syncOnce([note({ id: "bad" })], {
      notes: { rows: [], cursor: null, complete: true },
      tombstones: {
        rows: [{ id: "gone", deleted_at: STAMP }],
        cursor: { at: STAMP, id: "gone" },
        complete: true,
      },
      folders: { rows: [], cursor: null, complete: true },
      prefs: null,
    });

    expect(tombstonesApplied).toEqual(["gone"]);
    expect(outcome.pulled.map((n) => n.id)).toContain("gone");
    expect(outcome.refused?.message).toContain("permanently deleted");
  });
});

/**
 * A full page of deletes from the combined pull may have more behind it, and
 * the table is asked for the rest. It was asked from the cursor on disk, which
 * the page had not yet been written to, so it started over from before the
 * page instead of from where the page ended.
 */
describe("the deletes behind a full page from the combined pull", () => {
  const fullPage = {
    notes: { rows: [], cursor: null, complete: true },
    tombstones: {
      rows: [{ id: "gone", deleted_at: STAMP }],
      cursor: { at: STAMP, id: "gone" },
      complete: false,
    },
    folders: { rows: [], cursor: null, complete: true },
    prefs: null,
  };

  beforeEach(() => {
    columnExists = true;
    pushedRows = [];
    remoteRows = [];
    tombstoneRows = [];
    pulledToStore = [];
    tombstonesApplied = [];
    cursorFilters = [];
    outbox = new Map();
    duringUpload = null;
    poisoned = null;
    transportError = null;
    tombstoneReadError = null;
    probeError = null;
    missing = new Set<string>();
    vi.resetModules();
  });

  it("are asked for from where that page ended", async () => {
    const { syncOnce } = await import("./sync");
    await syncOnce([], fullPage);

    expect(cursorFilters.find((f) => f.table === "note_tombstones")?.expression).toBe(
      `deleted_at.gt.${STAMP},and(deleted_at.eq.${STAMP},note_id.gt.gone)`,
    );
    expect(tombstonesApplied).toEqual(["gone"]);
  });

  it("leave nothing half-applied when that read fails", async () => {
    tombstoneReadError = "connection reset";
    const { syncOnce } = await import("./sync");

    await expect(syncOnce([], fullPage)).rejects.toThrow("connection reset");
    expect(tombstonesApplied).toEqual([]);
  });
});
