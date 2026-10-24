/**
 * Contract: "Per-field last-write-wins" — how the server merges an upload into
 * the note it already holds.
 */
import { isDeepStrictEqual } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import type { NoteRow, NoteWrite, Session } from "./driver";
import { MERGE_FIELDS, at, clocksAt, note, sameInstant, useDriver, users, uuid, type MergeField } from "./support";

const driver = useDriver();
let a: Session;

beforeAll(async () => {
  [a] = await users(driver, 1);
});

const T1 = at(1_000);
const T2 = at(2_000);
const T3 = at(3_000);

async function read(id: string): Promise<NoteRow> {
  const [row] = await a.notesById([id]);
  if (!row) throw new Error(`note ${id} missing`);
  return row;
}

/** A note stored with every clock at T2, ready to be raced against. */
async function seeded(overrides: Partial<NoteWrite> = {}): Promise<NoteWrite> {
  const stored = note({ updated_at: T2, field_updated_at: clocksAt(T2), body: "stored", raw_content: "stored", ...overrides });
  await a.upsertNotes([stored]);
  return stored;
}

/** A second value for each merge field, different from `note()`'s default. */
function otherValue(field: MergeField): unknown {
  switch (field) {
    case "body":
      return "incoming";
    case "note_type":
      return "todo";
    case "board_id":
      return uuid();
    case "status":
      return "archived";
    case "priority":
      return 1;
    case "reminder_at":
      return at(86_400_000);
    case "reminder_repeat":
      return "daily";
    case "done":
      return true;
    case "merged_from":
      return [uuid()];
    case "merged_into":
      return uuid();
    case "attachments":
      return [{ id: "att", name: "f.pdf", mime: "application/pdf", size: 1, path: null, thumb: null }];
    case "link_previews":
      return [{ href: "https://example.com/", title: "t" }];
  }
}

function equalValue(field: MergeField, a: unknown, b: unknown): boolean {
  if (field === "reminder_at") return sameInstant(a as string | null, b as string | null);
  return isDeepStrictEqual(a, b);
}

describe("each field in the merge set is decided by its own clock", () => {
  for (const field of MERGE_FIELDS) {
    it(`${field}: a newer clock wins the value and the clock`, async () => {
      const stored = await seeded();
      const value = otherValue(field);
      await a.upsertNotes([
        { ...stored, [field]: value, updated_at: T3, field_updated_at: { ...clocksAt(T2), [field]: T3 } },
      ]);
      const got = await read(stored.id);
      expect(equalValue(field, got[field], value)).toBe(true);
      expect(got.field_updated_at[field]).toBe(T3);
    });

    it(`${field}: an older clock loses, and the stored value and clock stay`, async () => {
      const stored = await seeded();
      await a.upsertNotes([
        { ...stored, [field]: otherValue(field), updated_at: T3, field_updated_at: { ...clocksAt(T2), [field]: T1 } },
      ]);
      const got = await read(stored.id);
      expect(equalValue(field, got[field], stored[field])).toBe(true);
      expect(got.field_updated_at[field]).toBe(T2);
    });

    it(`${field}: an equal clock loses`, async () => {
      const stored = await seeded();
      // Some other clock has to move, or the whole map is equal to the stored
      // one and the write is taken whole (see "the edges of the merge").
      const mover = field === "note_type" ? "done" : "note_type";
      await a.upsertNotes([
        { ...stored, [field]: otherValue(field), updated_at: T3, field_updated_at: { ...clocksAt(T2), [mover]: T3, [field]: T2 } },
      ]);
      const got = await read(stored.id);
      expect(equalValue(field, got[field], stored[field])).toBe(true);
    });
  }
});

describe("the edges of the merge", () => {
  it("decides fields independently within one write", async () => {
    const stored = await seeded({ status: "active", priority: 0 });
    await a.upsertNotes([
      {
        ...stored,
        body: "newer words",
        status: "trashed",
        priority: 1,
        updated_at: T3,
        field_updated_at: { ...clocksAt(T2), body: T3, status: T1, priority: T3 },
      },
    ]);
    const got = await read(stored.id);
    expect(got.body).toBe("newer words");
    expect(got.status).toBe("active");
    expect(got.priority).toBe(1);
    expect(got.field_updated_at).toEqual({ ...clocksAt(T2), body: T3, priority: T3 });
  });

  it("leaves the stored clock map as the per-field maximum of the two", async () => {
    const stored = await seeded({ field_updated_at: { ...clocksAt(T2), body: T1, status: T3 } });
    await a.upsertNotes([
      { ...stored, body: "b", status: "archived", updated_at: T3, field_updated_at: { ...clocksAt(T2), body: T2, status: T2 } },
    ]);
    const got = await read(stored.id);
    expect(got.field_updated_at.body).toBe(T2);
    expect(got.field_updated_at.status).toBe(T3);
    expect(got.body).toBe("b");
    expect(got.status).toBe(stored.status);
  });

  it("gives a field the server holds no clock for to any write that carries one", async () => {
    // An imported note: no clocks at all.
    const stored = await seeded({ field_updated_at: {} });
    await a.upsertNotes([
      { ...stored, body: "first edit", updated_at: T3, field_updated_at: { body: T1 } },
    ]);
    const got = await read(stored.id);
    expect(got.body).toBe("first edit");
    expect(got.field_updated_at).toEqual({ body: T1 });
  });

  it("treats a null clock as older than anything: the field keeps its value and clock", async () => {
    const stored = await seeded();
    await a.upsertNotes([
      { ...stored, body: "incoming", updated_at: T3, field_updated_at: { ...clocksAt(T2), body: null } },
    ]);
    const got = await read(stored.id);
    expect(got.body).toBe("stored");
    expect(got.field_updated_at.body).toBe(T2);
  });

  it("drops a null clock for a field that had none, and keeps the stored value", async () => {
    const stored = await seeded({ field_updated_at: { status: T2 } });
    await a.upsertNotes([
      { ...stored, body: "incoming", updated_at: T3, field_updated_at: { status: T2, body: null } },
    ]);
    const got = await read(stored.id);
    expect(got.body).toBe("stored");
    expect(got.field_updated_at).toEqual({ status: T2 });
  });

  it("writes a merge field sent without its clock unconditionally, and forgets that field's clock", async () => {
    const stored = await seeded();
    const { body: _dropped, ...rest } = clocksAt(T2);
    void _dropped;
    await a.upsertNotes([{ ...stored, body: "unclocked", updated_at: T3, field_updated_at: { ...rest, status: T3 } }]);
    const got = await read(stored.id);
    expect(got.body).toBe("unclocked");
    expect("body" in got.field_updated_at).toBe(false);
  });

  it("takes a write whole when its clock map equals the stored one", async () => {
    // Nothing in the clocks moved, so nothing is merged: the row is taken as sent.
    const stored = await seeded();
    await a.upsertNotes([
      { ...stored, body: "same clocks, other words", status: "archived", updated_at: T3, field_updated_at: clocksAt(T2) },
    ]);
    const got = await read(stored.id);
    expect(got.body).toBe("same clocks, other words");
    expect(got.status).toBe("archived");
    expect(got.field_updated_at).toEqual(clocksAt(T2));
  });

  it("takes a write that carries no clock map at all whole, and keeps the stored clocks", async () => {
    // What a client without per-field clocks sends: plain last-write-wins.
    const stored = await seeded();
    const legacy: Partial<NoteWrite> = { ...stored, body: "legacy client", updated_at: T3 };
    delete legacy.field_updated_at;
    await a.upsertNotes([legacy as NoteWrite]);
    const got = await read(stored.id);
    expect(got.body).toBe("legacy client");
    expect(got.field_updated_at).toEqual(clocksAt(T2));
  });

  it("keeps the whole clock map of a brand-new note as it was sent", async () => {
    const clocks = { ...clocksAt(T1), body: T3 };
    const sent = note({ field_updated_at: clocks });
    await a.upsertNotes([sent]);
    expect((await read(sent.id)).field_updated_at).toEqual(clocks);
  });

  it("moves updated_at forward on a write even when every field lost", async () => {
    const stored = await seeded();
    await a.upsertNotes([
      { ...stored, body: "loses", updated_at: T3, field_updated_at: { ...clocksAt(T1) } },
    ]);
    const got = await read(stored.id);
    expect(got.body).toBe("stored");
    expect(sameInstant(got.updated_at, T3)).toBe(true);
  });
});
