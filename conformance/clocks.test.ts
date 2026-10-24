/**
 * Contract: "Clocks" — who stamps `updated_at`, and the one promise the pull
 * cursor rests on: a note's `updated_at` never moves backwards.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Session } from "./driver";
import { at, clocksAt, iso, itUnless, micros, note, useDriver, users } from "./support";

const driver = useDriver();
let a: Session;

beforeAll(async () => {
  [a] = await users(driver, 1);
});

async function stamp(id: string): Promise<bigint> {
  const [row] = await a.notesById([id]);
  return micros(row.updated_at);
}

describe("updated_at on an update", () => {
  it("is the sent stamp when that is later than the stored one", async () => {
    const n = note({ updated_at: at(0) });
    await a.upsertNotes([n]);
    await a.upsertNotes([{ ...n, body: "later", updated_at: at(5_000), field_updated_at: clocksAt(at(5_000)) }]);
    expect(await stamp(n.id)).toBe(micros(at(5_000)));
  });

  it("is the stored stamp plus one microsecond when the sent one is earlier", async () => {
    const n = note({ updated_at: at(10_000) });
    await a.upsertNotes([n]);
    await a.upsertNotes([{ ...n, body: "late arrival", updated_at: at(1_000), field_updated_at: clocksAt(at(11_000)) }]);
    expect(await stamp(n.id)).toBe(micros(at(10_000)) + 1n);
  });

  it("moves strictly forward when the sent stamp equals the stored one", async () => {
    // A note sent twice (the outbox re-sends freely). The stored stamp is in
    // the past, so the server's own clock is ahead of it.
    const past = iso(Date.now() - 3_600_000);
    const n = note({ updated_at: past, field_updated_at: clocksAt(past) });
    await a.upsertNotes([n]);
    await a.upsertNotes([n]);
    expect(await stamp(n.id)).toBeGreaterThan(micros(past));
  });

  itUnless(driver, "equal-stamp-restamp-can-go-backwards")(
    "moves strictly forward when the sent stamp equals a stored stamp that is ahead of the server clock",
    async () => {
      const future = iso(Date.now() + 30 * 86_400_000);
      const n = note({ updated_at: future, field_updated_at: clocksAt(future) });
      await a.upsertNotes([n]);
      await a.upsertNotes([n]);
      expect(await stamp(n.id)).toBeGreaterThan(micros(future));
    },
  );

  it("never moves backwards across a run of earlier and later writes", async () => {
    // Equal stamps are left out here: they are the two cases above (a stamp
    // ahead of the server clock repeated was Supabase's D3, fixed in 0025).
    const n = note({ updated_at: at(50_000) });
    await a.upsertNotes([n]);
    let last = await stamp(n.id);
    for (const offset of [49_000, 60_000, 10_000, 61_000, 61_500]) {
      await a.upsertNotes([{ ...n, updated_at: at(offset), field_updated_at: clocksAt(at(offset)) }]);
      const now = await stamp(n.id);
      expect(now).toBeGreaterThan(last);
      last = now;
    }
  });

  it("moves forward on a narrow patch that names no stamp", async () => {
    const past = iso(Date.now() - 3_600_000);
    const n = note({ updated_at: past, field_updated_at: clocksAt(past) });
    await a.upsertNotes([n]);
    await a.patchNote(n.id, { status: "archived" });
    expect(await stamp(n.id)).toBeGreaterThan(micros(past));
  });
});

describe("the server's clock", () => {
  it("is readable by a client off any answer, and is the real time", async () => {
    const before = Date.now();
    const server = await a.serverTime();
    const after = Date.now();
    // The Date header has whole-second resolution.
    expect(server).toBeGreaterThanOrEqual(before - 2_000);
    expect(server).toBeLessThanOrEqual(after + 2_000);
  });
});
