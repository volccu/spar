import type { Note, ReminderRepeat } from "../types";
import { shortMonth, shortWeekday } from "./when";

/**
 * Reminders — the arithmetic. Nothing here rings anything.
 *
 * `reminder_at` is one field on the note, riding the same outbox and per-field
 * clock every other field on CONFLICT_FIELDS already uses (lib/versions.ts) —
 * there is no separate table and no separate sync path. What this file adds is
 * the arithmetic a picker, a card and the Reminders mode need: a handful of
 * presets, how close is "worth a mark on the board", whether one has already
 * passed, and which notes are carrying one at all.
 *
 * **`reminder_at` is an anchor, not a countdown.** A repeating reminder
 * (`reminder_repeat`, migration 0020) leaves it exactly where the user put it
 * and computes each occurrence on the way past — nothing here, and nothing on
 * the server, ever advances the field. That is what keeps the server out of
 * the `notes` table entirely, which is the property the whole of Phase 3 was
 * built around: a write there would move `updated_at` and drag the note to the
 * top of a board ordered on the last edit, for a fact the user never created.
 *
 * Delivery is somewhere else entirely and has been since Phase 3 shipped
 * (`store/push.ts`, `public/push-sw.js`, migration 0015 and the
 * `send-reminders` edge function): the server finds a due reminder by reading
 * the note, so setting this field schedules nothing and cancels nothing. This
 * header used to say the whole of Phase 3 was out of scope, and it has not
 * been for months.
 */

/**
 * How far ahead a reminder has to sit before the board stops mentioning it.
 *
 * A mark only earns its place (web/CLAUDE.md) — a reminder three weeks out on
 * every card that has ever had one set would be exactly the clock-icon noise
 * that rule exists to prevent. A day out is close enough to be worth a glance
 * at the board rather than only inside the note; an overdue reminder (a
 * negative gap) is nearer than that by definition and always mentioned.
 */
export const REMINDER_SOON_MS = 24 * 60 * 60 * 1000;

/** Everything about a reminder that is stored: where the series starts, and
 *  whether it is a series at all. */
export type Reminding = Pick<Note, "reminder_at" | "reminder_repeat">;

function parsedReminder(note: Reminding): number | null {
  if (!note.reminder_at) return null;
  const at = Date.parse(note.reminder_at);
  return Number.isNaN(at) ? null : at;
}

/** The three rules, and what each one is worth in milliseconds. Monthly is
 *  absent on purpose: a month is not a length, it is a date in the next one. */
const FIXED_STEP_MS: Partial<Record<ReminderRepeat, number>> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

/** A rule this build understands. Anything else — a value from a newer client,
 *  a typo in the database — reads as "does not repeat", which is what null
 *  means and is the one safe way to be wrong about a series. */
function ruleOf(note: Reminding): ReminderRepeat | null {
  const rule = note.reminder_repeat;
  return rule === "daily" || rule === "weekly" || rule === "monthly" ? rule : null;
}

/**
 * `n` calendar months on from an instant, clamped the way Postgres clamps.
 *
 * The 31st of a month that has no 31st is its last day — Jan 31 + 1 month is
 * Feb 28, and + 2 is Mar 31 again, because every step is measured from the
 * anchor rather than from the step before it. `setUTCMonth` alone would spill
 * Feb 31 forward into March and put the whole series two or three days out for
 * the rest of its life.
 *
 * Done in **UTC**, and that is not an oversight. Postgres does this arithmetic
 * in the session's own zone and the sweep's session is UTC, so UTC is what
 * makes this function agree with `reminder_occurrence` in migration 0020. The
 * two must project the same series: a client that disagrees shows a time the
 * server will never ring at, which is the exact fault reminders were built to
 * end.
 */
function addMonthsUtc(ms: number, n: number): number {
  const from = new Date(ms);
  const day = from.getUTCDate();
  const at = new Date(ms);
  // To the 1st first, so the month can be moved without the day overflowing on
  // the way.
  at.setUTCDate(1);
  at.setUTCMonth(at.getUTCMonth() + n);
  const lastOfMonth = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0),
  ).getUTCDate();
  at.setUTCDate(Math.min(day, lastOfMonth));
  return at.getTime();
}

/** The anchor stepped on by `n` whole periods. */
function stepped(anchor: number, rule: ReminderRepeat, n: number): number {
  const fixed = FIXED_STEP_MS[rule];
  return fixed === undefined ? addMonthsUtc(anchor, n) : anchor + n * fixed;
}

/**
 * How many whole periods have elapsed since the anchor, never fewer than none.
 *
 * The estimate is exact for a fixed period and merely close for a month, so it
 * is corrected either way: a month is 28 to 31 days long and the day-of-month
 * clamping above makes the length of a step depend on where in the series it
 * falls. Both loops are bounded — this runs on every render of every card
 * carrying a reminder, and a series that cannot be projected must cost a
 * wrong answer, never a hung board.
 */
function periodsSince(anchor: number, rule: ReminderRepeat, now: number): number {
  const fixed = FIXED_STEP_MS[rule];
  let n =
    fixed === undefined
      ? monthsBetween(anchor, now)
      : Math.floor((now - anchor) / fixed);
  if (n < 0) n = 0;
  for (let guard = 0; guard < 4 && n > 0 && stepped(anchor, rule, n) > now; guard++) n -= 1;
  for (let guard = 0; guard < 4 && stepped(anchor, rule, n + 1) <= now; guard++) n += 1;
  return n;
}

/** Whole months between two instants by the calendar, in UTC. An estimate: it
 *  counts month boundaries and says nothing about the day or the time, which
 *  is what `periodsSince` corrects for. */
function monthsBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * The occurrence the **server** would ring for: the latest one that is not in
 * the future, or the anchor itself when the whole series is still ahead.
 *
 * This is `reminder_occurrence` in migration 0020, said in TypeScript. It is
 * exported for the test that holds the two together, and for nothing else —
 * every surface in the app shows the occurrence that is *coming*, which is
 * `nextOccurrence` below.
 */
export function lastOccurrence(note: Reminding, now = Date.now()): number | null {
  const anchor = parsedReminder(note);
  if (anchor === null) return null;
  const rule = ruleOf(note);
  if (!rule) return anchor;
  return stepped(anchor, rule, periodsSince(anchor, rule, now));
}

/**
 * The occurrence the app shows: the first one that has not happened yet.
 *
 * For a reminder that rings once this is simply the instant it was set for,
 * passed or not — a series of one has no next, so the one it has is the answer
 * and "overdue" keeps meaning exactly what it always meant. For a repeating
 * reminder it is always ahead, which is why such a reminder is never overdue:
 * there is nothing to acknowledge, it comes round again by itself.
 */
export function nextOccurrence(note: Reminding, now = Date.now()): number | null {
  const anchor = parsedReminder(note);
  if (anchor === null) return null;
  const rule = ruleOf(note);
  if (!rule) return anchor;
  const last = lastOccurrence(note, now)!;
  return last >= now ? last : stepped(anchor, rule, periodsSince(anchor, rule, now) + 1);
}

/**
 * The occurrence the app shows, as an ISO instant — what a card, a stamp and a
 * countdown are all written against.
 */
export function nextOccurrenceIso(note: Reminding, now = Date.now()): string | null {
  const at = nextOccurrence(note, now);
  return at === null ? null : new Date(at).toISOString();
}

/**
 * How long the server keeps an occurrence due after its moment has passed.
 *
 * `due_reminders`' `p_grace` default (`interval '1 day'`, migration 0020,
 * restated in 0023) and `GRACE_SECONDS` in `functions/_shared/notification.ts`,
 * which the reminder function and the spår server both read. One fact in three
 * places; `conformance/contract.test.ts` holds the migration and the shared
 * constant together, and this one is held only by these comments.
 */
const REMINDER_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Where the anchor has to go when a rule is put on a reminder, or null to
 * leave it where it is.
 *
 * A rule is projected from the anchor backwards as well as forwards, so a rule
 * set on an anchor that is already behind can land an occurrence the user never
 * asked for — one from before the rule existed — inside the sweep's grace
 * window, and the sweep rings it on its next pass. A one-shot reminder rang at
 * 09:00 on Monday; "every day" pressed at 15:00 on Tuesday projects Tuesday
 * 09:00, six hours old, and the phone rings at once for a time nobody chose.
 *
 * Only then is the anchor moved, to the next occurrence under the new rule —
 * the first one that is genuinely the rule's. Everywhere else it is left alone:
 * an occurrence that *is* the anchor rang (or is due) as the reminder it always
 * was, one past the grace window has missed its moment and the sweep ignores
 * it, and moving an anchor that did not need moving can change its series — a
 * monthly reminder on the 31st moved to the 30th is on the 30th for good.
 */
export function anchorForRule(
  note: Reminding,
  repeat: ReminderRepeat,
  now = Date.now(),
): string | null {
  const anchor = parsedReminder(note);
  if (anchor === null) return null;
  const series: Reminding = { reminder_at: note.reminder_at, reminder_repeat: repeat };
  const last = lastOccurrence(series, now);
  if (last === null || last <= anchor || last <= now - REMINDER_GRACE_MS) return null;
  return nextOccurrenceIso(series, now);
}

/**
 * The reminder a note hands to the idea it joins (review 2026-10-13, EH-03).
 *
 * The idea has its own id, and the sweep remembers what it rang by id
 * (`reminder_deliveries`), so an occurrence that has rung under the note's id
 * — one inside the grace window — would ring again under the idea's. That one
 * stays behind on the note: a one-off is not handed over at all (the archived
 * note still shows it in the Reminders list), and a series starts from its next
 * occurrence, the move `anchorForRule` makes and with its one cost (a monthly
 * series on the 31st moved onto the 30th stays there). Anything else is handed
 * over whole.
 */
export function handedOverReminder(note: Reminding, now = Date.now()): Reminding {
  const last = lastOccurrence(note, now);
  if (last === null) return { reminder_at: null, reminder_repeat: null };
  const whole = { reminder_at: note.reminder_at, reminder_repeat: note.reminder_repeat ?? null };
  if (last > now || last <= now - REMINDER_GRACE_MS) return whole;
  if (!ruleOf(note)) return { reminder_at: null, reminder_repeat: null };
  return { reminder_at: nextOccurrenceIso(note, now), reminder_repeat: whole.reminder_repeat };
}

/**
 * Whether `held` is the reminder `from` handed over (`handedOverReminder`):
 * the same rule, and the same moment or a later occurrence of the same series.
 * A note leaving an idea takes it back, so the two never both ring.
 */
export function isHandedOver(held: Reminding, from: Reminding): boolean {
  const at = parsedReminder(held);
  if (at === null || parsedReminder(from) === null) return false;
  if (ruleOf(held) !== ruleOf(from)) return false;
  return lastOccurrence(from, at) === at;
}

/** Whether a note's reminder is worth a mark on the board: due within the
 *  window, or already overdue and still sitting there unacknowledged. A
 *  repeating reminder is measured on the occurrence that is coming, so a daily
 *  one is always inside the window — which is true, and is what "every day"
 *  means. */
export function reminderDue(note: Reminding, now = Date.now()): boolean {
  const at = nextOccurrence(note, now);
  return at !== null && at - now <= REMINDER_SOON_MS;
}

/** Whether a set reminder's time has already passed. Never true of a repeating
 *  one: the instant it shows is the next one, and the next one is ahead. */
export function reminderOverdue(note: Reminding, now = Date.now()): boolean {
  const at = nextOccurrence(note, now);
  return at !== null && at <= now;
}

/**
 * How long a reminder that rings once stays on its note after its moment.
 *
 * A one-off reminder clears itself once it has rung (2026-10-14, owner asked:
 * "fire once and then clear itself"). The app cannot see the ringing — the
 * server does it — so it waits long enough for the sweep, which runs every
 * minute and retries a push it could not hand over, to have had its turns,
 * then writes the reminder away. Clearing at the moment itself would race the
 * sweep and could cancel the very ring it is clearing up after.
 */
export const SPENT_AFTER_MS = 10 * 60 * 1000;

/**
 * Whether a note's reminder has rung and should now clear itself.
 *
 * Only a one-off, only on an active note — the sweep rings nothing archived or
 * trashed (`due_reminders`, migration 0015), so a reminder there never rang and
 * stays for the person to see — and only once `SPENT_AFTER_MS` has gone by. A
 * repeating reminder is never spent: its next occurrence is always ahead.
 */
export function spentReminder(note: Reminding & Pick<Note, "status">, now = Date.now()): boolean {
  if (note.status !== "active" || ruleOf(note)) return false;
  const at = parsedReminder(note);
  return at !== null && at + SPENT_AFTER_MS <= now;
}

/** What the rule is called, in the app's own words. Used in the open note's
 *  stamp row and on the picker's rows, so both say it the same way. */
export function repeatWords(repeat: ReminderRepeat | null | undefined): string | null {
  switch (repeat) {
    case "daily":
      return "every day";
    case "weekly":
      return "every week";
    case "monthly":
      return "every month";
    default:
      return null;
  }
}

/** The picker's rules, in the order they are offered — shortest first, like
 *  the three presets above them. */
export const REMINDER_REPEATS: ReminderRepeat[] = ["daily", "weekly", "monthly"];

export type ReminderPreset = "in-hour" | "tonight" | "tomorrow" | "next-week";

function atLocalTime(base: Date, hour: number): Date {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Whether tonight's 20:00 has already gone, so the evening row means tomorrow. */
function eveningGone(now: Date): boolean {
  return atLocalTime(now, 20).getTime() <= now.getTime();
}

/**
 * The picker's presets, as ISO instants.
 *
 * Judgment calls, since the spec left the exact times open: "in an hour" is an
 * hour from now on the minute; "tonight" is 20:00 today, rolling to tomorrow if
 * that has already passed, so it is never a time in the past; "tomorrow" and
 * "next week" both land at 09:00, a plain start-of-day default with nothing to
 * recommend one hour over another.
 */
export function presetReminder(preset: ReminderPreset, now = new Date()): string {
  if (preset === "in-hour") {
    const at = new Date(now.getTime() + 3_600_000);
    at.setSeconds(0, 0);
    return at.toISOString();
  }
  if (preset === "tonight") {
    const at = atLocalTime(now, 20);
    if (eveningGone(now)) at.setDate(at.getDate() + 1);
    return at.toISOString();
  }
  const at = atLocalTime(now, 9);
  at.setDate(at.getDate() + (preset === "tomorrow" ? 1 : 7));
  return at.toISOString();
}

/**
 * The presets as the picker offers them, named and ordered for the moment it
 * is opened: by when each will ring, so the rows are read in the order their
 * times come round.
 *
 * After 20:00 the evening row rings tomorrow evening, and it says so: it used to
 * go on saying "Tonight" above "Tomorrow 09:00", which comes first (review
 * 2026-10-01, UX-22). It is then "Tomorrow evening", after the morning. The
 * order is the same rule at seven, when an hour on is later than tonight.
 */
export function reminderPresets(now = new Date()): { key: ReminderPreset; label: string }[] {
  const rows: { key: ReminderPreset; label: string }[] = [
    { key: "in-hour", label: "In 1 hour" },
    { key: "tonight", label: eveningGone(now) ? "Tomorrow evening" : "Tonight" },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "next-week", label: "Next week" },
  ];
  const at = (key: ReminderPreset) => Date.parse(presetReminder(key, now));
  return rows.sort((a, b) => at(a.key) - at(b.key));
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

/**
 * When a preset will actually ring, written beside its name in the picker:
 * "20:00" when the day is the one the name already says, "Wed 20:00" when it
 * is not — an hour on from 23:30 is tomorrow, and says so. "Next week" always
 * names its day, because "next week" alone does not say which one. The weekday
 * is English and short, like the month in `fullDate`.
 */
export function presetWhen(preset: ReminderPreset, now = new Date()): string {
  const at = new Date(presetReminder(preset, now));
  const expected = new Date(now);
  if (preset === "tomorrow" || (preset === "tonight" && eveningGone(now))) {
    expected.setDate(expected.getDate() + 1);
  }
  return preset !== "next-week" && sameDay(at, expected)
    ? hhmm(at)
    : `${shortWeekday(at)} ${hhmm(at)}`;
}

/**
 * A set reminder's clock time, spelled out for the picker's top line — the one
 * place the exact time is written; the note's own row counts towards it in
 * words ("reminds in 11 hours"). "today 20:00" for later today, the weekday
 * alone within the coming six days, and the date once a weekday could mean
 * two different days ("Mon 17 Aug 09:00"), with the year only when it is not
 * this one. English and short, like `presetWhen`.
 */
export function reminderWhen(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (sameDay(at, now)) return `today ${hhmm(at)}`;
  const day = shortWeekday(at);
  const startOfToday = atLocalTime(now, 0).getTime();
  if (at.getTime() > now.getTime() && at.getTime() < startOfToday + 7 * 24 * 3_600_000) {
    return `${day} ${hhmm(at)}`;
  }
  const month = shortMonth(at);
  const year = at.getFullYear() === now.getFullYear() ? "" : ` ${at.getFullYear()}`;
  return `${day} ${at.getDate()} ${month}${year} ${hhmm(at)}`;
}

/**
 * The earliest value a `datetime-local` may offer, in the local wall-clock
 * form the field speaks (`2026-09-22T14:05`). A reminder in the past would be
 * "due" the moment it was set, which nobody sets on purpose.
 */
export function localInputMin(now = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}T${hhmm(now)}`;
}

/**
 * Every note carrying a reminder, as one timeline: overdue first, then
 * soonest next.
 *
 * This is what the Reminders mode shows, and the order *is* the screen. One
 * ascending sort says both halves of that sentence and deliberately so — a
 * past instant is smaller than a future one, so "overdue first" is not a group
 * with a rule of its own, it is simply where the timeline already starts.
 * Sorting the overdue half by some second rule (nearest-to-now first, say)
 * would put a boundary in the middle of the list that nothing on screen
 * explains.
 *
 * **Trashed notes are out; archived ones are in.** That is the same line
 * `searchNotes` draws — an archived note stays findable, a trashed one does
 * not — and it is right for the same reason: a note on its way to being
 * destroyed is not something to be reminded about. Archived is the harder half
 * and is deliberate. The server will not ring for an archived note
 * (`due_reminders`, migration 0015, requires `status = 'active'`), so a
 * reminder left on one is the most invisible reminder there is, and this list
 * is the only place it can be seen at all.
 *
 * A note whose `reminder_at` will not parse carries no reminder anyone can act
 * on, so it is not in the list either — the same `parsedReminder` the mark and
 * the overdue test already read through.
 *
 * A **repeating** reminder takes its place by the occurrence that is coming,
 * not by the anchor it was set from — an anchor is where a series started and
 * may be months in the past, which would pin "every Tuesday" permanently to
 * the overdue end of a list it is never overdue in.
 *
 * `created_at` breaks a tie, so two reminders set for the same instant come
 * out in the same order on both devices rather than in whatever order the
 * store happened to hand them over in.
 */
export function notesWithReminders(notes: Note[], now = Date.now()): Note[] {
  return notes
    .filter((n) => n.status !== "trashed" && parsedReminder(n) !== null)
    .sort(
      (a, b) =>
        (nextOccurrence(a, now) ?? 0) - (nextOccurrence(b, now) ?? 0) ||
        a.created_at.localeCompare(b.created_at),
    );
}
