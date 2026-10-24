// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeAll, describe, expect, it } from "vitest";
import type { Canvas } from "../types";
import { canvas } from "../test/fixtures";

const folder = (id: string, over: Partial<Canvas> = {}): Canvas =>
  canvas({
    id,
    // Exactly where the default layout puts three notes.
    items: [
      { note_id: "a", x: 0, y: 0 },
      { note_id: "b", x: 276, y: 0 },
    ],
    updated_at: STAMP,
    ...over,
  });

/**
 * The upgrade to database version 5, which is the one moment folder sync has to
 * reason about canvases that predate it.
 *
 * Kept in a file of its own because it has to open the old database *before*
 * anything imports `db.ts` — the module opens version 5 on first use, and after
 * that there is no version 4 left to upgrade.
 */

const STAMP = "2026-08-12T09:00:00.000Z";


beforeAll(async () => {
  // Version 4, as it shipped: no outbox for folders anywhere.
  const old = await openDB("spar", 4, {
    upgrade(database) {
      const notes = database.createObjectStore("notes", { keyPath: "id" });
      notes.createIndex("by_created", "created_at");
      notes.createIndex("by_status", "status");
      database.createObjectStore("meta");
      database.createObjectStore("dirty");
      database.createObjectStore("files");
      database.createObjectStore("folders", { keyPath: "id" });
    },
  });

  await old.put("folders", folder("untouched"));
  await old.put("folders", folder("dragged", { items: [{ note_id: "a", x: 812, y: 340 }] }));
  await old.put("folders", folder("drawn", {
    strokes: [{ id: "s1", points: [[0, 0], [10, 10]], color: "#16161a", width: 4 }],
  }));
  await old.put("folders", folder("resized", { items: [{ note_id: "a", x: 0, y: 0, width: 400 }] }));
  old.close();
});

describe("upgrading a database that has folders but no folder outbox", () => {
  it("queues the canvases somebody actually arranged, and only those", async () => {
    const { dirtyCanvasEntries } = await import("./db");

    const queued = new Set((await dirtyCanvasEntries()).map((entry) => entry.id));

    expect(queued.has("dragged")).toBe(true);
    expect(queued.has("drawn")).toBe(true);
    expect(queued.has("resized")).toBe(true);
    // A canvas sitting exactly where the app put it is not a decision anybody
    // made, and uploading it would flatten the other device's arrangement.
    expect(queued.has("untouched")).toBe(false);
  });

  it("queues the version that is actually stored, so the push can be crossed off", async () => {
    const { dirtyCanvasEntries } = await import("./db");

    const entry = (await dirtyCanvasEntries()).find((e) => e.id === "drawn");
    expect(entry?.stamp).toBe(STAMP);
  });

  it("keeps every folder it found", async () => {
    const { allCanvases } = await import("./db");
    expect((await allCanvases()).map((f) => f.id).sort()).toEqual([
      "dragged",
      "drawn",
      "resized",
      "untouched",
    ]);
  });
});
