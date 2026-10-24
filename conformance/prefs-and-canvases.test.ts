/**
 * Contract: "Preferences and boards" and "Canvases".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BackendError, type CanvasRow, type Session } from "./driver";
import { at, micros, note, sameInstant, useDriver, users, uuid } from "./support";

const driver = useDriver();
const EPOCH = { at: "1970-01-01T00:00:00.000Z", id: null };

describe("preferences", () => {
  let a: Session;
  beforeAll(async () => {
    [a] = await users(driver, 1);
  });

  it("has no row until the first upload", async () => {
    expect(await a.readPrefs()).toBeNull();
  });

  it("stores the board list, with no Inbox date until one is given", async () => {
    const boards = [
      { id: uuid(), name: "Recipes", position: 0, created_at: at(0), icon: "BookOpenIcon", color: "moss" },
      { id: uuid(), name: "Work", position: 1, created_at: at(0) },
    ];
    await a.upsertPrefs({ boards, updated_at: at(1_000) });
    const got = await a.readPrefs();
    expect(got?.boards).toEqual(boards);
    expect(got?.inbox_since).toBeNull();
    expect(sameInstant(got?.updated_at, at(1_000))).toBe(true);
  });

  it("writes only the fields an upload carries: a date alone leaves the boards alone", async () => {
    const before = (await a.readPrefs())!.boards;
    await a.upsertPrefs({ inbox_since: "1970-01-01T00:00:00.000Z", updated_at: at(2_000) });
    const got = await a.readPrefs();
    expect(got?.boards).toEqual(before);
    expect(sameInstant(got?.inbox_since, "1970-01-01T00:00:00.000Z")).toBe(true);
  });

  it("writes only the fields an upload carries: boards alone leave the date alone", async () => {
    await a.upsertPrefs({ boards: [], updated_at: at(3_000) });
    const got = await a.readPrefs();
    expect(got?.boards).toEqual([]);
    expect(sameInstant(got?.inbox_since, "1970-01-01T00:00:00.000Z")).toBe(true);
  });

  it("takes the upload's stamp as sent, even an earlier one: the conflict rule is the client's", async () => {
    await a.upsertPrefs({ boards: [{ id: "late" }], updated_at: at(500) });
    const got = await a.readPrefs();
    expect(got?.boards).toEqual([{ id: "late" }]);
    expect(sameInstant(got?.updated_at, at(500))).toBe(true);
  });

  it("clears the Inbox date back to unanswered when told to", async () => {
    await a.upsertPrefs({ inbox_since: null, updated_at: at(4_000) });
    expect((await a.readPrefs())?.inbox_since).toBeNull();
  });
});

describe("preferences, written conditionally", () => {
  let a: Session;
  beforeAll(async () => {
    [a] = await users(driver, 1);
  });

  it("creates the row only while there is none", async () => {
    expect(await a.writePrefsIf({ boards: [{ id: "first" }], updated_at: at(1_000) }, null)).toBe(true);
    expect(await a.writePrefsIf({ boards: [{ id: "second" }], updated_at: at(2_000) }, null)).toBe(false);
    expect((await a.readPrefs())?.boards).toEqual([{ id: "first" }]);
  });

  it("writes over the row it read, and refuses once it has moved on, writing nothing", async () => {
    const read = (await a.readPrefs())!;
    expect(await a.writePrefsIf({ boards: [{ id: "mine" }], updated_at: at(3_000) }, read.updated_at)).toBe(true);
    // Read before that write: stale now.
    expect(await a.writePrefsIf({ boards: [{ id: "late" }], updated_at: at(4_000) }, read.updated_at)).toBe(false);
    const got = await a.readPrefs();
    expect(got?.boards).toEqual([{ id: "mine" }]);
    expect(sameInstant(got?.updated_at, at(3_000))).toBe(true);
  });

  it("carries the Inbox date only when given, like the plain upload", async () => {
    const read = (await a.readPrefs())!;
    expect(
      await a.writePrefsIf({ boards: [], inbox_since: "1970-01-01T00:00:00.000Z", updated_at: at(5_000) }, read.updated_at),
    ).toBe(true);
    const next = (await a.readPrefs())!;
    expect(await a.writePrefsIf({ boards: [{ id: "x" }], updated_at: at(6_000) }, next.updated_at)).toBe(true);
    expect(sameInstant((await a.readPrefs())?.inbox_since, "1970-01-01T00:00:00.000Z")).toBe(true);
  });
});

describe("canvases", () => {
  let a: Session;
  beforeAll(async () => {
    [a] = await users(driver, 1);
  });

  function canvas(id: string, stamp: string, items: unknown[] = []): CanvasRow {
    return { id, items, strokes: [], image_widths: {}, text_elements: [], created_at: stamp, updated_at: stamp };
  }

  it("round-trips every part of an arrangement", async () => {
    const idea = note();
    await a.upsertNotes([idea]);
    const sent: CanvasRow = {
      id: idea.id,
      items: [{ note_id: uuid(), x: 10, y: 20, w: 240 }],
      strokes: [{ points: [[0, 0], [5, 5]], width: 2 }],
      image_widths: { [uuid()]: 320 },
      text_elements: [{ id: "t1", x: 1, y: 2, text: "label" }],
      created_at: at(0),
      updated_at: at(1_000),
    };
    await a.upsertCanvases([sent]);
    const [got] = (await a.pullCanvases(EPOCH, 500)).filter((c) => c.id === idea.id);
    expect(got.items).toEqual(sent.items);
    expect(got.strokes).toEqual(sent.strokes);
    expect(got.image_widths).toEqual(sent.image_widths);
    expect(got.text_elements).toEqual(sent.text_elements);
    expect(sameInstant(got.updated_at, sent.updated_at)).toBe(true);
  });

  it("replaces the whole row on every write, whatever its stamp: last write wins", async () => {
    const idea = note();
    await a.upsertNotes([idea]);
    await a.upsertCanvases([canvas(idea.id, at(5_000), [{ n: 1 }])]);
    await a.upsertCanvases([canvas(idea.id, at(1_000), [{ n: 2 }])]);
    const [got] = (await a.pullCanvases(EPOCH, 500)).filter((c) => c.id === idea.id);
    expect(got.items).toEqual([{ n: 2 }]);
    expect(micros(got.updated_at)).toBe(micros(at(1_000)));
  });

  it("refuses a canvas for an idea note that does not exist", async () => {
    let error: unknown = null;
    try {
      await a.upsertCanvases([canvas(uuid(), at(0))]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BackendError);
    expect(["row-refused", "refused"]).toContain((error as BackendError).kind);
  });
});
