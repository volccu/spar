import type { ReminderRepeat } from "../types";

/**
 * The golden vectors — the contract between `lib/reminders.ts` and
 * `reminder_occurrence` in the database.
 *
 * **One table, read by both sides** (audit CODE-4): `lib/reminders.test.ts`
 * holds the TypeScript projection to it, and the conformance suite
 * (`conformance/reminders.test.ts`) holds each backend's SQL or server
 * projection to the same rows. There used to be a hand copy in each place.
 *
 * **Why a table.** The series is projected twice, once in `lib/reminders.ts` for what the app
 * shows and once in SQL for what the phone rings at, and until now nothing
 * held the two together: the unit tests asserted `lib/reminders.ts` against a *prose
 * description* of the SQL, which is a description of the intention, so they
 * went on passing for as long as the SQL disagreed with it. It did.
 * `reminder_occurrence` stepped each occurrence from the previous one instead
 * of from the anchor, and since `interval '1 month'` clamps, a monthly series
 * anchored on the 31st walked down to the 28th and stayed there — 31 January
 * projected to 28 March, so the phone rang on the 28th while the open note
 * said the 31st, and then rang again on the 31st. Migration **0023** is the
 * repair, and this table is what stops it drifting back.
 *
 * **How the expected values were arrived at.** By hand, from the algorithm
 * both sides state — `n` whole periods on **from the anchor**, `n` being the
 * largest count whose instant is not in the future, with a month clamped to
 * the last day of a shorter one — and *not* by running either implementation
 * and writing down what it said. That distinction is the whole value of the
 * table: a vector copied out of the code under test asserts only that the code
 * has not changed, and the failure being guarded against here is precisely one
 * that changed nothing while being wrong.
 *
 * The production database is never reached from a test run. The SQL half is
 * run by the conformance suite against a local stack (`npm run test:conformance`),
 * which no gate runs, so the rule below still stands.
 *
 * **A change to *either* side must be re-checked against this table.** Not
 * "re-run"; re-checked. If a vector here starts failing, the question is which
 * of the two projections moved and whether the table or the code is the thing
 * that is wrong — and if a vector is edited, the same edit is owed to
 * `reminder_occurrence`, and vice versa.
 *
 * Everything is stated in UTC and only in UTC. Migration 0023 pins
 * `timezone = 'UTC'` inside both functions for exactly that reason: the SQL's
 * `+ interval` is calendar arithmetic in the session's zone, so the same sweep
 * under `Europe/Helsinki` projected a different series in twelve thousand of
 * forty-two thousand sampled cases. The DST vectors below are the ones that
 * catch that pin being removed.
 */
export interface Vector {
  /** Read as the test's name, so a failure says what broke rather than
   *  which row of an array it was. */
  why: string;
  anchor: string;
  repeat: ReminderRepeat | null;
  now: string;
  /** `lastOccurrence` — what `reminder_occurrence` returns, and the instant
   *  `due_reminders` compares against `now()` and keys a delivery on. */
  last: string;
  /** `nextOccurrence` — what every surface in the app shows. */
  next: string;
}

export const GOLDEN: Vector[] = [
  // ---- the fault migration 0023 repairs -------------------------------
  {
    why: "a monthly series anchored on the 31st is on the 28th in February and the 31st again in March",
    anchor: "2026-01-31T09:00:00.000Z",
    repeat: "monthly",
    now: "2026-03-28T12:00:00Z",
    // Two steps from the anchor is 31 March, which is still ahead, so the
    // occurrence is the one step: 28 February. The old SQL stepped from the
    // clamped 28 February and answered 28 March — this instant, today.
    last: "2026-02-28T09:00:00.000Z",
    next: "2026-03-31T09:00:00.000Z",
  },
  {
    why: "the same series has not walked down to the 28th four months later",
    anchor: "2026-01-31T09:00:00.000Z",
    repeat: "monthly",
    now: "2026-05-30T12:00:00Z",
    // Five steps is 31 May, still ahead; four is 30 April. The old SQL was
    // by now three days out and drifting.
    last: "2026-04-30T09:00:00.000Z",
    next: "2026-05-31T09:00:00.000Z",
  },
  {
    why: "an anchor on the 30th clamps to 28 February and comes back to the 30th",
    anchor: "2026-01-30T09:00:00.000Z",
    repeat: "monthly",
    now: "2026-02-28T10:00:00Z",
    last: "2026-02-28T09:00:00.000Z",
    next: "2026-03-30T09:00:00.000Z",
  },
  {
    why: "an anchor on the 29th does the same in a year that has no 29 February",
    anchor: "2026-01-29T09:00:00.000Z",
    repeat: "monthly",
    now: "2026-03-01T00:00:00Z",
    last: "2026-02-28T09:00:00.000Z",
    next: "2026-03-29T09:00:00.000Z",
  },

  // ---- a leap day, which is the 29th case with a four-year period -----
  {
    why: "a leap-day anchor clamps to 28 February in an ordinary year",
    anchor: "2024-02-29T06:00:00.000Z",
    repeat: "monthly",
    now: "2025-02-28T07:00:00Z",
    last: "2025-02-28T06:00:00.000Z",
    next: "2025-03-29T06:00:00.000Z",
  },
  {
    why: "a leap-day anchor is the 29th again when February has one",
    anchor: "2024-02-29T06:00:00.000Z",
    repeat: "monthly",
    now: "2028-03-01T00:00:00Z",
    // 48 steps from the anchor, and 2028 is a leap year. Measured from the
    // step before, four years of clamping would have put this on the 28th.
    last: "2028-02-29T06:00:00.000Z",
    next: "2028-03-29T06:00:00.000Z",
  },

  // ---- a far-past anchor, where an off-by-one estimate would show -----
  {
    why: "a daily reminder set six years ago still rings at the anchor's own time of day",
    anchor: "2020-01-01T07:00:00.000Z",
    repeat: "daily",
    now: "2026-08-10T12:00:00Z",
    last: "2026-08-10T07:00:00.000Z",
    next: "2026-08-11T07:00:00.000Z",
  },
  {
    why: "a weekly reminder set six years ago still lands on the anchor's own weekday",
    anchor: "2020-01-01T07:00:00.000Z", // a Wednesday
    repeat: "weekly",
    now: "2026-08-10T12:00:00Z", // a Monday
    // 2,408 days on from the anchor, which is exactly 344 weeks.
    last: "2026-08-05T07:00:00.000Z",
    next: "2026-08-12T07:00:00.000Z",
  },

  // ---- summer time, which is what the pinned UTC zone is for ----------
  {
    why: "a daily reminder steps 24 hours across the spring change, not 23",
    anchor: "2026-03-25T23:30:00.000Z",
    repeat: "daily",
    now: "2026-03-30T12:00:00Z",
    // Europe/Helsinki goes to summer time at 01:00Z on 29 March. A session
    // in that zone would answer 2026-03-29T22:30Z here, an hour early,
    // because four *calendar* days on from 01:30 local is 01:30 local.
    last: "2026-03-29T23:30:00.000Z",
    next: "2026-03-30T23:30:00.000Z",
  },
  {
    why: "a weekly reminder steps 7 × 24 hours across the spring change",
    anchor: "2026-03-22T23:30:00.000Z",
    repeat: "weekly",
    now: "2026-04-06T00:00:00Z",
    last: "2026-04-05T23:30:00.000Z",
    next: "2026-04-12T23:30:00.000Z",
  },
  {
    why: "a daily reminder steps 24 hours across the autumn change, not 25",
    anchor: "2026-10-24T22:30:00.000Z",
    repeat: "daily",
    now: "2026-10-26T00:00:00Z",
    // The change is at 01:00Z on 25 October; a Helsinki session would answer
    // 2026-10-25T23:30Z, an hour late.
    last: "2026-10-25T22:30:00.000Z",
    next: "2026-10-26T22:30:00.000Z",
  },
  {
    why: "a monthly anchor near local midnight is projected on its UTC day, and that is the known limitation",
    anchor: "2026-10-30T23:30:00.000Z", // 31 October, 01:30, in Helsinki
    repeat: "monthly",
    now: "2026-12-05T00:00:00Z",
    // The series falls on the 30th of each UTC month, so what the phone
    // shows is 1 December, 01:30. Every occurrence really is one calendar
    // month on from the instant the user picked; the calendar is UTC's and
    // not theirs. Fixing that means a zone on the note — migration 0023 §2b.
    last: "2026-11-30T23:30:00.000Z",
    next: "2026-12-30T23:30:00.000Z",
  },

  // ---- the boundaries `due_reminders` actually compares ---------------
  {
    why: "an occurrence landing exactly on now is already due, not still ahead",
    anchor: "2026-08-10T07:00:00.000Z",
    repeat: "daily",
    now: "2026-08-13T07:00:00.000Z",
    // `due_reminders` asks `o.at <= now()`, so this is the instant it fires.
    last: "2026-08-13T07:00:00.000Z",
    next: "2026-08-13T07:00:00.000Z",
  },
  {
    why: "a series still entirely ahead projects to its own anchor",
    anchor: "2027-01-01T09:00:00.000Z",
    repeat: "monthly",
    now: "2026-08-10T12:00:00Z",
    // The count is clamped at zero rather than going negative, and the
    // caller's `<= now()` test is what refuses it.
    last: "2027-01-01T09:00:00.000Z",
    next: "2027-01-01T09:00:00.000Z",
  },
  {
    why: "a reminder with no rule is its own occurrence, passed or not",
    anchor: "2026-01-31T09:00:00.000Z",
    repeat: null,
    now: "2026-03-28T12:00:00Z",
    last: "2026-01-31T09:00:00.000Z",
    next: "2026-01-31T09:00:00.000Z",
  },
];
