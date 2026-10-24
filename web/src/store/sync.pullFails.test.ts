// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetServerClock } from "./serverClock";
import { isDeletionMarker } from "../lib/versions";

const server = vi.hoisted(() => ({
  tombstones: [] as { note_id: string; deleted_at: string }[],
  notesFail: false,
}));

vi.mock("./attachments", () => ({
  removeRemote: async () => {},
  removeNoteFolders: async () => {},
  pruneCache: async () => 0,
  uploadPending: async () => ({ uploaded: [], failed: null }),
}));

vi.mock("./supabase", () => {
  const table = (name: string) => ({
    select(cols: string) {
      if (!cols.includes(",")) return { limit: async () => ({ data: [], error: null }) };
      const chain: Record<string, unknown> = {
        eq: () => ({ limit: async () => ({ data: [], error: null }) }),
        or: () => chain,
        order: () => chain,
        limit: async () =>
          name === "note_tombstones"
            ? { data: server.tombstones, error: null }
            : server.notesFail
              ? { data: null, error: { code: "08006", message: "connection lost" } }
              : { data: [], error: null },
        in: async () => ({ data: [], error: null }),
      };
      return chain;
    },
    async upsert() {
      return { error: null };
    },
  });
  return {
    shellReady: () => {},
    syncConfigured: true,
    getSupabase: async () => ({
      from: (name: string) => table(name),
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
      // no combined pull on this server: every half reads for itself
      async rpc() {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      },
    }),
  };
});

import { allNotes, purgeEverything, putNote } from "./db";
import { resetServerCapabilities, syncOnce } from "./sync";
import { resetPullChanges } from "./pullChanges";
import { note as base } from "../test/fixtures";

beforeEach(async () => {
  await purgeEverything();
  resetServerCapabilities();
  resetPullChanges();
  forgetServerClock();
  server.tombstones = [];
  server.notesFail = false;
});

describe("a flaky connection half way through a tick", () => {
  it("still tells the screen about the deletes it already applied to the device", async () => {
    const ghost = base({ id: "ghost", body: "deleted for good on the laptop", updated_at: "2026-08-10T10:00:00.000Z", status: "trashed" });
    await putNote(ghost);
    // clean the outbox entry so the note is not in the way of the pull
    const { clearDirtySent } = await import("./db");
    await clearDirtySent([{ id: "ghost", stamp: ghost.updated_at }]);
    server.tombstones = [{ note_id: "ghost", deleted_at: "2026-08-20T12:00:00.000Z" }];
    server.notesFail = true; // the tombstone read got through, the notes read did not

    const outcome = await syncOnce([ghost]).catch((e: Error) => e);

    // The device has already dropped the note ...
    expect((await allNotes()).map((n) => n.id)).not.toContain("ghost");
    // ... so the tick must still hand the deletion back (outcome.pulled) for the screen to drop it too.
    expect(outcome instanceof Error ? "threw: " + outcome.message : "ok").toBe("ok");
    expect((outcome as { pulled: never[] }).pulled.some(isDeletionMarker)).toBe(true);
  });
});
