import type { Canvas, Note, UserBoard } from "../types";
import { getBackend, type Row } from "./backend";
import { getMeta } from "./db";
import { reallyMissing } from "./capability";
import {
  FOLDERS_CURSOR,
  NOTES_CURSOR,
  TOMBSTONES_CURSOR,
  laterCursor,
  readCursor,
  repairStart,
  type Cursor,
} from "./cursors";
import { noteFromRow } from "./sync";
import { canvasFromRow } from "./canvasSync";

/**
 * The four pulls a tick makes, asked as one question (migration 0022).
 *
 * An idle tick — nothing to push, which is nearly every tick — used to be
 * four round trips standing single file: tombstones, notes, canvases, prefs.
 * The answers do not depend on each other, so `pull_changes` returns all four
 * for the three cursors this device keeps, and the tick hands each part to
 * the module that would have fetched it. Every rule those modules apply —
 * tombstones before the push, the outbox winning over a pull, the canvas
 * conflict rule, the prefs row read only when nothing is dirty — is still
 * applied by them; this only changes *when the bytes arrive*, not what is
 * done with them.
 *
 * A server that has not run the migration says so once (`PGRST202`), the
 * answer is remembered for the session, and the tick goes on exactly as it
 * did before. Any other failure is raised, the same as a failed pull.
 */

export const PULL_PAGE = 500;

export interface Page<T> {
  rows: T[];
  /** Where this page ended, or null when it held nothing. */
  cursor: Cursor | null;
  /** False when the page was full and there may be more behind it. */
  complete: boolean;
}

export interface TombstoneRow {
  id: string;
  deleted_at: string;
}

export interface RemotePrefs {
  boards: UserBoard[];
  at: string;
  inboxSince: string | null;
}

export interface Ahead {
  notes: Page<Note>;
  tombstones: Page<TombstoneRow>;
  folders: Page<Canvas>;
  /** The row, or null for a server that holds none for this person. */
  prefs: RemotePrefs | null;
}

let known: boolean | null = null;

/** For sign-out and tests: the next tick asks the server again. */
export function resetPullChanges(): void {
  known = null;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

export async function pullChanges(): Promise<Ahead | null> {
  if (known === false) return null;
  const backend = await getBackend();
  if (!backend) return null;

  const [notesSaved, tombstonesSaved, foldersSaved] = await Promise.all([
    getMeta<Cursor | string>(NOTES_CURSOR),
    getMeta<Cursor | string>(TOMBSTONES_CURSOR),
    getMeta<Cursor | string>(FOLDERS_CURSOR),
  ]);
  // Every cursor steps back over the repair window exactly as its plain pull
  // does (`repairStart`); each `latest` only ever moves forward from where it
  // was saved. Deletes take it too: the server stamps one `now()` when its
  // transaction runs, several run at once, and one that commits after this
  // device has read past its instant was otherwise never seen here.
  const notesSince = readCursor(notesSaved);
  let notesCursor = repairStart(notesSince);
  let notesLatest = notesSince;
  const tombstonesSince = readCursor(tombstonesSaved);
  let tombstonesCursor = repairStart(tombstonesSince);
  let tombstonesLatest = tombstonesSince;
  const foldersSince = readCursor(foldersSaved);
  let foldersCursor = repairStart(foldersSince);
  let foldersLatest = foldersSince;

  const ahead: Ahead = {
    notes: { rows: [], cursor: null, complete: true },
    tombstones: { rows: [], cursor: null, complete: true },
    folders: { rows: [], cursor: null, complete: true },
    prefs: null,
  };

  for (;;) {
    const { data, error } = await backend.pullChanges({
      notes: notesCursor,
      tombstones: tombstonesCursor,
      folders: foldersCursor,
      limit: PULL_PAGE,
    });
    if (error) {
      if (known === null && reallyMissing(error)) {
        known = false;
        return null;
      }
      throw new Error(error.message);
    }
    known = true;
    const answer = (data ?? {}) as Row;

    const notes = rows(answer.notes);
    if (notes.length > 0) {
      ahead.notes.rows.push(...notes.map(noteFromRow));
      const last = notes[notes.length - 1];
      notesCursor = { at: String(last.updated_at), id: String(last.id) };
      if (laterCursor(notesCursor, notesLatest)) notesLatest = notesCursor;
      ahead.notes.cursor = notesLatest;
    }
    const tombstones = rows(answer.tombstones);
    if (tombstones.length > 0) {
      ahead.tombstones.rows.push(
        ...tombstones.map((row) => ({ id: String(row.note_id), deleted_at: String(row.deleted_at) })),
      );
      const last = tombstones[tombstones.length - 1];
      tombstonesCursor = { at: String(last.deleted_at), id: String(last.note_id) };
      if (laterCursor(tombstonesCursor, tombstonesLatest)) tombstonesLatest = tombstonesCursor;
      ahead.tombstones.cursor = tombstonesLatest;
    }
    const folders = rows(answer.folders);
    if (folders.length > 0) {
      ahead.folders.rows.push(...folders.map(canvasFromRow));
      const last = folders[folders.length - 1];
      foldersCursor = { at: String(last.updated_at), id: String(last.id) };
      if (laterCursor(foldersCursor, foldersLatest)) foldersLatest = foldersCursor;
      ahead.folders.cursor = foldersLatest;
    }
    const prefs = answer.prefs as Row | null | undefined;
    ahead.prefs = prefs
      ? {
          boards: (prefs.boards as UserBoard[] | null) ?? [],
          at: String(prefs.updated_at),
          inboxSince: (prefs.inbox_since as string | null) ?? null,
        }
      : null;

    // A full page may have more behind it; the next page is asked for with
    // every cursor advanced, so a list already drained answers empty.
    const more =
      notes.length >= PULL_PAGE || tombstones.length >= PULL_PAGE || folders.length >= PULL_PAGE;
    if (!more) break;
  }
  return ahead;
}
