import type { Note } from "../types";

/**
 * An answer given in the notification shade, arriving.
 *
 * `public/push-sw.js` is the dumb half, exactly as `share-sw.js` is: it records
 * which button was pressed on which note and parks it in a cache. This is the
 * half that can be read in TypeScript and tested, and it decides what the press
 * actually *means* — which is one ordinary field write, through the same
 * `update` a tap inside the app goes through, with the same outbox and the same
 * per-field clock.
 *
 * The worker deliberately does not touch IndexedDB. Every rule that makes a
 * local write syncable — the clocks, the dirty queue, the version compare —
 * lives in code it cannot import, and a second, plainer implementation of any
 * of it in a file with no build step is how two writers of one store start
 * disagreeing.
 */

/** The cache `public/push-sw.js` parks answers in. Named in both files. */
export const ANSWER_INBOX = "reminder-answers";

/**
 * How far "Later" moves a reminder.
 *
 * An hour: long enough that the phone stops asking and short enough that it is
 * still today's problem. There is deliberately no menu of snooze lengths in the
 * shade — the two words are there so a reminder can be dealt with without
 * looking at the app, and a submenu on a lock screen is the app again.
 */
export const SNOOZE_MS = 60 * 60 * 1000;

export interface ReminderAnswer {
  note_id: string;
  action: "later" | "done";
  /** When the button was pressed, not when it was collected — see the note on
   *  `answer()` in `public/push-sw.js` for why that difference matters. */
  at: string;
  /**
   * The occurrence the notification was about, as the push carried it.
   *
   * Absent on an answer parked by an older worker, and on a push composed
   * before this was carried — in which case the check below stands down and
   * the answer is taken as it always was.
   */
  for?: string | null;
}

/** Two timestamps naming the same moment, however each was spelled. Falls back
 *  to comparing the text when either cannot be read as a time at all. */
function sameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) ? left === right : a === b;
}

function readable(value: unknown): value is ReminderAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Partial<ReminderAnswer>;
  return (
    typeof answer.note_id === "string" &&
    answer.note_id.length > 0 &&
    (answer.action === "later" || answer.action === "done") &&
    typeof answer.at === "string"
  );
}

/**
 * Empties the answer inbox and returns what was in it, or an empty list —
 * which is every ordinary open of the app.
 *
 * Emptied as it is read, and for the same reason `takeShared` empties the share
 * inbox: an answer that has been applied must never be applied twice, and one
 * left behind would move a reminder again the next time the app started.
 *
 * Never throws. A browser with no Cache API, a storage error, an entry that
 * will not decode — all of them are "nothing was answered". This runs on every
 * open, and nothing about it may ever stand in front of the board.
 */
export async function takeReminderAnswers(): Promise<ReminderAnswer[]> {
  if (typeof caches === "undefined") return [];
  try {
    // `open` would *create* the cache, leaving an empty one on every device
    // that has never answered a notification. Ask first.
    if (!(await caches.has(ANSWER_INBOX))) return [];
    const cache = await caches.open(ANSWER_INBOX);
    const keys = await cache.keys();
    const answers: ReminderAnswer[] = [];
    // Each entry is deleted as it is read, never the whole cache afterwards
    // (audit 2026-10-10, BUG-5): the worker can park a second press while
    // this loop runs, and dropping the cache at the end threw that press
    // away unread. One not listed in `keys` stays for the next open. The
    // empty cache is left standing — deleting it would race the same way.
    for (const key of keys) {
      const response = await cache.match(key);
      await cache.delete(key);
      if (!response) continue;
      const value = await response.json().catch(() => null);
      if (readable(value)) answers.push(value);
    }
    return answers;
  } catch (error) {
    console.error("could not read the answers that were waiting", error);
    return [];
  }
}

/**
 * What one answer changes about a note, or null when it changes nothing.
 *
 * Pure, so the whole meaning of both words can be read and tested in one place
 * rather than inferred from a call site in `App.tsx`.
 *
 * **A repeating reminder is left alone.** The sweep never offers these buttons
 * on one (`_shared/notification.ts`), but a notification can outlive the rule
 * that composed it — set a reminder to repeat while yesterday's is still
 * sitting in the shade and "Later" would move the anchor of the series, which
 * is precisely the write those buttons are withheld to prevent. The press does
 * nothing rather than something surprising.
 */
export function answerPatch(note: Note, answer: ReminderAnswer): Partial<Note> | null {
  if (note.reminder_repeat) return null;
  /**
   * **A Later still works on a reminder that has already cleared itself.**
   *
   * A one-off reminder clears itself ten minutes after it rings
   * (`spentReminder`), and any device that opens in that time does it — so a
   * Later pressed on the phone and collected after the laptop has tidied the
   * reminder away finds nothing on the note. Dropping it would make the button
   * silently do nothing, so a Later that names the occurrence it was about is
   * taken as asked: an hour on from the press. The one cost is a Done on one
   * device and a Later on another for the same ring, which now re-arms it; two
   * contradictory answers to one notification, and the later word wins.
   * A Done on a cleared reminder has nothing left to do.
   */
  if (!note.reminder_at) {
    if (answer.action !== "later" || !answer.for) return null;
    return { reminder_at: snoozedFrom(answer) };
  }
  /**
   * **The answer has to be about the reminder the note is holding now.**
   *
   * A notification outlives the state that made it, and this is collected
   * whenever the app next opens — which can be hours later, on a phone that
   * has been in a pocket. Meanwhile the reminder may have been moved on the
   * laptop and synced. Applied blindly, a "Later" pressed at nine and
   * collected at four wrote a snooze from nine o'clock over a reminder that
   * now said Friday, stamped with a clock later than the laptop's, so the
   * write won the field outright: Friday destroyed, and the note ringing at
   * once because a time five hours gone is inside the sweep's grace. Three
   * devices made it worse — a Done on the phone and a Later on a tablet that
   * had not synced would re-arm a reminder that had just been finished with.
   *
   * So an answer names the occurrence it was about, and one that no longer
   * matches the note is dropped. It is not lost work: the reminder the user
   * can see is the one that stands, which is the only version of this anybody
   * could reason about.
   *
   * **Compared as instants, never as strings.** The push carries the time in
   * Postgres's spelling (`…T08:00:00+00:00`) and a reminder set on this device
   * is held in JavaScript's (`…T08:00:00.000Z`) — one moment, two strings. Read
   * as text they never matched, so on the very device that set the reminder
   * every Later and Done pressed in the shade was dropped here in silence. A
   * value either side cannot read keeps the plain comparison, which drops the
   * answer unless the two are character for character the same.
   */
  if (answer.for && !sameInstant(answer.for, note.reminder_at)) return null;
  if (answer.action === "done") return { reminder_at: null, reminder_repeat: null };
  return { reminder_at: snoozedFrom(answer) };
}

/**
 * An hour on from when Later was pressed, not from when it was collected —
 * and never earlier than now. An hour already gone by the time the app heard
 * of the press rings as soon as it can; written as the past, the one-off's
 * ten-minute tidy-up (`spentReminder`) took it as rung and cleared it before
 * the sweep ever saw it (bughunt 2026-10-15).
 */
function snoozedFrom(answer: ReminderAnswer): string {
  const now = Date.now();
  const pressed = Date.parse(answer.at);
  const from = Number.isFinite(pressed) ? pressed : now;
  return new Date(Math.max(from + SNOOZE_MS, now)).toISOString();
}
