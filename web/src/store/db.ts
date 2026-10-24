import { announceWritten } from "./tabs";
import { nowIso } from "../lib/when";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { TOMBSTONE_DAYS } from "../lib/trash";
import type { Attachment, Note, Canvas } from "../types";
import type { PdfTextOutcome } from "../lib/pdfWords";
import type { ImageTextOutcome } from "../lib/imageWords";
import { looksArranged } from "../lib/canvas";
import { mergeNoteFields, remoteIsNewer } from "../lib/versions";
import { forgetReadingPositions } from "../lib/readingPosition";
import { clearUnsaved, readUnsaved } from "./unsavedStash";
// The two cache names, from the modules that own them — never spelled again
// here. `purgeEverything` is the third reader of each; the workers are the
// other, and they cannot import (see `purgeWorkerInboxes`).
import { SHARE_INBOX } from "../lib/shareTarget";
import { ANSWER_INBOX } from "../lib/reminderActions";

/**
 * The local store is the UI's source of truth (SPEC §3). The server is a sync
 * target reached through the `dirty` store below, which acts as the outbox:
 * every local write records the note as needing upload, and sync clears it
 * once the server has accepted it. Nothing is lost if the app closes midway.
 *
 * An outbox entry holds the `updated_at` of the version that made it dirty, and
 * that is what makes crossing one off safe. Sync sends a note and clears it
 * afterwards, and the upload takes long enough to type into — so an edit that
 * lands mid-flight used to be crossed off along with the version that was
 * actually sent, and simply never went up. Now the entry is only removed if it
 * still names the version that went, so an edit made during a sync survives it.
 */

interface SparDB extends DBSchema {
  notes: {
    key: string;
    value: Note;
    indexes: { by_created: string; by_status: string };
  };
  meta: { key: string; value: unknown };
  /** Note id -> the `updated_at` of the version waiting to be uploaded. */
  dirty: { key: string; value: string };
  /** Attachment bytes, keyed by attachment id. The note row carries the rest. */
  files: { key: string; value: Blob };
  /** Spatial folders, keyed by their idea note id. */
  folders: { key: string; value: Canvas };
  /** The folder outbox, under exactly the rule `dirty` runs for notes. */
  folderDirty: { key: string; value: string };
  /** Permanent note deletions that must be remembered across offline periods. */
  tombstones: { key: string; value: Tombstone };
  /** Tombstones waiting to be acknowledged by the server. */
  tombstoneDirty: { key: string; value: string };
  /** Attachment id -> the words read out of that PDF, on this device. */
  pdfText: { key: string; value: PdfTextEntry };
  /** Attachment id -> the words read out of that picture, on this device. */
  imageText: { key: string; value: ImageTextEntry };
}

/**
 * The words in a screenshot or a photograph, read on this device and never
 * sent anywhere (FX-A-07). The same bargain as `PdfTextEntry`: derived from
 * bytes already here, local, never synced, never a column, taken by
 * `purgeEverything`, and read again only when `IMAGE_TEXT_VERSION` in
 * `store/imageTextReader.ts` is bumped.
 */
export interface ImageTextEntry {
  v: number;
  outcome: ImageTextOutcome;
  text: string;
}

/**
 * A document's text layer, read once per device so search can match it.
 *
 * **Local, never synced, and never a column.** It is derived from bytes both
 * devices can hold, so each one derives it for itself the first time it has
 * the file — the same bargain the card-sized image copies make, kept on disk
 * rather than in memory because reading a PDF's words costs the engine and
 * the engine is half a megabyte. Nothing here is authoritative: losing the
 * whole store costs one more read of each document, and `purgeEverything`
 * takes it with the rest.
 *
 * `v` is the extractor's version. A better reader (a new page cap, a smarter
 * join) bumps `PDF_TEXT_VERSION` in `store/pdfTextReader.ts`, and every entry written
 * under an older one is simply read again.
 */
export interface PdfTextEntry {
  v: number;
  outcome: PdfTextOutcome;
  text: string;
}

export interface Tombstone {
  id: string;
  deleted_at: string;
  expected_updated_at?: string;
  /**
   * The attachments the note was carrying, held until the server confirms the
   * delete.
   *
   * They used to be destroyed the moment the user emptied the trash — before
   * the server had agreed to anything. But `permanently_delete_note` can
   * refuse: it declines if the note is no longer trashed on the server, or if
   * its `updated_at` has moved past what this device expected. Destroying them
   * is now the last step, not the first: `purgeTombstoneFiles` runs only once
   * the server has actually taken the delete.
   *
   * **What a refusal does, said exactly, because this comment used to overstate
   * it and that is part of why the gap survived a review.** Nothing here
   * restores anything. `forgetTombstones` drops the marker, which is all this
   * store can do — the note itself was removed by `deleteNotes` before the
   * server was ever asked. Coming back is `sync.ts`'s job: the refused ids go
   * on the deferred-pull list and the same turn's pull fetches them by id.
   * Until that existed, a refused delete meant the note was gone here, alive on
   * the server, and past the pull cursor, so nothing ever mentioned it again.
   * The bytes below are what make that recovery whole rather than a note with
   * empty frames in it — they were never destroyed, so the file store still has
   * them under the same attachment ids the returning note names.
   */
  attachments?: Attachment[];
  /**
   * What this device believed about the note when it destroyed it — its status
   * and its per-field clocks.
   *
   * Only one question is ever asked of them, and it is asked once, in
   * `pushTombstones`, when the server has *refused* a delete. A refusal has two
   * causes that look identical from here: the other device restored the note,
   * or this device's own "trashed" write never got out (trash a note offline,
   * empty the trash offline, and `deleteNotes` throws the note and its outbox
   * entry away together — so the server is still holding an *active* note and
   * `permanently_delete_note` will not take a delete for one). Treating both as
   * a restore is what made a deliberate destroy come back as an ordinary
   * active note on the board, which is the worse of the two ways to be wrong.
   *
   * With these, the two can be told apart by asking the server what clock it
   * holds for `status`: newer than this one means somebody really did restore
   * it, older means this device is holding a write the server has never seen.
   */
  believed?: { status: Note["status"]; clocks: Record<string, string> };
}

const DB_NAME = "spar";
const DB_VERSION = 8;

let dbPromise: Promise<IDBPDatabase<SparDB>> | null = null;

function db() {
  if (!dbPromise) {
    // A blocked upgrade does not fail — it *hangs*. `openDB` keeps waiting for
    // the other tab to let go and never settles either way, so the load path's
    // own `catch` (which already has exactly the right words for this) could
    // never fire and the app sat on its spinner. Racing the open against a
    // promise the `blocked` callback rejects turns the one condition that
    // stalls forever into an ordinary failure, which the UI already reports.
    let sayBlocked: (reason: Error) => void = () => {};
    const blocked = new Promise<never>((_, reject) => {
      sayBlocked = reject;
    });
    const opening = openDB<SparDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const notes = database.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("by_created", "created_at");
          notes.createIndex("by_status", "status");
          database.createObjectStore("meta");
        }
        if (oldVersion < 2) {
          database.createObjectStore("dirty");
        }
        if (oldVersion < 3) {
          database.createObjectStore("files");
        }
        if (oldVersion < 4) {
          database.createObjectStore("folders", { keyPath: "id" });
        }
        if (oldVersion < 5) {
          database.createObjectStore("folderDirty");
          // Folders that predate the outbox. Every one written since says for
          // itself whether it travels, by being queued or not; these were all
          // written before there was anywhere to say it, so the ones carrying
          // evidence of an actual arrangement are queued now and go up on the
          // next sync. Without this, a canvas laid out before folders synced
          // would sit on that device for ever, waiting to be touched again.
          if (oldVersion >= 4) {
            const existing = transaction.objectStore("folders");
            const queue = transaction.objectStore("folderDirty");
            // Chained rather than awaited — `upgrade` is not declared async
            // and `openDB` does not wait on it, only on the underlying
            // versionchange transaction, which these requests keep alive as
            // long as each one lands before the microtask queue drains. A
            // failure here used to disappear as an unhandled rejection;
            // caught now so it is at least visible instead of silently
            // leaving some canvases un-queued.
            existing
              .getAll()
              .then((folders) => {
                for (const folder of folders) {
                  if (looksArranged(folder)) void queue.put(folder.updated_at, folder.id);
                }
              })
              .catch((err) => {
                console.error("spår: failed to queue pre-outbox folders for sync", err);
              });
          }
        }
        if (oldVersion < 6) {
          database.createObjectStore("tombstones", { keyPath: "id" });
          database.createObjectStore("tombstoneDirty");
        }
        if (oldVersion < 7) {
          // Keyed by attachment id, out of line, like `files` beside it.
          // Nothing to backfill: an empty store only means every PDF is read
          // once more, at idle, which is what a fresh device does anyway.
          database.createObjectStore("pdfText");
        }
        if (oldVersion < 8) {
          // Same shape as `pdfText`, and for the same reason nothing is
          // backfilled: an empty store is a device that has not read its
          // pictures yet.
          database.createObjectStore("imageText");
        }
      },
      /**
       * Another tab is still holding the previous schema version.
       *
       * Without this the upgrade simply never runs, the open promise never
       * settles, and this tab shows its loading state forever — the same dead
       * end an unhandled read error used to produce, reached a different way.
       * Neither tab says anything, so it reads as the app being broken rather
       * than as one tab too many. It cannot be resolved from here; naming it is
       * what lets `useNotes` tell the user which thing to close — which it can
       * only do if the open actually settles, hence the rejection below.
       */
      blocked(currentVersion, blockedVersion) {
        const message =
          `spår: another tab is holding database version ${currentVersion}; ` +
          `this tab needs ${blockedVersion ?? DB_VERSION}. Close the other tab and reload.`;
        console.error(message);
        sayBlocked(new Error(message));
      },
      /**
       * This tab is the one in the way: a newer tab wants to upgrade. Let go,
       * so the other tab is not the one left hanging — the reverse of the case
       * above, and the reason a version bump does not need every tab closed by
       * hand. Reads after this fail, which the load path now reports.
       */
      blocking() {
        console.warn("spår: closing this tab's database so a newer version can upgrade");
        // `opening`, not `dbPromise`: this tab only blocks a newer one once its
        // own open has succeeded, and `dbPromise` is now a race that may have
        // rejected — attaching `.then` to that would raise an unhandled
        // rejection on the way past.
        void opening.then((database) => database.close());
        dbPromise = null;
      },
    });
    dbPromise = Promise.race([opening, blocked]);
  }
  return dbPromise;
}

export async function allNotes(): Promise<Note[]> {
  return (await db()).getAll("notes");
}

export async function allCanvases(): Promise<Canvas[]> {
  return (await db()).getAll("folders");
}

/**
 * An arrangement the user made. Queued for upload like any other local write.
 */
export async function putCanvasSynced(folder: Canvas): Promise<void> {
  const database = await db();
  const tx = database.transaction(["folders", "folderDirty"], "readwrite");
  await Promise.all([
    tx.objectStore("folders").put(folder),
    tx.objectStore("folderDirty").put(folder.updated_at, folder.id),
    tx.done,
  ]);
}

/**
 * A folder written without joining the outbox, for the two cases where nobody
 * asked for one: a pull from the server, and the default layout the app invents
 * the first time an idea is opened.
 *
 * That second case is the whole reason this function exists. The default layout
 * is not a decision — it is derived from the source notes, and every device
 * derives the same one. Queued, it would upload with today's timestamp and
 * overwrite an arrangement made on the laptop last week, purely because the
 * phone opened the idea once. Nothing is lost by staying quiet: an untouched
 * canvas is reconstructible from the notes, which is exactly what the grid
 * card's miniature already does.
 */
export async function putCanvasLocalOnly(folder: Canvas): Promise<void> {
  await (await db()).put("folders", folder);
}

export async function putCanvasesLocalOnly(folders: Canvas[]): Promise<void> {
  if (folders.length === 0) return;
  const tx = (await db()).transaction("folders", "readwrite");
  await Promise.all([...folders.map((f) => tx.store.put(f)), tx.done]);
}

/** A local write. Records the note in the outbox so sync will upload it. */
export async function putNote(note: Note): Promise<void> {
  return putNotes([note]);
}

/** The named notes as the store holds them now; a destroyed one is absent. */
export async function getNotes(ids: string[]): Promise<Map<string, Note>> {
  const store = (await db()).transaction("notes").objectStore("notes");
  const rows = await Promise.all(ids.map((id) => store.get(id)));
  const found = new Map<string, Note>();
  for (const row of rows) if (row) found.set(row.id, row);
  return found;
}

/**
 * A local write, merged over anything newer the store already holds.
 *
 * The note handed in is the screen's copy, and a pull can store a newer one in
 * the moment before the screen is told — a typing pause ending then wrote the
 * old copy straight over it, and another device's archive was undone on this
 * one, past the cursor, for good. So a stored field with a newer clock stays,
 * read in the same transaction as the write; every field this edit changed
 * still wins on its own newer clock. The outbox stamp is the merged row's, which
 * can be ahead of the screen's copy for a moment: its entry then stays until the
 * pull reaches the screen, costing one more upload, never an edit.
 */
export async function putNotes(notes: Note[]): Promise<void> {
  if (notes.length === 0) return;
  const database = await db();
  const tx = database.transaction(["notes", "dirty"], "readwrite");
  const noteStore = tx.objectStore("notes");
  const dirtyStore = tx.objectStore("dirty");
  const write = async (n: Note) => {
    const stored = await noteStore.get(n.id);
    const row =
      stored && stored.field_updated_at && n.field_updated_at && remoteIsNewer(n, stored)
        ? mergeNoteFields(n, stored)
        : n;
    await Promise.all([noteStore.put(row), dirtyStore.put(row.updated_at, row.id)]);
  };
  await Promise.all([...notes.map(write), tx.done]);
  announceWritten(notes.map((n) => n.id));
}

/**
 * Applies rows the server sent, and reports the ones it had to put back.
 *
 * A pending local write wins over a pull, even when the pull has a later
 * timestamp: it has not reached the server yet and must not be replaced before
 * the outbox can send it. The comparison lives in the same IndexedDB
 * transaction as the write, which protects the durable copy as well as the
 * React state from a stale pull.
 *
 * `deferred` is only the notes skipped because this device still has unsent
 * work for them. That skip is right — an unsent local edit must not be
 * overwritten by the copy it was made from — but the caller used to throw the
 * information away and advance the pull cursor regardless, so the discarded
 * change was never offered again. A note that stays in the outbox therefore
 * stopped receiving remote changes altogether, and the two devices showed
 * different text for it indefinitely, with nothing to say so. Naming them lets
 * sync fetch them again by id next turn.
 *
 * The other two skips are final and deliberately not reported: a tombstoned
 * note must never come back, and a row that simply is not newer than the local
 * copy has nothing to offer.
 */
export async function putNotesFromServer(
  notes: Note[],
): Promise<{ accepted: Note[]; deferred: string[] }> {
  if (notes.length === 0) return { accepted: [], deferred: [] };
  const tx = (await db()).transaction(["notes", "dirty", "tombstones"], "readwrite");
  const accepted: Note[] = [];
  const deferred: string[] = [];
  for (const note of notes) {
    const [local, pending, tombstone] = await Promise.all([
      tx.objectStore("notes").get(note.id),
      tx.objectStore("dirty").get(note.id),
      tx.objectStore("tombstones").get(note.id),
    ]);
    if (pending !== undefined) {
      deferred.push(note.id);
      continue;
    }
    if (tombstone) continue;
    if (local && !remoteIsNewer(local, note)) continue;
    await tx.objectStore("notes").put(note);
    accepted.push(note);
  }
  await tx.done;
  announceWritten(accepted.map((n) => n.id));
  return { accepted, deferred };
}

/** A note waiting to be uploaded, and the version of it that is waiting. */
export interface DirtyEntry {
  id: string;
  stamp: string;
}

export async function allTombstones(): Promise<Tombstone[]> {
  return (await db()).getAll("tombstones");
}

export async function dirtyTombstoneEntries(): Promise<DirtyEntry[]> {
  return readOutbox("tombstoneDirty");
}

export async function clearTombstoneDirtySent(sent: DirtyEntry[]): Promise<void> {
  return clearOutbox("tombstoneDirty", sent);
}

/**
 * Destroys notes locally. Only ever called for notes that have already served
 * their month in the trash, or that the user emptied by hand — never as part
 * of an ordinary edit. Also clears any outbox entry, so a note cannot be
 * uploaded again after it has been deleted.
 *
 * A destroyed idea takes its canvas with it. A folder is keyed by the idea's own
 * id and means nothing without it, so leaving one behind is an orphan that
 * nothing will ever open or sweep — the server says the same thing with the
 * cascade on the foreign key (migration 0010).
 *
 * A tombstone is left behind, so the delete is durable and travels: it is what
 * stops the note being resurrected by a pull, on this device or another.
 *
 * The note's attachment bytes are *kept* here and handed to the tombstone
 * instead — unlike `applyRemoteTombstones`, where the server has already
 * destroyed the note and there is nothing left to come back to. Here the
 * server has not agreed yet and can still refuse, so the bytes are destroyed
 * by `purgeTombstoneFiles` once it has. See `Tombstone.attachments`.
 */
export async function deleteNotes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await db();
  const tx = database.transaction(
    ["notes", "dirty", "folders", "folderDirty", "tombstones", "tombstoneDirty"],
    "readwrite",
  );
  const notes = tx.objectStore("notes");
  const dirty = tx.objectStore("dirty");
  const folders = tx.objectStore("folders");
  const folderDirty = tx.objectStore("folderDirty");
  const tombstones = tx.objectStore("tombstones");
  const tombstoneDirty = tx.objectStore("tombstoneDirty");
  const deletedAt = nowIso();
  const expected = new Map<string, string>();
  const carried = new Map<string, Attachment[]>();
  const believed = new Map<string, Tombstone["believed"]>();
  /**
   * Ids already gone from this device with a marker standing for them — a
   * second destroy of the same note (audit DATA-7, 2026-10-10). Writing a new
   * marker over the old one dropped its `attachments` and `believed`: the
   * held bytes became orphans, and a refused delete then read as a restore.
   * The marker already says everything a second one would, so it is left.
   */
  const marked = new Set<string>();
  for (const id of ids) {
    const note = await notes.get(id);
    if (!note && (await tombstones.get(id))) {
      marked.add(id);
      continue;
    }
    if (note?.updated_at) expected.set(id, note.updated_at);
    // Recorded, not destroyed. `purgeTombstoneFiles` does that once the server
    // has actually taken the delete — see `Tombstone.attachments`.
    if (note?.attachments?.length) carried.set(id, note.attachments);
    // The one thing that survives the note itself, so a refused delete can be
    // told from a restore. See `Tombstone.believed`.
    if (note) {
      believed.set(id, {
        status: note.status,
        clocks: { ...(note.field_updated_at ?? {}) },
      });
    }
  }
  await Promise.all([
    ...ids.filter((id) => !marked.has(id)).flatMap((id) => [
      notes.delete(id),
      dirty.delete(id),
      folders.delete(id),
      folderDirty.delete(id),
      tombstones.put({
        id,
        deleted_at: deletedAt,
        expected_updated_at: expected.get(id) ?? deletedAt,
        ...(carried.has(id) ? { attachments: carried.get(id) } : {}),
        ...(believed.has(id) ? { believed: believed.get(id) } : {}),
      }),
      tombstoneDirty.put(deletedAt, id),
    ]),
    tx.done,
  ]);
  announceWritten(ids);
}

/**
 * Destroys the bytes a permanently-deleted note was carrying, once the server
 * has confirmed the note itself is gone.
 *
 * Returns what has to be removed from storage as well, so the caller can do
 * that half. Anything whose upload never finished has no `path`, so there is
 * nothing remote to remove — and that is exactly the file whose local copy was
 * the only one, which is why this waits for the confirmation.
 */
export async function purgeTombstoneFiles(ids: string[]): Promise<Attachment[]> {
  if (ids.length === 0) return [];
  const tx = (await db()).transaction(["tombstones", "files"], "readwrite");
  const store = tx.objectStore("tombstones");
  const remote: Attachment[] = [];
  const pending: Promise<unknown>[] = [];
  for (const id of ids) {
    const tombstone = await store.get(id);
    const attachments = tombstone?.attachments ?? [];
    if (attachments.length === 0) continue;
    for (const attachment of attachments) {
      pending.push(tx.objectStore("files").delete(attachment.id));
      if (attachment.path) remote.push(attachment);
    }
    // The tombstone stays — it is what stops the note coming back — but it no
    // longer needs to carry a list of files that no longer exist.
    const { attachments: _spent, ...rest } = tombstone!;
    pending.push(store.put(rest));
  }
  await Promise.all([...pending, tx.done]);
  return remote;
}

/** Drops a local delete marker when the server proves the note was restored. */
export async function forgetTombstones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = (await db()).transaction(["tombstones", "tombstoneDirty"], "readwrite");
  await Promise.all([
    ...ids.flatMap((id) => [tx.objectStore("tombstones").delete(id), tx.objectStore("tombstoneDirty").delete(id)]),
    tx.done,
  ]);
}

/**
 * Drops delete markers older than `TOMBSTONE_DAYS`, and never one that is
 * still waiting to go up — an unsent delete is the only record that the note
 * was destroyed here, and it stays until the server has taken it, however
 * old it gets. Returns how many went. Runs on open beside the trash sweep.
 */
export async function pruneTombstones(now = Date.now()): Promise<number> {
  const cutoff = now - TOMBSTONE_DAYS * 86_400_000;
  const tx = (await db()).transaction(["tombstones", "tombstoneDirty"], "readwrite");
  const tombstones = tx.objectStore("tombstones");
  const dirty = tx.objectStore("tombstoneDirty");
  let gone = 0;
  for (const tombstone of await tombstones.getAll()) {
    if (!(Date.parse(tombstone.deleted_at) < cutoff)) continue;
    if ((await dirty.get(tombstone.id)) !== undefined) continue;
    await tombstones.delete(tombstone.id);
    gone += 1;
  }
  await tx.done;
  return gone;
}

/** Applies remote permanent deletes without re-queueing them for upload. */
export async function applyRemoteTombstones(
  rows: { id: string; deleted_at?: string }[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  const database = await db();
  const tx = database.transaction(
    ["notes", "dirty", "folders", "folderDirty", "tombstones", "tombstoneDirty", "files"],
    "readwrite",
  );
  const notes = tx.objectStore("notes");
  const dirty = tx.objectStore("dirty");
  const folders = tx.objectStore("folders");
  const folderDirty = tx.objectStore("folderDirty");
  const tombstones = tx.objectStore("tombstones");
  const tombstoneDirty = tx.objectStore("tombstoneDirty");
  const files = tx.objectStore("files");
  const attachmentIds: string[] = [];
  const now = nowIso();
  for (const { id, deleted_at } of rows) {
    const note = await notes.get(id);
    // The marker keeps the server's own instant, and whatever this device
    // already held about the delete. Stamped "now" instead, a fresh device
    // pulling a year of old deletes kept every one of them for a further
    // year (`pruneTombstones` counts from `deleted_at`); and a marker this
    // device had made itself, attachments and all, was replaced by a bare
    // one, so the files it listed were never purged from storage.
    const held = await tombstones.get(id);
    // The bytes go with the note: its own files, and the ones this device's
    // marker was still holding for a delete of its own. Only the first list
    // used to be read, and when this device had already destroyed the note it
    // is empty — the note is no longer in the store — so the marker's files
    // stayed in `files` for good: the outbox entry that would have had
    // `purgeTombstoneFiles` take them is cleared right here. The server has
    // destroyed the note, so nothing is coming back to hold them.
    const fileIds = new Set(
      [...(note?.attachments ?? []), ...(held?.attachments ?? [])].map((attachment) => attachment.id),
    );
    attachmentIds.push(...fileIds);
    await Promise.all([
      notes.delete(id),
      dirty.delete(id),
      folders.delete(id),
      folderDirty.delete(id),
      tombstones.put({ ...held, id, deleted_at: deleted_at ?? held?.deleted_at ?? now }),
      tombstoneDirty.delete(id),
      ...[...fileIds].map((fileId) => files.delete(fileId)),
    ]);
  }
  await tx.done;
  announceWritten(rows.map((row) => row.id));
  return attachmentIds;
}

/** The two outboxes, which run the identical rule over different things. */
type Outbox = "dirty" | "folderDirty" | "tombstoneDirty";

/**
 * An outbox, read whole. Keys and values are both returned in key order, so
 * the two lists line up by index.
 */
async function readOutbox(name: Outbox): Promise<DirtyEntry[]> {
  const tx = (await db()).transaction(name, "readonly");
  const [ids, stamps] = await Promise.all([
    tx.store.getAllKeys(),
    tx.store.getAll(),
  ]);
  await tx.done;
  return (ids as string[]).map((id, i) => ({ id, stamp: stamps[i] }));
}

/**
 * Crosses off only the entries that still name the version that was uploaded.
 * An entry re-stamped by an edit made during the upload is left alone, so the
 * next sync sends it — sending the same note twice costs nothing, because the
 * upload is an upsert keyed on the note's own id, and losing an edit costs a lot.
 *
 * Entries written before the outbox held `updated_at` hold a number instead, so
 * they never match and are simply pushed once more. That heals itself on the
 * first sync and needs no migration.
 */
async function clearOutbox(name: Outbox, sent: DirtyEntry[]): Promise<void> {
  if (sent.length === 0) return;
  const tx = (await db()).transaction(name, "readwrite");
  const store = tx.store;
  await Promise.all([
    ...sent.map(async ({ id, stamp }) => {
      if ((await store.get(id)) === stamp) await store.delete(id);
    }),
    tx.done,
  ]);
}

export async function dirtyEntries(): Promise<DirtyEntry[]> {
  return readOutbox("dirty");
}

export async function clearDirtySent(sent: DirtyEntry[]): Promise<void> {
  return clearOutbox("dirty", sent);
}

export async function dirtyCanvasEntries(): Promise<DirtyEntry[]> {
  return readOutbox("folderDirty");
}

export async function clearCanvasDirtySent(sent: DirtyEntry[]): Promise<void> {
  return clearOutbox("folderDirty", sent);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get("meta", key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put("meta", value, key);
}

/**
 * The words typed into the capture bar and not yet saved as a note.
 *
 * **Why this exists.** Everything else the user types is already safe: an open
 * note writes `body` on every keystroke, so a tab Android kills mid-sentence
 * loses at most the character that was still under the finger. The capture bar
 * was the one place that did not — what was typed there lived only in React
 * state until Save was pressed, so a reload, a link that took the window, or
 * an eviction while the app sat in the background threw the whole thing away
 * with nothing to say so. This closes that, and it closes it *the same way*,
 * because two different durability stories in one app is how one of them
 * quietly stops being true.
 *
 * **Why IndexedDB and not `localStorage`**, which is the opposite of the
 * decision `lib/readingPosition.ts` makes twenty lines from here — the two
 * differ because they are asked at different moments. A reading position has
 * to be answered *before the first paint*, which only a synchronous store can
 * do. A draft has to be answered before the user starts typing, which is a
 * whole human reaction away, so it can be fetched; and on the writing side
 * `localStorage` is synchronous disk I/O on the main thread, which is the last
 * thing to put on a keystroke. This also inherits the account handoff for
 * free: `purgeEverything` clears `meta`, so a half-written thought never
 * survives the device being handed to somebody else.
 *
 * **It is a draft and never a note.** Nothing here has an id, a `raw_content`
 * or a place on a board, and nothing here is ever uploaded — an unfinished
 * fragment on the board would be worse than the problem. It becomes a note at
 * the one moment it always did: when the user saves it.
 *
 * Neither call can throw. A draft that could not be stored is a lost safety
 * net; it is never a reason for a keystroke to fail.
 */
const CAPTURE_DRAFT = "captureDraft";

export async function readCaptureDraft(): Promise<string> {
  try {
    const saved = await getMeta<string>(CAPTURE_DRAFT);
    return typeof saved === "string" ? saved : "";
  } catch {
    return "";
  }
}

export async function writeCaptureDraft(text: string): Promise<void> {
  try {
    await setMeta(CAPTURE_DRAFT, text);
  } catch {
    // Full, private browsing, or a database that would not open. Nothing here
    // is worth an error: the words are still on screen.
  }
}

/** Which account the data in this browser belongs to. */
const OWNER = "owner";
let ownerClaim: Promise<boolean> | null = null;

/**
 * Binds the local store to one account, and empties it when a different person
 * signs in.
 *
 * The local store is the source of truth for the UI and it long outlives a
 * session: signing out ends the session and touches nothing else, which is
 * right for one person on their own device and wrong the moment the browser is
 * handed to somebody. Without this, a second account signing in here would open
 * onto the first one's entire archive — read straight out of IndexedDB, before
 * a single request is made, so no amount of row level security on the server
 * says anything about it. Worse, any note still in the outbox would then be
 * uploaded under the new account's id.
 *
 * Nothing is lost that was ever synced; the notes are on the server and the
 * pull starts again from the beginning. Unsent local work by the *previous*
 * account is the one thing that would be lost for good, so while any is left
 * the claim refuses with `UnsentWork` and the person chooses; only
 * `evenIfUnsent` purges it.
 *
 * An unclaimed store is adopted rather than destroyed. That is the ordinary
 * first sign-in, including from device-only mode where the local notes are the
 * only copy in existence, and emptying it there would be the destructive answer
 * to a question nobody asked.
 *
 * Returns whether a different account's data was cleared out.
 */
export async function claimForOwner(
  userId: string,
  { evenIfUnsent = false }: { evenIfUnsent?: boolean } = {},
): Promise<boolean> {
  if (ownerClaim) return ownerClaim;
  ownerClaim = claimOwner(userId, evenIfUnsent);
  try {
    return await ownerClaim;
  } finally {
    ownerClaim = null;
  }
}

/**
 * Raised instead of purging when the store being handed over still holds work
 * that exists nowhere else. The count is what the person is told.
 */
export class UnsentWork extends Error {
  constructor(readonly count: number) {
    super(`${count} unsent changes`);
    this.name = "UnsentWork";
  }
}

/**
 * How many things on this device have never reached the server: notes in the
 * outbox, carrying a file whose bytes were never uploaded, or held only by the
 * failed-write stash (one each, however many reasons), idea layouts still
 * queued, permanent deletes not yet sent, and a folder change and an Inbox date
 * still queued (one each). The last two were left out, so the purge emptied
 * them with nothing said (audit DATA-8, 2026-10-10); the keys are
 * `useBoards`'s `DIRTY_KEY` and `SINCE_DIRTY_KEY`.
 */
export async function unsentWorkCount(): Promise<number> {
  const database = await db();
  const [dirtyIds, canvases, deletes, notes, boardsQueued, sinceQueued] = await Promise.all([
    database.getAllKeys("dirty"),
    database.count("folderDirty"),
    database.count("tombstoneDirty"),
    database.getAll("notes"),
    database.get("meta", "boardsDirty"),
    database.get("meta", "inboxSinceDirty"),
  ]);
  const unsentNotes = new Set<string>(dirtyIds.map(String));
  for (const note of notes) {
    if ((note.attachments ?? []).some((att) => !att.path)) unsentNotes.add(note.id);
  }
  for (const note of readUnsaved()) unsentNotes.add(note.id);
  return unsentNotes.size + canvases + deletes + (boardsQueued === true ? 1 : 0) + (sinceQueued === true ? 1 : 0);
}

async function claimOwner(userId: string, evenIfUnsent: boolean): Promise<boolean> {
  const stored = await getMeta<string>(OWNER);
  if (stored === userId) return false;
  const switching = stored !== undefined;
  // The purge used to go ahead whatever was still queued, and the previous
  // account's unsent edits and un-uploaded files went with it — the only
  // copies there were, and nothing on screen said so. Now it stops and says
  // how many, and the person decides (`useAccount`'s `held`): download them,
  // sign back in as the account they belong to, or clear the device anyway.
  // The store is not claimed while it waits, so sync stays off throughout.
  if (switching && !evenIfUnsent) {
    const unsent = await unsentWorkCount();
    if (unsent > 0) throw new UnsentWork(unsent);
  }
  // Ordering matters: the purge clears `meta` too, so the new owner is written
  // afterwards or the next open would think the store is unclaimed. The
  // browser's push subscription goes first: it still carries the previous
  // account's address, and left standing that account's reminders went on
  // ringing here (audit 2026-10-10, SEC-7; `pushRelease.ts`).
  if (switching) {
    // Fetched only here: a switch is rare, and the first paint pays for none of it.
    await (await import("./pushRelease")).releaseBrowserPush();
    await purgeEverything();
  }
  await setMeta(OWNER, userId);
  return switching;
}

export async function isSeeded(): Promise<boolean> {
  return Boolean(await (await db()).get("meta", "seeded"));
}

export async function markSeeded(): Promise<void> {
  await (await db()).put("meta", true, "seeded");
}

/**
 * Attachment bytes live here rather than in the note row, and they are written
 * before anything is uploaded — a file you just dropped in is openable at once,
 * on a train, with the sync still queued behind it.
 */
export async function putFile(id: string, blob: Blob): Promise<void> {
  await (await db()).put("files", blob, id);
}

/** Several files' bytes in one transaction — a batch of photographs at once. */
export async function putFiles(entries: [string, Blob][]): Promise<void> {
  if (entries.length === 0) return;
  const tx = (await db()).transaction("files", "readwrite");
  await Promise.all([...entries.map(([id, blob]) => tx.store.put(blob, id)), tx.done]);
}

export async function getFile(id: string): Promise<Blob | undefined> {
  return (await db()).get("files", id);
}

/**
 * Every document's words this device has read, by attachment id. Read whole,
 * once, at idle — never on the way to the first paint.
 */
export async function allPdfText(): Promise<Map<string, PdfTextEntry>> {
  const tx = (await db()).transaction("pdfText", "readonly");
  const [ids, entries] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  await tx.done;
  return new Map((ids as string[]).map((id, i) => [id, entries[i]]));
}

export async function putPdfText(id: string, entry: PdfTextEntry): Promise<void> {
  await (await db()).put("pdfText", entry, id);
}

export async function deletePdfText(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = (await db()).transaction("pdfText", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/** Every picture's words this device has read, by attachment id. Read at idle. */
export async function allImageText(): Promise<Map<string, ImageTextEntry>> {
  const tx = (await db()).transaction("imageText", "readonly");
  const [ids, entries] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  await tx.done;
  return new Map((ids as string[]).map((id, i) => [id, entries[i]]));
}

export async function putImageText(id: string, entry: ImageTextEntry): Promise<void> {
  await (await db()).put("imageText", entry, id);
}

export async function deleteImageText(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = (await db()).transaction("imageText", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export interface CachedFile {
  id: string;
  size: number;
}

/**
 * What this device is holding bytes for, and how much.
 *
 * A Blob in IndexedDB is a handle to something on disk, so listing them reads
 * sizes and not contents — this stays cheap with a few hundred files in it.
 */
export async function cachedFiles(): Promise<CachedFile[]> {
  const tx = (await db()).transaction("files", "readonly");
  const [ids, blobs] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  await tx.done;
  return (ids as string[]).map((id, i) => ({ id, size: blobs[i]?.size ?? 0 }));
}

export async function deleteFiles(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const tx = (await db()).transaction("files", "readwrite");
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/**
 * Settings-only escape hatch: destroys the entire local store.
 *
 * Also the account handoff (`claimOwner` above), which is the reason the last
 * line is here. Everything this app keeps about one person's notes lives in
 * IndexedDB — with three exceptions, and an exception that a purge does not
 * know about is a leak. Reading positions are held in `localStorage`, because
 * they have to be answerable before the first paint (`lib/readingPosition.ts`
 * says why), and they are a list of this user's note ids. Handing the device to
 * somebody else has to take them too.
 *
 * The other two are in **Cache Storage**, where the service workers park what
 * they cannot write to the database themselves. `share-inbox` holds the raw
 * bytes and the filenames of a share the app has not come back to collect —
 * photographs, in the case the share target exists for — and `reminder-answers`
 * holds the note ids a Later or a Done was pressed on. Both are written by a
 * worker (`public/share-sw.js`, `public/push-sw.js`) with no access to
 * IndexedDB's stores, both are drained on the next open, and neither survived
 * this purge until now: sign out, hand the browser over, and the last share the
 * app never collected was still sitting there for the next person.
 *
 * They are deleted by name and not by emptying Cache Storage: the generated
 * service worker precaches the app shell into caches of its own, and dropping
 * those would turn a handoff into a full re-download of the app — and, offline,
 * into no app at all. `lib/shareTarget.ts` and `lib/reminderActions.ts` own the
 * two names.
 *
 * Guarded, and deliberately last. `caches` does not exist in every context the
 * app is loaded in (jsdom, a non-secure origin, some private windows), and a
 * cache that refused to be deleted must not stop the purge that has already
 * emptied the database — a half-purged store is the state the account handoff
 * exists to prevent. A leftover share is the smaller failure of the two.
 */
export async function purgeEverything(): Promise<void> {
  const database = await db();
  await database.clear("notes");
  await database.clear("meta");
  await database.clear("dirty");
  await database.clear("files");
  await database.clear("folders");
  await database.clear("folderDirty");
  await database.clear("tombstones");
  await database.clear("tombstoneDirty");
  // Derived, but derived from one person's documents: it is their words.
  await database.clear("pdfText");
  await database.clear("imageText");
  clearUnsaved();
  forgetReadingPositions();
  await purgeWorkerInboxes();
}

/** What the two workers park outside the database, dropped by name. */
async function purgeWorkerInboxes(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    await Promise.all([caches.delete(SHARE_INBOX), caches.delete(ANSWER_INBOX)]);
  } catch {
    // Storage that would not answer. The notes are already gone, which is the
    // part of the handoff that had to be right.
  }
}
