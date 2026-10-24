import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_INBOX, SNOOZE_MS, answerPatch, takeReminderAnswers } from "./reminderActions";
import type { Note } from "../types";
import { note as base } from "../test/fixtures";

const note = (over: Partial<Note> = {}): Note =>
  base({
    raw_content: "Call the dentist",
    body: "Call the dentist",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    reminder_at: "2026-09-05T08:00:00.000Z",
    ...over,
  });

/**
 * The half of the notification's answer buttons that can be tested.
 *
 * `public/push-sw.js` is a plain file with no build step and no imports, so it
 * holds nothing but "record which button, park it, nudge any window" — every
 * decision it would otherwise have made lives here. The cache below is the
 * contract between the two files: the worker writes exactly this key and this
 * JSON, and `takeReminderAnswers` reads it. Same arrangement as the share
 * target, and the same reason for it.
 */

/** A stand-in for one browser's Cache Storage, enough for what is used here. */
class FakeCache {
  entries = new Map<string, Response>();
  async put(request: Request | string, response: Response) {
    this.entries.set(typeof request === "string" ? request : request.url, response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  /** Called inside `match`, so a test can park a press mid-read. */
  onMatch: (() => Promise<void>) | null = null;
  async match(request: Request | string) {
    const found = this.entries.get(typeof request === "string" ? request : request.url);
    const hook = this.onMatch;
    this.onMatch = null;
    if (hook) await hook();
    return found;
  }
  async delete(request: Request | string) {
    return this.entries.delete(typeof request === "string" ? request : request.url);
  }
}

let caches_: Map<string, FakeCache>;

beforeEach(() => {
  caches_ = new Map();
  vi.stubGlobal("caches", {
    has: async (name: string) => caches_.has(name),
    open: async (name: string) => {
      if (!caches_.has(name)) caches_.set(name, new FakeCache());
      return caches_.get(name)!;
    },
    delete: async (name: string) => caches_.delete(name),
  });
});

/** What the worker writes, said once so the tests cannot drift from it. */
async function park(noteId: string, action: string, at: string) {
  const cache = caches_.get(ANSWER_INBOX) ?? new FakeCache();
  caches_.set(ANSWER_INBOX, cache);
  await cache.put(
    new Request(`https://spar.test/__reminder/${noteId}`),
    new Response(JSON.stringify({ note_id: noteId, action, at }), {
      headers: { "content-type": "application/json" },
    }),
  );
}

const NOW = Date.parse("2026-09-05T09:00:00.000Z");


describe("collecting what was answered in the shade", () => {
  it("finds nothing on an ordinary open, and does not create the cache", async () => {
    expect(await takeReminderAnswers()).toEqual([]);
    expect(caches_.has(ANSWER_INBOX)).toBe(false);
  });

  it("reads back exactly what the worker parked", async () => {
    await park("n1", "later", "2026-09-05T09:00:00.000Z");
    expect(await takeReminderAnswers()).toEqual([
      { note_id: "n1", action: "later", at: "2026-09-05T09:00:00.000Z" },
    ]);
  });

  // Two reminders answered while the app was shut are two independent facts.
  it("keeps every note's answer, not just the last one", async () => {
    await park("n1", "later", "2026-09-05T09:00:00.000Z");
    await park("n2", "done", "2026-09-05T09:01:00.000Z");
    const answers = await takeReminderAnswers();
    expect(answers.map((a) => a.note_id).sort()).toEqual(["n1", "n2"]);
  });

  // Applied twice, "Later" would move the reminder two hours instead of one.
  it("empties the inbox as it reads it", async () => {
    await park("n1", "done", "2026-09-05T09:00:00.000Z");
    expect(await takeReminderAnswers()).toHaveLength(1);
    expect(await takeReminderAnswers()).toEqual([]);
  });

  // BUG-5 (audit 2026-10-10): the whole cache used to be dropped after the
  // read, so a press the worker parked while the app was reading was thrown
  // away unread. Each entry is now deleted as it is read.
  it("keeps a press parked while the inbox was being read", async () => {
    await park("n1", "done", "2026-09-05T09:00:00.000Z");
    const cache = caches_.get(ANSWER_INBOX)!;
    cache.onMatch = () => park("n2", "later", "2026-09-05T09:00:01.000Z");
    expect((await takeReminderAnswers()).map((a) => a.note_id)).toEqual(["n1"]);
    expect((await takeReminderAnswers()).map((a) => a.note_id)).toEqual(["n2"]);
    expect(await takeReminderAnswers()).toEqual([]);
  });

  it("drops an entry it cannot make sense of rather than throwing", async () => {
    await park("n1", "explode", "2026-09-05T09:00:00.000Z");
    expect(await takeReminderAnswers()).toEqual([]);
  });

  it("says nothing was answered when the browser has no cache storage", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await takeReminderAnswers()).toEqual([]);
  });
});

describe("what an answer changes", () => {
  const at = (ms: number) => new Date(ms).toISOString();
  // A snooze is never earlier than now, so the clock is pinned to the press.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("moves the reminder an hour on from when the button was pressed", () => {
    const patch = answerPatch(note(), { note_id: "n1", action: "later", at: at(NOW) });
    expect(patch).toEqual({ reminder_at: at(NOW + SNOOZE_MS) });
  });

  /*
   * The press is stamped in the worker and collected whenever the app next
   * runs, which may be later. Counting from the press means a snooze made at
   * nine asks for ten, however late the app opens before then. Counting from
   * the collection would postpone it another hour every time.
   */
  it("counts from the press, not from the collection", () => {
    const pressed = NOW - 30 * 60 * 1000;
    const patch = answerPatch(note(), { note_id: "n1", action: "later", at: at(pressed) });
    expect(patch).toEqual({ reminder_at: at(pressed + SNOOZE_MS) });
  });

  /*
   * A snooze whose hour ran out before the app heard of it rings as soon as it
   * can: it asks for now. Written as the time already gone, the app's own
   * ten-minute tidy-up took it as rung and cleared it before the server's
   * sweep ever saw it, so the Later rang never (bughunt 2026-10-15).
   */
  it("asks for now when the hour has already gone by", () => {
    const pressed = NOW - 5 * 60 * 60 * 1000;
    const patch = answerPatch(note(), { note_id: "n1", action: "later", at: at(pressed) });
    expect(patch).toEqual({ reminder_at: at(NOW) });
  });

  it("falls back to now for a press with an unreadable stamp", () => {
    const patch = answerPatch(note(), { note_id: "n1", action: "later", at: "whenever" });
    expect(patch).toEqual({ reminder_at: at(NOW + SNOOZE_MS) });
  });

  it("clears the reminder on Done, and the rule with it", () => {
    const patch = answerPatch(note(), { note_id: "n1", action: "done", at: at(NOW) });
    expect(patch).toEqual({ reminder_at: null, reminder_repeat: null });
  });

  it("changes nothing on a note whose reminder is already gone", () => {
    const gone = note({ reminder_at: null });
    expect(answerPatch(gone, { note_id: "n1", action: "done", at: at(NOW) })).toBe(null);
  });

  /*
   * A one-off reminder clears itself ten minutes after it rings, on whichever
   * device opens first — so a Later pressed on the phone can be collected
   * after the laptop has tidied it away. It still snoozes; a Done has nothing
   * left to do; a Later that does not say which ring it was about is dropped.
   */
  it("still snoozes a reminder that has already cleared itself", () => {
    const gone = note({ reminder_at: null });
    const rang = "2026-09-05T08:00:00+00:00";
    expect(answerPatch(gone, { note_id: "n1", action: "later", at: at(NOW), for: rang })).toEqual({
      reminder_at: at(NOW + SNOOZE_MS),
    });
    expect(answerPatch(gone, { note_id: "n1", action: "done", at: at(NOW), for: rang })).toBe(null);
    expect(answerPatch(gone, { note_id: "n1", action: "later", at: at(NOW) })).toBe(null);
  });

  /*
   * The sweep never puts these buttons on a repeating reminder, but a
   * notification outlives the payload that composed it: set a note to repeat
   * while yesterday's notification is still in the shade, and "Later" would
   * move the anchor of the whole series by an hour. The press does nothing.
   */
  it("leaves a repeating reminder alone, whichever button was pressed", () => {
    const weekly = note({ reminder_repeat: "weekly" });
    expect(answerPatch(weekly, { note_id: "n1", action: "later", at: at(NOW) })).toBe(null);
    expect(answerPatch(weekly, { note_id: "n1", action: "done", at: at(NOW) })).toBe(null);
  });
});


/**
 * A notification outlives the state that made it, and the answer is collected
 * whenever the app next opens — which can be hours later, on a phone that has
 * been in a pocket while the laptop moved the reminder.
 */
describe("an answer about a reminder that has since moved", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  const rang = "2026-09-05T08:00:00.000Z";

  it("is dropped, rather than written over the newer one", () => {
    const moved = note({ reminder_at: "2026-09-11T12:00:00.000Z" });
    expect(
      answerPatch(moved, {
        note_id: moved.id,
        action: "later",
        at: "2026-09-05T08:02:00.000Z",
        for: rang,
      }),
    ).toBeNull();
  });

  it("is applied when it is still about the reminder the note holds", () => {
    const n = note();
    expect(
      answerPatch(n, { note_id: n.id, action: "done", at: "2026-09-05T08:02:00.000Z", for: rang }),
    ).toEqual({ reminder_at: null, reminder_repeat: null });
  });

  /**
   * The push spells the time the way Postgres writes it and this device holds
   * it the way JavaScript does — the same moment, two strings. Compared as
   * text, every answer on the device that set the reminder was dropped.
   */
  it("reads the push's spelling of the time as the same moment", () => {
    const n = note(); // "2026-09-05T08:00:00.000Z"
    const fromServer = "2026-09-05T08:00:00+00:00";
    expect(
      answerPatch(n, { note_id: n.id, action: "done", at: "2026-09-05T08:02:00.000Z", for: fromServer }),
    ).toEqual({ reminder_at: null, reminder_repeat: null });
    expect(
      answerPatch(n, { note_id: n.id, action: "later", at: "2026-09-05T08:02:00.000Z", for: fromServer }),
    ).toEqual({ reminder_at: new Date(Date.parse("2026-09-05T08:02:00.000Z") + SNOOZE_MS).toISOString() });
  });

  it("still drops a different moment, and a time it cannot read, in either spelling", () => {
    const moved = note({ reminder_at: "2026-09-11T12:00:00.000Z" });
    const at = "2026-09-05T08:02:00.000Z";
    expect(answerPatch(moved, { note_id: moved.id, action: "later", at, for: "2026-09-05T08:00:00+00:00" })).toBeNull();
    expect(answerPatch(note(), { note_id: "n1", action: "done", at, for: "not a time" })).toBeNull();
  });

  it("is applied as before when the push never said what it was about", () => {
    const n = note();
    const patch = answerPatch(n, {
      note_id: n.id,
      action: "later",
      at: "2026-09-05T08:02:00.000Z",
    });
    expect(patch?.reminder_at).toBeTruthy();
  });
});
