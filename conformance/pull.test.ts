/**
 * Contract: "Pulling changes: cursors" — the keyset every pull is, the ties it
 * breaks, and the combined pull that answers four questions at once.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { CanvasRow, Cursor, NoteRow, Session, TombstoneRow } from "./driver";
import { at, micros, note, useDriver, users } from "./support";

const driver = useDriver();
const EPOCH: Cursor = { at: "1970-01-01T00:00:00.000Z", id: null };

/** `(updated_at, id)` order: the instant, then the id's canonical text. */
function ordered<T>(rows: T[], time: (row: T) => string, id: (row: T) => string): boolean {
  for (let i = 1; i < rows.length; i++) {
    const t0 = micros(time(rows[i - 1]));
    const t1 = micros(time(rows[i]));
    if (t1 < t0) return false;
    if (t1 === t0 && !(id(rows[i]) > id(rows[i - 1]))) return false;
  }
  return true;
}

function canvas(id: string, stamp: string): CanvasRow {
  return { id, items: [], strokes: [], image_widths: {}, text_elements: [], created_at: stamp, updated_at: stamp };
}

/** Walks a keyset to its end the way the client does, a page at a time. */
async function walk<T>(
  page: (after: Cursor, limit: number) => Promise<T[]>,
  time: (row: T) => string,
  id: (row: T) => string,
  limit: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor = EPOCH;
  for (let turns = 0; turns < 100; turns++) {
    const rows = await page(cursor, limit);
    out.push(...rows);
    if (rows.length < limit) break;
    const last = rows[rows.length - 1];
    cursor = { at: time(last), id: id(last) };
  }
  return out;
}

describe("the notes keyset", () => {
  let a: Session;
  const tied = at(10_000);
  const ids: string[] = [];

  beforeAll(async () => {
    [a] = await users(driver, 1);
    // Five notes sharing one stamp, and one either side of them.
    const rows = [note({ updated_at: at(5_000) }), note({ updated_at: at(20_000) })];
    for (let i = 0; i < 5; i++) rows.push(note({ updated_at: tied }));
    await a.upsertNotes(rows);
    ids.push(...rows.map((r) => r.id));
  });

  it("orders by updated_at, then by id", async () => {
    const rows = await a.pullNotes(EPOCH, 500);
    expect(rows.length).toBe(7);
    expect(ordered(rows, (r) => r.updated_at, (r) => r.id)).toBe(true);
  });

  it("reads strictly after the stamp when the cursor has no id", async () => {
    const rows = await a.pullNotes({ at: tied, id: null }, 500);
    expect(rows.map((r) => micros(r.updated_at))).toEqual([micros(at(20_000))]);
  });

  it("reads the rest of a tie, then what follows, when the cursor carries an id", async () => {
    const all = await a.pullNotes(EPOCH, 500);
    const tie = all.filter((r) => micros(r.updated_at) === micros(tied));
    const after = await a.pullNotes({ at: tie[1].updated_at, id: tie[1].id }, 500);
    expect(after.map((r) => r.id)).toEqual([...tie.slice(2).map((r) => r.id), all[all.length - 1].id]);
  });

  it("walks every note exactly once, a page at a time, however the pages cut a tie", async () => {
    for (const limit of [1, 2, 3, 4]) {
      const rows = await walk((c, l) => a.pullNotes(c, l), (r) => r.updated_at, (r) => r.id, limit);
      expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
    }
  });

  it("accepts a cursor in the server's own spelling as well as a client's", async () => {
    const [first] = await a.pullNotes(EPOCH, 1);
    // The server spells it `…+00:00`; a client that saved `…Z` must mean the same.
    const zulu = new Date(Number(micros(first.updated_at) / 1000n)).toISOString();
    const server = await a.pullNotes({ at: first.updated_at, id: first.id }, 500);
    const client = await a.pullNotes({ at: zulu, id: first.id }, 500);
    expect(client.map((r) => r.id)).toEqual(server.map((r) => r.id));
  });

  it("returns trashed and archived notes like any other", async () => {
    const [x, y] = [note({ status: "trashed", updated_at: at(30_000) }), note({ status: "archived", updated_at: at(30_001) })];
    await a.upsertNotes([x, y]);
    const rows = await a.pullNotes({ at: at(25_000), id: null }, 500);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      [x.id, "trashed"],
      [y.id, "archived"],
    ]);
  });

  it("returns a note again once an update moves it past the cursor", async () => {
    const [first] = await a.pullNotes(EPOCH, 1);
    const cursor = { at: at(40_000), id: null };
    expect((await a.pullNotes(cursor, 500)).map((r) => r.id)).not.toContain(first.id);
    const full = (await a.notesById([first.id]))[0];
    await a.upsertNotes([{ ...full, body: "moved on", updated_at: at(41_000), field_updated_at: { ...full.field_updated_at, body: at(41_000) } }]);
    expect((await a.pullNotes(cursor, 500)).map((r) => r.id)).toContain(first.id);
  });
});

describe("the tombstone keyset", () => {
  it("orders by deleted_at, then note_id, and pages without loss", async () => {
    const [a] = await users(driver, 1);
    const doomed = Array.from({ length: 5 }, () => note({ status: "trashed" }));
    await a.upsertNotes(doomed);
    for (const n of doomed) expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    // Force a tie: several deletes at one instant.
    const tie = "2020-01-01T00:00:00.000Z";
    for (const n of doomed.slice(0, 3)) await driver.server.backdateTombstone(n.id, tie);
    const all = await a.pullTombstones(EPOCH, 500);
    expect(all.length).toBe(5);
    expect(ordered(all, (t) => t.deleted_at, (t) => t.note_id)).toBe(true);
    expect((await a.pullTombstones({ at: tie, id: null }, 500)).length).toBe(2);
    for (const limit of [1, 2]) {
      const walked = await walk<TombstoneRow>((c, l) => a.pullTombstones(c, l), (t) => t.deleted_at, (t) => t.note_id, limit);
      expect(walked.map((t) => t.note_id).sort()).toEqual(doomed.map((n) => n.id).sort());
    }
  });
});

describe("the canvas keyset", () => {
  let a: Session;
  const tied = at(10_000);
  const ideas: string[] = [];

  beforeAll(async () => {
    [a] = await users(driver, 1);
    const notes = Array.from({ length: 4 }, () => note());
    await a.upsertNotes(notes);
    ideas.push(...notes.map((n) => n.id));
    await a.upsertCanvases([
      canvas(notes[0].id, at(5_000)),
      canvas(notes[1].id, tied),
      canvas(notes[2].id, tied),
      canvas(notes[3].id, at(20_000)),
    ]);
  });

  it("reads from the stamp inclusive when the cursor has no id", async () => {
    const rows = await a.pullCanvases({ at: tied, id: null }, 500);
    expect(rows.length).toBe(3);
    expect(ordered(rows, (r) => r.updated_at, (r) => r.id)).toBe(true);
  });

  it("reads strictly after (stamp, id) when the cursor carries an id", async () => {
    const all = await a.pullCanvases(EPOCH, 500);
    const tie = all.filter((r) => micros(r.updated_at) === micros(tied));
    const after = await a.pullCanvases({ at: tie[0].updated_at, id: tie[0].id }, 500);
    expect(after.map((r) => r.id)).toEqual([tie[1].id, all[3].id]);
  });

  it("walks every canvas exactly once", async () => {
    for (const limit of [1, 2, 3]) {
      const rows = await walk((c, l) => a.pullCanvases(c, l), (r) => r.updated_at, (r) => r.id, limit);
      // The first page is inclusive and every later one carries an id, so a
      // walk never repeats a row.
      expect(rows.map((r) => r.id).sort()).toEqual([...ideas].sort());
    }
  });
});

describe("the combined pull", () => {
  it("answers exactly what the three separate pulls and the prefs read answer", async () => {
    const [a] = await users(driver, 1);
    const notes = [note({ updated_at: at(1_000) }), note({ updated_at: at(2_000) }), note({ status: "trashed", updated_at: at(3_000) })];
    await a.upsertNotes(notes);
    await a.upsertCanvases([canvas(notes[0].id, at(1_500))]);
    expect(await a.permanentlyDeleteNote(notes[2].id, notes[2].updated_at)).toBe(true);
    await a.upsertPrefs({ boards: [{ id: "x", name: "Recipes" }], inbox_since: at(0), updated_at: at(4_000) });

    const cursors = { notes: EPOCH, tombstones: EPOCH, folders: EPOCH, limit: 500 };
    const changes = await a.pullChanges(cursors);
    const sameIds = (x: { id?: string; note_id?: string }[], y: { id?: string; note_id?: string }[]) =>
      expect(x.map((r) => r.id ?? r.note_id)).toEqual(y.map((r) => r.id ?? r.note_id));
    sameIds(changes.notes, await a.pullNotes(EPOCH, 500));
    sameIds(changes.tombstones, await a.pullTombstones(EPOCH, 500));
    sameIds(changes.folders, await a.pullCanvases(EPOCH, 500));
    expect(changes.prefs).toEqual(await a.readPrefs());
  });

  it("carries every column a client reads on each row, and no owner", async () => {
    const [a] = await users(driver, 1);
    const n = note();
    await a.upsertNotes([n]);
    await a.upsertCanvases([canvas(n.id, at(0))]);
    const changes = await a.pullChanges({ notes: EPOCH, tombstones: EPOCH, folders: EPOCH, limit: 500 });
    const row = changes.notes[0] as NoteRow & Record<string, unknown>;
    for (const key of Object.keys(n)) expect(row).toHaveProperty(key);
    expect(row).not.toHaveProperty("owner_id");
    const folder = changes.folders[0] as CanvasRow & Record<string, unknown>;
    for (const key of ["id", "items", "strokes", "image_widths", "text_elements", "created_at", "updated_at"]) {
      expect(folder).toHaveProperty(key);
    }
    expect(folder).not.toHaveProperty("owner_id");
  });

  it("answers null prefs for a user who has none", async () => {
    const [a] = await users(driver, 1);
    expect((await a.pullChanges({ notes: EPOCH, tombstones: EPOCH, folders: EPOCH, limit: 500 })).prefs).toBeNull();
  });

  it("limits each list separately, and pages each by its own cursor", async () => {
    const [a] = await users(driver, 1);
    const notes = [note({ updated_at: at(1_000) }), note({ updated_at: at(2_000) }), note({ updated_at: at(3_000) })];
    await a.upsertNotes(notes);
    await a.upsertCanvases(notes.map((n, i) => canvas(n.id, at(1_000 * (i + 1)))));
    const first = await a.pullChanges({ notes: EPOCH, tombstones: EPOCH, folders: EPOCH, limit: 2 });
    expect(first.notes.length).toBe(2);
    expect(first.folders.length).toBe(2);
    const lastNote = first.notes[1];
    const lastFolder = first.folders[1];
    const second = await a.pullChanges({
      notes: { at: lastNote.updated_at, id: lastNote.id },
      tombstones: EPOCH,
      folders: { at: lastFolder.updated_at, id: lastFolder.id },
      limit: 2,
    });
    expect(second.notes.map((r) => r.id)).toEqual([notes[2].id]);
    expect(second.folders.map((r) => r.id)).toEqual([notes[2].id]);
  });

  it("reads the notes strictly after, and the canvases from, a cursor with no id", async () => {
    const [a] = await users(driver, 1);
    const n = note({ updated_at: at(1_000) });
    await a.upsertNotes([n]);
    await a.upsertCanvases([canvas(n.id, at(1_000))]);
    const changes = await a.pullChanges({
      notes: { at: at(1_000), id: null },
      tombstones: EPOCH,
      folders: { at: at(1_000), id: null },
      limit: 500,
    });
    expect(changes.notes).toEqual([]);
    expect(changes.folders.map((f) => f.id)).toEqual([n.id]);
  });
});
