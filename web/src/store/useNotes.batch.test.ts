// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The open note's keystrokes: the screen at once, the disk at the pause.
 * Every character used to be its own IndexedDB transaction and its own
 * broadcast to every other tab.
 */

const writes = vi.hoisted(() => ({ batches: [] as string[][] }));

vi.mock("./db", async (importOriginal) => {
  const real = await importOriginal<typeof import("./db")>();
  return {
    ...real,
    putNotes: async (...args: Parameters<typeof real.putNotes>) => {
      writes.batches.push(args[0].map((n) => n.body));
      return real.putNotes(...args);
    },
  };
});

import { useNotes } from "./useNotes";
import { allNotes } from "./db";

// Unmounted after every case, so no store is left running its write and retry
// timers once the file ends: Testing Library cleans up by itself only where
// the runner's globals are on, and here they are not. A timer firing after
// jsdom was torn down sent React's scheduler looking for `window`.
afterEach(() => cleanup());

async function ready() {
  const hook = renderHook(() => useNotes());
  await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });
  return hook.result;
}

describe("typing into an open note", () => {
  it("draws every keystroke at once and writes the burst as one", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("Draft")!.id;
    });
    writes.batches = [];

    for (const body of ["Draft o", "Draft on", "Draft one"]) {
      act(() => result.current.editBody(id, body));
      // On screen immediately — nothing waits on the disk.
      expect(result.current.notes.find((n) => n.id === id)?.body).toBe(body);
    }

    await waitFor(async () =>
      expect((await allNotes()).find((n) => n.id === id)?.body).toBe("Draft one"),
    );
    // One transaction for the burst, holding only the last version.
    expect(writes.batches).toEqual([["Draft one"]]);
  });

  it("writes at once when the app is hidden", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("Leaving")!.id;
    });
    writes.batches = [];
    act(() => result.current.editBody(id, "Leaving now"));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });

    // Asked for synchronously by the hide, not after the pause.
    expect(writes.batches).toEqual([["Leaving now"]]);
  });

  it("never lets a waiting body land on top of a newer immediate write", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("Order")!.id;
    });
    act(() => result.current.editBody(id, "Order matters"));
    // An immediate write for the same note, carrying the newer body with it.
    act(() => result.current.togglePriority(result.current.notes.find((n) => n.id === id)!));

    await new Promise((r) => setTimeout(r, 400));
    const stored = (await allNotes()).find((n) => n.id === id);
    expect(stored?.body).toBe("Order matters");
    expect(stored?.priority).toBe(1);
  });

  /*
   * A change from another device landing inside the pause: the screen merges
   * it, and the waiting write used to put the note as it was at the first
   * keystroke on top of it in IndexedDB — the pull's cursor already past it,
   * so after a reload the other device's change was gone (bughunt 2026-10-15).
   */
  it("never lets a waiting body land on top of a change pulled in the pause", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("Pulled")!.id;
    });
    await new Promise((r) => setTimeout(r, 400));
    act(() => result.current.editBody(id, "Pulled here"));
    const mine = result.current.notes.find((n) => n.id === id)!;
    const later = "2099-01-01T00:00:00.000Z";
    act(() =>
      result.current.applyRemote([
        {
          ...mine,
          body: "Pulled",
          priority: 1,
          updated_at: later,
          // The other device saw the words before this keystroke.
          field_updated_at: { body: mine.created_at, priority: later },
        },
      ]),
    );

    await new Promise((r) => setTimeout(r, 400));
    const stored = (await allNotes()).find((n) => n.id === id);
    expect(stored?.body).toBe("Pulled here");
    expect(stored?.priority).toBe(1);
  });
});
