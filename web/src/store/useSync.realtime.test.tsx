// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types";

/**
 * The three live channels, and the two rules they share: a table the server
 * has not got is never bound (a bad binding fails the whole channel, not just
 * that binding), and this device's own upsert coming back down does not wake
 * a tick to pull what it just pushed.
 *
 * `prefs` was the last table to get a channel. It had been in the realtime
 * publication since the migration that created it and the client had simply
 * never listened, which is what kept the backstop timer short.
 */

/** Channel name -> the handler its one binding was given. */
let handlers = new Map<string, (payload: { new: unknown }) => void>();
/** Channels this mount subscribed to, and the ones it removed on the way out. */
let opened: string[] = [];
let removed: string[] = [];
/** Whether the server admits to each optional table. */
let hasCanvases = true;
let hasBoards = true;
/** How many ticks have started. */
let ticks = 0;

const channel = (name: string) => {
  const made = {
    on(_event: string, _filter: unknown, handler: (payload: { new: unknown }) => void) {
      handlers.set(name, handler);
      return made;
    },
    subscribe() {
      opened.push(name);
      return made;
    },
    name,
  };
  return made;
};

vi.mock("./supabase", () => ({
  syncConfigured: true,
  getSupabase: async () => ({
    channel,
    removeChannel: (ch: { name: string }) => {
      removed.push(ch.name);
    },
  }),
}));
vi.mock("./pullChanges", () => ({ pullChanges: async () => null }));
vi.mock("./attachments", () => ({ uploadPending: async () => ({ uploaded: [], failed: null }) }));
vi.mock("./sync", () => ({
  syncOnce: async () => {
    ticks += 1;
    return { pushed: 0, pulled: [], refused: null, held: [] };
  },
}));
vi.mock("./canvasSync", () => ({
  serverKnowsCanvases: async () => hasCanvases,
  syncCanvasesOnce: async () => ({ pushed: 0, pulled: [], refused: null, held: [] }),
}));
vi.mock("./boardSync", () => ({
  serverKnowsBoards: async () => hasBoards,
  syncBoardsOnce: async () => ({ pushed: false, pulled: null }),
}));
vi.mock("../components/SyncMark", () => ({ MIN_WORKING_MS: 0 }));

import { forgetSent, PREFS_ROW, rememberSent } from "./echo";
import { useSync } from "./useSync";

/**
 * Stable across renders, exactly as `App` passes them. Built fresh in the
 * render callback they are new identities every time, so `run` is rebuilt and
 * the channel effect tears down and resubscribes on every state change —
 * which is a fair description of what this file would then be testing.
 */
const NOTES: Note[] = [];
const PORTS = {
  applyRemote: vi.fn(),
  applyUploaded: vi.fn(),
  canvas: { folders: [], version: 0, applyRemote: vi.fn() },
  prefs: {
    boards: [],
    inboxSince: null,
    at: "2026-09-01T00:00:00.000Z",
    dirty: false,
    sinceDirty: false,
    version: 0,
    applyRemote: vi.fn(),
    clearDirty: vi.fn(),
  },
};

function loop() {
  return renderHook(() =>
    useSync({ enabled: true, notes: NOTES, localVersion: 0, ...PORTS }),
  );
}

/**
 * Real timers throughout. The wake is debounced 700ms inside the hook and the
 * constant is private to it, so the wait is real — and fake timers cannot be
 * used here anyway, since `waitFor` polls on a timer they have stopped.
 */
const WOKEN_BY_NOW = 1200;
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many channels this server's tables justify. */
const expected = () => [true, hasCanvases, hasBoards].filter(Boolean).length;

/** Mounts, waits for every channel to open, and forgets the first tick. */
async function mounted() {
  const hook = loop();
  await waitFor(() => expect(opened).toHaveLength(expected()), { timeout: 10_000 });
  await waitFor(() => expect(ticks).toBeGreaterThan(0), { timeout: 10_000 });
  ticks = 0;
  return hook;
}

/** Fires realtime payloads; they share one debounce, so one wait covers all. */
async function fire(rows: [string, unknown][]) {
  for (const [name, row] of rows) handlers.get(name)!({ new: row });
  await settle(WOKEN_BY_NOW);
}

beforeEach(() => {
  handlers = new Map();
  opened = [];
  removed = [];
  hasCanvases = true;
  hasBoards = true;
  ticks = 0;
  forgetSent();
});

describe("the live channels", () => {
  it("opens one per table, and closes all three on the way out", async () => {
    const { unmount } = await mounted();
    expect(opened).toEqual(["notes-changes", "folder-changes", "prefs-changes"]);

    unmount();
    await waitFor(() => expect(removed).toHaveLength(3));
    expect(removed).toEqual(expect.arrayContaining(["notes-changes", "folder-changes", "prefs-changes"]));
  });

  it("binds nothing for a table the server has not got", async () => {
    hasBoards = false;
    await mounted();
    expect(opened).toEqual(["notes-changes", "folder-changes"]);
  });

  it("wakes a tick when the other device writes the folder shelf", async () => {
    await mounted();
    await fire([["prefs-changes", { owner_id: "someone", updated_at: "2026-09-06T12:00:00+00:00" }]]);
    expect(ticks).toBe(1);
  });

  it("does not wake a tick on this device's own shelf, canvas or note", async () => {
    await mounted();
    const stamp = "2026-09-06T12:00:00.000Z";
    const echoed = "2026-09-06T12:00:00+00:00";
    rememberSent("prefs", [{ id: PREFS_ROW, updated_at: stamp }]);
    rememberSent("folders", [{ id: "idea", updated_at: stamp }]);
    rememberSent("notes", [{ id: "n1", updated_at: stamp }]);

    await fire([
      ["prefs-changes", { owner_id: "someone", updated_at: echoed }],
      ["folder-changes", { id: "idea", updated_at: echoed }],
      ["notes-changes", { id: "n1", updated_at: echoed }],
    ]);
    expect(ticks).toBe(0);

    // The other device writing the same canvas a moment later still wakes it.
    await fire([["folder-changes", { id: "idea", updated_at: "2026-09-06T12:00:05+00:00" }]]);
    expect(ticks).toBe(1);
  });
});
