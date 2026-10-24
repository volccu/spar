import { useSyncExternalStore } from "react";
import { fullDate, ringMark, timeMark, timeUntilWords, timeWords, untouchedSince } from "./when";
import { nextOccurrence, type Reminding } from "./reminders";

/**
 * One clock for the whole app.
 *
 * A stamp reading "3 MIN" is a lie thirty seconds later, so something has to
 * make it tick. The naive version — a `now` in App's state, passed down —
 * re-renders all 241 cards every beat to change the two of them that moved.
 *
 * So the beat is a store and what each card subscribes to is its own *finished
 * string*. React compares snapshots and skips the render when they match, so a
 * note from March re-renders never: its snapshot is "12 MAR" forever, whatever
 * the clock does. Only the handful of cards whose words actually changed pay
 * for the beat.
 *
 * Every subscriber reads the same `now`, so two cards written a millisecond
 * apart can never disagree about where the minute boundary fell.
 */

/** Half a minute: the coarsest beat where "NOW" -> "1 MIN" still looks instant. */
const BEAT_MS = 30_000;

let now = Date.now();
const subscribers = new Set<() => void>();
let timer: number | null = null;

function beat() {
  now = Date.now();
  for (const notify of subscribers) notify();
}

function start() {
  if (timer === null && !document.hidden) {
    timer = window.setInterval(beat, BEAT_MS);
  }
}

function stop() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

/**
 * A backgrounded tab has no one reading it, and a phone that keeps a timer
 * alive behind a locked screen is a phone with worse battery life for nothing.
 * Coming back catches up in one beat rather than waiting out the interval.
 */
function onVisibility() {
  if (document.hidden) {
    stop();
  } else if (subscribers.size > 0) {
    beat();
    start();
  }
}

function subscribe(notify: () => void): () => void {
  if (subscribers.size === 0) {
    document.addEventListener("visibilitychange", onVisibility);
    // The store may have sat idle since the last subscriber left. React reads
    // the snapshot again right after subscribing, so refreshing here — without
    // notifying, which would be re-entrant — is picked up on this same commit.
    now = Date.now();
    start();
  }
  subscribers.add(notify);

  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    }
  };
}

/** The card footer's stamp, kept current. */
export function useTimeMark(iso: string): string {
  const read = () => timeMark(iso, now);
  return useSyncExternalStore(subscribe, read, read);
}

/** The open note's spelled-out stamp, or null once it is older than a week. */
/**
 * When a note's reminder next rings, as the card's footer says it on the
 * Reminders list (`ringMark`) — or "" for no note or no reminder. The
 * occurrence is projected on every beat, so a repeating reminder that has just
 * rung moves on to its next one without anything being written to the note.
 */
export function useRingMark(note: Reminding | null): string {
  const read = () => {
    const at = note ? nextOccurrence(note, now) : null;
    return at === null ? "" : ringMark(at, now);
  };
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Whether a note's reminder has been missed — a one-off whose time is gone —
 * kept current on the shared clock, so a card turns to "passed" the beat its
 * time goes by rather than on whatever render happens next (review FX-B-04).
 * Never true of a repeating reminder: the occurrence shown is the coming one.
 */
export function useReminderPassed(note: Reminding | null): boolean {
  const read = () => {
    const at = note ? nextOccurrence(note, now) : null;
    return at !== null && at <= now;
  };
  return useSyncExternalStore(subscribe, read, read);
}

export function useTimeWords(iso: string): string | null {
  const read = () => timeWords(iso, now);
  return useSyncExternalStore(subscribe, read, read);
}

/** The open note's line for a note untouched for over a year, on the shared
 *  clock — null while it is newer than that (`untouchedSince`). */
export function useUntouchedSince(iso: string): string | null {
  const read = () => untouchedSince(iso, now);
  return useSyncExternalStore(subscribe, read, read);
}

/** How long until a future stamp, kept current — a reminder still ahead. */
export function useTimeUntilWords(iso: string): string | null {
  const read = () => timeUntilWords(iso, now);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The exact day, on the same beat — because whether the year is printed is now
 * a fact about *when it is being read*, not only about the note.
 *
 * It changes at most once a year and the snapshot is the finished string, so
 * this costs a note from March exactly nothing: its answer is "12 Mar" every
 * beat until the 1st of January, when it becomes "12 Mar 2026" and re-renders
 * once. That is the whole reason it goes through the clock rather than reading
 * `Date.now()` at render: an open note left on screen over midnight would
 * otherwise keep yesterday's answer forever.
 */
export function useFullDate(iso: string): string {
  const read = () => fullDate(iso, now);
  return useSyncExternalStore(subscribe, read, read);
}
