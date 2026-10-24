import { DAY_MS } from "./when";
import type { Note } from "../types";

/**
 * The trash (SPEC §2.4).
 *
 * v1 forbade deletion outright, and that was too absolute: a note captured by
 * mistake, or a duplicate, is noise the archive has to carry forever. So there
 * is a delete — but it is a holding pen, not an incinerator. A trashed note is
 * whole, restorable, and untouched for a month before it goes.
 *
 * There is no `trashed_at` column and there does not need to be one: a note
 * enters the trash by being updated, so `updated_at` is when it happened, and
 * restoring it resets the clock by definition.
 */

export const TRASH_DAYS = 30;

/**
 * How long a permanent delete is remembered after it happened — the horizon
 * past which a tombstone is dropped, here and on the server (migration 0021's
 * `prune_note_tombstones`, which must say the same number).
 *
 * A tombstone exists so a device that was offline with an old copy cannot
 * resurrect a note the other device destroyed. A year past the delete there is
 * no such device — a phone that has not synced in a year is a phone somebody
 * replaced — and the store was the one thing in the app with no ceiling: read
 * whole twice per sync tick, and matched per upserted row on the server. What
 * a pruned tombstone can no longer prevent is a device restored from a backup
 * older than the horizon bringing a note back; that is a note returning, not
 * one being lost, and it is the trade.
 */
export const TOMBSTONE_DAYS = 365;


/**
 * When a note went into the trash, as near as the note can say.
 *
 * There is no `trashed_at`, and the status field's own clock is the next best
 * thing: it moves when the note is trashed and when it is put back, and nothing
 * else in the trash writes it. A note with no clocks at all (imported, or
 * written before migration 0011) falls back to `updated_at`, which is also what
 * the sweep counts its thirty days from.
 */
export function trashedAt(note: Note): string {
  return note.field_updated_at?.status ?? note.updated_at ?? "";
}

/**
 * The Trash's order: **the note deleted last stands first** (owner, 2026-10-23).
 * It used to be ordered by time left, oldest deletion first, so the note you had
 * just binned by mistake was at the bottom of the board. Ties fall back to the
 * last write, then the creation date, so the order is total.
 */
export function sortTrash(notes: readonly Note[]): Note[] {
  const at = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 0 : t;
  };
  return notes
    .map((note) => ({ note, gone: at(trashedAt(note)), wrote: at(note.updated_at), born: at(note.created_at ?? "") }))
    .sort((a, b) => b.gone - a.gone || b.wrote - a.wrote || b.born - a.born)
    .map((k) => k.note);
}

/** Notes whose month is up. Everything else in the trash is still restorable. */
export function expiredInTrash(notes: Note[], now = Date.now()): Note[] {
  const cutoff = now - TRASH_DAYS * DAY_MS;
  return notes.filter(
    (n) => n.status === "trashed" && Date.parse(n.updated_at) < cutoff,
  );
}

/**
 * Days left before a trashed note is destroyed, rounded up so "1" means "some
 * time today" rather than "already gone". 0 means it goes on the next sweep.
 */
export function daysLeftInTrash(note: Note, now = Date.now()): number {
  const gone = Date.parse(note.updated_at) + TRASH_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((gone - now) / DAY_MS));
}

/**
 * What a trashed card's stamp says: the days it has left ("29d"), "today" on the
 * last one, rather than the age of the last edit. Six characters at most. (The
 * board is now ordered newest deletion first, `sortTrash`; the stamp still
 * counts the days left.)
 */
export function trashMark(daysLeft: number): string {
  return daysLeft <= 0 ? "today" : `${daysLeft}d`;
}

/**
 * Close enough to the sweep to say so: the standing line at the top of the
 * **Trash board** (`closeToSweep` below, whose only reader is `trashWarnCount`
 * in `App.tsx`). Each **trashed card** counts its own days in the stamp
 * (`trashMark`), from the first day, and says nothing more in its footer — the
 * same number twice read as two warnings.
 * It does *not* ride on the shelf's trash count, whatever this comment used to
 * claim — that count is a plain number of trashed notes and says nothing about
 * the sweep. The warning is therefore on the Trash board itself, which is the
 * one screen you have no particular reason to visit.
 *
 * Three days is enough notice without turning the board into a countdown from
 * the day a note was deleted. It is deliberately passive — a standing fact,
 * not an offer with a countdown of its own.
 *
 * The sweep itself is silent, before and after (`sweepTrash` in
 * `store/useNotes.ts`): the month in the trash is the asking, and nothing is
 * announced when the notes go.
 */
export const TRASH_WARN_DAYS = 3;

/** Trashed notes near enough to their sweep to be worth mentioning. */
export function closeToSweep(notes: Note[], now = Date.now()): Note[] {
  return notes.filter(
    (n) => n.status === "trashed" && daysLeftInTrash(n, now) <= TRASH_WARN_DAYS,
  );
}
