import { describe, expect, it } from "vitest";
import {
  fullDate,
  untouchedSince,
  ringMark,
  shortMonth,
  shortWeekday,
  timeMark,
  timeUntilWords,
  timeWords,
  writtenDate,
} from "./when";

/**
 * Local noon, not a UTC stamp. The calendar forms below render in local time,
 * so a UTC midday would land on the day before or after in the far-eastern and
 * far-western zones and the expected "3 AUG" would be off by one there.
 */
const NOW = new Date(2026, 7, 10, 12, 0, 0).getTime();

/** An ISO stamp `ms` before NOW. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

/** An ISO stamp `ms` after NOW — a reminder still ahead. */
function ahead(ms: number): string {
  return new Date(NOW + ms).toISOString();
}

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Review UX-06: when a reminder rings, in the slot the stamp has. Review
 * FX-B-04: a missed one reads "passed" rather than a time that looks like a
 * coming one, and a day this week carries its clock time ("Mon 09:00"), not a
 * bare hour that read as a date ("Mon 9") or nothing at all ("Fri").
 */
describe("ringMark", () => {
  // NOW is Monday 10 August 2026, at noon local time.
  const at = (day: number, h: number, m = 0) => new Date(2026, 7, day, h, m).getTime();

  it("says the clock time for later today", () => {
    expect(ringMark(at(10, 21, 30), NOW)).toBe("21:30");
    expect(ringMark(at(10, 12, 1), NOW)).toBe("12:01");
  });

  it("says passed for a time already gone, today or any earlier day", () => {
    expect(ringMark(at(10, 9), NOW)).toBe("passed");
    expect(ringMark(at(8, 9), NOW)).toBe("passed");
    expect(ringMark(NOW, NOW)).toBe("passed");
  });

  it("says the weekday and the clock time for the coming six days", () => {
    expect(ringMark(at(11, 9), NOW)).toBe("Tue 09:00");
    expect(ringMark(at(16, 21), NOW)).toBe("Sun 21:00");
    expect(ringMark(at(12, 9, 30), NOW)).toBe("Wed 09:30");
  });

  it("dates anything a week or more ahead", () => {
    expect(ringMark(at(17, 9), NOW)).toBe("17 Aug");
  });

  it("never runs past the nine characters the Reminders list gives it", () => {
    for (let h = -24 * 3; h < 24 * 30; h += 7) {
      expect(ringMark(NOW + h * HOUR, NOW).length).toBeLessThanOrEqual(9);
    }
  });
});

describe("timeMark", () => {
  it("counts minutes for the first hour", () => {
    expect(timeMark(ago(0), NOW)).toBe("Now");
    expect(timeMark(ago(59 * SEC), NOW)).toBe("Now");
    expect(timeMark(ago(MIN), NOW)).toBe("1 min");
    expect(timeMark(ago(59 * MIN), NOW)).toBe("59 min");
  });

  it("counts hours for the first day", () => {
    expect(timeMark(ago(HOUR), NOW)).toBe("1 hr");
    expect(timeMark(ago(2 * HOUR), NOW)).toBe("2 hrs");
    expect(timeMark(ago(23 * HOUR + 59 * MIN), NOW)).toBe("23 hrs");
  });

  it("counts days up to six, then hands over to the calendar", () => {
    expect(timeMark(ago(DAY), NOW)).toBe("1 day");
    expect(timeMark(ago(6 * DAY), NOW)).toBe("6 days");
    // The seventh day is where counting stops being easier than reading a date.
    expect(timeMark(ago(7 * DAY), NOW)).toBe("3 Aug");
    expect(timeMark(ago(400 * DAY), NOW)).toBe("Jul ’25");
  });

  it("never grows past the width the calendar form already needed", () => {
    const widest = [0, MIN, 59 * MIN, HOUR, 23 * HOUR, DAY, 6 * DAY, 60 * DAY]
      .map((ms) => timeMark(ago(ms), NOW).length);
    expect(Math.max(...widest)).toBeLessThanOrEqual(7);
  });

  it("treats a stamp from the future as now, not as a countdown", () => {
    expect(timeMark(new Date(NOW + HOUR).toISOString(), NOW)).toBe("Now");
  });

  it("says nothing at all when the stamp is unreadable", () => {
    expect(timeMark("not a date", NOW)).toBe("");
  });
});

describe("timeWords", () => {
  it("spells it out, and gets the singulars right", () => {
    expect(timeWords(ago(0), NOW)).toBe("just now");
    expect(timeWords(ago(MIN), NOW)).toBe("1 minute ago");
    expect(timeWords(ago(5 * MIN), NOW)).toBe("5 minutes ago");
    expect(timeWords(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(timeWords(ago(3 * HOUR), NOW)).toBe("3 hours ago");
    expect(timeWords(ago(DAY), NOW)).toBe("1 day ago");
    expect(timeWords(ago(6 * DAY), NOW)).toBe("6 days ago");
  });

  it("says '1 day ago' rather than 'yesterday', which can be false", () => {
    // 01:00 Monday, written 23:00 Saturday: 26 hours, but two nights back.
    const monday = Date.parse("2026-08-10T01:00:00Z");
    const saturday = "2026-08-08T23:00:00Z";
    expect(timeWords(saturday, monday)).toBe("1 day ago");
  });

  it("goes quiet past the window, leaving the date to speak", () => {
    expect(timeWords(ago(7 * DAY), NOW)).toBeNull();
    expect(timeWords("not a date", NOW)).toBeNull();
  });
});

describe("timeUntilWords", () => {
  it("counts forward in the same units timeWords counts backward in", () => {
    // Not zero: an instant exactly "now" is due, not "ahead" — see below.
    expect(timeUntilWords(ahead(1), NOW)).toBe("in a moment");
    expect(timeUntilWords(ahead(MIN), NOW)).toBe("in 1 minute");
    expect(timeUntilWords(ahead(5 * MIN), NOW)).toBe("in 5 minutes");
    expect(timeUntilWords(ahead(HOUR), NOW)).toBe("in 1 hour");
    expect(timeUntilWords(ahead(3 * HOUR), NOW)).toBe("in 3 hours");
    expect(timeUntilWords(ahead(DAY), NOW)).toBe("in 1 day");
    expect(timeUntilWords(ahead(6 * DAY), NOW)).toBe("in 6 days");
  });

  it("goes quiet past the window, the same edge timeWords stops counting at", () => {
    expect(timeUntilWords(ahead(7 * DAY), NOW)).toBeNull();
  });

  it("is null for an instant already passed — that is overdue, a different question", () => {
    expect(timeUntilWords(ago(MIN), NOW)).toBeNull();
    expect(timeUntilWords(new Date(NOW).toISOString(), NOW)).toBeNull();
  });

  it("says nothing at all when the stamp is unreadable", () => {
    expect(timeUntilWords("not a date", NOW)).toBeNull();
  });
});

describe("untouchedSince", () => {
  const now = new Date(2026, 9, 14, 12, 0, 0).getTime();
  it("names the month and year of a note untouched for over a year", () => {
    expect(untouchedSince(new Date(2025, 2, 9, 12).toISOString(), now)).toBe("Untouched since March 2025");
    expect(untouchedSince(new Date(2019, 11, 31, 12).toISOString(), now)).toBe("Untouched since December 2019");
  });
  it("says nothing for a note touched within the year, on either side of the line", () => {
    expect(untouchedSince(new Date(2026, 9, 1, 12).toISOString(), now)).toBeNull();
    expect(untouchedSince(new Date(2025, 9, 15, 12).toISOString(), now)).toBeNull();
    expect(untouchedSince(new Date(2025, 9, 14, 11).toISOString(), now)).toBe("Untouched since October 2025");
  });
  it("says nothing for a stamp it cannot read", () => {
    expect(untouchedSince("", now)).toBeNull();
  });
});

describe("fullDate", () => {
  const inAugust = new Date(2026, 7, 28, 12, 0, 0).getTime();
  const august10 = new Date(2026, 7, 10, 12, 0, 0).toISOString();

  it("spells the month, so the day and month can never be swapped", () => {
    expect(fullDate(august10, new Date(2025, 0, 1).getTime())).toBe("10 Aug 2026");
  });

  /**
   * The year the reader is already in says nothing — it is four characters
   * confirming that yes, it is still now.
   */
  it("drops the year while the reader is standing in it", () => {
    expect(fullDate(august10, inAugust)).toBe("10 Aug");
  });

  /**
   * ...and it comes back by itself, with nothing written to the note. This is
   * the whole reason `now` is a parameter: a note left untouched over New Year
   * starts printing its year on the 1st of January.
   */
  it("brings the year back once the reader is in a different one", () => {
    expect(fullDate(august10, new Date(2027, 0, 1).getTime())).toBe("10 Aug 2026");
    expect(fullDate(august10, new Date(2028, 5, 1).getTime())).toBe("10 Aug 2026");
  });

  it("says nothing at all when the stamp is unreadable", () => {
    expect(fullDate("not a date", inAugust)).toBe("");
  });
});

describe("writtenDate", () => {
  it("names the month, the way the note's own stamp does", () => {
    expect(writtenDate(new Date(2026, 8, 27, 9, 0, 0))).toBe("27 Sep 2026");
  });

  /**
   * The one way it differs from `fullDate`. A stamp is drawn afresh and gets
   * its year back on New Year's Day by itself; characters typed into a note
   * are never drawn afresh, so a date written without its year this September
   * is a date nobody can place next September.
   */
  it("always keeps the year, because the text outlives it", () => {
    const today = new Date(2026, 7, 10, 12, 0, 0);
    expect(fullDate(today.toISOString(), today.getTime())).toBe("10 Aug");
    expect(writtenDate(today)).toBe("10 Aug 2026");
  });
});

// The names are spelled out rather than asked of the browser on every card
// (audit PERF-1). They must read exactly as `toLocaleString("en")` did.
describe("shortMonth and shortWeekday", () => {
  it("names all twelve months as before", () => {
    const names = Array.from({ length: 12 }, (_, m) => shortMonth(new Date(2026, m, 15)));
    expect(names).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    for (let m = 0; m < 12; m++) {
      const d = new Date(2026, m, 15);
      expect(shortMonth(d)).toBe(d.toLocaleString("en", { month: "short" }));
    }
  });

  it("names all seven weekdays as before", () => {
    // 4 Oct 2026 is a Sunday.
    const names = Array.from({ length: 7 }, (_, i) => shortWeekday(new Date(2026, 9, 4 + i)));
    expect(names).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 9, 4 + i);
      expect(shortWeekday(d)).toBe(d.toLocaleString("en", { weekday: "short" }));
    }
  });

  it("dates a card in every month the way it always did", () => {
    const now = new Date(2026, 11, 31, 12).getTime();
    for (let m = 0; m < 12; m++) {
      const d = new Date(2026, m, 3, 9);
      if (now - d.getTime() < 7 * 86_400_000) continue;
      expect(timeMark(d.toISOString(), now)).toBe(`3 ${d.toLocaleString("en", { month: "short" })}`);
      const last = new Date(2025, m, 3, 9);
      expect(timeMark(last.toISOString(), now)).toBe(
        `${last.toLocaleString("en", { month: "short" })} ’25`,
      );
    }
  });
});
