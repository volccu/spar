import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The four pulls asked as one question, and the two things that must hold:
 * the cursors the client already keeps go up unchanged in meaning, and a
 * server without the function is asked once, not every tick.
 */

/** Every RPC call, with its arguments. */
let calls: Record<string, unknown>[] = [];
/** What the fake server answers, per call in order. */
let answers: { data?: unknown; error?: { code?: string; message: string } | null }[] = [];
/** The cursors on disk, by key. */
let meta: Record<string, unknown> = {};

vi.mock("./supabase", () => ({
  syncConfigured: true,
  getSupabase: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      return answers.shift() ?? { data: null, error: null };
    },
  }),
}));
vi.mock("./db", () => ({
  getMeta: async (key: string) => meta[key],
}));

import { PULL_PAGE, pullChanges, resetPullChanges } from "./pullChanges";
import { REPAIR_WINDOW_MS } from "./cursors";

const NOTE_ROW = {
  id: "n1",
  raw_content: "hello",
  body: "hello",
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-06T10:00:00+00:00",
  status: "active",
  priority: 0,
};

beforeEach(() => {
  calls = [];
  answers = [];
  meta = {};
  resetPullChanges();
});

describe("pullChanges", () => {
  it("asks once, with every cursor the device keeps, and hands back all four parts", async () => {
    meta = {
      lastPulledAt: { at: "2026-09-06T09:00:00.000Z", id: "n0" },
      lastTombstonesPulledAt: { at: "2026-09-05T00:00:00.000Z", id: "t0" },
      lastFoldersPulledAt: "2026-09-04T00:00:00.000Z",
    };
    answers = [
      {
        data: {
          notes: [NOTE_ROW],
          tombstones: [{ note_id: "gone", deleted_at: "2026-09-05T12:00:00+00:00" }],
          folders: [{ id: "idea", items: [], updated_at: "2026-09-06T08:00:00+00:00" }],
          prefs: { boards: [{ id: "b1", name: "Recipes", position: 0 }], inbox_since: null, updated_at: "2026-09-01T00:00:00+00:00" },
        },
      },
    ];

    const ahead = await pullChanges();

    expect(calls).toHaveLength(1);
    // Every cursor steps back over the repair window and drops its id, exactly
    // as the plain pulls do — deletes included, since a delete committing
    // late is as real as a note doing so. A cursor with no id goes up null,
    // which the function reads as "from this stamp".
    expect(calls[0]).toMatchObject({
      name: "pull_changes",
      p_notes_at: new Date(Date.parse("2026-09-06T09:00:00.000Z") - REPAIR_WINDOW_MS).toISOString(),
      p_notes_id: null,
      p_tombstones_at: new Date(Date.parse("2026-09-05T00:00:00.000Z") - REPAIR_WINDOW_MS).toISOString(),
      p_tombstones_id: null,
      p_folders_at: new Date(Date.parse("2026-09-04T00:00:00.000Z") - REPAIR_WINDOW_MS).toISOString(),
      p_folders_id: null,
      p_limit: PULL_PAGE,
    });
    expect(ahead?.folders.cursor).toEqual({ at: "2026-09-06T08:00:00+00:00", id: "idea" });
    expect(ahead?.notes.rows.map((n) => n.id)).toEqual(["n1"]);
    expect(ahead?.notes.cursor).toEqual({ at: "2026-09-06T10:00:00+00:00", id: "n1" });
    expect(ahead?.notes.complete).toBe(true);
    expect(ahead?.tombstones.rows).toEqual([{ id: "gone", deleted_at: "2026-09-05T12:00:00+00:00" }]);
    expect(ahead?.tombstones.cursor).toEqual({ at: "2026-09-05T12:00:00+00:00", id: "gone" });
    expect(ahead?.folders.rows[0]).toMatchObject({ id: "idea", idea_id: "idea" });
    expect(ahead?.prefs).toEqual({
      boards: [{ id: "b1", name: "Recipes", position: 0 }],
      at: "2026-09-01T00:00:00+00:00",
      inboxSince: null,
    });
  });

  it("keeps the deletes cursor where it was when the repair window brings back only old ones", async () => {
    meta = { lastTombstonesPulledAt: { at: "2026-09-06T09:00:00.000Z", id: "t5" } };
    answers = [
      {
        data: {
          notes: [],
          tombstones: [{ note_id: "late", deleted_at: "2026-09-06T08:59:30+00:00" }],
          folders: [],
          prefs: null,
        },
      },
    ];
    const ahead = await pullChanges();
    // The late delete is delivered, and the saved position does not walk back.
    expect(ahead?.tombstones.rows).toEqual([{ id: "late", deleted_at: "2026-09-06T08:59:30+00:00" }]);
    expect(ahead?.tombstones.cursor).toEqual({ at: "2026-09-06T09:00:00.000Z", id: "t5" });
  });

  it("keeps the notes cursor where it was when the repair window brings back only old rows", async () => {
    meta = { lastPulledAt: { at: "2026-09-06T09:00:00.000Z", id: "n5" } };
    answers = [{ data: { notes: [{ ...NOTE_ROW, updated_at: "2026-09-06T08:59:30+00:00" }], tombstones: [], folders: [], prefs: null } }];

    const ahead = await pullChanges();

    expect(ahead?.notes.rows).toHaveLength(1);
    expect(ahead?.notes.cursor).toEqual({ at: "2026-09-06T09:00:00.000Z", id: "n5" });
    expect(ahead?.prefs).toBeNull();
  });

  /**
   * The canvas cursor had neither guard. A canvas that went up stamped a
   * moment behind where this device had already read — a server clock read a
   * second early, a slow commit — was never asked for again.
   */
  it("steps the canvas cursor back over the window too, and keeps it where it was for older rows", async () => {
    meta = { lastFoldersPulledAt: { at: "2026-09-06T09:00:00.000Z", id: "idea0" } };
    answers = [
      {
        data: {
          notes: [],
          tombstones: [],
          folders: [{ id: "idea", items: [], updated_at: "2026-09-06T08:59:30+00:00" }],
          prefs: null,
        },
      },
    ];

    const ahead = await pullChanges();

    expect(calls[0]).toMatchObject({
      p_folders_at: new Date(Date.parse("2026-09-06T09:00:00.000Z") - REPAIR_WINDOW_MS).toISOString(),
      p_folders_id: null,
    });
    expect(ahead?.folders.rows).toHaveLength(1);
    expect(ahead?.folders.cursor).toEqual({ at: "2026-09-06T09:00:00.000Z", id: "idea0" });
  });

  it("follows a full page from where it ended, and reports the whole as complete", async () => {
    const page = Array.from({ length: PULL_PAGE }, (_, i) => ({
      ...NOTE_ROW,
      id: `n${String(i).padStart(3, "0")}`,
    }));
    answers = [
      { data: { notes: page, tombstones: [], folders: [], prefs: null } },
      { data: { notes: [{ ...NOTE_ROW, id: "n999" }], tombstones: [], folders: [], prefs: null } },
    ];

    const ahead = await pullChanges();

    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ p_notes_at: NOTE_ROW.updated_at, p_notes_id: "n499" });
    expect(ahead?.notes.rows).toHaveLength(PULL_PAGE + 1);
    expect(ahead?.notes.complete).toBe(true);
  });

  it("asks a server without the function once, and not again this session", async () => {
    answers = [
      { data: null, error: { code: "PGRST202", message: "Could not find the function public.pull_changes" } },
    ];

    expect(await pullChanges()).toBeNull();
    expect(await pullChanges()).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("raises any other failure and asks again next time", async () => {
    answers = [{ data: null, error: { message: "fetch failed" } }];
    await expect(pullChanges()).rejects.toThrow("fetch failed");

    answers = [{ data: { notes: [], tombstones: [], folders: [], prefs: null } }];
    expect(await pullChanges()).not.toBeNull();
    expect(calls).toHaveLength(2);
  });
});
