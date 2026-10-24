// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeAll, describe, expect, it } from "vitest";
import { note } from "../test/fixtures";

/**
 * The upgrade to database version 7, which adds the store search keeps a
 * PDF's words in.
 *
 * A file of its own for `dbUpgrade.test.ts`'s reason: the old database has to
 * exist *before* anything imports `db.ts`, which opens the current version on
 * first use and leaves no version 6 behind to upgrade.
 */

beforeAll(async () => {
  // Version 6, as it shipped: everything but the words.
  const old = await openDB("spar", 6, {
    upgrade(database) {
      const notes = database.createObjectStore("notes", { keyPath: "id" });
      notes.createIndex("by_created", "created_at");
      notes.createIndex("by_status", "status");
      database.createObjectStore("meta");
      database.createObjectStore("dirty");
      database.createObjectStore("files");
      database.createObjectStore("folders", { keyPath: "id" });
      database.createObjectStore("folderDirty");
      database.createObjectStore("tombstones", { keyPath: "id" });
      database.createObjectStore("tombstoneDirty");
    },
  });
  await old.put("notes", note({ id: "kept", body: "the lease" }));
  await old.put("dirty", "2026-01-01T00:00:00.000Z", "kept");
  await old.put("files", new Blob(["%PDF"]), "lease-pdf");
  old.close();
});

describe("upgrading a database that has no store for a document's words", () => {
  it("keeps every note, outbox entry and file it found", async () => {
    const { allNotes, dirtyEntries, getFile } = await import("./db");
    expect((await allNotes()).map((n) => n.id)).toEqual(["kept"]);
    expect((await dirtyEntries()).map((e) => e.id)).toEqual(["kept"]);
    expect(await getFile("lease-pdf")).toBeTruthy();
  });

  it("starts with nothing read, and keeps what is read from then on", async () => {
    const { allPdfText, putPdfText } = await import("./db");
    expect((await allPdfText()).size).toBe(0);
    await putPdfText("lease-pdf", { v: 1, outcome: "text", text: "Tampere" });
    expect((await allPdfText()).get("lease-pdf")?.text).toBe("Tampere");
  });

  it("empties it with everything else when the device changes hands", async () => {
    const { allPdfText, purgeEverything } = await import("./db");
    await purgeEverything();
    expect((await allPdfText()).size).toBe(0);
  });
});
