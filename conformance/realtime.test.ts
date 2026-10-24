/**
 * Contract: "Live updates" — a change signal is a hint to sync, reaches the
 * writer's own sessions, and reaches nobody else.
 *
 * Silence is asserted by waiting a fixed while, so the negative tests here are
 * only as strong as that wait; they are written so that the positive signal
 * for the same write is seen first, in the same wait.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChangeSignal, RealtimeTable, Session } from "./driver";
import { at, clocksAt, eventually, itUnless, note, sleep, useDriver, users } from "./support";

const driver = useDriver();
let a: Session;
let b: Session;
const seen: { a: ChangeSignal[]; b: ChangeSignal[] } = { a: [], b: [] };
const stops: (() => Promise<void>)[] = [];

const WAIT = 6_000;

describe.skipIf(!driver.can.realtime)("change signals", () => {
  beforeAll(async () => {
    [a, b] = await users(driver, 2);
    for (const table of ["notes", "folders", "prefs"] as RealtimeTable[]) {
      stops.push(await a.subscribe(table, (s) => seen.a.push(s)));
      stops.push(await b.subscribe(table, (s) => seen.b.push(s)));
    }
    // A subscription reports live a moment before the server is listening,
    // and the first one after a server starts can take many seconds. Warm up
    // with a note of A's own until its signal arrives, so the waits below
    // measure the contract rather than the server's start-up.
    const warm = note();
    await a.upsertNotes([warm]);
    for (let i = 0; i < 10 && !seen.a.some((s) => s.new?.id === warm.id); i++) {
      await sleep(2_000);
      await a.upsertNotes([{ ...warm, updated_at: at(i + 1), field_updated_at: clocksAt(at(i + 1)) }]);
    }
    if (!seen.a.some((s) => s.new?.id === warm.id)) throw new Error("realtime never delivered a signal");
  }, 60_000);

  afterAll(async () => {
    for (const stop of stops) await stop();
  });

  const about = (list: ChangeSignal[], id: string) =>
    list.filter((s) => s.new?.id === id || s.old?.id === id || s.new?.note_id === id);

  it("tells the writer's own sessions about an insert and an update, carrying the row", async () => {
    const n = note();
    await a.upsertNotes([n]);
    expect(await eventually(() => about(seen.a, n.id).some((s) => s.event === "INSERT"), WAIT)).toBe(true);
    await a.upsertNotes([{ ...n, body: "changed", updated_at: at(1_000), field_updated_at: clocksAt(at(1_000)) }]);
    expect(await eventually(() => about(seen.a, n.id).some((s) => s.event === "UPDATE"), WAIT)).toBe(true);
    const update = about(seen.a, n.id).find((s) => s.event === "UPDATE")!;
    expect(update.new?.body).toBe("changed");
    expect(update.new?.updated_at).toBeDefined();
  });

  it("never tells another user about an insert or an update", async () => {
    const n = note();
    await a.upsertNotes([n]);
    await a.upsertNotes([{ ...n, body: "again", updated_at: at(2_000), field_updated_at: clocksAt(at(2_000)) }]);
    expect(await eventually(() => about(seen.a, n.id).some((s) => s.event === "UPDATE"), WAIT)).toBe(true);
    await sleep(1_000);
    expect(about(seen.b, n.id)).toEqual([]);
  });

  it("signals canvases and preferences to their owner", async () => {
    const idea = note();
    await a.upsertNotes([idea]);
    await a.upsertCanvases([
      { id: idea.id, items: [], strokes: [], image_widths: {}, text_elements: [], created_at: at(0), updated_at: at(0) },
    ]);
    await a.upsertPrefs({ boards: [], updated_at: at(3_000) });
    expect(await eventually(() => seen.a.some((s) => s.table === "folders" && s.new?.id === idea.id), WAIT)).toBe(true);
    expect(await eventually(() => seen.a.some((s) => s.table === "prefs"), WAIT)).toBe(true);
    await sleep(1_000);
    expect(seen.b.filter((s) => s.table === "folders" || s.table === "prefs")).toEqual([]);
  });

  it("tells the owner when a note is permanently deleted", async () => {
    const n = note({ status: "trashed" });
    await a.upsertNotes([n]);
    expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
    expect(await eventually(() => about(seen.a, n.id).some((s) => s.event === "DELETE"), WAIT)).toBe(true);
  });

  itUnless(driver, "realtime-delete-reaches-other-users")(
    "never tells another user that one of someone else's notes was deleted",
    async () => {
      const n = note({ status: "trashed" });
      await a.upsertNotes([n]);
      expect(await a.permanentlyDeleteNote(n.id, n.updated_at)).toBe(true);
      expect(await eventually(() => about(seen.a, n.id).some((s) => s.event === "DELETE"), WAIT)).toBe(true);
      await sleep(1_000);
      expect(about(seen.b, n.id)).toEqual([]);
    },
  );
});
