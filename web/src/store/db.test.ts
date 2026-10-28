// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Note, Canvas } from "../types";
import {
  allCanvases,
  allNotes,
  allTombstones,
  clearDirtySent,
  clearCanvasDirtySent,
  clearTombstoneDirtySent,
  deleteNotes,
  dirtyCanvasEntries,
  dirtyTombstoneEntries,
  pruneTombstones,
  putCanvasSynced,
  putCanvasLocalOnly,
  putCanvasesFromServer,
  putFile,
  getFile,
  purgeTombstoneFiles,
  putNote,
  putNotesFromServer,
} from "./db";
import { canvas, note as base } from "../test/fixtures";

const note = (id: string): Note =>
  base({
    id,
    source: "merge",
    created_at: "2026-08-12T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
    merged_from: ["a", "b"],
  });

const folder = (id: string, stamp = "2026-08-12T09:00:00.000Z"): Canvas =>
  canvas({ id, updated_at: stamp });



async function queued(id: string): Promise<boolean> {
  return (await dirtyCanvasEntries()).some((entry) => entry.id === id);
}

describe("the folder outbox", () => {
  /**
   * The linchpin of the whole conflict rule (see `syncCanvasesOnce`). Opening an
   * idea invents a default layout, and an invention nobody asked for must not
   * travel — stamped now, it would outrank and flatten the arrangement made on
   * the other device last week.
   */
  it("does not queue a layout the app invented", async () => {
    await putCanvasLocalOnly(folder("quiet"));

    expect(await queued("quiet")).toBe(false);
    expect((await allCanvases()).some((f) => f.id === "quiet")).toBe(true);
  });

  /**
   * A pulled arrangement must not land over a drag made on this device since
   * the outbox was read: the check and the write are one transaction.
   */
  it("does not store a pulled canvas over one queued here", async () => {
    await putCanvasSynced(folder("dragged", "2026-08-12T09:00:05.000Z"));
    const stored = await putCanvasesFromServer([
      folder("dragged", "2026-08-12T09:00:01.000Z"),
      folder("other", "2026-08-12T09:00:01.000Z"),
    ]);
    expect(stored.map((f) => f.id)).toEqual(["other"]);
    const all = await allCanvases();
    expect(all.find((f) => f.id === "dragged")?.updated_at).toBe("2026-08-12T09:00:05.000Z");
    expect(all.some((f) => f.id === "other")).toBe(true);
  });

  it("queues an arrangement the user made", async () => {
    await putCanvasSynced(folder("loud"));

    expect(await queued("loud")).toBe(true);
  });

  /**
   * Dragging writes several times a second, so a move landing while the upload
   * is in flight is ordinary. Crossing it off by id would send the first
   * position and forget the last one.
   */
  it("crosses off only the version that went up", async () => {
    await putCanvasSynced(folder("mid", "2026-08-12T09:00:00.000Z"));
    await putCanvasSynced(folder("mid", "2026-08-12T09:00:02.000Z"));

    await clearCanvasDirtySent([{ id: "mid", stamp: "2026-08-12T09:00:00.000Z" }]);
    expect(await queued("mid")).toBe(true);

    await clearCanvasDirtySent([{ id: "mid", stamp: "2026-08-12T09:00:02.000Z" }]);
    expect(await queued("mid")).toBe(false);
  });

  /**
   * A canvas is keyed by its idea's own id and means nothing without it, so a
   * destroyed idea that left one behind would leave an orphan nothing ever
   * opens or sweeps. The server says the same with the cascade in 0010.
   */
  it("destroys a canvas along with the idea it belongs to", async () => {
    await putNote(note("gone"));
    await putCanvasSynced(folder("gone"));

    await deleteNotes(["gone"]);

    expect((await allCanvases()).some((f) => f.id === "gone")).toBe(false);
    expect(await queued("gone")).toBe(false);
    expect((await allTombstones()).map((t) => t.id)).toContain("gone");
    expect((await dirtyTombstoneEntries()).map((entry) => entry.id)).toContain("gone");
  });

  it("keeps a permanent delete queued until remote acknowledgement", async () => {
    await putNote(note("retry"));
    await deleteNotes(["retry"]);

    expect(await allNotes()).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "retry" })]));
    expect((await dirtyTombstoneEntries()).find((entry) => entry.id === "retry")?.stamp).toBeTruthy();
  });
});

describe("server note writes", () => {
  it("does not replace a note with a pending local version", async () => {
    const local = note("pending");
    local.body = "local edit";
    local.updated_at = "2026-08-12T10:00:00.000Z";
    await putNote(local);

    const remote = { ...local, body: "remote edit", updated_at: "2026-08-12T11:00:00.000Z" };
    // Deferred rather than merely dropped: the local edit wins now, and the id
    // is named so the next pull asks for the server's copy again by id. The
    // cursor has already moved past it, so an unnamed skip is a change this
    // device never sees.
    expect(await putNotesFromServer([remote])).toEqual({
      accepted: [],
      deferred: ["pending"],
    });
    expect((await allNotes()).find((n) => n.id === "pending")?.body).toBe("local edit");
  });

  it("accepts a newer server version when no local write is pending", async () => {
    const local = note("remote");
    await putNote(local);
    // A successful upload removes the outbox entry before a pull is applied.
    const newer = { ...local, body: "server edit", updated_at: "2026-08-12T11:00:00.000Z" };
    await clearDirtySent([{ id: local.id, stamp: local.updated_at }]);
    expect(await putNotesFromServer([newer])).toEqual({ accepted: [newer], deferred: [] });
    expect((await allNotes()).find((n) => n.id === "remote")?.body).toBe("server edit");
  });
});

/**
 * Emptying the trash used to destroy the note's bytes before asking the server
 * whether it would take the delete at all — and it can refuse, after which the
 * note is restored. For a file whose upload never finished, the local copy it
 * threw away was the only one in existence.
 */
describe("attachment bytes survive until the delete is confirmed", () => {
  it("keeps the bytes, and hands them to the tombstone", async () => {
    const doomed = note("with-files");
    doomed.status = "trashed";
    doomed.attachments = [
      { id: "never-uploaded", name: "a.png", size: 1, kind: "image", path: null },
      { id: "on-the-server", name: "b.png", size: 1, kind: "image", path: "u/b.png" },
    ] as Note["attachments"];
    await putNote(doomed);
    await putFile("never-uploaded", new Blob(["a"]));
    await putFile("on-the-server", new Blob(["b"]));

    await deleteNotes(["with-files"]);

    // The note is gone from the board immediately; the bytes are not gone at all.
    expect((await allNotes()).find((n) => n.id === "with-files")).toBeUndefined();
    expect(await getFile("never-uploaded")).toBeDefined();
    expect(await getFile("on-the-server")).toBeDefined();
    const tombstone = (await allTombstones()).find((t) => t.id === "with-files");
    expect(tombstone?.attachments).toHaveLength(2);
  });

  it("destroys them once the server has taken the delete, and reports only the uploaded ones", async () => {
    const doomed = note("confirmed");
    doomed.status = "trashed";
    doomed.attachments = [
      { id: "local-only", name: "a.png", size: 1, kind: "image", path: null },
      { id: "remote-too", name: "b.png", size: 1, kind: "image", path: "u/b.png" },
    ] as Note["attachments"];
    await putNote(doomed);
    await putFile("local-only", new Blob(["a"]));
    await putFile("remote-too", new Blob(["b"]));
    await deleteNotes(["confirmed"]);

    const orphaned = await purgeTombstoneFiles(["confirmed"]);

    expect(await getFile("local-only")).toBeUndefined();
    expect(await getFile("remote-too")).toBeUndefined();
    // Only the one that ever reached storage needs removing from it.
    expect(orphaned.map((a) => a.path)).toEqual(["u/b.png"]);
    // The tombstone stays — it is what stops the note coming back — but it no
    // longer carries a list of files that no longer exist.
    const tombstone = (await allTombstones()).find((t) => t.id === "confirmed");
    expect(tombstone).toBeDefined();
    expect(tombstone?.attachments).toBeUndefined();
  });
});

/**
 * The tombstone store was the one thing in the app with no ceiling. A marker
 * past its year goes; one still waiting to be sent does not, however old,
 * because it is the only record that the note was destroyed here.
 */
describe("pruning tombstones", () => {
  it("drops a marker past the horizon, keeps a young one, and never an unsent one", async () => {
    const DAY = 86_400_000;
    await putNote(note("old-sent"));
    await putNote(note("old-unsent"));
    await putNote(note("young"));
    await deleteNotes(["old-sent", "old-unsent", "young"]);
    // Backdate two of them: one the server has taken, one it has not.
    const entries = await dirtyTombstoneEntries();
    await clearTombstoneDirtySent(entries.filter((e) => e.id === "old-sent"));
    // A second connection at the store's own version, to backdate what no API
    // writes. No number: whatever version the store is at now is the one to
    // join, and a number here broke on every schema bump.
    const database = await (await import("idb")).openDB("spar");
    const tx = database.transaction("tombstones", "readwrite");
    for (const id of ["old-sent", "old-unsent"]) {
      const row = await tx.store.get(id);
      await tx.store.put({ ...row, deleted_at: new Date(Date.now() - 400 * DAY).toISOString() });
    }
    await tx.done;
    database.close();

    const gone = await pruneTombstones();
    expect(gone).toBe(1);
    const left = (await allTombstones()).map((t) => t.id).sort();
    expect(left).toContain("old-unsent");
    expect(left).toContain("young");
    expect(left).not.toContain("old-sent");
  });
});

/**
 * Audit DATA-7 (2026-10-10): destroying a note already gone from this device
 * wrote a new marker over the old one, dropping the files it held for the
 * server's answer and what the device believed — the bytes orphaned, and a
 * refused delete then read as a restore.
 */
describe("destroying a note that is already gone", () => {
  it("leaves the marker that stands for it as it was", async () => {
    const doomed = note("twice");
    doomed.status = "trashed";
    doomed.attachments = [{ id: "held", name: "a.png", size: 1, kind: "image", path: null }] as Note["attachments"];
    await putNote(doomed);
    await deleteNotes(["twice"]);
    const first = (await allTombstones()).find((t) => t.id === "twice");
    expect(first?.attachments).toHaveLength(1);
    expect(first?.believed?.status).toBe("trashed");

    await deleteNotes(["twice"]);

    expect((await allTombstones()).find((t) => t.id === "twice")).toEqual(first);
  });
});
