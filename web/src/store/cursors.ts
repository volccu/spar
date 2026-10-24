import { cmpIso } from "../lib/versions";
import { serverNow } from "./serverClock";

/**
 * Where each pull left off, and the one shape a cursor has.
 *
 * Three pulls keep a keyset cursor — notes, tombstones, canvases — and two
 * of them had grown their own copy of this type and its reader. The combined
 * pull (`pullChanges.ts`) reads all three at once, which is what made one
 * definition worth having.
 *
 * The keys are persisted in every device's IndexedDB and keep their old
 * spellings on purpose: renaming one would read as "never pulled" and
 * re-fetch everything from the beginning of time.
 */
export const NOTES_CURSOR = "lastPulledAt";
export const TOMBSTONES_CURSOR = "lastTombstonesPulledAt";
export const FOLDERS_CURSOR = "lastFoldersPulledAt";

export interface Cursor {
  at: string;
  /** Empty on a device that has never completed a pull, or one still holding
   *  the plain timestamp a key stored before it became a keyset. */
  id: string;
}

const EPOCH_CURSOR: Cursor = { at: "1970-01-01T00:00:00.000Z", id: "" };

export function readCursor(value: unknown): Cursor {
  if (value && typeof value === "object") {
    const cursor = value as Partial<Cursor>;
    if (typeof cursor.at === "string" && typeof cursor.id === "string") return cursor as Cursor;
  }
  return { at: typeof value === "string" ? value : EPOCH_CURSOR.at, id: "" };
}

/**
 * Whether `a` sits past `b` in `(at, id)` order.
 *
 * The instants are compared as instants (`cmpIso`), not as text: a cursor read
 * off a row says `…+00:00` and one written here says `…Z`, and at a genuine tie
 * the two spellings compared as strings disagree about which is later.
 */
export function laterCursor(a: Cursor, b: Cursor): boolean {
  const byTime = cmpIso(a.at, b.at);
  return byTime > 0 || (byTime === 0 && a.id > b.id);
}

/**
 * How far back of the cursor to re-read, and why it is minutes rather than a
 * month.
 *
 * The overlap exists for one narrow reason: a row can commit after we have
 * already read past its stamp. A slow write does that, and so does an upload
 * stamped with the server's clock (`stampForUpload`), which is read off
 * whole-second `Date` headers and runs a second or so early. A short window
 * steps back over that gap. Nothing else needs it — the cursor is committed
 * only after the durable local write, so an interrupted apply already replays
 * by itself.
 *
 * Every keyset pull takes it: notes, canvases and deletes. Canvases had
 * neither this nor the cap below until the upload stamp moved to the server's
 * clock, so a canvas pushed a moment after another could land just behind the
 * other device's cursor and never be pulled. Deletes went without it until
 * 2026-09-21 — stamped with the server's `now()` when their transaction runs,
 * one committing late sat behind the other device's cursor for good.
 *
 * It used to be thirty days, which sounds cautious and is not: every note in
 * this archive has been touched inside thirty days, so *every* sync re-read
 * *every* row. Measured against the live server that is 0.65 MB and three
 * seconds, repeated every twenty seconds, on every focus, and again on the
 * realtime echo of our own push — about a hundred megabytes an hour of phone
 * data to learn that nothing had changed, and the slow, repeatedly-cancelled
 * request behind a good share of "sync failed".
 */
export const REPAIR_WINDOW_MS = 2 * 60_000;

/**
 * The window on a steady tick: after one that finished cleanly, the next
 * steps back only this far.
 *
 * Two minutes on every tick re-downloaded, whole, every row touched in the
 * last two minutes — which while typing is mostly the note this device had
 * just sent, thumbnails and all, once per pause. The gap the window exists to
 * cover is seconds wide (a slow commit, an upload stamped a second early by
 * `stampForUpload`), so a clean tick followed by a clean tick needs only that.
 * The full window comes back for the first tick of a session and for the tick
 * after any failure (`widenRepairWindow`), which are the two moments the last
 * read may have ended somewhere other than where it meant to.
 */
export const STEADY_WINDOW_MS = 15_000;

let wide = true;

/** A tick finished cleanly: the next may step back only `STEADY_WINDOW_MS`. */
export function narrowRepairWindow(): void {
  wide = false;
}

/** The first tick, or the one after a failure: step back the full window. */
export function widenRepairWindow(): void {
  wide = true;
}

/**
 * Where a pull starts reading: the saved cursor stepped back over the repair
 * window, without its id.
 *
 * The id goes with the stamp it broke ties for — a keyset's tiebreaker only
 * means anything beside its own instant. With no id the notes keyset reads
 * from the stamp exclusive and the canvas keyset inclusive, and a row read
 * twice inside the window is an idempotent overwrite either way. The saved
 * cursor itself is not moved back: each pull keeps the later of it and the
 * last row it read (`laterCursor`), so re-reading old rows never walks the
 * position backwards.
 */
export function repairStart(saved: Cursor): Cursor {
  const at = Date.parse(saved.at);
  const back = wide ? REPAIR_WINDOW_MS : STEADY_WINDOW_MS;
  return {
    at: Number.isFinite(at) ? new Date(at - back).toISOString() : EPOCH_CURSOR.at,
    id: "",
  };
}

/**
 * A cursor may not be carried past the time the *server* thinks it is.
 *
 * `updated_at` is whatever clock the writing client had, and every pull here
 * is a keyset over it, so one device with a fast clock stamps its rows into
 * the future and drags the cursor there with them. Everything the other device
 * writes in the meantime then sits behind the cursor permanently: not late,
 * never — nothing moves those rows' stamps again, and the two-minute repair
 * window is nowhere near a wrong clock. This was invisible while the window
 * was thirty days, which is why cutting it to two minutes is what exposed it.
 *
 * So the cursor stops at the server's own clock (`serverNow`, read free off
 * the `Date` header of every answer). The cost is re-reading the handful of
 * rows stamped ahead of it on each tick until real time catches up, which is
 * the direction to be wrong in. The id half is dropped along with the stamp
 * it belonged to: a keyset's tiebreaker is only meaningful beside its own
 * instant.
 *
 * Until the server has answered anything at all, there is no clock to compare
 * with and the cursor stands as it is.
 */
export function cappedAtServerTime(cursor: Cursor): Cursor {
  const now = serverNow();
  if (now === null) return cursor;
  const cap = new Date(now).toISOString();
  return cmpIso(cursor.at, cap) <= 0 ? cursor : { at: cap, id: "" };
}
