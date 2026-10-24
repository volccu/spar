// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { note as base } from "../test/fixtures";
import { readUnsaved, stashUnsaved, withUnsaved } from "./unsavedStash";

/**
 * A local write that IndexedDB refuses. It used to be held only in memory until
 * somebody pressed Retry, so a reload lost it. Now it is copied to
 * `localStorage` at once and retried on its own; the next open lays the copy
 * back over the store.
 */

const failNext = vi.hoisted(() => ({ count: 0, deletes: 0 }));

vi.mock("./db", async (importOriginal) => {
  const real = await importOriginal<typeof import("./db")>();
  return {
    ...real,
    // Every store write goes through `putNotes`, a single note as a batch of one.
    putNotes: async (...args: Parameters<typeof real.putNotes>) => {
      if (failNext.count > 0) {
        failNext.count -= 1;
        throw new Error("QuotaExceededError");
      }
      return real.putNotes(...args);
    },
    deleteNotes: async (...args: Parameters<typeof real.deleteNotes>) => {
      if (failNext.deletes > 0) {
        failNext.deletes -= 1;
        throw new Error("blocked");
      }
      return real.deleteNotes(...args);
    },
  };
});

import { useNotes } from "./useNotes";
import { allNotes } from "./db";

afterEach(() => {
  // Unmounted, so the store's retry and write timers are cleared with it.
  // Left mounted — Testing Library only cleans up by itself where the test
  // runner's globals are on, and they are not here — a refused write's retry
  // fired after the file had finished and jsdom was gone, and React's
  // scheduler reached for `window`: "window is not defined", now and then.
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  failNext.count = 0;
  failNext.deletes = 0;
});

describe("a failed local write", () => {
  it("is stashed at once, retried on its own, and the stash emptied once it lands", async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });

    failNext.count = 1;
    let id = "";
    act(() => {
      id = hook.result.current.create("Written while the disk was full")!.id;
    });

    await waitFor(() => expect(hook.result.current.storageError).not.toBeNull());
    expect(readUnsaved().map((n) => n.id)).toContain(id);

    // No button pressed: the first retry waits two seconds.
    await waitFor(
      async () => expect((await allNotes()).some((n) => n.id === id)).toBe(true),
      { timeout: 5_000 },
    );
    await waitFor(() => expect(hook.result.current.storageError).toBeNull());
    expect(readUnsaved()).toEqual([]);
  });

  it("comes back on the next open from the stash, and is written properly", async () => {
    const lost = base({ id: "stashed-1", body: "survived the reload", updated_at: "2026-09-21T10:00:00.000Z" });
    stashUnsaved([lost]);

    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });

    expect(hook.result.current.notes.find((n) => n.id === "stashed-1")?.body).toBe("survived the reload");
    await waitFor(async () =>
      expect((await allNotes()).find((n) => n.id === "stashed-1")?.body).toBe("survived the reload"),
    );
    await waitFor(() => expect(readUnsaved()).toEqual([]));
  });
});

describe("withUnsaved", () => {
  const at = (id: string, updated_at: string, body = id) => base({ id, updated_at, body });

  it("lays a copy over the store only where it is newer or missing", () => {
    const loaded = [at("a", "2026-09-21T10:00:00.000Z", "disk"), at("b", "2026-09-21T10:00:00.000Z", "disk")];
    const stashed = [
      at("a", "2026-09-21T11:00:00.000Z", "stash"),
      at("b", "2026-09-21T09:00:00.000Z", "stash"),
      at("c", "2026-09-21T09:00:00.000Z", "stash"),
    ];
    const { notes, pending } = withUnsaved(loaded, stashed);
    const body = (id: string) => notes.find((n) => n.id === id)?.body;
    expect(body("a")).toBe("stash");
    expect(body("b")).toBe("disk");
    expect(body("c")).toBe("stash");
    expect(pending.map((n) => n.id).sort()).toEqual(["a", "c"]);
  });

  it("reads nothing from a stash that is not a list of notes", () => {
    localStorage.setItem("spar.unsaved", "{not json");
    expect(readUnsaved()).toEqual([]);
    localStorage.setItem("spar.unsaved", JSON.stringify([{ nope: 1 }]));
    expect(readUnsaved()).toEqual([]);
  });
});

/**
 * Emptying the trash took the notes off the screen before the store had agreed,
 * and a refusal was never caught: they looked destroyed and came back on the
 * next reload. Now they go back into the trash on screen and the banner says so.
 */
describe("a delete for good the store refuses", () => {
  it("puts the notes back in the trash and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });
    let id = "";
    act(() => {
      id = hook.result.current.create("Going in the bin")!.id;
    });
    act(() => hook.result.current.setStatus(id, "trashed"));

    failNext.deletes = 1;
    let destroyed = -1;
    await act(async () => {
      destroyed = await hook.result.current.destroy([id]);
    });

    expect(destroyed).toBe(0);
    expect(hook.result.current.notes.find((n) => n.id === id)?.status).toBe("trashed");
    expect(hook.result.current.storageError).toMatch(/still in the trash/);
  });
});
