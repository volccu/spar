import { useSyncExternalStore } from "react";
import type { Said } from "../components/Speech";
import { mascotPlay, mascotSign } from "../components/mascot-element";
import { hasOpenBox } from "./blocks";

/**
 * The creature's moments (2026-10-16, owner: "build all of those"): small
 * things it does when something happens, and the one sentence some of them
 * say. The moves are in `components/mascot-element.ts`; this is where the app
 * tells it, from wherever the thing happened — the Sorter, the Ticker, the
 * open note's tick, a share — without any of them reaching into `App`.
 *
 * A sentence is a store of one value read by `useSpeech`, like `twinSaid.ts`:
 * the newest moment, for `MOMENT_MS`. What it says is plain and says what
 * happened; the character is in how the creature moves.
 */

/** How long a moment's sentence stands. */
export const MOMENT_MS = 4_500;
/**
 * How long a move that happened where no creature can be seen — inside Tidy
 * up, under the open note on a phone — is kept for when one can be.
 */
export const KEEP_MS = 30_000;

let current: Said | null = null;
let said = 0;
let timer = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * The creature says this for a moment, with at most one thing to do about it.
 * Returns the sentence's key, for `hush`.
 */
export function robotSays(words: string, act?: Said["act"], ms = MOMENT_MS): string {
  said += 1;
  const key = `moment:${said}`;
  current = { key, words, act };
  window.clearTimeout(timer);
  timer = window.setTimeout(() => hush(key), ms);
  emit();
  return key;
}

/** Stops saying a moment early — its search closed, say — if it is still the one being said. */
export function hush(key: string) {
  if (current?.key !== key) return;
  window.clearTimeout(timer);
  current = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => current;

/** The moment being said now, or null. */
export function useMoment(): Said | null {
  return useSyncExternalStore(subscribe, read, read);
}

/** For tests: nothing is being said. */
export function resetMoments() {
  window.clearTimeout(timer);
  current = null;
  emit();
}

export interface Tally {
  moved: number;
  archived: number;
  binned: number;
  left: number;
  reminded?: number;
}

/** What a finished Tidy up came to, as one line: "12 filed, 3 left". Null when nothing happened. */
export function tidyWords({ moved, archived, binned, left, reminded = 0 }: Tally): string | null {
  const parts = (
    [
      [moved, "filed"],
      [archived, "archived"],
      [binned, "deleted"],
      [reminded, "reminded"],
      [left, "left"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** A Tidy up run to the end and closed: the creature hops and says what it came to. */
export function tidiedUp(tally: Tally) {
  const words = tidyWords(tally);
  if (!words) return;
  robotSays(`Done. ${words}`);
  mascotPlay("hop", KEEP_MS);
}

/** A tick that left the list with no open box: one small, pleased nod. */
export function answerTick(before: string, after: string) {
  if (hasOpenBox(before) && !hasOpenBox(after)) mascotPlay("yes", KEEP_MS);
}

/** The whole Trash emptied by hand: a shiver, and how much went. */
export function emptiedTrash(n: number) {
  if (n <= 0) return;
  robotSays(`Poof. Emptied ${n} ${n === 1 ? "note" : "notes"}`);
  mascotPlay("shake", KEEP_MS);
}

/** A picture shared in from another app: a camera's flash on its screen. */
export function pictureArrived() {
  mascotPlay("flash", 5_000);
}

/** The counts worth a sign: 100, 500, then every thousand. */
export function isMilestone(n: number): boolean {
  return n === 100 || n === 500 || (n >= 1000 && n % 1000 === 0);
}

const SHOWN_KEY = "spar.milestones";

function shownMilestones(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

/**
 * The note that made the count a milestone: the sign goes up, once per
 * milestone on this device. Remembered here only — a convenience, never synced.
 */
export function celebrate(n: number): boolean {
  if (!isMilestone(n)) return false;
  const shown = shownMilestones();
  if (shown.includes(n)) return false;
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown, n]));
  } catch {
    // Storage refused: the sign still goes up, and may again another day.
  }
  mascotSign(n, KEEP_MS);
  return true;
}

/** A search's words as the creature quotes them, cut short past `max`. */
export function quoted(query: string, max = 24): string {
  const q = query.trim().replace(/\s+/g, " ");
  return `"${q.length > max ? `${q.slice(0, max - 1)}…` : q}"`;
}
