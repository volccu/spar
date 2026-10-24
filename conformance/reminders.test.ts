/**
 * Contract: "Reminders" — the occurrence projection the server rings by, its
 * agreement with the one the app shows (web/src/lib/reminders.ts), and what
 * "due" means to the sweep.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { lastOccurrence } from "../web/src/lib/reminders";
import type { DueReminder, NoteWrite, Session } from "./driver";
import { GOLDEN } from "./reminder-vectors";
import { clocksAt, iso, note, sameInstant, useDriver, users } from "./support";

const driver = useDriver();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("the occurrence projection", () => {
  for (const v of GOLDEN) {
    it(v.why, async () => {
      const got = await driver.server.reminderOccurrence(v.anchor, v.repeat, v.now);
      expect(sameInstant(got, v.last)).toBe(true);
    });
  }

  it("reads a rule it does not know as no rule at all", async () => {
    const anchor = "2026-01-31T09:00:00.000Z";
    expect(sameInstant(await driver.server.reminderOccurrence(anchor, "yearly", "2027-06-01T00:00:00Z"), anchor)).toBe(true);
  });

  it("agrees with the client's projection (web/src/lib/reminders.ts) across a wide sample", async () => {
    // Deterministic, so a failure names the same triple every run. Weighted
    // towards the cases that have diverged before: the 28th to the 31st,
    // anchors near midnight, and instants either side of a summer-time change.
    let seed = 0x5eed;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const rules = ["daily", "weekly", "monthly", "monthly", null] as const;
    const triples: { anchor: string; repeat: (typeof rules)[number]; now: string }[] = [];
    for (let i = 0; i < 400; i++) {
      const year = 2020 + Math.floor(random() * 10);
      const month = Math.floor(random() * 12);
      const day = random() < 0.5 ? 28 + Math.floor(random() * 4) : 1 + Math.floor(random() * 28);
      const hour = random() < 0.4 ? [0, 22, 23][Math.floor(random() * 3)] : Math.floor(random() * 24);
      const minute = Math.floor(random() * 60);
      // Date.UTC rolls an impossible day (31 February) into the next month,
      // which is still a valid anchor.
      const anchor = Date.UTC(year, month, day, hour, minute);
      const now = anchor + Math.floor((random() * 830 - 30) * DAY) + Math.floor(random() * DAY);
      triples.push({ anchor: iso(anchor), repeat: rules[Math.floor(random() * rules.length)], now: iso(now) });
    }
    const disagreements: string[] = [];
    for (let i = 0; i < triples.length; i += 16) {
      await Promise.all(
        triples.slice(i, i + 16).map(async (t) => {
          const server = await driver.server.reminderOccurrence(t.anchor, t.repeat, t.now);
          const client = lastOccurrence({ reminder_at: t.anchor, reminder_repeat: t.repeat }, Date.parse(t.now));
          if (!sameInstant(server, client === null ? null : iso(client))) {
            disagreements.push(`${t.anchor} ${t.repeat} @ ${t.now}: server ${server}, client ${client && iso(client)}`);
          }
        }),
      );
    }
    expect(disagreements).toEqual([]);
  });
});

describe("what is due", () => {
  let a: Session;
  let now: number;

  beforeAll(async () => {
    [a] = await users(driver, 1);
    now = await a.serverTime();
  });

  async function reminding(anchorMs: number, repeat: string | null, overrides: Partial<NoteWrite> = {}): Promise<NoteWrite> {
    const stamp = iso(now);
    const n = note({
      body: `reminder ${repeat ?? "once"}`,
      raw_content: `reminder ${repeat ?? "once"}`,
      reminder_at: iso(anchorMs),
      reminder_repeat: repeat,
      updated_at: stamp,
      field_updated_at: clocksAt(stamp),
      ...overrides,
    });
    await a.upsertNotes([n]);
    return n;
  }

  async function due(id: string): Promise<DueReminder | undefined> {
    return (await driver.server.dueReminders()).find((d) => d.note_id === id);
  }

  it("is a reminder whose instant has just passed, on an active note", async () => {
    const n = await reminding(now - 5 * MINUTE, null);
    const hit = await due(n.id);
    expect(hit).toBeDefined();
    expect(hit!.owner_id).toBe(a.userId);
    expect(hit!.body).toBe(n.body);
    expect(hit!.reminder_repeat).toBeNull();
    expect(sameInstant(hit!.reminder_at, n.reminder_at)).toBe(true);
  });

  it("is not a reminder still ahead", async () => {
    const n = await reminding(now + HOUR, null);
    expect(await due(n.id)).toBeUndefined();
  });

  it("is not a reminder more than a day stale", async () => {
    const n = await reminding(now - DAY - 5 * MINUTE, null);
    expect(await due(n.id)).toBeUndefined();
  });

  it("is still a reminder just inside the day", async () => {
    const n = await reminding(now - DAY + 5 * MINUTE, null);
    expect(await due(n.id)).toBeDefined();
  });

  it("is not a reminder on an archived or trashed note", async () => {
    for (const status of ["archived", "trashed"]) {
      const n = await reminding(now - 5 * MINUTE, null, { status });
      expect(await due(n.id)).toBeUndefined();
    }
  });

  it("is not an instant already delivered, and is again once the reminder moves", async () => {
    const n = await reminding(now - 5 * MINUTE, null);
    const hit = await due(n.id);
    await driver.server.recordDelivery({ note_id: n.id, owner_id: a.userId, reminder_at: hit!.reminder_at });
    expect(await due(n.id)).toBeUndefined();
    const moved = iso(now - 2 * MINUTE);
    await a.upsertNotes([
      { ...n, reminder_at: moved, updated_at: iso(now + 1_000), field_updated_at: { ...clocksAt(n.updated_at), reminder_at: iso(now + 1_000) } },
    ]);
    const again = await due(n.id);
    expect(sameInstant(again?.reminder_at, moved)).toBe(true);
  });

  for (const [repeat, periods, stepMs] of [
    ["daily", 10, DAY],
    ["weekly", 3, 7 * DAY],
  ] as const) {
    it(`projects a ${repeat} series to the occurrence that has just passed`, async () => {
      const anchor = now - periods * stepMs - 5 * MINUTE;
      const n = await reminding(anchor, repeat);
      const hit = await due(n.id);
      expect(hit?.reminder_repeat).toBe(repeat);
      expect(sameInstant(hit?.reminder_at, iso(anchor + periods * stepMs))).toBe(true);
    });
  }

  it("projects a monthly series by the calendar, as the client does", async () => {
    const d = new Date(now - 5 * MINUTE);
    // Months back to a month holding the same day, so the occurrence is five
    // minutes ago rather than clamped days away and outside the grace window.
    const back = d.getUTCDate() > 28 ? 12 : 3;
    const anchor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
    const n = await reminding(anchor, "monthly");
    const hit = await due(n.id);
    const expected = lastOccurrence({ reminder_at: iso(anchor), reminder_repeat: "monthly" }, now);
    expect(hit).toBeDefined();
    expect(sameInstant(hit!.reminder_at, iso(expected!))).toBe(true);
  });

  it("delivers each occurrence of a series once: yesterday's delivery does not cover today's", async () => {
    const anchor = now - DAY - 5 * MINUTE;
    const n = await reminding(anchor, "daily");
    await driver.server.recordDelivery({ note_id: n.id, owner_id: a.userId, reminder_at: iso(anchor) });
    const hit = await due(n.id);
    expect(sameInstant(hit?.reminder_at, iso(anchor + DAY))).toBe(true);
    await driver.server.recordDelivery({ note_id: n.id, owner_id: a.userId, reminder_at: hit!.reminder_at });
    expect(await due(n.id)).toBeUndefined();
  });

  it("never writes the note: the anchor stays where the user put it", async () => {
    const anchor = now - 3 * DAY - 5 * MINUTE;
    const n = await reminding(anchor, "daily");
    const hit = await due(n.id);
    await driver.server.recordDelivery({ note_id: n.id, owner_id: a.userId, reminder_at: hit!.reminder_at });
    const [row] = await a.notesById([n.id]);
    expect(sameInstant(row.reminder_at, iso(anchor))).toBe(true);
    expect(sameInstant(row.updated_at, n.updated_at)).toBe(true);
  });
});
