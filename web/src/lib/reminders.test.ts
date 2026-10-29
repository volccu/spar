import { describe, expect, it } from "vitest";
import {
  anchorForRule,
  handedOverReminder,
  isHandedOver,
  lastOccurrence,
  nextOccurrence,
  notesWithReminders,
  presetReminder,
  presetWhen,
  reminderPresets,
  reminderWhen,
  monthDays,
  parseClock,
  clockWords,
  atMinutes,
  reminderDue,
  reminderOverdue,
  SPENT_AFTER_MS,
  spentReminder,
  repeatWords,
  REMINDER_SOON_MS,
} from "./reminders";
import type { Note, ReminderRepeat } from "../types";
import { GOLDEN } from "../test/reminderVectors";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-08-10T12:00:00Z");

function note(
  reminder_at: string | null,
  reminder_repeat: ReminderRepeat | null = null,
): Pick<Note, "reminder_at" | "reminder_repeat"> {
  return { reminder_at, reminder_repeat };
}

/** An instant, as the arithmetic hands it back: ISO, so a failure names a time
 *  rather than a thirteen-digit number nobody can read. */
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("reminderDue", () => {
  it("says nothing about a note with no reminder set", () => {
    expect(reminderDue(note(null), NOW)).toBe(false);
  });

  it("is due once inside the warning window", () => {
    expect(reminderDue(note(new Date(NOW + REMINDER_SOON_MS - 1).toISOString()), NOW)).toBe(true);
  });

  it("is not due while still well ahead of the window", () => {
    expect(reminderDue(note(new Date(NOW + REMINDER_SOON_MS + HOUR).toISOString()), NOW)).toBe(
      false,
    );
  });

  it("stays due once the moment has passed and nobody has cleared it", () => {
    expect(reminderDue(note(new Date(NOW - 10 * DAY).toISOString()), NOW)).toBe(true);
  });

  it("ignores an unreadable stamp rather than throwing", () => {
    expect(reminderDue(note("not a date"), NOW)).toBe(false);
  });
});

/**
 * Putting a rule on a reminder whose anchor is behind. Every vector is worked by
 * hand from NOW (2026-08-10 12:00 UTC) and a 24-hour grace window, not read out
 * of the function.
 */
describe("anchorForRule", () => {
  it("moves the anchor past an occurrence from before the rule, inside the grace window", () => {
    // Rang Sunday 09:00 as a one-shot. Daily from there projects Monday 09:00,
    // three hours old — the sweep would ring it at once.
    expect(anchorForRule(note("2026-08-09T09:00:00.000Z"), "daily", NOW)).toBe(
      "2026-08-11T09:00:00.000Z",
    );
    // Weekly from Monday 3 August 11:00 projects today 11:00, an hour old.
    expect(anchorForRule(note("2026-08-03T11:00:00.000Z"), "weekly", NOW)).toBe(
      "2026-08-17T11:00:00.000Z",
    );
    // Monthly from 10 July 08:00 projects today 08:00, four hours old.
    expect(anchorForRule(note("2026-07-10T08:00:00.000Z"), "monthly", NOW)).toBe(
      "2026-09-10T08:00:00.000Z",
    );
  });

  it("leaves an anchor that is itself the latest occurrence", () => {
    // Three hours ago, and the reminder's own time — not something the rule made.
    expect(anchorForRule(note("2026-08-10T09:00:00.000Z"), "daily", NOW)).toBeNull();
    // The 31st: the next step is 31 August, still ahead, so nothing is clamped.
    expect(anchorForRule(note("2026-07-31T09:00:00.000Z"), "monthly", NOW)).toBeNull();
  });

  it("leaves it when the projected occurrence is already past the grace window", () => {
    // Weekly from Sunday 2 August 10:00 projects Sunday 9 August 10:00 — 26 hours.
    expect(anchorForRule(note("2026-08-02T10:00:00.000Z"), "weekly", NOW)).toBeNull();
  });

  it("leaves a future anchor, and a note with none", () => {
    expect(anchorForRule(note("2026-08-11T09:00:00.000Z"), "daily", NOW)).toBeNull();
    expect(anchorForRule(note(null), "daily", NOW)).toBeNull();
  });
});

/**
 * What a note hands to the idea it joins (review 2026-10-13, EH-03). The idea
 * has a new id, and the sweep remembers what rang by id, so an occurrence that
 * has rung under the note's id would ring again under the idea's.
 */
describe("handedOverReminder", () => {
  const none = { reminder_at: null, reminder_repeat: null };

  it("hands over a reminder still to come, whole", () => {
    expect(handedOverReminder(note("2026-08-10T13:00:00.000Z"), NOW)).toEqual(
      note("2026-08-10T13:00:00.000Z"),
    );
    // A series whose last occurrence is past the grace window: nothing to ring twice.
    expect(handedOverReminder(note("2026-08-02T10:00:00.000Z", "weekly"), NOW)).toEqual(
      note("2026-08-02T10:00:00.000Z", "weekly"),
    );
  });

  it("keeps back a one-off that has just rung", () => {
    expect(handedOverReminder(note("2026-08-10T11:55:00.000Z"), NOW)).toEqual(none);
  });

  it("hands over a long-overdue one-off, which the sweep will not ring again", () => {
    expect(handedOverReminder(note("2026-08-08T09:00:00.000Z"), NOW)).toEqual(
      note("2026-08-08T09:00:00.000Z"),
    );
  });

  it("starts a series that has just rung from its next occurrence", () => {
    // Daily at 09:00 since the 1st: today's rang three hours ago.
    expect(handedOverReminder(note("2026-08-01T09:00:00.000Z", "daily"), NOW)).toEqual(
      note("2026-08-11T09:00:00.000Z", "daily"),
    );
  });

  it("hands over nothing from a note with none", () => {
    expect(handedOverReminder(note(null), NOW)).toEqual(none);
  });
});

/** Whether an idea's reminder is the one a note handed it, so it goes back
 *  with the note when the note leaves (review 2026-10-13, EH-03). */
describe("isHandedOver", () => {
  it("knows a reminder handed over whole, or from a series' next occurrence", () => {
    const daily = note("2026-08-01T09:00:00.000Z", "daily");
    expect(isHandedOver(daily, daily)).toBe(true);
    expect(isHandedOver(handedOverReminder(daily, NOW), daily)).toBe(true);
    expect(isHandedOver(note("2026-08-10T13:00:00.000Z"), note("2026-08-10T13:00:00+00:00"))).toBe(true);
  });

  it("does not claim a different reminder, or none", () => {
    expect(isHandedOver(note("2026-08-10T13:00:00.000Z"), note("2026-08-10T14:00:00.000Z"))).toBe(false);
    expect(isHandedOver(note("2026-08-11T09:00:00.000Z", "weekly"), note("2026-08-01T09:00:00.000Z", "daily"))).toBe(false);
    expect(isHandedOver(note("2026-08-11T09:30:00.000Z", "daily"), note("2026-08-01T09:00:00.000Z", "daily"))).toBe(false);
    expect(isHandedOver(note(null), note(null))).toBe(false);
  });
});

describe("reminderOverdue", () => {
  it("is false for nothing set", () => {
    expect(reminderOverdue(note(null), NOW)).toBe(false);
  });

  it("is false while still ahead", () => {
    expect(reminderOverdue(note(new Date(NOW + HOUR).toISOString()), NOW)).toBe(false);
  });

  it("is true the instant it passes", () => {
    expect(reminderOverdue(note(new Date(NOW).toISOString()), NOW)).toBe(true);
    expect(reminderOverdue(note(new Date(NOW - 1).toISOString()), NOW)).toBe(true);
  });
});

describe("spentReminder", () => {
  const at = (ms: number) => new Date(ms).toISOString();
  const spent = (over: Partial<Note>) => spentReminder({ ...note(at(NOW - SPENT_AFTER_MS)), status: "active", ...over }, NOW);

  it("clears a one-off once it has had its time to ring", () => {
    expect(spent({})).toBe(true);
    expect(spent({ reminder_at: at(NOW - SPENT_AFTER_MS + 1) })).toBe(false);
    expect(spent({ reminder_at: at(NOW + HOUR) })).toBe(false);
    expect(spent({ reminder_at: null })).toBe(false);
  });

  it("never clears a repeating one, or one on a note that never rang", () => {
    expect(spent({ reminder_repeat: "daily" })).toBe(false);
    expect(spent({ status: "archived" })).toBe(false);
    expect(spent({ status: "trashed" })).toBe(false);
  });
});

describe("presetReminder", () => {
  const morning = new Date(2026, 7, 10, 9, 0, 0, 0); // 09:00 local

  it("sets tonight to 20:00 today when that has not passed yet", () => {
    const at = new Date(presetReminder("tonight", morning));
    expect(at.getDate()).toBe(morning.getDate());
    expect(at.getHours()).toBe(20);
  });

  it("rolls tonight to tomorrow once 20:00 has already gone", () => {
    const late = new Date(2026, 7, 10, 21, 30, 0, 0);
    const at = new Date(presetReminder("tonight", late));
    expect(at.getDate()).toBe(late.getDate() + 1);
    expect(at.getHours()).toBe(20);
    // Never a time already in the past.
    expect(at.getTime()).toBeGreaterThan(late.getTime());
  });

  it("sets tomorrow to 09:00 the next day", () => {
    const at = new Date(presetReminder("tomorrow", morning));
    expect(at.getDate()).toBe(morning.getDate() + 1);
    expect(at.getHours()).toBe(9);
  });

  it("sets next week to 09:00, seven days out", () => {
    const at = new Date(presetReminder("next-week", morning));
    expect(at.getDate()).toBe(morning.getDate() + 7);
    expect(at.getHours()).toBe(9);
  });

  it("never returns a time already passed, for any preset", () => {
    for (const preset of ["in-hour", "tonight", "tomorrow", "next-week"] as const) {
      const now = new Date();
      const at = new Date(presetReminder(preset, now));
      expect(at.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("presetWhen", () => {
  // 10 August 2026 is a Monday.
  const morning = new Date(2026, 7, 10, 9, 0, 0, 0);

  it("gives only the time when the day is the one the name already says", () => {
    expect(presetWhen("tonight", morning)).toBe("20:00");
    expect(presetWhen("tomorrow", morning)).toBe("09:00");
  });

  it("always names the day next week lands on", () => {
    expect(presetWhen("next-week", morning)).toBe("Mon 09:00");
  });
});

describe("reminderPresets", () => {
  // 10 August 2026 is a Monday.
  const labels = (now: Date) => reminderPresets(now).map((p) => `${p.key}:${p.label}`);

  it("offers an hour from now first, then tonight, tomorrow and next week", () => {
    expect(labels(new Date(2026, 7, 10, 9, 0))).toEqual([
      "in-hour:In 1 hour",
      "tonight:Tonight",
      "tomorrow:Tomorrow",
      "next-week:Next week",
    ]);
  });

  // Review 2026-10-01, UX-22: after eight the evening row means tomorrow, so it
  // says so, and it falls in behind the morning that comes before it.
  it("calls the evening row tomorrow evening once tonight's has gone, after tomorrow morning", () => {
    expect(labels(new Date(2026, 7, 10, 20, 54))).toEqual([
      "in-hour:In 1 hour",
      "tomorrow:Tomorrow",
      "tonight:Tomorrow evening",
      "next-week:Next week",
    ]);
  });

  it("lists every row in the order its time comes round", () => {
    for (const hour of [0, 9, 19, 20, 23]) {
      const now = new Date(2026, 7, 10, hour, 30);
      const times = reminderPresets(now).map((p) => Date.parse(presetReminder(p.key, now)));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });
});

describe("the hour preset", () => {
  it("lands an hour on, on the minute", () => {
    const now = new Date(2026, 7, 10, 14, 37, 42, 500);
    const at = new Date(presetReminder("in-hour", now));
    expect(at.getHours()).toBe(15);
    expect(at.getMinutes()).toBe(37);
    expect(at.getSeconds()).toBe(0);
    expect(at.getTime()).toBeGreaterThan(now.getTime());
  });

  it("says only the time on the same day, and the day once it crosses midnight", () => {
    expect(presetWhen("in-hour", new Date(2026, 7, 10, 14, 37))).toBe("15:37");
    expect(presetWhen("in-hour", new Date(2026, 7, 10, 23, 30))).toBe("Tue 00:30");
  });

  it("gives tomorrow evening only its time once the name says tomorrow", () => {
    expect(presetWhen("tonight", new Date(2026, 7, 10, 21, 30))).toBe("20:00");
  });
});

describe("reminderWhen", () => {
  // 10 August 2026 is a Monday.
  const now = new Date(2026, 7, 10, 14, 0);
  const at = (d: Date) => reminderWhen(d.toISOString(), now);

  it("says today for a time later today", () => {
    expect(at(new Date(2026, 7, 10, 20, 0))).toBe("today 20:00");
  });

  it("gives the weekday within the coming week", () => {
    expect(at(new Date(2026, 7, 11, 9, 0))).toBe("Tue 09:00");
    expect(at(new Date(2026, 7, 16, 9, 0))).toBe("Sun 09:00");
  });

  it("adds the date once the weekday alone could mean two days", () => {
    expect(at(new Date(2026, 7, 17, 9, 0))).toBe("Mon 17 Aug 09:00");
  });

  it("adds the year when it is not this one", () => {
    expect(at(new Date(2027, 0, 4, 9, 0))).toBe("Mon 4 Jan 2027 09:00");
  });
});

describe("monthDays", () => {
  it("lays every month out as six Monday-first weeks", () => {
    // October 2026 starts on a Thursday; February 2027 on a Monday.
    const oct = monthDays(2026, 9);
    expect(oct).toHaveLength(42);
    expect(oct.slice(0, 3)).toEqual([null, null, null]);
    expect(oct[3]?.getDate()).toBe(1);
    expect(oct[33]?.getDate()).toBe(31);
    expect(oct[34]).toBe(null);
    const feb = monthDays(2027, 1);
    expect(feb).toHaveLength(42);
    expect(feb[0]?.getDate()).toBe(1);
    expect(feb.filter(Boolean)).toHaveLength(28);
  });
});

describe("parseClock", () => {
  it("reads a time the way it is typed on a number pad", () => {
    expect(parseClock("9")).toBe(540);
    expect(parseClock("09:00")).toBe(540);
    expect(parseClock("930")).toBe(570);
    expect(parseClock("9.30")).toBe(570);
    expect(parseClock("2115")).toBe(21 * 60 + 15);
    expect(parseClock(" 21 ")).toBe(21 * 60);
  });

  it("refuses what is not a time of day", () => {
    for (const bad of ["", "24", "9:60", "abc", "12345", "9:5"]) expect(parseClock(bad)).toBe(null);
  });

  it("writes minutes back as a clock does", () => {
    expect(clockWords(540)).toBe("09:00");
    expect(clockWords(21 * 60 + 5)).toBe("21:05");
  });
});

describe("atMinutes", () => {
  it("puts a time of day on a picked day, in this device's clock", () => {
    const at = atMinutes(new Date(2026, 9, 16), 9 * 60 + 30);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 9, 16, 9, 30]);
  });
});

/**
 * The Reminders mode's whole screen is this list and its order, so both are
 * pinned here rather than in App's own test — that one asserts the mode shows
 * what this function says, and this one says what it is.
 */
describe("notesWithReminders", () => {
  function full(
    id: string,
    reminder_at: string | null,
    status: Note["status"] = "active",
    created_at = "2026-01-01T00:00:00.000Z",
  ): Note {
    return {
      id,
      raw_content: id,
      body: id,
      source: "web",
      created_at,
      updated_at: created_at,
      note_type: null,
      board_id: null,
      status,
      priority: 0,
      reminder_at,
      reminder_repeat: null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
    };
  }
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const ids = (notes: Note[]) => notes.map((n) => n.id);

  it("keeps only the notes actually carrying a reminder", () => {
    expect(
      ids(notesWithReminders([full("none", null), full("set", at(HOUR))])),
    ).toEqual(["set"]);
  });

  it("drops a reminder whose stamp will not parse", () => {
    expect(ids(notesWithReminders([full("junk", "not a date")]))).toEqual([]);
  });

  // A note on its way to being destroyed is not something to be reminded
  // about — the same line searchNotes draws, and for the same reason.
  it("leaves out a trashed note and keeps an archived one", () => {
    const list = notesWithReminders([
      full("trashed", at(HOUR), "trashed"),
      full("archived", at(2 * HOUR), "archived"),
      full("active", at(3 * HOUR), "active"),
    ]);
    expect(ids(list)).toEqual(["archived", "active"]);
  });

  // The order *is* the screen: one ascending sort, which puts the overdue at
  // the top because a past instant is smaller than a future one.
  it("puts overdue first, most overdue at the top, then soonest next", () => {
    const list = notesWithReminders([
      full("next week", at(7 * DAY)),
      full("an hour ago", at(-HOUR)),
      full("in an hour", at(HOUR)),
      full("last week", at(-7 * DAY)),
    ]);
    expect(ids(list)).toEqual(["last week", "an hour ago", "in an hour", "next week"]);
  });

  // Two reminders set for the same instant have to come out in the same order
  // on both devices, not in whatever order the store handed them over in.
  it("breaks a tie on when the note was written", () => {
    const same = at(DAY);
    expect(
      ids(
        notesWithReminders([
          full("newer", same, "active", "2026-03-01T00:00:00.000Z"),
          full("older", same, "active", "2026-02-01T00:00:00.000Z"),
        ]),
      ),
    ).toEqual(["older", "newer"]);
  });

  it("does not reorder the array it was handed", () => {
    const notes = [full("b", at(HOUR)), full("a", at(-HOUR))];
    notesWithReminders(notes);
    expect(ids(notes)).toEqual(["b", "a"]);
  });
});

/**
 * The series, which is the half of this feature that has to agree with a
 * database.
 *
 * `reminder_at` is an anchor and nothing ever advances it, so every occurrence
 * is computed twice — here, for what the app shows, and in
 * `reminder_occurrence` (migration 0020) for what the server rings at. Two
 * projections of one series is a thing that can drift, and the failure it
 * drifts into is silent: a note that says "reminds in 3 hours" and then does
 * not. Everything below pins the arithmetic the SQL is written against.
 */
describe("a reminder that comes round again", () => {
  const anchor = "2026-08-10T07:00:00.000Z";

  it("is its own next occurrence while the series is still ahead", () => {
    const before = Date.parse("2026-08-09T00:00:00Z");
    expect(iso(nextOccurrence(note(anchor, "daily"), before))).toBe(anchor);
    expect(iso(lastOccurrence(note(anchor, "daily"), before))).toBe(anchor);
  });

  it("steps a day at a time, counted from the anchor", () => {
    const now = Date.parse("2026-08-13T09:00:00Z");
    expect(iso(lastOccurrence(note(anchor, "daily"), now))).toBe("2026-08-13T07:00:00.000Z");
    expect(iso(nextOccurrence(note(anchor, "daily"), now))).toBe("2026-08-14T07:00:00.000Z");
  });

  it("steps seven days at a time, keeping the weekday", () => {
    const now = Date.parse("2026-08-30T00:00:00Z");
    expect(iso(nextOccurrence(note(anchor, "weekly"), now))).toBe("2026-08-31T07:00:00.000Z");
  });

  /**
   * The one case the naive month arithmetic gets wrong in both directions.
   * `setUTCMonth` alone spills Jan 31 into Mar 3; Postgres clamps it to Feb 28,
   * and this has to clamp with it. Measuring every step from the anchor is
   * what brings the 31st back in March rather than walking the series down to
   * the 28th forever.
   */
  it("clamps a monthly reminder to the last day of a shorter month", () => {
    const end = note("2026-01-31T07:00:00.000Z", "monthly");
    expect(iso(nextOccurrence(end, Date.parse("2026-02-01T00:00:00Z")))).toBe(
      "2026-02-28T07:00:00.000Z",
    );
    expect(iso(nextOccurrence(end, Date.parse("2026-03-01T00:00:00Z")))).toBe(
      "2026-03-31T07:00:00.000Z",
    );
  });

  /**
   * The borrow in Postgres's `age()` reports 0 months elapsed on Feb 28 from an
   * anchor on Jan 31 — one real occurrence it would skip. The SQL steps on
   * while the next one has also passed, and so does this.
   */
  it("does not skip the occurrence a month-count borrow hides", () => {
    const end = note("2026-01-31T07:00:00.000Z", "monthly");
    const now = Date.parse("2026-02-28T08:00:00Z");
    expect(iso(lastOccurrence(end, now))).toBe("2026-02-28T07:00:00.000Z");
  });

  it("crosses a year without losing the day", () => {
    const now = Date.parse("2027-01-05T00:00:00Z");
    expect(iso(nextOccurrence(note("2026-11-03T07:00:00.000Z", "monthly"), now))).toBe(
      "2027-02-03T07:00:00.000Z",
    );
  });

  it("reads a rule it has never heard of as one that does not repeat", () => {
    const odd = { reminder_at: anchor, reminder_repeat: "hourly" as unknown as ReminderRepeat };
    const now = Date.parse("2026-08-13T09:00:00Z");
    expect(iso(nextOccurrence(odd, now))).toBe(anchor);
    expect(reminderOverdue(odd, now)).toBe(true);
  });

  it("is never overdue, however long ago the series started", () => {
    const now = Date.parse("2027-05-05T05:00:00Z");
    expect(reminderOverdue(note(anchor, "daily"), now)).toBe(false);
    expect(reminderOverdue(note(anchor, "weekly"), now)).toBe(false);
    expect(reminderOverdue(note(anchor, "monthly"), now)).toBe(false);
    // The same anchor, ringing once, is overdue by nine months.
    expect(reminderOverdue(note(anchor), now)).toBe(true);
  });

  it("keeps a daily reminder inside the board's window, because it always is", () => {
    const now = Date.parse("2027-05-05T05:00:00Z");
    expect(reminderDue(note(anchor, "daily"), now)).toBe(true);
    expect(reminderDue(note(anchor, "monthly"), now)).toBe(false);
  });

  it("takes a note's place in the timeline from the occurrence that is coming", () => {
    // The repeating note's anchor is nine months older than the one-off's, so
    // ordering on the anchor would put it first and permanently.
    const soon = Date.parse("2027-05-05T05:00:00Z");
    const daily = { ...noteRow("daily", anchor), reminder_repeat: "daily" as ReminderRepeat };
    // The daily one comes round at 07:00, two hours from `soon`; the one-off
    // is five hours out. Ordered on the anchor the daily note would lead by
    // nine months and never stop leading.
    const once = noteRow("once", new Date(soon + 5 * HOUR).toISOString());
    expect(notesWithReminders([once, daily], soon).map((n) => n.id)).toEqual(["daily", "once"]);
  });

  it("names each rule the one way the app says it", () => {
    expect(repeatWords("daily")).toBe("every day");
    expect(repeatWords("weekly")).toBe("every week");
    expect(repeatWords("monthly")).toBe("every month");
    expect(repeatWords(null)).toBe(null);
  });
});

// The golden vectors and why they exist: `test/reminderVectors.ts`.
describe("the projection both sides have to agree on", () => {
  for (const v of GOLDEN) {
    it(v.why, () => {
      const n = note(v.anchor, v.repeat);
      const now = Date.parse(v.now);
      expect(iso(lastOccurrence(n, now))).toBe(v.last);
      expect(iso(nextOccurrence(n, now))).toBe(v.next);
    });
  }

  /**
   * The contract in one sentence, asserted over every vector rather than
   * written in a comment: the occurrence is the latest one that is **not in
   * the future**, and the one the app shows is the first that has not
   * happened yet.
   *
   * The SQL broke the first half as well as the day-of-month: it corrected its
   * month estimate upward only, so an over-count stood and the function could
   * hand back an instant still ahead of `now` — which `due_reminders` would
   * then compare against `now()` and quietly find nothing due.
   */
  it("never projects an occurrence in the future, or a next one in the past", () => {
    for (const v of GOLDEN) {
      if (!v.repeat) continue; // a reminder that rings once is overdue on purpose
      const n = note(v.anchor, v.repeat);
      const now = Date.parse(v.now);
      const anchor = Date.parse(v.anchor);
      const last = lastOccurrence(n, now)!;
      if (anchor <= now) expect(last).toBeLessThanOrEqual(now);
      else expect(last).toBe(anchor);
      expect(nextOccurrence(n, now)!).toBeGreaterThanOrEqual(now);
    }
  });
});

function noteRow(id: string, reminder_at: string | null): Note {
  return {
    id,
    raw_content: id,
    body: id,
    source: "web",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at,
    reminder_repeat: null,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [],
  };
}
