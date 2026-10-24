/**
 * Contract: "Notes" — creating, reading, the immutable capture, and the body
 * that defaults to it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BackendError, type FieldClocks, type NoteRow, type Session } from "./driver";
import { at, clocksAt, itUnless, micros, note, sameInstant, useDriver, users, uuid } from "./support";

const driver = useDriver();
let a: Session;

beforeAll(async () => {
  [a] = await users(driver, 1);
});

async function refusal(promise: Promise<unknown>): Promise<BackendError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BackendError) return error;
    throw error;
  }
  throw new Error("expected the backend to refuse, and it accepted");
}

function one(rows: NoteRow[], id: string): NoteRow {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`note ${id} not returned`);
  return row;
}

describe("creating and reading notes", () => {
  it("reads back every column as it was sent", async () => {
    const board = uuid();
    const merged = uuid();
    const sent = note({
      raw_content: "Buy oat milk",
      body: "Buy oat milk and bread",
      source: "share",
      note_type: "todo",
      board_id: board,
      status: "archived",
      priority: 1,
      reminder_at: at(3_600_000),
      reminder_repeat: "weekly",
      done: null,
      merged_from: [merged],
      merged_into: null,
      keep_id: `keep-${uuid()}`,
      attachments: [{ id: "a1", name: "x.png", mime: "image/png", size: 3, path: null, thumb: null }],
      link_previews: [{ href: "https://example.com/", title: "Example", gone: true, checked_at: "2026-09-01T00:00:00.000Z", hidden: true }],
    });
    await a.upsertNotes([sent]);
    const got = one(await a.notesById([sent.id]), sent.id);
    expect(got.raw_content).toBe(sent.raw_content);
    expect(got.body).toBe(sent.body);
    expect(got.source).toBe("share");
    expect(got.note_type).toBe("todo");
    expect(got.board_id).toBe(board);
    expect(got.status).toBe("archived");
    expect(got.priority).toBe(1);
    expect(sameInstant(got.reminder_at, sent.reminder_at)).toBe(true);
    expect(got.reminder_repeat).toBe("weekly");
    expect(got.done).toBeNull();
    expect(got.merged_from).toEqual([merged]);
    expect(got.merged_into).toBeNull();
    expect(got.keep_id).toBe(sent.keep_id);
    expect(got.attachments).toEqual(sent.attachments);
    expect(got.link_previews).toEqual(sent.link_previews);
    expect(got.field_updated_at).toEqual(sent.field_updated_at);
    expect(sameInstant(got.created_at, sent.created_at)).toBe(true);
    expect(sameInstant(got.updated_at, sent.updated_at)).toBe(true);
  });

  it("keeps a client's stamps on insert exactly, even ones far in the past", async () => {
    const sent = note({ updated_at: "2019-05-01T08:00:00.123Z", created_at: "2018-01-01T00:00:00.000Z" });
    await a.upsertNotes([sent]);
    const got = one(await a.notesById([sent.id]), sent.id);
    expect(micros(got.updated_at)).toBe(micros("2019-05-01T08:00:00.123Z"));
    expect(micros(got.created_at)).toBe(micros("2018-01-01T00:00:00.000Z"));
  });

  it("stores the list columns empty, never null, when a note carries nothing", async () => {
    const sent = note();
    await a.upsertNotes([sent]);
    const got = one(await a.notesById([sent.id]), sent.id);
    expect(got.attachments).toEqual([]);
    expect(got.link_previews).toEqual([]);
  });

  it("returns only the ids that exist and are the caller's", async () => {
    const sent = note();
    await a.upsertNotes([sent]);
    const got = await a.notesById([sent.id, uuid()]);
    expect(got.map((r) => r.id)).toEqual([sent.id]);
  });

  it("answers noteState with status and clocks, and null for a note it does not hold", async () => {
    const sent = note({ status: "trashed" });
    await a.upsertNotes([sent]);
    const state = await a.noteState(sent.id);
    expect(state).toEqual({ id: sent.id, status: "trashed", field_updated_at: sent.field_updated_at });
    expect(await a.noteState(uuid())).toBeNull();
  });
});

describe("the body defaults to the capture", () => {
  it("fills an empty body from raw_content on insert", async () => {
    const sent = note({ raw_content: "the original words", body: "" });
    await a.upsertNotes([sent]);
    expect(one(await a.notesById([sent.id]), sent.id).body).toBe("the original words");
  });

  it("does not touch a body that was sent", async () => {
    const sent = note({ raw_content: "original", body: "edited" });
    await a.upsertNotes([sent]);
    expect(one(await a.notesById([sent.id]), sent.id).body).toBe("edited");
  });

  it("lets a narrow update empty the body: an emptied note is the user's choice", async () => {
    const sent = note({ raw_content: "words", body: "words" });
    await a.upsertNotes([sent]);
    await a.patchNote(sent.id, { body: "", field_updated_at: { ...(sent.field_updated_at as FieldClocks), body: at(5_000) } });
    expect(one(await a.notesById([sent.id]), sent.id).body).toBe("");
  });

  itUnless(driver, "upsert-cannot-empty-body")(
    "lets an upsert empty an existing note's body, as it may change it to anything else",
    async () => {
      const sent = note({ raw_content: "words", body: "words" });
      await a.upsertNotes([sent]);
      const later = at(5_000);
      await a.upsertNotes([
        { ...sent, body: "", updated_at: later, field_updated_at: { ...clocksAt(sent.updated_at), body: later } },
      ]);
      expect(one(await a.notesById([sent.id]), sent.id).body).toBe("");
    },
  );
});

describe("raw_content is immutable", () => {
  it("refuses an upsert naming a different raw_content, as a refusal of that row", async () => {
    const sent = note({ raw_content: "first capture" });
    await a.upsertNotes([sent]);
    const error = await refusal(
      a.upsertNotes([{ ...sent, raw_content: "rewritten", body: "rewritten", updated_at: at(9_000) }]),
    );
    expect(error.kind).toBe("row-refused");
    const got = one(await a.notesById([sent.id]), sent.id);
    expect(got.raw_content).toBe("first capture");
    expect(got.body).toBe("first capture");
    expect(sameInstant(got.updated_at, sent.updated_at)).toBe(true);
  });

  it("refuses a narrow update of raw_content too", async () => {
    const sent = note({ raw_content: "kept" });
    await a.upsertNotes([sent]);
    const error = await refusal(a.patchNote(sent.id, { raw_content: "changed" } as never));
    expect(error.kind).toBe("row-refused");
    expect(one(await a.notesById([sent.id]), sent.id).raw_content).toBe("kept");
  });

  it("accepts every other edit alongside an unchanged raw_content", async () => {
    const sent = note({ raw_content: "kept" });
    await a.upsertNotes([sent]);
    const later = at(1_000);
    await a.upsertNotes([{ ...sent, body: "kept, and more", updated_at: later, field_updated_at: clocksAt(later) }]);
    const got = one(await a.notesById([sent.id]), sent.id);
    expect(got.raw_content).toBe("kept");
    expect(got.body).toBe("kept, and more");
  });
});

describe("an upload is one statement", () => {
  it("refuses a whole batch when one row in it is refused, and stores none of it", async () => {
    const good = note();
    const existing = note({ raw_content: "stays" });
    await a.upsertNotes([existing]);
    const bad = { ...existing, raw_content: "changed", updated_at: at(2_000) };
    const error = await refusal(a.upsertNotes([good, bad]));
    expect(error.kind).toBe("row-refused");
    expect(await a.notesById([good.id])).toEqual([]);
  });

  it("stores a batch whole when every row is acceptable", async () => {
    const batch = [note(), note(), note()];
    await a.upsertNotes(batch);
    expect((await a.notesById(batch.map((n) => n.id))).length).toBe(3);
  });

  it("stores a note sent twice once", async () => {
    const sent = note();
    await a.upsertNotes([sent]);
    await a.upsertNotes([sent]);
    expect((await a.notesById([sent.id])).length).toBe(1);
  });
});

describe("the narrow patch", () => {
  it("changes the named columns and nothing else", async () => {
    const sent = note({ body: "unchanged", raw_content: "unchanged", status: "active" });
    await a.upsertNotes([sent]);
    const clocks = { ...(sent.field_updated_at as FieldClocks), status: at(4_000) };
    await a.patchNote(sent.id, { status: "trashed", updated_at: at(4_000), field_updated_at: clocks });
    const got = one(await a.notesById([sent.id]), sent.id);
    expect(got.status).toBe("trashed");
    expect(got.body).toBe("unchanged");
    expect(got.field_updated_at).toEqual(clocks);
  });

  it("never creates a note that does not exist", async () => {
    const id = uuid();
    await a.patchNote(id, { status: "trashed", updated_at: at(0) });
    expect(await a.notesById([id])).toEqual([]);
  });
});

describe("columns outside the merge set", () => {
  it("are taken as sent on every accepted write: source, created_at, keep_id", async () => {
    const sent = note({ source: "web", keep_id: null });
    await a.upsertNotes([sent]);
    const later = at(1_000);
    const keep = `keep-${uuid()}`;
    await a.upsertNotes([
      { ...sent, source: "import", keep_id: keep, created_at: at(-50_000), updated_at: later },
    ]);
    const got = one(await a.notesById([sent.id]), sent.id);
    expect(got.source).toBe("import");
    expect(got.keep_id).toBe(keep);
    expect(sameInstant(got.created_at, at(-50_000))).toBe(true);
  });

  it("refuses, as a row, a second note of the same user carrying a keep_id already taken", async () => {
    const keep = `keep-${uuid()}`;
    await a.upsertNotes([note({ keep_id: keep })]);
    const error = await refusal(a.upsertNotes([note({ keep_id: keep })]));
    expect(error.kind).toBe("row-refused");
  });

  itUnless(driver, "keep-id-unique-across-users")(
    "lets two users each import a note with the same keep_id: it is unique per user",
    async () => {
      const [b] = await users(driver, 1);
      const keep = `keep-${uuid()}`;
      await a.upsertNotes([note({ keep_id: keep })]);
      const theirs = note({ keep_id: keep });
      await b.upsertNotes([theirs]);
      expect((await b.notesById([theirs.id]))[0]?.keep_id).toBe(keep);
    },
  );
});
