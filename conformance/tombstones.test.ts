/**
 * Contract: "Trash, permanent delete and tombstones".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BackendError, type NoteWrite, type Session } from "./driver";
import { at, clocksAt, iso, micros, note, useDriver, users } from "./support";

const driver = useDriver();
let a: Session;
const EPOCH = { at: "1970-01-01T00:00:00.000Z", id: null };

beforeAll(async () => {
  [a] = await users(driver, 1);
});

async function trashed(overrides: Partial<NoteWrite> = {}): Promise<NoteWrite> {
  const n = note({ status: "trashed", ...overrides });
  await a.upsertNotes([n]);
  return n;
}

async function refusal(promise: Promise<unknown>): Promise<BackendError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BackendError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("trash is a status, not a delete", () => {
  it("keeps a trashed note whole, readable and pulled like any other", async () => {
    const n = await trashed({ body: "still here" });
    const [row] = await a.notesById([n.id]);
    expect(row.status).toBe("trashed");
    expect(row.body).toBe("still here");
    expect((await a.pullNotes(EPOCH, 500)).map((r) => r.id)).toContain(n.id);
  });

  it("restores by writing the status back", async () => {
    const n = await trashed();
    await a.upsertNotes([{ ...n, status: "active", updated_at: at(1_000), field_updated_at: { ...clocksAt(n.updated_at), status: at(1_000) } }]);
    expect((await a.notesById([n.id]))[0].status).toBe("active");
  });
});

describe("permanently deleting a note", () => {
  it("destroys a trashed note whose stamp is at or behind the one expected", async () => {
    const n = await trashed();
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    expect(await a.notesById([n.id])).toEqual([]);
    expect(await a.noteState(n.id)).toBeNull();
  });

  it("refuses a note that is not trashed, and leaves it", async () => {
    for (const status of ["active", "archived"]) {
      const n = note({ status });
      await a.upsertNotes([n]);
      expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(false);
      expect((await a.notesById([n.id])).length).toBe(1);
    }
  });

  it("refuses a note an update has moved past the expected stamp, clocks and all", async () => {
    const n = await trashed();
    await a.upsertNotes([{ ...n, body: "edited since", updated_at: at(5_000), field_updated_at: { ...clocksAt(n.updated_at), body: at(5_000) } }]);
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(false);
    expect((await a.notesById([n.id])).length).toBe(1);
  });

  it("accepts a note whose stamp ran ahead while no field clock did", async () => {
    // The server (or `stampForUpload`) moved `updated_at`; no client wrote a field.
    const n = await trashed();
    await a.upsertNotes([{ ...n, updated_at: at(5_000) }]);
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
  });

  it("compares the field clocks as instants, whatever their spelling", async () => {
    const n = await trashed({ field_updated_at: { ...clocksAt(at(0)), status: "2031-03-14T11:00:00+02:00" } });
    await a.upsertNotes([{ ...n, updated_at: at(5_000) }]);
    // 11:00+02:00 is 09:00Z, which is `at(0)`: nothing is newer than expected.
    expect(await a.permanentlyDeleteNote(n.id, at(0))).toBe(true);
  });

  it("falls back to the status alone for a note that carries no clocks", async () => {
    const n = await trashed({ field_updated_at: {} });
    await a.upsertNotes([{ ...n, updated_at: at(5_000) }]);
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
  });

  it("ignores clock values that are not dates", async () => {
    const n = await trashed({ field_updated_at: { ...clocksAt(at(0)), junk: "not a date" } });
    await a.upsertNotes([{ ...n, updated_at: at(5_000) }]);
    expect(await a.permanentlyDeleteNote(n.id, at(0))).toBe(true);
  });

  it("answers false for a note that does not exist, including one already destroyed", async () => {
    const n = await trashed();
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(false);
  });

  it("takes the note's canvas with it", async () => {
    const n = await trashed();
    await a.upsertCanvases([
      { id: n.id, items: [], strokes: [], image_widths: {}, text_elements: [], created_at: at(0), updated_at: at(0) },
    ]);
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    expect((await a.pullCanvases(EPOCH, 500)).map((c) => c.id)).not.toContain(n.id);
  });
});

describe("tombstones", () => {
  it("records every permanent delete, stamped with the server's clock", async () => {
    const n = await trashed();
    const before = Date.now();
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    const after = Date.now();
    const stone = (await a.pullTombstones(EPOCH, 500)).find((t) => t.note_id === n.id);
    expect(stone).toBeDefined();
    const deletedMs = Number(micros(stone!.deleted_at) / 1000n);
    expect(deletedMs).toBeGreaterThanOrEqual(before - 5_000);
    expect(deletedMs).toBeLessThanOrEqual(after + 5_000);
    const changes = await a.pullChanges({ notes: EPOCH, tombstones: EPOCH, folders: EPOCH, limit: 500 });
    expect(changes.tombstones.map((t) => t.note_id)).toContain(n.id);
    expect(changes.notes.map((r) => r.id)).not.toContain(n.id);
  });

  it("refuses, as a row, any upload that would bring a destroyed note back", async () => {
    const n = await trashed();
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    const error = await refusal(a.upsertNotes([{ ...n, status: "active", updated_at: at(9_000), field_updated_at: clocksAt(at(9_000)) }]));
    expect(error.kind).toBe("row-refused");
    expect(await a.notesById([n.id])).toEqual([]);
  });

  it("makes a narrow patch of a destroyed note a no-op that creates nothing", async () => {
    const n = await trashed();
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    await a.patchNote(n.id, { status: "trashed", updated_at: n.updated_at });
    expect(await a.notesById([n.id])).toEqual([]);
  });

  it("is kept for a year", async () => {
    const n = await trashed();
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    await driver.server.backdateTombstone(n.id, iso(Date.now() - 364 * 86_400_000));
    await driver.server.pruneTombstones();
    expect((await a.pullTombstones(EPOCH, 500)).map((t) => t.note_id)).toContain(n.id);
    await refusal(a.upsertNotes([n]));
  });

  it("is forgotten after a year, and the note may then be uploaded again", async () => {
    const n = await trashed();
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    await driver.server.backdateTombstone(n.id, iso(Date.now() - 366 * 86_400_000));
    expect(await driver.server.pruneTombstones()).toBeGreaterThanOrEqual(1);
    expect((await a.pullTombstones(EPOCH, 500)).map((t) => t.note_id)).not.toContain(n.id);
    await a.upsertNotes([n]);
    expect((await a.notesById([n.id])).length).toBe(1);
  });
});
