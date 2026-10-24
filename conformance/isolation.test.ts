/**
 * Contract: "Ownership and isolation" — one user never sees another's rows,
 * and nothing one user does changes another's.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BackendError, type NoteWrite, type Session } from "./driver";
import { BASE, at, clocksAt, iso, note, useDriver, users, uuid } from "./support";

const driver = useDriver();
let a: Session;
let b: Session;
let hers: NoteWrite;

const EPOCH = { at: "1970-01-01T00:00:00.000Z", id: null };

beforeAll(async () => {
  [a, b] = await users(driver, 2);
  hers = note({ raw_content: "a's private note", status: "trashed" });
  await a.upsertNotes([hers]);
});

async function refused(promise: Promise<unknown>): Promise<BackendError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BackendError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

async function untouched(): Promise<void> {
  const row = await driver.server.readNote(hers.id);
  expect(row?.body).toBe(hers.body);
  expect(row?.status).toBe("trashed");
}

describe("reading", () => {
  it("never returns another user's note from a pull", async () => {
    expect(await b.pullNotes(EPOCH, 500)).toEqual([]);
  });

  it("never returns another user's note by id", async () => {
    expect(await b.notesById([hers.id])).toEqual([]);
    expect(await b.noteState(hers.id)).toBeNull();
  });

  it("never returns another user's rows from the combined pull", async () => {
    await a.upsertPrefs({ boards: [{ id: uuid(), name: "A's board" }], updated_at: at(0) });
    const changes = await b.pullChanges({ notes: EPOCH, tombstones: EPOCH, folders: EPOCH, limit: 500 });
    expect(changes.notes).toEqual([]);
    expect(changes.tombstones).toEqual([]);
    expect(changes.folders).toEqual([]);
    expect(changes.prefs).toBeNull();
  });

  it("never returns another user's tombstones", async () => {
    const gone = note({ status: "trashed" });
    await a.upsertNotes([gone]);
    expect(await a.permanentlyDeleteNote(gone.id, gone.updated_at)).toBe(true);
    expect(await b.pullTombstones(EPOCH, 500)).toEqual([]);
    expect((await a.pullTombstones(EPOCH, 500)).map((t) => t.note_id)).toContain(gone.id);
  });

  it("never returns another user's canvases", async () => {
    const idea = note();
    await a.upsertNotes([idea]);
    await a.upsertCanvases([
      { id: idea.id, items: [], strokes: [], image_widths: {}, text_elements: [], created_at: at(0), updated_at: at(0) },
    ]);
    expect(await b.pullCanvases(EPOCH, 500)).toEqual([]);
  });
});

describe("writing", () => {
  it("refuses an upsert naming another user's note id, and leaves that note as it was", async () => {
    const error = await refused(
      b.upsertNotes([{ ...hers, body: "overwritten", status: "active", updated_at: at(99_000), field_updated_at: clocksAt(at(99_000)) }]),
    );
    expect(["refused", "row-refused"]).toContain(error.kind);
    await untouched();
  });

  it("makes a narrow patch of another user's note change nothing", async () => {
    await b.patchNote(hers.id, { status: "active", body: "patched" });
    await untouched();
  });

  it("refuses to permanently delete another user's note", async () => {
    expect(await b.permanentlyDeleteNote(hers.id, iso(BASE + 10 * 365 * 86_400_000))).toBe(false);
    await untouched();
  });

  it("refuses a canvas for a note the caller does not own", async () => {
    const error = await refused(
      b.upsertCanvases([
        { id: hers.id, items: [], strokes: [], image_widths: {}, text_elements: [], created_at: at(0), updated_at: at(0) },
      ]),
    );
    expect(["refused", "row-refused"]).toContain(error.kind);
  });

  it("keeps each user's preferences row apart", async () => {
    await a.upsertPrefs({ boards: [{ id: "a-board" }], updated_at: at(1_000) });
    await b.upsertPrefs({ boards: [{ id: "b-board" }], updated_at: at(2_000) });
    expect((await a.readPrefs())?.boards).toEqual([{ id: "a-board" }]);
    expect((await b.readPrefs())?.boards).toEqual([{ id: "b-board" }]);
  });

  it("refuses to take over another user's push endpoint, and leaves it registered to them", async () => {
    const endpoint = `https://push.example.test/${uuid()}`;
    const row = { endpoint, p256dh: "a-key", auth: "a-auth", user_agent: null, seen_at: at(0), failed_at: null } as const;
    await a.upsertPushSubscription(row);
    const error = await refused(b.upsertPushSubscription({ ...row, p256dh: "b-key", auth: "b-auth" }));
    expect(["refused", "row-refused"]).toContain(error.kind);
    const [kept] = await driver.server.allSubscriptions(a.userId);
    expect(kept.p256dh).toBe("a-key");
    await b.deletePushSubscription(endpoint);
    expect((await driver.server.allSubscriptions(a.userId)).map((s) => s.endpoint)).toContain(endpoint);
  });
});

describe("without a session", () => {
  it("reads nothing and writes nothing", async () => {
    const [c] = await users(driver, 1);
    await c.upsertNotes([note()]);
    await c.signOut();
    let rows: unknown[] = [];
    try {
      rows = await c.pullNotes(EPOCH, 500);
    } catch (error) {
      expect(error).toBeInstanceOf(BackendError);
    }
    expect(rows).toEqual([]);
    const error = await refused(c.upsertNotes([note()]));
    expect(["refused", "unauthenticated", "row-refused"]).toContain(error.kind);
  });
});
