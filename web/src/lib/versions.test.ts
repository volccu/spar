import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import { editedAt, fieldClocks, mergeNoteFields, remoteIsNewer, wasEdited } from "./versions";
import { note as base } from "../test/fixtures";

const note = (over: Partial<Note> = {}): Note =>
  base({
    raw_content: "hello",
    body: "hello",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...over,
  });


describe("deciding which copy of a note is newer", () => {
  it("asks the field clocks when both sides have some", () => {
    const local = note({
      updated_at: "2026-08-05T00:00:00.000Z",
      field_updated_at: { body: "2026-08-05T00:00:00.000Z" },
    });
    const remote = note({
      updated_at: "2026-08-02T00:00:00.000Z",
      field_updated_at: { priority: "2026-08-04T00:00:00.000Z" },
    });
    // The remote is older overall and still carries a field this device has
    // never seen. Whole-row last-write-wins would throw that away.
    expect(remoteIsNewer(local, remote)).toBe(true);
  });

  it("does not take a remote row back that says nothing new", () => {
    const clocks = { body: "2026-08-05T00:00:00.000Z" };
    const local = note({ updated_at: "2026-08-05T00:00:00.000Z", field_updated_at: clocks });
    const remote = note({ updated_at: "2026-08-05T00:00:00.000Z", field_updated_at: { ...clocks } });
    expect(remoteIsNewer(local, remote)).toBe(false);
  });

  /**
   * The state 267 of the 276 rows in the live archive are actually in: written
   * before migration 0011, so `field_updated_at` is the column default `{}`.
   *
   * Read as a statement about fields, an empty object finds nothing newer and
   * the row is dropped — for ever, whatever the server does to it afterwards.
   * That is not caution, it is a device that has quietly stopped receiving.
   */
  it("falls back to updated_at when the server row carries no clocks", () => {
    const local = note({
      updated_at: "2026-08-01T00:00:00.000Z",
      field_updated_at: { body: "2026-08-01T00:00:00.000Z" },
    });
    const remote = note({ updated_at: "2026-08-09T00:00:00.000Z", field_updated_at: {} });
    expect(remoteIsNewer(local, remote)).toBe(true);
  });

  it("still refuses an older row that carries no clocks", () => {
    const local = note({
      updated_at: "2026-08-09T00:00:00.000Z",
      field_updated_at: { body: "2026-08-09T00:00:00.000Z" },
    });
    const remote = note({ updated_at: "2026-08-01T00:00:00.000Z", field_updated_at: {} });
    expect(remoteIsNewer(local, remote)).toBe(false);
  });

  it("falls back when this device has no clocks either", () => {
    const local = note({ updated_at: "2026-08-01T00:00:00.000Z" });
    const remote = note({ updated_at: "2026-08-02T00:00:00.000Z" });
    expect(remoteIsNewer(local, remote)).toBe(true);
  });

  /**
   * The case that kept the screen behind the store: a merge keeps the later of
   * the two stamps, so when this device held it the merged note comes back with
   * an `updated_at` identical to the local one. Compared with `>` it looked like
   * nothing had happened, and the other device's edit was never drawn.
   */
  it("accepts a merged note whose updated_at did not move", () => {
    const local = note({
      updated_at: "2026-08-05T00:00:00.000Z",
      field_updated_at: { body: "2026-08-05T00:00:00.000Z" },
    });
    const remote = note({
      body: "theirs",
      updated_at: "2026-08-03T00:00:00.000Z",
      field_updated_at: { tags: "2026-08-03T00:00:00.000Z" },
    });
    const merged = mergeNoteFields(local, remote);
    expect(merged.updated_at).toBe(local.updated_at);
    expect(remoteIsNewer(local, merged)).toBe(true);
  });
});

describe("inventing clocks for a note that has none", () => {
  it("stamps every field with updated_at", () => {
    const clocks = fieldClocks(note({ updated_at: "2026-08-07T00:00:00.000Z" }));
    expect(clocks.body).toBe("2026-08-07T00:00:00.000Z");
    expect(clocks.priority).toBe("2026-08-07T00:00:00.000Z");
  });

  it("treats the empty column default as no clocks at all", () => {
    const clocks = fieldClocks(
      note({ updated_at: "2026-08-07T00:00:00.000Z", field_updated_at: {} }),
    );
    expect(clocks.body).toBe("2026-08-07T00:00:00.000Z");
  });

  it("keeps real clocks, and does not hand back the note's own object", () => {
    const stored = { body: "2026-08-06T00:00:00.000Z" };
    const clocks = fieldClocks(note({ field_updated_at: stored }));
    expect(clocks).toEqual(stored);
    expect(clocks).not.toBe(stored);
  });
});

describe("merging two copies field by field", () => {
  it("keeps each side's newer field and carries the clocks forward", () => {
    const local = note({
      body: "mine",
      priority: 0,
      updated_at: "2026-08-05T00:00:00.000Z",
      field_updated_at: {
        body: "2026-08-05T00:00:00.000Z",
        priority: "2026-08-01T00:00:00.000Z",
      },
    });
    const remote = note({
      body: "theirs",
      priority: 1,
      updated_at: "2026-08-04T00:00:00.000Z",
      field_updated_at: {
        body: "2026-08-02T00:00:00.000Z",
        priority: "2026-08-04T00:00:00.000Z",
      },
    });
    const merged = mergeNoteFields(local, remote);
    expect(merged.body).toBe("mine");
    expect(merged.priority).toBe(1);
    expect(merged.field_updated_at?.body).toBe("2026-08-05T00:00:00.000Z");
    expect(merged.field_updated_at?.priority).toBe("2026-08-04T00:00:00.000Z");
  });
});

describe("when a note was last edited", () => {
  const born = "2026-03-01T09:00:00.000Z";

  it("is the creation date for a note nobody has touched", () => {
    const n = note({ created_at: born, updated_at: born });
    expect(editedAt(n)).toBe(born);
    expect(wasEdited(n)).toBe(false);
  });

  it("follows the words", () => {
    const n = note({
      created_at: born,
      updated_at: "2026-08-14T12:00:00.000Z",
      field_updated_at: { body: "2026-08-14T12:00:00.000Z" },
    });
    expect(editedAt(n)).toBe("2026-08-14T12:00:00.000Z");
    expect(wasEdited(n)).toBe(true);
  });

  it("is not edited by the files it was written with (their clock is its own instant)", () => {
    const n = note({
      created_at: born,
      updated_at: born,
      field_updated_at: { body: born, attachments: born },
    });
    expect(editedAt(n)).toBe(born);
    expect(wasEdited(n)).toBe(false);
  });

  it("counts words changed seconds after the note was written", () => {
    const after = (ms: number) => new Date(Date.parse(born) + ms).toISOString();
    for (const ms of [1, 30_000, 59_000]) {
      expect(wasEdited(note({ created_at: born, field_updated_at: { body: after(ms) } }))).toBe(true);
      expect(
        wasEdited(note({ created_at: born, field_updated_at: { body: after(ms), attachments: born } })),
      ).toBe(true);
    }
  });

  it("is not edited by its own files' upload landing, which moves their clock a moment later", () => {
    const after = (ms: number) => new Date(Date.parse(born) + ms).toISOString();
    for (const ms of [1, 3_000, 59_000]) {
      expect(
        wasEdited(note({ created_at: born, field_updated_at: { body: born, attachments: after(ms) } })),
      ).toBe(false);
    }
    expect(
      wasEdited(note({ created_at: born, field_updated_at: { body: born, attachments: after(300_000) } })),
    ).toBe(true);
  });

  it("follows the files too — attaching one is editing the note", () => {
    const n = note({
      created_at: born,
      updated_at: "2026-08-14T12:00:00.000Z",
      field_updated_at: { body: born, attachments: "2026-08-14T12:00:00.000Z" },
    });
    expect(editedAt(n)).toBe("2026-08-14T12:00:00.000Z");
  });

  /**
   * The whole reason this is not `updated_at`. Filing a note writes the row,
   * and if that counted as an edit then archiving twelve notes would drag all
   * twelve to the top of the board — which is the opposite of what filing is
   * for.
   */
  it("does not move when the note is merely filed", () => {
    const n = note({
      created_at: born,
      updated_at: "2026-08-14T12:00:00.000Z",
      field_updated_at: { body: born, status: "2026-08-14T12:00:00.000Z", priority: "2026-08-14T12:00:00.000Z" },
    });
    expect(editedAt(n)).toBe(born);
    expect(wasEdited(n)).toBe(false);
  });

  it("falls back to updated_at for a note that predates the clocks", () => {
    // Every note the importer made is in this state, and it is the honest
    // answer when there is nothing finer to ask.
    const n = note({ created_at: born, updated_at: "2026-05-02T00:00:00.000Z" });
    expect(editedAt(n)).toBe("2026-05-02T00:00:00.000Z");
  });

  it("never claims a note was edited before it existed", () => {
    // A stamp behind the creation date is two machines disagreeing about the
    // time, not a fact about the note.
    const n = note({
      created_at: born,
      updated_at: "2020-01-01T00:00:00.000Z",
      field_updated_at: { body: "2020-01-01T00:00:00.000Z" },
    });
    expect(editedAt(n)).toBe(born);
    expect(wasEdited(n)).toBe(false);
  });
});
