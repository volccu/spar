import type { Note } from "../types";

/**
 * One definition of "which copy of this note is newer".
 *
 * It was written three times — in `sync.ts` to decide what a pull may apply,
 * in `db.ts` to defend the durable store from a stale row, and in `useNotes.ts`
 * to decide what reaches the screen — and the three disagreed. `useNotes` still
 * compared bare `updated_at`, so a note the store had accepted on a *field*
 * clock was thrown away before it was drawn: IndexedDB held the merged note and
 * the card on screen held the old one until the next reload. That is the same
 * failure `markerOf` exists to prevent, said about versions instead of markers.
 */

/**
 * The fields two devices may edit independently. Anything not on this list is
 * either immutable (`raw_content`, `id`, `created_at`) or bookkeeping the
 * server owns. It is mirrored by the `foreach` array in the migration that most
 * recently restated the merge trigger — **0020**, which put `reminder_repeat`
 * on it; **0016** before that, and 0011 before that. The client proposes
 * per-field clocks and the server enforces them, so the two lists have to say
 * the same thing, and `lib/constants.test.ts` checks them against each other —
 * against whichever migration is newest, rather than against a number written
 * here, because a pointer at the wrong file is how the next person edits the
 * wrong list. A mismatch is not rejected anywhere: the server simply never
 * merges the field, and it silently falls back to whole-row last-write-wins.
 */
export const CONFLICT_FIELDS = [
  "body", "note_type", "board_id", "status",
  "priority", "reminder_at", "reminder_repeat", "done", "merged_from", "merged_into",
  "attachments", "link_previews",
] as const;

export type FieldClocks = Record<string, string>;

/**
 * Compares two ISO-8601 timestamps as instants, not as strings.
 *
 * A row pulled from PostgREST keeps its stored precision — six fractional
 * digits and an explicit offset, e.g. `2026-08-14T12:00:00.123456+00:00` —
 * while a local write is `toISOString()`'s three-digit `...123Z`. Both sort
 * the same way `localeCompare` and `>` would almost all the time, since a
 * longer fractional part after an identical prefix still reads as "later" —
 * but that stops being true exactly at a genuine tie between a local and a
 * remote copy of the same instant, where the extra digits make the longer
 * string compare greater for reasons that have nothing to do with time.
 * Parsing removes that.
 *
 * Falls back to the string compare for anything `Date.parse` cannot read — an
 * empty string, most often — so every caller's existing "no clock yet"
 * sentinel keeps behaving exactly as it did before.
 */
export function cmpIso(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A stamp read once, for a sort: its instant and the text to fall back on.
 *
 * `cmpIso` parses both sides on every call, and a comparison sort calls it
 * O(n log n) times — on a board of 3,000 notes that was 33–39 ms of
 * `Date.parse` per sort, re-run on every note change (audit PERF-5). A sort
 * reads each note's stamps into one of these first and compares with
 * `cmpStamp`, which decides exactly as `cmpIso` would.
 */
export interface SortStamp {
  s: string;
  /** `Date.parse` of the text, filled in the first time a comparison needs it;
   *  NaN when it cannot be read. Lazy because a search sort is mostly decided
   *  by the score and reaches the stamps only on a tie. */
  t?: number;
}

export function sortStamp(iso: string): SortStamp {
  return { s: iso };
}

/** `cmpIso` over stamps parsed once: instants when both read, else text. */
export function cmpStamp(a: SortStamp, b: SortStamp): number {
  const ta = (a.t ??= Date.parse(a.s));
  const tb = (b.t ??= Date.parse(b.s));
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
}

/** Whether `a` names a strictly later instant than `b`. */
function isoAfter(a: string, b: string): boolean {
  return cmpIso(a, b) > 0;
}

/** True for a clock object that actually says something. */
function usable(clocks: FieldClocks | undefined): clocks is FieldClocks {
  return Boolean(clocks) && Object.keys(clocks as FieldClocks).length > 0;
}

/**
 * The per-field clocks for a note, inventing them from `updated_at` when the
 * note predates them. Every note written before migration 0011 is in that
 * state, and so is every note the importer made.
 */
export function fieldClocks(note: Note): FieldClocks {
  const stored = note.field_updated_at;
  if (usable(stored)) return { ...stored };
  return Object.fromEntries(CONFLICT_FIELDS.map((field) => [field, note.updated_at]));
}

/**
 * The fields that mean the note itself was *edited*, as opposed to filed.
 *
 * `updated_at` moves for everything — archiving, priority, a tag, an upload
 * recording where the bytes landed — so it answers "when was this row last
 * written", which is a question about the database. "When did I last change
 * this note" is a question about the note, and the per-field clocks already
 * hold the answer: the words, and the files carried beside them. Both are the
 * note's content. Everything else on CONFLICT_FIELDS is organising, and
 * organising a note is not editing it — otherwise archiving twelve notes would
 * pull all twelve to the top of the board as if they had just been written.
 */
const CONTENT_FIELDS = ["body", "attachments"] as const;

/**
 * When the note was last actually edited.
 *
 * Falls back to `updated_at` for a note with no clocks at all — every note the
 * importer made, and everything written before migration 0011 — which is the
 * honest answer when there is nothing finer to ask, and for those notes is
 * usually their creation date anyway. That fallback is only ever reached by a
 * note that has never been written locally: the first local write seeds the
 * full clock set from the pre-write `updated_at` (`localPatch` in
 * `store/useNotes.ts`), so the old edit time becomes a real `body` clock and
 * organising an imported note no longer reads as editing it. Never earlier
 * than `created_at`: a stamp
 * claiming a note was edited before it existed is a clock disagreement, not a
 * fact, and the same reasoning `spanOf` clamps the future for.
 */
export function editedAt(note: Note): string {
  const clocks = note.field_updated_at;
  let latest = "";
  if (clocks) {
    for (const field of CONTENT_FIELDS) {
      const stamp = clocks[field];
      if (stamp && isoAfter(stamp, latest)) latest = stamp;
    }
  }
  if (!latest) latest = note.updated_at ?? "";
  const born = note.created_at ?? "";
  return isoAfter(latest, born) ? latest : born;
}

/**
 * How long a note's own files may take to land before the path they come back
 * with reads as an edit. `createWithFiles` stamps their clock with
 * `created_at`, but on a device that syncs, recording where the upload landed
 * has to move that clock again — the server's merge keeps a field whose clock
 * did not advance (`applyUploaded`, `store/useNotes.ts`) — so a note captured
 * with a photo said "Edited" seconds after Save (dogfooding 2026-10-18). Words
 * get no such allowance: a typo fixed ten seconds after Save is an edit
 * (code review 2026-10-19).
 */
const FILES_LAND_MS = 60_000;

/** Whether the note has been changed since it was written. */
export function wasEdited(note: Note): boolean {
  const born = note.created_at ?? "";
  const words = note.field_updated_at?.body;
  const files = note.field_updated_at?.attachments;
  if (!words && !files) return isoAfter(editedAt(note), born);
  if (words && isoAfter(words, born)) return true;
  return files !== undefined && Date.parse(files) - Date.parse(born) >= FILES_LAND_MS;
}

/**
 * Whether a row from the server carries anything this device has not got.
 *
 * The clocks are only asked when *both* sides have some. An empty `{}` is not a
 * statement that nothing changed — it is the absence of one, and it is the
 * normal state of every row written before 0011 landed: 267 of the 276 rows in
 * the live archive have exactly that. Read as a statement, `Object.entries({})`
 * finds no field newer and the row is silently dropped, so a change made
 * anywhere but in a 0011-aware client (the since-removed enrichment function
 * was one) could never reach the device again. Treating an empty clock set as
 * *absent* falls back to `updated_at`, which is the honest answer when there is
 * nothing finer to ask.
 */
export function remoteIsNewer(local: Note, remote: Note): boolean {
  const mine = local.field_updated_at;
  const theirs = remote.field_updated_at;
  if (usable(mine) && usable(theirs)) {
    return Object.entries(theirs).some(([field, stamp]) => isoAfter(stamp, mine[field] ?? ""));
  }
  return isoAfter(remote.updated_at, local.updated_at);
}

/**
 * Merges two independently edited copies field by field, newest clock wins.
 * The remote row is the base because the server holds the columns this client
 * may not know about; only fields this device holds a newer clock for are
 * carried over from the local copy.
 */
export function mergeNoteFields(local: Note, remote: Note): Note {
  const localClocks = fieldClocks(local);
  const remoteClocks = fieldClocks(remote);
  const merged: Note = { ...remote };
  const clocks: FieldClocks = { ...remoteClocks };
  for (const field of CONFLICT_FIELDS) {
    if (isoAfter(localClocks[field] ?? "", remoteClocks[field] ?? "")) {
      (merged as unknown as Record<string, unknown>)[field] =
        (local as unknown as Record<string, unknown>)[field];
      clocks[field] = localClocks[field];
    }
  }
  merged.updated_at = isoAfter(local.updated_at, remote.updated_at) ? local.updated_at : remote.updated_at;
  merged.field_updated_at = clocks;
  return merged;
}

/**
 * A note let go of, said in the same list as the rows a pull brings down or
 * another tab wrote (`applyRemote` in `store/useNotes.ts`): an id and a flag,
 * with no fields to merge. It travels as a `Note` so the list stays one list,
 * and the casts that make that true live here and nowhere else.
 */
export function deletionMarker(id: string): Note {
  return { id, __deleted: true } as unknown as Note;
}

export function isDeletionMarker(note: Note): boolean {
  return Boolean((note as Note & { __deleted?: true }).__deleted);
}
