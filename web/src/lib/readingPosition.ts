/**
 * Where you had got to in a long note, on this device and nowhere else.
 *
 * The user named the canvas zoom as the precedent, and the precedent is the
 * *argument* rather than the mechanism (`lib/canvas.ts`): two devices never
 * agree on how far into a note a phone happened to be scrolled, because the
 * column is a different width, the type is the same size, and the lines
 * therefore fall in different places. A shared offset would be two machines
 * disagreeing about a number that only means anything on one of them. So this
 * is device-local by the same reasoning zoom is component-local — one step
 * further, because unlike zoom it has to survive the note being closed, which
 * is the whole feature.
 *
 * What that rules out, explicitly: it is never a field on the note, it never
 * enters the outbox, it is never on `CONFLICT_FIELDS`, and nothing here ever
 * touches `updated_at`. A scroll offset is not an edit and must never pull a
 * card to the top of a board ordered on the last edit.
 *
 * **`localStorage`, and the synchronous read is the entire reason.** The app's
 * own store is IndexedDB and that is where a note belongs; this does not go
 * there, because IndexedDB can only answer asynchronously. An asynchronous
 * answer means the note paints at the top and then jumps — which is the one
 * outcome this feature has to avoid, and is worse than not restoring at all. A
 * synchronous read can be spent in a `useLayoutEffect` before the first paint,
 * so the note is *already* in the right place the first time it is seen and
 * there is no move to make. (`store/db.ts`'s account handoff clears this along
 * with everything else — a purge that left one user's reading positions behind
 * for the next is the same leak the purge exists to prevent.)
 */

const KEY = "spar.reading";

/**
 * Below this, the top of the note is where you were.
 *
 * Restoring is only worth a jump when you had actually gone somewhere. A
 * couple of lines down is inside the first screenful of every note, so putting
 * the reader back there says nothing and costs the small surprise of a note
 * that does not start at the beginning. Roughly four lines of reading text at
 * `--t-read` and `--lh-read`; it is a threshold rather than a measurement, so
 * it is a plain number here and not a token.
 */
export const MIN_REMEMBERED_PX = 120;

/**
 * How many notes are remembered at once, most recent first.
 *
 * The archive is a few hundred notes and each entry is a handful of bytes, so
 * this is not about space — it is about the list being a cache with an end to
 * it rather than something that only ever grows. Least recently read is the
 * one to drop, which the array gives for free by writing to the front.
 */
const MAX_REMEMBERED = 200;

interface Spot {
  id: string;
  /** Pixels down the note's scrolling body. */
  at: number;
  /**
   * How long the note's text was when this was written.
   *
   * The offset is a count of pixels into a particular piece of text, so it
   * stops meaning anything the moment the text changes — a note edited on the
   * phone would otherwise reopen on the laptop somewhere arbitrary, with
   * nothing to say why. Length rather than a hash or a timestamp, deliberately:
   * `updated_at` moves for filing, archiving and priority, none of which move a
   * word, so a stamp would throw the position away every time a note was
   * organised; and a hash costs a pass over 15,000 characters to protect
   * against the one case it catches that length does not — an edit that
   * replaces exactly as many characters as it removes, where being a line out
   * is not a harm worth paying for on every open.
   */
  len: number;
}

function read(): Spot[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Spot =>
        typeof s?.id === "string" &&
        typeof s?.at === "number" &&
        typeof s?.len === "number",
    );
  } catch {
    // Storage refused, or somebody else wrote nonsense under this key. A lost
    // reading position is a scroll; it is never a reason to fail to open a note.
    return [];
  }
}

function write(spots: Spot[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(spots.slice(0, MAX_REMEMBERED)));
  } catch {
    // Full, or private browsing. Nothing here is worth an error.
  }
}

/**
 * Puts this note at the front of the list, or takes it off.
 *
 * An offset inside the first screenful is stored as *nothing* rather than as a
 * small number: reading back to the top of a note is a decision too, and it has
 * to be able to clear a position set earlier, or a note you have finished and
 * scrolled back through would reopen halfway down forever.
 */
export function rememberReadingPosition(id: string, at: number, len: number): void {
  const rest = read().filter((s) => s.id !== id);
  if (!Number.isFinite(at) || at < MIN_REMEMBERED_PX) {
    write(rest);
    return;
  }
  write([{ id, at: Math.round(at), len }, ...rest]);
}

/**
 * Where to open this note, in pixels — `0` when the answer is the top.
 *
 * Zero rather than null so the caller has no branch to get wrong: scrolling a
 * fresh note to 0 is what it was already doing.
 */
export function recallReadingPosition(id: string, len: number): number {
  const spot = read().find((s) => s.id === id);
  if (!spot || spot.len !== len) return 0;
  return spot.at;
}

/** Everything, forgotten — the account handoff in `store/db.ts`. */
export function forgetReadingPositions(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do and nothing worth saying.
  }
}
