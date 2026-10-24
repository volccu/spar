// notification.ts — what a reminder says when it arrives, and how long the
// push service should hold on to it.
//
// Pure, dependency-free, and shared on purpose: the sweep in
// `send-reminders` composes the push payload and its TTL here, the spår
// server's own sweep (`server/src/push.ts`) does the same, and the root test
// suite (`tests/notification.test.ts`) can import the same file without Deno,
// which is the only way the wording ever gets checked before it reaches a
// phone.

/** One button in the notification shade. `action` is the word the worker
 *  matches on; `title` is the word a person reads. */
export interface ReminderAction {
  action: "later" | "done";
  title: string;
}

/** The one shape the worker in `web/public/push-sw.js` knows how to show. */
export interface ReminderPayload {
  note_id: string;
  title: string;
  body: string;
  /** The instant the reminder was set for, ISO-8601. The shade shows it as
   *  the notification's time, so a push delayed by a sleeping phone still
   *  says *when* it was meant to be. */
  at: string;
  /** What can be answered from the shade without opening the app. Composed
   *  here rather than in the worker so the wording is testable — the worker
   *  cannot be imported, typechecked or run outside a browser. */
  actions: ReminderAction[];
}

/**
 * The two answers a reminder can be given without opening the app, and why a
 * repeating one gets neither.
 *
 * **Later** moves the reminder an hour on; **Done** clears it. Both are
 * ordinary writes to `reminder_at` when the app next runs
 * (`web/src/lib/reminderActions.ts`), which is the whole reason they are safe
 * to offer from a lock screen: nothing here reaches the database, and nothing
 * is destroyed by either word.
 *
 * A **repeating** reminder is offered nothing, and that is a decision rather
 * than an omission. `reminder_at` is the anchor of a series, so moving it an
 * hour would move every future occurrence an hour — "Later" would quietly
 * rewrite the rule instead of postponing one ringing of it. And "Done" on a
 * series means *stop repeating*, which is a change to what the note is for and
 * not a thing to decide from a lock screen with one thumb. It comes round
 * again by design; that is what it was set to do. Snoozing one occurrence
 * would need a second column and is deliberately not built — see
 * `web/CLAUDE.md`.
 */
function actionsFor(repeat: string | null | undefined): ReminderAction[] {
  if (repeat) return [];
  return [
    { action: "later", title: "Later" },
    { action: "done", title: "Done" },
  ];
}

function cut(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

/**
 * A note has no heading — not a field, not a derived one (SPEC §5) — so this
 * does not invent one. The operating system insists on a title and a body,
 * so the note's own opening line becomes the title and what follows becomes
 * the body: the note, arranged, exactly as a card face arranges it. Nothing
 * is summarised and nothing is added.
 *
 * A note that is one line long therefore arrives as a title alone — that is
 * the whole note, and Android draws the site under it. A note that is empty
 * (a file, or a note emptied after the reminder was set) still has to say
 * something, so it falls back to the word "Reminder".
 */
export function notificationFor(note: {
  note_id: string;
  reminder_at: string;
  body: string;
  reminder_repeat?: string | null;
}): ReminderPayload {
  const lines = (note.body ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const first = lines[0] ?? "";
  const rest = lines.slice(1).join(" ");
  return {
    note_id: note.note_id,
    title: cut(first, 60) || "Reminder",
    body: cut(rest, 120),
    at: note.reminder_at,
    actions: actionsFor(note.reminder_repeat),
  };
}

/**
 * A reminder that has come due, as a sweep hands it over. `At` is the instant's
 * spelling: an ISO string from `due_reminders` on Supabase, microseconds in the
 * spår server's own sweep.
 */
export interface DueReminder<At = string> {
  note_id: string;
  owner_id: string;
  /** The occurrence, not the anchor. `due_reminders` projects a repeating
   *  reminder forward and hands back the instant that came due (migration
   *  0020); the note's own `reminder_at` never moves. */
  reminder_at: At;
  /** The repeat rule, which decides only one thing here: whether the shade
   *  gets Later and Done — see `notificationFor`. */
  reminder_repeat: string | null;
  body: string;
}

/**
 * How long an occurrence stays due, in seconds — the same window as
 * `due_reminders`' `p_grace` default (`interval '1 day'`, migration 0020,
 * restated in 0023). **The two must agree**, the way `TOMBSTONE_DAYS` and
 * `prune_note_tombstones` must: it is one fact written in two languages, held
 * together by `conformance/contract.test.ts`.
 */
export const GRACE_SECONDS = 24 * 60 * 60;

/**
 * The shortest TTL worth sending. A push whose TTL has run out is discarded by
 * the push service rather than held, so a reminder sent in the last seconds of
 * its grace with a truthful TTL of four would reach a sleeping phone never —
 * and be written down as delivered. One sweep's worth of slack is the least
 * that means anything.
 */
export const MIN_TTL_SECONDS = 60;

/**
 * What is left of an occurrence's grace, in seconds, as the push's TTL — with
 * `at` and `now` in whatever unit the caller keeps instants in, `perSecond` of
 * them to a second (a thousand for milliseconds, a million for the server's
 * microseconds), so neither caller converts and rounds twice.
 */
export function graceTtl(at: number, now: number, perSecond: number): number {
  const left = Math.round((at + GRACE_SECONDS * perSecond - now) / perSecond);
  return Math.min(GRACE_SECONDS, Math.max(MIN_TTL_SECONDS, left));
}

/**
 * How long this push is worth holding on to, derived from what is left of the
 * reminder's own grace.
 *
 * The bug this replaces: `sendPush` used to default to a TTL of twelve hours,
 * a number chosen inside the transport with no knowledge of what it was
 * carrying, while a reminder stays due for twenty-four — and a delivery is
 * written to `reminder_deliveries` on the push service's **201**, which means
 * *accepted*, not *delivered*. So a phone switched off from 08:45 to 22:00 had
 * its 09:00 reminder expire at the push service at 21:00, already booked as
 * sent, with nothing anywhere recording that it never arrived. The next sweep
 * did not retry it: as far as `send-reminders` was concerned it had gone.
 *
 * Now the message expires at the push service at exactly the instant the sweep
 * would have stopped considering it due, which is the only honest answer. A
 * flat twenty-four hours would also be long enough, and would be worse: it
 * would leave a push alive after the server has decided the moment has passed,
 * so a phone coming back on Thursday would ring for Tuesday — the noise the
 * grace window exists to refuse.
 *
 * An unreadable occurrence falls back to the whole window rather than to
 * nothing: too long is a reminder arriving late, too short is one never
 * arriving at all.
 */
export function ttlFor(occurrenceIso: string, now = Date.now()): number {
  const at = Date.parse(occurrenceIso);
  if (Number.isNaN(at)) return GRACE_SECONDS;
  return graceTtl(at, now, 1000);
}
