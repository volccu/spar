import { syncConfigured } from "./supabase";
import { afterShell } from "./shell";
import { RUNTIME_CONFIG, loadBackendConfig } from "./backend/config";

/**
 * What time the server thinks it is — read off the `Date` header of every
 * answer it gives, so it costs nothing.
 *
 * Two things in the app were trusting the device's own clock with decisions
 * that outlive it, and both of them are quiet when they go wrong.
 *
 * **The pull cursor.** `updated_at` is written by whichever *client* touched
 * the row, and the pull is a keyset over it. A device whose clock runs fast
 * stamps its own notes into the future and drags its cursor there with them;
 * everything the other device writes in the meantime then sits behind that
 * cursor permanently — not late, never, because nothing moves those rows'
 * stamps again. `REPAIR_WINDOW_MS` is two minutes, which is nowhere near a
 * wrong clock; the thirty-day window it replaced was what used to hide this.
 *
 * **The trash sweep.** It destroys notes permanently, here and on the server,
 * on a schedule the device's clock alone decides. A machine reading a month
 * ahead emptied the whole trash on its next open, whatever the real age of
 * anything in it, with nothing to warn and nothing to undo.
 *
 * A migration could have the server answer with its own `now()` and that would
 * be the tidier place for it. This needs no migration and no extra round trip:
 * HTTP requires a `Date` on every response, PostgREST and GoTrue both send
 * one, and one second of resolution is ample against either question. The
 * reading is taken *after* the answer arrives, so the latency it includes
 * makes the estimate slightly early — the safe direction for both readers,
 * since early means re-reading a row and deferring a delete.
 *
 * It lives beside `supabase.ts` rather than inside it so that the many tests
 * which mock the client do not each have to know about a clock.
 */
let skewMs = 0;
let clockRead = false;
let waiting: ((at: number | null) => void)[] = [];

/** Called with the `Date` header of every answer the server gives. */
export function noteServerDate(said: string | null): void {
  if (!said) return;
  const at = Date.parse(said);
  if (Number.isNaN(at)) return;
  skewMs = at - Date.now();
  clockRead = true;
  if (waiting.length === 0) return;
  const told = waiting;
  waiting = [];
  for (const tell of told) tell(Date.now() + skewMs);
}

/** The server's clock, in local milliseconds, or `null` until one is read. */
export function serverNow(): number | null {
  return clockRead ? Date.now() + skewMs : null;
}

/**
 * The instant a local write is stamped with: the server's clock once one has
 * been read, the device's until then (audit 2026-10-10, DATA-6).
 *
 * The trash sweep counts a note's month against the server's clock, from the
 * `updated_at` this device stamped. A device running more than thirty days slow
 * therefore trashed a note that was already "a month old" by the server's
 * reckoning, and the next open destroyed it. Stamping from the same clock the
 * sweep reads keeps the two measuring from one zero.
 */
export function stampNow(): number {
  return serverNow() ?? Date.now();
}

/**
 * The server's clock, waited for — the form the trash sweep needs.
 *
 * The sweep is the one destructive thing the app does without being asked, so
 * it asks a second party what time it is and simply **does not run** in a
 * session where no server answers. A sweep deferred to the next open costs
 * nothing; the notes stay whole in the trash meanwhile. With no server
 * configured at all the device's clock stands, because there is then no second
 * opinion to be had and no second copy of the notes to lose.
 */
export function serverClock(waitMs: number): Promise<number | null> {
  // A build that reads `/config.json` learns whether there is a server at all
  // only from the file, read after the shell like every other server question.
  if (RUNTIME_CONFIG) {
    return afterShell()
      .then(loadBackendConfig)
      .then((config) =>
        config.backend === "none" ? Date.now() : serverReading(waitMs),
      );
  }
  if (!syncConfigured) return Promise.resolve(Date.now());
  return serverReading(waitMs);
}

function serverReading(waitMs: number): Promise<number | null> {
  const now = serverNow();
  if (now !== null) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (at: number | null) => {
      clearTimeout(timer);
      resolve(at);
    };
    const timer = setTimeout(() => {
      waiting = waiting.filter((f) => f !== done);
      resolve(null);
    }, waitMs);
    waiting.push(done);
  });
}

/**
 * The latest instant `stampForUpload` has read, so the stamps it hands out
 * never run backwards.
 *
 * `serverNow` is not monotonic. The `Date` header is whole seconds and is
 * re-read off every answer, so two readings a moment apart can disagree by
 * most of a second in the wrong direction — and a canvas being dragged goes up
 * every 700ms, into a pull that has no repair window to step back over that.
 * The highest reading is still one the server's clock had already passed, so
 * holding on to it can never stamp anything into the future.
 */
let highestRead = 0;

/**
 * The `updated_at` a row is sent with: its own stamp, or the server's clock if
 * that is later.
 *
 * Every pull here is a keyset over `updated_at`, and `updated_at` is whatever
 * the writing client stamped. The server keeps it: migration 0013 only floors
 * an update at the stamp already stored, and an insert is not touched at all.
 * So a note written offline at nine and uploaded at two arrived stamped nine,
 * five hours behind a cursor the other device had already carried past it,
 * and never reached that device — the two-minute repair window is nowhere near
 * an afternoon, and a canvas's pull has no window at all. Stamped no earlier
 * than the server's own now, the row lands ahead of every cursor that could
 * have been written before it arrived.
 *
 * **Only the row that is sent is restamped; the local copy keeps its own.**
 * The outbox entry and the refusal book both name a version by that stamp, and
 * what went up is that same version under a later stamp, not a different one —
 * so crossing off and holding go on reading the local stamp. The echo guard is
 * told the stamp that was actually sent, or this device's own upload would wake
 * it. Nothing reads the gap as a newer version: a note's conflicts are decided
 * by its per-field clocks, which are untouched, and `permanently_delete_note`
 * (migration 0019) accepts a stored stamp that has run ahead of the expected
 * one so long as no field clock has.
 *
 * Before the server has answered anything the stamp goes as it is, which is
 * exactly what every upload did before this existed.
 */
export function stampForUpload(stamp: string): string {
  const now = serverNow();
  if (now === null) return stamp;
  highestRead = Math.max(highestRead, now);
  return Date.parse(stamp) < highestRead ? new Date(highestRead).toISOString() : stamp;
}

/** For tests, which start each case with a server that has said nothing yet. */
export function forgetServerClock(): void {
  skewMs = 0;
  clockRead = false;
  waiting = [];
  highestRead = 0;
}
