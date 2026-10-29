// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../types";

/**
 * The one rule this store is arranged around, checked rather than trusted: an
 * arrangement the user made travels, and a layout the app invented does not
 * (`putCanvasSynced` vs `putCanvasLocalOnly`, `web/CLAUDE.md` "A canvas syncs
 * on outboxes"). And the banner that a refused write now raises, which for a
 * year was an unhandled rejection and nothing else.
 */

vi.mock("./db", async (importOriginal) => {
  const real = await importOriginal<typeof import("./db")>();
  return { ...real, putCanvasSynced: vi.fn(real.putCanvasSynced) };
});

import { useCanvases } from "./useCanvases";
import * as db from "./db";
import { note as base } from "../test/fixtures";

const note = (id: string, over: Partial<Note> = {}): Note =>
  base({
    id,
    raw_content: id,
    body: id,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...over,
  });


const idea = note("idea", { merged_from: ["a", "b"] });
const sources = [note("a", { merged_into: "idea" }), note("b", { merged_into: "idea" })];

async function ready() {
  const hook = renderHook(() => useCanvases());
  // The load is one read; give it a turn.
  await act(async () => {});
  return hook.result;
}

const queued = async () => (await db.dirtyCanvasEntries()).map((entry) => entry.id);

describe("what travels and what does not", () => {
  it("stores an invented layout without queueing it, and queues an arrangement the user made", async () => {
    const result = await ready();

    let id = "";
    act(() => {
      id = result.current.ensureForIdea(idea, sources).id;
    });
    await waitFor(async () => expect((await db.allCanvases()).map((c) => c.id)).toContain(id));
    expect(await queued()).not.toContain(id);

    act(() => {
      result.current.moveItem(id, "a", 300, 120);
    });
    await waitFor(async () => expect(await queued()).toContain(id));
    const stored = (await db.allCanvases()).find((c) => c.id === id);
    expect(stored?.items.find((item) => item.note_id === "a")).toMatchObject({ x: 300, y: 120 });
  });

  it("absorbs what the server sent without queueing it back", async () => {
    const result = await ready();
    const remote = {
      id: "from-the-phone",
      idea_id: "from-the-phone",
      items: [{ note_id: "a", x: 900, y: 400 }],
      strokes: [],
      image_widths: {},
      text_elements: [],
      created_at: "2026-08-12T08:00:00.000Z",
      updated_at: "2026-08-12T10:00:00.000Z",
    };
    act(() => {
      result.current.applyRemoteCanvases([remote]);
    });
    expect(result.current.folders.map((c) => c.id)).toContain("from-the-phone");
    await waitFor(async () =>
      expect((await db.allCanvases()).map((c) => c.id)).toContain("from-the-phone"),
    );
    expect(await queued()).not.toContain("from-the-phone");
  });
});

describe("a write the store refused", () => {
  it("keeps the arrangement on screen, says it is not saved, and saves it on Try again", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.ensureForIdea(note("idea-2", { merged_from: ["a"] }), sources).id;
    });
    vi.mocked(db.putCanvasSynced).mockRejectedValueOnce(new Error("quota"));

    act(() => {
      result.current.moveItem(id, "a", 50, 60);
    });
    await waitFor(() => expect(result.current.storageError).toMatch(/not saved on this device/));
    // The screen kept the move; the store did not.
    expect(result.current.folders.find((c) => c.id === id)?.items[0]).toMatchObject({ x: 50, y: 60 });

    await act(async () => {
      await result.current.retryStorage();
    });
    expect(result.current.storageError).toBeNull();
    const stored = (await db.allCanvases()).find((c) => c.id === id);
    expect(stored?.items.find((item) => item.note_id === "a")).toMatchObject({ x: 50, y: 60 });
    expect(await queued()).toContain(id);
  });
  it("does not let an older refused write come back over a newer one that was saved", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.ensureForIdea(note("idea-3", { merged_from: ["a"] }), sources).id;
    });
    let refuse: (error: Error) => void = () => {};
    vi.mocked(db.putCanvasSynced).mockImplementationOnce(
      () => new Promise<void>((_, reject) => (refuse = reject)),
    );
    act(() => {
      result.current.moveItem(id, "a", 10, 10);
    });
    act(() => {
      result.current.moveItem(id, "a", 700, 800);
    });
    await waitFor(async () => {
      const stored = (await db.allCanvases()).find((c) => c.id === id);
      expect(stored?.items[0]).toMatchObject({ x: 700, y: 800 });
    });
    await act(async () => {
      refuse(new Error("quota"));
    });
    await act(async () => {
      await result.current.retryStorage();
    });
    const stored = (await db.allCanvases()).find((c) => c.id === id);
    expect(stored?.items[0]).toMatchObject({ x: 700, y: 800 });
  });
});
