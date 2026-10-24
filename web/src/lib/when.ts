/**
 * When a note happened, said the way a person would.
 *
 * A stamp reading "5 AUG" makes the reader do arithmetic: they have to know
 * today's date, subtract, and only then learn the thing they actually wanted —
 * how long ago this was. For anything written in the last week that is work the
 * app can do instead, so it does: minutes for the first hour, hours for the
 * first day, then days up to six. On the seventh day the elapsed count stops
 * being useful ("11 days ago" is no easier than a date) and the calendar takes
 * over again.
 *
 * Everything here is a pure function of (iso, now). `now` is always passed in
 * rather than read from the clock, so the tests can stand at any moment and so
 * `clock.ts` can hand every card the same instant — two cards a millisecond
 * apart must never disagree about what "1 MIN" means.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
/** A day, in the unit `Date.now()` speaks. */
export const DAY_MS = 24 * HOUR;

/** Past this, a note is dated rather than counted. Six days is the last count. */
const RECENT_MS = 7 * DAY_MS;

type Span =
  | { unit: "now" }
  | { unit: "min" | "hour" | "day"; n: number }
  | { unit: "past" };

/**
 * A duration, bucketed into the largest whole unit that fits — minutes, hours,
 * then days to six. Shared by `spanOf` (elapsed, looking backward) and
 * `timeUntilWords` (looking forward): the same grammar either way, just fed a
 * different sign of gap.
 */
function bucket(ms: number): Span {
  if (ms < MIN) return { unit: "now" };
  if (ms < HOUR) return { unit: "min", n: Math.floor(ms / MIN) };
  if (ms < DAY_MS) return { unit: "hour", n: Math.floor(ms / HOUR) };
  if (ms < RECENT_MS) return { unit: "day", n: Math.floor(ms / DAY_MS) };
  return { unit: "past" };
}

/**
 * Elapsed time, in whole units of the largest one that fits.
 *
 * Clamped at zero: a note whose stamp is in the future is a clock that
 * disagrees with the server, not a note from tomorrow, and "in 3 hours" on your
 * own note is alarming in a way "NOW" is not.
 */
function spanOf(then: number, now: number): Span {
  return bucket(Math.max(0, now - then));
}

/**
 * The month and weekday by their English short names, spelled out rather than
 * asked of `toLocaleString` (audit PERF-1). The wording is fixed English
 * either way, and asking the browser builds a new formatter on every call —
 * thousands of them every 30-second beat on a board of a few thousand cards,
 * a measured second of a selection tap. An array lookup is free.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sep" — the month of a local date, in the English short form. */
export function shortMonth(d: Date): string {
  return MONTHS[d.getMonth()];
}

/** "Mon" — the weekday of a local date, in the English short form. */
export function shortWeekday(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

/**
 * The calendar form, for anything older than the window.
 *
 * An elided year takes an apostrophe, or "JAN 25" reads as the 25th.
 */
function calendarMark(d: Date, now: Date): string {
  const month = shortMonth(d);
  return d.getFullYear() === now.getFullYear()
    ? `${d.getDate()} ${month}`
    : `${month} ’${String(d.getFullYear()).slice(2)}`;
}

/**
 * What a card's footer shows.
 *
 * Abbreviated hard, because this shares a 20px row with the cut level and the
 * link mark on a card that can be 246px wide. Every form it can produce is six
   * characters or fewer — "59 min", "23 hrs", "6 days" — which is the width the
 * calendar form already needed, so nothing below it has to move.
 */
export function timeMark(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const span = spanOf(then, now);
  switch (span.unit) {
    case "now":
      return "Now";
    case "min":
      return `${span.n} min`;
    case "hour":
      return span.n === 1 ? "1 hr" : `${span.n} hrs`;
    case "day":
      return span.n === 1 ? "1 day" : `${span.n} days`;
    case "past":
      return calendarMark(new Date(then), new Date(now));
  }
}

/**
 * When a reminder rings, in the footer's stamp slot (review UX-06, FX-B-04).
 *
 * The Reminders list used to draw the clock mark beside the note's *age*, and
 * "clock · 1 day" reads as "rings in a day" — on a note due in eleven hours.
 * There the stamp's slot says when it rings instead, and it says it as a time
 * rather than as a count, because a count beside a clock is the very reading
 * this replaces:
 *
 * - **already gone**: "passed" — a missed one-off read "09:00" or "8 Oct",
 *   exactly as a coming one does, and nothing on screen said it was late. The
 *   instant handed in is the *coming* occurrence (`nextOccurrence`), so a
 *   repeating reminder is never passed;
 * - **later today**: the clock time, "09:00";
 * - **within the coming six days**: the weekday and the clock time, "Mon
 *   09:00". It said "Mon 9", which read as Monday the 9th, and a time off the
 *   hour dropped the time altogether ("Fri");
 * - **anything else**: the calendar form the stamp already uses, "3 Oct".
 *
 * Nine characters at most, which the Reminders list gives its stamp; the
 * age stamp everywhere else keeps to six. The open note still says the exact
 * day and minute.
 */
export function ringMark(at: number, now: number): string {
  if (!Number.isFinite(at)) return "";
  if (at <= now) return "passed";
  const d = new Date(at);
  const today = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return clock;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (at < startOfToday + RECENT_MS) {
    return `${shortWeekday(d)} ${clock}`;
  }
  return calendarMark(d, today);
}

/**
 * What the open note says. Null once the note is older than the window, where
 * the date alone is the honest answer and `fullDate` carries it.
 *
 * Spelled out rather than abbreviated: the sheet has a whole row for this and
 * no competition for it, and "3 hours ago" is what you would have said.
 */
export function timeWords(iso: string, now: number): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const span = spanOf(then, now);
  switch (span.unit) {
    case "now":
      return "just now";
    case "min":
      return span.n === 1 ? "1 minute ago" : `${span.n} minutes ago`;
    case "hour":
      return span.n === 1 ? "1 hour ago" : `${span.n} hours ago`;
    // Deliberately "1 day ago" and never "yesterday". The count is elapsed
    // hours, not calendar days, so at 01:00 on Monday a note written at 23:00
    // on Saturday is 26 hours old — one day by this arithmetic, but two nights
    // ago by the calendar. "1 day ago" is true under either reading; the word
    // "yesterday" would simply be wrong.
    case "day":
      return `${span.n} day${span.n === 1 ? "" : "s"} ago`;
    case "past":
      return null;
  }
}

/**
 * The same grammar as `timeWords`, run forward: how long until a future
 * instant, in minutes, hours, then days to six. Null for an instant that has
 * already passed — that is overdue, a different question `timeWords` already
 * answers on its own — and null past the window, where the exact day is the
 * honest answer once counting stops being useful.
 */
export function timeUntilWords(iso: string, now: number): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then) || then <= now) return null;
  const span = bucket(then - now);
  switch (span.unit) {
    case "now":
      return "in a moment";
    case "min":
      return span.n === 1 ? "in 1 minute" : `in ${span.n} minutes`;
    case "hour":
      return span.n === 1 ? "in 1 hour" : `in ${span.n} hours`;
    case "day":
      return span.n === 1 ? "in 1 day" : `in ${span.n} days`;
    case "past":
      return null;
  }
}

/**
 * The exact day, always available in the open note.
 *
 * Written out rather than left to `toLocaleDateString`, which renders 8 October
 * as "10/8/2026" in one locale and "8.10.2026" in another — a date you have to
 * know the machine's settings to read is not a date. Spelling the month costs
 * three characters and removes the ambiguity entirely.
 *
 * The year is dropped while it is the year the reader is standing in, which is
 * the overwhelming majority of what an open note shows: "2026" on a note from
 * last week is four characters saying only "yes, still now". It comes back by
 * itself the moment the note and the reader are in different years — a note
 * left untouched over New Year starts printing its year on the 1st of January
 * without anything being written to it, because `now` is passed in rather than
 * baked in. That is the same rule `calendarMark` follows one row up on the
 * card, minus the apostrophe: with the day still in front of it there is no
 * "JAN 25" ambiguity to guard against.
 */
export function fullDate(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${dayAndMonth(d)}${year}`;
}

const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A line of memory for a note nobody has touched in over a year (joy review
 * 2026-10-14, #14): "Untouched since March 2025", the month spelled out as
 * `fullDate`'s is. Null for anything touched within the year, and for a stamp
 * that cannot be read. It is only said in the open note: a card's stamp counts,
 * it does not date. `now` is a parameter, as in `fullDate`, so a note ages into
 * it by itself.
 */
export function untouchedSince(iso: string, now: number): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const aYearBack = new Date(now);
  aYearBack.setFullYear(aYearBack.getFullYear() - 1);
  if (d.getTime() > aYearBack.getTime()) return null;
  return `Untouched since ${LONG_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "27 Sep" — the day, then the month by its English short name. The one
 *  spelling `fullDate` and `writtenDate` share. */
function dayAndMonth(d: Date): string {
  return `${d.getDate()} ${shortMonth(d)}`;
}

/**
 * A day as it is written *into* a note — the insert panel's Date row.
 *
 * `fullDate`'s grammar — the day, then the month by name, never by number —
 * with one difference, and it is the whole reason this is not `fullDate`: the
 * year is always there. `fullDate` may drop it because it is worked out afresh
 * every time it is drawn, so the year comes back by itself on the 1st of
 * January. Characters typed into a note are not worked out again. "27 Sep"
 * written this year would still say "27 Sep" next year, and by then it is a
 * date nobody can place. The month keeps `fullDate`'s English short name, so
 * a note's text and its stamp say a day the same way.
 */
export function writtenDate(now: Date): string {
  return `${dayAndMonth(now)} ${now.getFullYear()}`;
}

/** This instant as the ISO stamp every row in the app is dated with. */
export function nowIso(): string {
  return new Date().toISOString();
}
