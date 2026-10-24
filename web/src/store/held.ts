import { getMeta, setMeta } from "./db";

/**
 * Notes the server keeps refusing, and the way out of a loop that had none.
 *
 * Almost every upload failure is temporary — no signal, a token mid-refresh,
 * a server having a bad minute — and retrying is exactly right. A few are
 * not. A note whose `raw_content` has drifted trips the immutability trigger
 * from migration 0001; a row that violates a constraint or a policy is
 * refused for a reason that is still true tomorrow. Nothing distinguished
 * the two, so a permanently refused note was re-sent on every tick for the
 * rest of the app's life: `send` bisected the batch to find it every time,
 * the sync mark read "failed" forever over an archive that was otherwise
 * syncing perfectly, and no screen in the app could say which note it was or
 * do anything about it. The only fix was a developer.
 *
 * So refusals are counted, per note and per version. After `HOLD_AFTER` of
 * them the note is **held**: not offered again, not counted against the sync
 * mark, and named to the user with the server's own words and two ways out —
 * ask again, or keep this version on this device alone.
 *
 * **Per version, which is what makes the count self-clearing.** The count is
 * kept beside the `updated_at` it was earned by, so editing a held note is
 * itself a retry: a new stamp is a new attempt and starts at zero. That is
 * also the honest reading — the row the server refused no longer exists.
 *
 * Kept in `meta` rather than in the outbox's own value. The outbox is crossed
 * off by comparing that value to the stamp that went up (`clearOutbox`), and
 * a note held here is still queued there: being held is a fact about how the
 * sending has gone, not a change to what is waiting to be sent.
 */

const KEY = "heldNotes";

/** The same book for idea layouts (`canvasSync.ts`), kept apart because a
 *  canvas has its idea note's id. */
export const HELD_CANVASES = "heldCanvases";

/** How many refusals of one version are enough to stop asking. */
export const HOLD_AFTER = 5;

export interface HeldNote {
  id: string;
  /** The version that was refused. A newer one is a fresh attempt. */
  stamp: string;
  /** What the server said, shown to the user as the reason. */
  message: string;
  count: number;
}

type Book = Record<string, { stamp: string; message: string; count: number }>;

async function book(key: string): Promise<Book> {
  return (await getMeta<Book>(key)) ?? {};
}

/**
 * Records one refusal and reports whether the note has now been refused
 * enough times to stop offering it.
 */
export async function recordRefusal(
  id: string,
  stamp: string,
  message: string,
  key = KEY,
): Promise<boolean> {
  const all = await book(key);
  const seen = all[id];
  // A different version is a different attempt, whatever went before.
  const count = seen && seen.stamp === stamp ? seen.count + 1 : 1;
  all[id] = { stamp, message, count };
  await setMeta(key, all);
  return count >= HOLD_AFTER;
}

/** Forgets what is known about these notes — a success, or the user asking again. */
export async function clearRefusals(ids: string[], key = KEY): Promise<void> {
  if (ids.length === 0) return;
  const all = await book(key);
  let changed = false;
  for (const id of ids) {
    if (id in all) {
      delete all[id];
      changed = true;
    }
  }
  if (changed) await setMeta(key, all);
}

/** Every note that has been refused often enough to be held, and why. */
export async function heldNotes(key = KEY): Promise<HeldNote[]> {
  return Object.entries(await book(key))
    .filter(([, seen]) => seen.count >= HOLD_AFTER)
    .map(([id, seen]) => ({ id, ...seen }));
}

/**
 * Whether this exact version of this note is held, answered from a list read
 * once per tick rather than from disk per note.
 */
export function isHeld(held: HeldNote[], id: string, stamp: string): boolean {
  return held.some((note) => note.id === id && note.stamp === stamp);
}
