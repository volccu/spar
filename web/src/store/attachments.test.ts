import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, Note } from "../types";

/**
 * Letting go of file bytes without ever letting go of the only copy.
 *
 * Opening a file caches it forever, which is what makes the second look instant
 * and offline-proof. Left unbounded it is also what fills the phone up, and a
 * browser out of room does not tidy: it drops the whole origin, notes included.
 * So there is a ceiling — and exactly one thing it must never touch.
 */

/** The fake local file store: attachment id -> size in bytes. */
let store = new Map<string, number>();
/** What the sweep asked to have deleted. */
let deleted: string[] = [];
/**
 * The delete markers this device is holding, with the attachments they are
 * holding bytes for — the second half of what the sweep must not touch.
 */
let tombstones: { id: string; deleted_at: string; attachments?: Attachment[] }[] = [];
/** Set when reading the markers is supposed to fail. */
let tombstonesFail = false;

vi.mock("./db", () => ({
  cachedFiles: async () =>
    [...store].map(([id, size]) => ({ id, size })),
  deleteFiles: async (ids: string[]) => {
    deleted.push(...ids);
    for (const id of ids) store.delete(id);
  },
  allTombstones: async () => {
    if (tombstonesFail) throw new Error("the store would not open");
    return tombstones;
  },
  getFile: async (id: string) => blobs.get(id),
  putFile: async () => {},
  getMeta: async (key: string) => meta.get(key),
  setMeta: async (key: string, value: unknown) => {
    meta.set(key, value);
  },
}));

/** The fake `meta` store. */
let meta = new Map<string, unknown>();

/** Bytes this device holds, by attachment id — what an upload reads. */
let blobs = new Map<string, Blob>();
/** The fake server, or null for device-only. */
let server: unknown = null;

vi.mock("./supabase", () => ({ getSupabase: async () => server }));
vi.mock("./sync", () => ({ serverKnowsAttachments: async () => true }));

import {
  pendingUploads,
  pruneCache,
  refusesTheFile,
  removeNoteFolders,
  sendAgain,
  uploadRefused,
  removeRemote,
  retryOrphans,
  uploadPending,
  UPLOAD_BATCH,
} from "./attachments";
import { note as base } from "../test/fixtures";

const note = (id: string, attachments: Attachment[]): Note =>
  base({ id, raw_content: "", body: "", attachments });

const MB = 1024 * 1024;

function att(id: string, path: string | null, addedAt: string): Attachment {
  return {
    id,
    name: `${id}.jpg`,
    mime: "image/jpeg",
    size: 10 * MB,
    width: 100,
    height: 100,
    thumb: "data:image/jpeg;base64,xx",
    path,
    added_at: addedAt,
  };
}


beforeEach(() => {
  store = new Map();
  deleted = [];
  tombstones = [];
  tombstonesFail = false;
  blobs = new Map();
  server = null;
});

describe("pruneCache", () => {
  it("does nothing at all under the budget", async () => {
    store.set("a", 10 * MB);
    const notes = [note("n1", [att("a", "u/n1/a", "2026-01-01T00:00:00.000Z")])];
    expect(await pruneCache(notes, 100 * MB)).toBe(0);
    expect(deleted).toEqual([]);
  });

  it("never drops a file that has not been uploaded", async () => {
    // The only copy in existence. Dropping it is not a cache miss, it is losing
    // the file — so the budget loses instead, and stays over.
    store.set("mine", 90 * MB);
    const notes = [note("n1", [att("mine", null, "2020-01-01T00:00:00.000Z")])];
    expect(await pruneCache(notes, 10 * MB)).toBe(0);
    expect(deleted).toEqual([]);
    expect(store.has("mine")).toBe(true);
  });

  it("drops uploaded copies, oldest first, and stops at the budget", async () => {
    store.set("new", 40 * MB);
    store.set("old", 40 * MB);
    store.set("older", 40 * MB);
    const notes = [
      note("n1", [
        att("new", "u/n1/new", "2026-06-01T00:00:00.000Z"),
        att("old", "u/n1/old", "2025-06-01T00:00:00.000Z"),
        att("older", "u/n1/older", "2024-06-01T00:00:00.000Z"),
      ]),
    ];
    expect(await pruneCache(notes, 60 * MB)).toBe(2);
    expect(deleted).toEqual(["older", "old"]);
    // Stops the moment it is under, rather than emptying the store.
    expect(store.has("new")).toBe(true);
  });

  it("takes bytes belonging to no note before anything else", async () => {
    store.set("orphan", 40 * MB);
    store.set("kept", 40 * MB);
    const notes = [note("n1", [att("kept", "u/n1/kept", "2020-01-01T00:00:00.000Z")])];
    // "kept" is older, but an orphan is a leftover from a destroyed note and
    // stands for nothing at all — it goes first whatever its date.
    expect(await pruneCache(notes, 50 * MB)).toBe(1);
    expect(deleted).toEqual(["orphan"]);
  });

  it("leaves the un-uploaded alone even while dropping around it", async () => {
    store.set("mine", 40 * MB);
    store.set("theirs", 40 * MB);
    const notes = [
      note("n1", [
        att("mine", null, "2020-01-01T00:00:00.000Z"),
        att("theirs", "u/n1/theirs", "2026-01-01T00:00:00.000Z"),
      ]),
    ];
    await pruneCache(notes, 50 * MB);
    expect(deleted).toEqual(["theirs"]);
    expect(store.has("mine")).toBe(true);
  });

  /**
   * A delete the server has not taken yet is a note this device is still
   * holding whole — `Tombstone.attachments` is what lets a refused delete come
   * back as the note it was rather than as empty frames. Its files are named by
   * no live note, which is exactly the shape the sweep reads as an orphan and
   * drops before anything else.
   */
  it("never drops an un-uploaded file a tombstone is holding", async () => {
    store.set("held", 90 * MB);
    tombstones = [
      {
        id: "gone",
        deleted_at: "2026-09-01T00:00:00.000Z",
        // Never uploaded, and now not on any board either: this device's copy
        // is the only one in existence, and a refused delete is what asks for
        // it back.
        attachments: [att("held", null, "2020-01-01T00:00:00.000Z")],
      },
    ];
    expect(await pruneCache([], 10 * MB)).toBe(0);
    expect(deleted).toEqual([]);
    expect(store.has("held")).toBe(true);
  });

  it("treats a tombstone's uploaded file as a spare copy, not as an orphan", async () => {
    store.set("held", 40 * MB);
    store.set("live", 40 * MB);
    tombstones = [
      {
        id: "gone",
        deleted_at: "2026-09-01T00:00:00.000Z",
        attachments: [att("held", "u/gone/held", "2026-06-01T00:00:00.000Z")],
      },
    ];
    // Both are on the server, so both may go — but the held one is *known*, so
    // it takes its turn by date instead of going first as a leftover. "live" is
    // the older, and one of the two is all the budget asks for.
    const notes = [note("n1", [att("live", "u/n1/live", "2024-06-01T00:00:00.000Z")])];
    expect(await pruneCache(notes, 50 * MB)).toBe(1);
    expect(deleted).toEqual(["live"]);
    expect(store.has("held")).toBe(true);
  });

  it("drops nothing at all when the markers cannot be read", async () => {
    // Which files are being held is not a question this sweep may guess at.
    store.set("orphan", 90 * MB);
    tombstonesFail = true;
    await expect(pruneCache([], 10 * MB)).rejects.toThrow();
    expect(deleted).toEqual([]);
  });
});

describe("uploadPending", () => {
  /** A storage bucket that records every upload and refuses the names given. */
  function bucket(refuse: string[] = []) {
    const sent: string[] = [];
    let inFlight = 0;
    let peak = 0;
    server = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u" } } } }) },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 1));
            inFlight -= 1;
            sent.push(path);
            const id = path.split("/").pop()!;
            return { error: refuse.includes(id) ? new Error("refused") : null };
          },
        }),
      },
    };
    return { sent, peak: () => peak };
  }

  const photos = (count: number) =>
    Array.from({ length: count }, (_, i) => {
      const id = `p${i}`;
      blobs.set(id, new Blob(["x"]));
      return att(id, null, "2026-09-17T00:00:00.000Z");
    });

  it("sends a batch at a time, together, and records each path that landed", async () => {
    // Eleven photographs used to go up one after another in a single tick, with
    // no path recorded until the last had landed.
    const { sent, peak } = bucket();
    const notes = [note("n1", photos(11))];
    const { uploaded, failed } = await uploadPending(notes);
    expect(failed).toBeNull();
    expect(sent).toHaveLength(UPLOAD_BATCH);
    expect(peak()).toBe(UPLOAD_BATCH);
    const paths = uploaded[0].attachments.filter((a) => a.path !== null);
    expect(paths.map((a) => a.path)).toEqual(["u/n1/p0", "u/n1/p1", "u/n1/p2"]);
  });

  it("keeps what landed beside a file the bucket refused", async () => {
    bucket(["p1"]);
    const { uploaded, failed } = await uploadPending([note("n1", photos(3))]);
    expect(failed?.message).toMatch(/p1\.jpg/);
    expect(uploaded[0].attachments.map((a) => a.path)).toEqual(["u/n1/p0", null, "u/n1/p2"]);
  });

  /**
   * Audit BUG-2 (2026-10-10): a file the server turns away was sent up in full
   * on every sync — every edit, every return, every five minutes.
   */
  it("does not send a file again once the server has turned it away, until asked", async () => {
    const sent: string[] = [];
    let status: number | undefined = 413;
    server = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u" } } } }) },
      storage: {
        from: () => ({
          upload: async (path: string) => {
            sent.push(path);
            return { error: status ? Object.assign(new Error("Payload too large"), { status }) : null };
          },
        }),
      },
    };
    blobs.set("big", new Blob(["x"]));
    const film = note("n9", [{ ...att("big", null, "2026-09-17T00:00:00.000Z"), name: "holiday.mp4" }]);

    const first = await uploadPending([film]);
    expect(first.failed?.message).toBe("file refused: holiday.mp4\nPayload too large");
    expect(uploadRefused("big")).toBe(true);

    expect((await uploadPending([film])).failed).toBeNull();
    expect(sent).toHaveLength(1);

    status = undefined;
    sendAgain("big");
    expect(uploadRefused("big")).toBe(false);
    const third = await uploadPending([film]);
    expect(sent).toHaveLength(2);
    expect(third.uploaded[0].attachments[0].path).toBe("u/n9/big");
  });

  it("keeps sending a file whose upload failed for a reason that is not about the file", () => {
    expect(refusesTheFile(null)).toBe(false); // the network
    expect(refusesTheFile("401")).toBe(false); // an expired sign-in
    expect(refusesTheFile("429")).toBe(false);
    expect(refusesTheFile("503")).toBe(false);
    expect(refusesTheFile("413")).toBe(true);
    expect(refusesTheFile("403")).toBe(true);
    expect(refusesTheFile("507")).toBe(true);
  });

  it("does not spend the batch on files only the other device holds", async () => {
    const { sent } = bucket();
    const theirs = [att("t0", null, "2026-09-17T00:00:00.000Z"), att("t1", null, "2026-09-17T00:00:00.000Z")];
    await uploadPending([note("n1", [...theirs, ...photos(3)])]);
    expect(sent).toHaveLength(3);
  });
});

describe("pendingUploads", () => {
  it("lists the files still only on this device", () => {
    const n = note("n1", [att("a1", null, "2026-01-01T00:00:00.000Z"), att("a2", "u/n1/a2", "2026-01-01T00:00:00.000Z")]);
    expect(pendingUploads([n]).map((p) => p.att.id)).toEqual(["a1"]);
  });

  it("skips a note in the trash, and lists it again once restored", () => {
    const binned = { ...note("n1", [att("a1", null, "2026-01-01T00:00:00.000Z")]), status: "trashed" as const };
    expect(pendingUploads([binned])).toEqual([]);
    expect(pendingUploads([{ ...binned, status: "active" }]).map((p) => p.att.id)).toEqual(["a1"]);
  });
});

/**
 * A removal the server did not take used to be dropped — a thrown failure was
 * swallowed by the caller, and the storage client's own refusal, which it
 * returns rather than throws, was never read. The file then sat on the server
 * for good with nothing left naming it.
 */
describe("removing server files", () => {
  function bucket(answer: () => { error: { message: string } | null }) {
    const asked: string[][] = [];
    server = {
      storage: {
        from: () => ({
          remove: async (paths: string[]) => {
            asked.push(paths);
            return answer();
          },
        }),
      },
    };
    return asked;
  }

  beforeEach(() => {
    meta = new Map();
  });

  it("writes down what the server refused, and asks again on the next open", async () => {
    let refuse = true;
    const asked = bucket(() => (refuse ? { error: { message: "offline" } } : { error: null }));

    await expect(removeRemote([att("gone", "u/gone", "2026-09-01T00:00:00.000Z")])).rejects.toThrow();
    expect(meta.get("orphanPaths")).toEqual(["u/gone"]);

    refuse = false;
    expect(await retryOrphans()).toBe(1);
    expect(asked.at(-1)).toEqual(["u/gone"]);
    expect(meta.get("orphanPaths")).toEqual([]);
  });

  it("keeps the list when the retry fails too", async () => {
    meta.set("orphanPaths", ["u/a"]);
    bucket(() => ({ error: { message: "still offline" } }));
    await expect(retryOrphans()).rejects.toThrow();
    expect(meta.get("orphanPaths")).toEqual(["u/a"]);
  });

  it("asks nothing when nothing is owed", async () => {
    const asked = bucket(() => ({ error: null }));
    expect(await retryOrphans()).toBe(0);
    expect(asked).toEqual([]);
  });
});

/**
 * Audit DATA-5 (2026-10-10): the server's delete removes the row, not the
 * bytes, and this device removes only the paths it knows. Once a delete is
 * confirmed, the note's whole folder goes.
 */
describe("a destroyed note's folder", () => {
  function bucket(files: Record<string, string[]>, failList = false) {
    const removed: string[][] = [];
    server = {
      auth: { getSession: async () => ({ data: { session: { user: { id: "u" } } } }) },
      storage: {
        from: () => ({
          list: async (folder: string) =>
            failList
              ? { data: null, error: { message: "offline" } }
              : { data: (files[folder] ?? []).map((name) => ({ id: `id-${name}`, name })), error: null },
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          },
        }),
      },
    };
    return removed;
  }

  beforeEach(() => {
    meta = new Map();
  });

  it("is emptied, files this device never knew of included", async () => {
    const removed = bucket({ "u/n1": ["a1", "stray"], "u/n2": [] });
    await removeNoteFolders(["n1", "n2"]);
    expect(removed).toEqual([["u/n1/a1", "u/n1/stray"]]);
  });

  it("is remembered when it cannot be emptied, and emptied on the next open", async () => {
    bucket({}, true);
    await expect(removeNoteFolders(["n1"])).rejects.toThrow();
    expect(meta.get("orphanPaths")).toEqual(["u/n1/"]);

    const removed = bucket({ "u/n1": ["late"] });
    expect(await retryOrphans()).toBe(1);
    expect(removed).toEqual([["u/n1/late"]]);
    expect(meta.get("orphanPaths")).toEqual([]);
  });
});
