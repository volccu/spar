// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { allNotes, clearDirtySent, purgeEverything, putNote, putNotesFromServer } from "./db";
import { note as base } from "../test/fixtures";

beforeEach(async () => {
  await purgeEverything();
});

describe("a local write is a blind overwrite of whatever the store holds", () => {
  it("a typing flush built from the screen's older copy must not undo a change the pull just stored", async () => {
    const t0 = "2026-10-15T10:00:00.000Z";
    const v1 = base({ id: "n", body: "hello", status: "active", updated_at: t0, field_updated_at: { body: t0, status: t0 } });
    await putNote(v1);
    await clearDirtySent([{ id: "n", stamp: t0 }]);

    // sync: the laptop archived the note; the pull stores it (the screen has not been told yet)
    const tArchive = "2026-10-15T10:00:05.000Z";
    const remote = base({ id: "n", body: "hello", status: "archived", updated_at: tArchive, field_updated_at: { body: t0, status: tArchive } });
    await putNotesFromServer([remote]);

    // the typing pause ends in that same moment: the flush writes the screen's copy
    const tType = "2026-10-15T10:00:05.010Z";
    const typed = { ...v1, body: "hello world", updated_at: tType, field_updated_at: { body: tType, status: t0 } };
    await putNote(typed);

    const stored = (await allNotes()).find((n) => n.id === "n")!;
    expect(stored.body).toBe("hello world");
    expect(stored.status).toBe("archived"); // the archive is lost on this device: stored.status === "active"
  });
});
