import type { Attachment, Note } from "../types";
import { getBackend } from "./backend";
import { serverKnowsAttachments } from "./sync";
import { allTombstones, cachedFiles, deleteFiles, getFile, getMeta, putFile, setMeta } from "./db";
import { isPdf } from "../lib/pdf";
import { isImage } from "../lib/files";
import { pdfBytesLanded } from "./pdfText";
import { imageBytesLanded } from "./imageText";
import { FILE_REFUSED } from "../lib/serverWords";

/**
 * Getting a file from one machine to the other.
 *
 * The bytes do not go through the notes table — they go to a private storage
 * bucket, one folder per user, and the note carries only a path to them. What
 * the note *does* carry is the thumbnail, which is why the other device can
 * show you the file before it has fetched it.
 *
 * Nothing here is on the hot path. An attach writes locally and returns; this
 * runs afterwards, on the same background tick as the note sync, and an upload
 * that fails is simply retried on the next one — the attachment still has no
 * path, which is the entire record it needs.
 */

/** `${user}/${note}/${attachment}` — the leading folder is what RLS checks. */
function pathFor(userId: string, noteId: string, a: Attachment): string {
  return `${userId}/${noteId}/${a.id}`;
}

/** Attachments whose bytes are still only on this device. */
export function pendingUploads(notes: Note[]): { note: Note; att: Attachment }[] {
  const out: { note: Note; att: Attachment }[] = [];
  for (const note of notes) {
    // A note in the trash is on its way out, and recording an upload
    // restamps `updated_at` — which the trash sweep counts its thirty days
    // from, the same way an unfurl used to re-date it (`useLinkUnfurl`). The
    // bytes stay on this device; a restore puts the note back on the list.
    if (note.status === "trashed") continue;
    for (const att of note.attachments ?? []) {
      if (att.path === null) out.push({ note, att });
    }
  }
  return out;
}

/**
 * How many files one tick sends up, and how many of those travel at once.
 *
 * Eleven photographs from a phone are 30–60MB, and this used to send every
 * waiting file in one tick, one after another, recording **none** of the paths
 * until the last had landed. So the other device saw nothing at all for the
 * whole of it, and a phone that put the app away at file ten — which Android
 * does to a backgrounded PWA without asking — threw away the nine that had
 * already arrived and sent all eleven again on the next open (the upload is an
 * upsert, so it was never an error, only the whole wait twice).
 *
 * A tick now takes a small batch, records what landed, and the loop comes
 * straight back for the next (`again` in `useSync`). Three in flight at
 * once is the modest end of what a browser allows per host: enough that one
 * slow request does not hold the rest, few enough that a phone on mobile data
 * is not splitting its upstream so finely every file crawls.
 */
export const UPLOAD_BATCH = 3;

/**
 * Files the server turned away this session, by attachment id (audit BUG-2,
 * 2026-10-10).
 *
 * Nothing used to remember a refusal, and sync runs on every edit, on every
 * return to the app and on a five-minute timer — so one film over the server's
 * cap was sent up in full each time and turned away each time, gigabytes of
 * mobile data for a file that could never land, under a row that said
 * "Sending" for ever. A file refused once is now held back until the app is
 * opened again or the person asks for it to be sent again (`sendAgain`, the
 * row's own button), and the row says the server would not take it.
 *
 * Only an answer *about the file* counts (`refusesTheFile`): a dropped
 * connection, an expired sign-in, throttling or a server error say nothing
 * about it and are retried as before.
 */
const refused = new Set<string>();
const refusalWatchers = new Set<() => void>();

function refusalsChanged(): void {
  for (const watch of refusalWatchers) watch();
}

/** Whether the server turned this file away this session. */
export function uploadRefused(id: string): boolean {
  return refused.has(id);
}

/** Calls `watch` whenever a file is refused or offered again; returns the way to stop. */
export function watchRefusals(watch: () => void): () => void {
  refusalWatchers.add(watch);
  return () => refusalWatchers.delete(watch);
}

/** Offers a refused file again on the next sync — the person asked. */
export function sendAgain(id: string): void {
  if (refused.delete(id)) refusalsChanged();
}

/**
 * Whether an upload's failure is the server's answer about the file itself: a
 * 4xx other than an expired sign-in (401), a timeout (408) or throttling
 * (429), or a server out of room (507). A failure with no status — the
 * network — is never one.
 */
export function refusesTheFile(code: string | null | undefined): boolean {
  const status = Number(code);
  if (!code || !Number.isInteger(status)) return false;
  if (status === 507) return true;
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

/**
 * Uploads a batch of what is waiting and returns the notes that need rewriting
 * with the paths they landed on. Returns an empty list when there is nothing
 * to do, when there is no server, or when nobody is signed in — all three are
 * ordinary states, not errors.
 *
 * A file the bucket refused is not one of those. It used to be dropped here
 * with `continue` and nothing else, so a bucket that was never created, a
 * policy that says no, or a file over the cap meant the same file failing on
 * every tick for the rest of time while the sync mark read fine. The first
 * refusal comes back as `failed`, beside whatever did land, for the loop to
 * raise once everything else has been applied.
 */
export async function uploadPending(
  notes: Note[],
): Promise<{ uploaded: Note[]; failed: Error | null; landed: Map<string, string> }> {
  const nothing = { uploaded: [], failed: null, landed: new Map<string, string>() };
  const backend = await getBackend();
  if (!backend) return nothing;
  const waiting = pendingUploads(notes);
  if (waiting.length === 0) return nothing;
  // A path the note row cannot carry is a path nobody can use. Until the
  // migration lands there is nothing to gain by uploading, and a failed
  // request per file per tick to be spared.
  if (!(await serverKnowsAttachments())) return nothing;

  // The session's own user, read locally. `getUser()` asks the server to
  // vouch for the token first — a round trip on every tick that has a file
  // waiting — and the bucket's policy will refuse a bad token anyway.
  const userId = (await backend.session())?.user?.id;
  if (!userId) return nothing;

  /** Paths that landed, by attachment id. */
  const landed = new Map<string, string>();
  let failed: Error | null = null;

  // Only files this device actually holds count towards the batch. A file with
  // no local bytes and no remote path was attached on the other device and has
  // not finished uploading there — nothing here can send it, and letting it
  // take a place in the batch would starve the ones that can. Each upload
  // starts the moment its bytes are found, and the batch is awaited together.
  const batch: Promise<void>[] = [];
  for (const { note, att } of waiting) {
    if (batch.length === UPLOAD_BATCH) break;
    // Turned away once already this session: not sent again until asked.
    if (refused.has(att.id)) continue;
    const blob = await getFile(att.id);
    if (!blob) continue;
    const path = pathFor(userId, note.id, att);
    batch.push(
      backend
        .uploadFile(path, blob, att.mime || "application/octet-stream")
        // A network failure is answered as `error` too, never by throwing.
        .then(({ error }) => {
          if (!error) {
            landed.set(att.id, path);
            return;
          }
          const name = att.name || "file";
          if (refusesTheFile(error.code)) {
            refused.add(att.id);
            refusalsChanged();
            // Named, so the sync-failed dialog can say which file (`syncWords`).
            failed ??= new Error(`${FILE_REFUSED}${name}\n${error.message}`);
          } else failed ??= new Error(`${name}: ${error.message}`);
        }),
    );
  }
  await Promise.all(batch);

  if (landed.size === 0) return { uploaded: [], failed, landed };

  const uploaded = notes
    .filter((n) => (n.attachments ?? []).some((a) => landed.has(a.id)))
    .map((n) => ({
      ...n,
      attachments: n.attachments.map((a) =>
        landed.has(a.id) ? { ...a, path: landed.get(a.id) ?? a.path } : a,
      ),
    }));
  // `landed` beside the notes: only these paths are new this tick, which is
  // what tells `applyUploaded` an orphan from a file uploaded long ago.
  return { uploaded, failed, landed };
}

/**
 * The file's bytes, from this device if it has them and from the server if it
 * does not — caching what it fetches, so the second look is instant and the
 * file survives going offline afterwards.
 *
 * Returns null when the file is genuinely unreachable: not here, not uploaded
 * yet, or no network. The caller shows the name and the size, which it has
 * from the note either way.
 */
export async function fetchFile(att: Attachment): Promise<Blob | null> {
  const local = await getFile(att.id);
  if (local) return local;
  if (!att.path) return null;
  const backend = await getBackend();
  if (!backend) return null;

  const { data, error } = await backend.downloadFile(att.path);
  if (error || !data) return null;
  try {
    await putFile(att.id, data);
  } catch (err) {
    // The copy is a cache. A device out of room refuses it, and that is when
    // the file must still open: show the bytes, keep nothing (bughunt 2026-10-15).
    console.warn("[spår] could not keep a copy of the file on this device", err);
    return data;
  }
  // A document attached on the other device is readable here from now on,
  // and search learns its words at the next idle moment (`store/pdfText.ts`).
  if (isPdf(att.mime, att.name)) pdfBytesLanded();
  // And a picture's words, the same way (`store/imageText.ts`).
  if (isImage(att)) imageBytesLanded();
  return data;
}

/**
 * The file's bytes for the export (`lib/exportArchive.ts`): this device's copy,
 * or the server's — and unlike `fetchFile`, **what it fetches is not kept.**
 *
 * The export reads every file in the archive once. Caching each one would fill
 * the phone with a second copy of every photograph just to write them into a
 * zip, which is the exact failure `CACHE_BUDGET` exists to prevent: a browser
 * out of room drops the whole origin, notes included. Null when the file is
 * genuinely unreachable, and the export writes its preview instead.
 */
export async function exportBytes(att: Attachment): Promise<Uint8Array | null> {
  const blob = await passingBytes(att);
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/**
 * The file's bytes, this device's or the server's, **without keeping what is
 * fetched** — for the export, and for Save on a film or a sound (audit BUG-6,
 * 2026-10-10): a 50 MB film saved to the phone's downloads used to be written
 * into this device's store as well, for the cache sweep to find later.
 */
export async function passingBytes(att: Attachment): Promise<Blob | null> {
  const local = await getFile(att.id);
  if (local) return local;
  if (!att.path) return null;
  const backend = await getBackend();
  if (!backend) return null;
  const { data, error } = await backend.downloadFile(att.path);
  if (error || !data) return null;
  return data;
}

/**
 * How much this device may hold in fetched file bytes before it starts letting
 * the oldest ones go. Roughly a hundred photographs.
 *
 * Some ceiling has to exist. Opening a file caches it forever so the second
 * look is instant and survives going offline, which is right — but on the
 * phone, every picture ever *looked at* accumulated with nothing to remove it,
 * and a browser out of room does not tidy up: it throws away the whole origin,
 * notes included, and the notes are the part that cannot be re-fetched.
 */
const CACHE_BUDGET = 300 * 1024 * 1024;

/**
 * Lets go of file bytes this device is only holding a second copy of.
 *
 * The one rule that matters: a file that has not been uploaded — `path === null`
 * — is the only copy in existence and is never, ever a candidate. Everything
 * dropped here is on the server and comes back by opening it, and its thumbnail
 * is in the note row regardless, so a pruned file still looks like itself on the
 * board and in the note. Bytes that belong to no note at all go first: those are
 * leftovers from a note that was destroyed while the delete failed.
 *
 * **A tombstone's attachments are a note's attachments, not leftovers.** The
 * live notes are not the whole of what this device is deliberately holding:
 * `Tombstone.attachments` exists precisely because `permanently_delete_note`
 * can refuse, and the bytes are what make the recovered note whole rather than
 * a note with empty frames in it — they are destroyed by `purgeTombstoneFiles`
 * once the server has actually taken the delete, and not before. A marker
 * still waiting for that answer — a week offline, a delete refused every tick —
 * names files no live note names, which is the exact shape this sweep read as
 * an orphan and dropped *first*; and a file with `path === null` inside one was
 * the only copy in existence. So the tombstones are folded into `known` and
 * `spare` under the same two rules the notes are, and an un-uploaded one there
 * is as un-droppable as an un-uploaded one on the board.
 *
 * Reading them can fail, and then nothing is dropped: which files are being
 * held is not a question this sweep is allowed to guess at, and a cache left
 * over its ceiling for one more open is the cheap way to be wrong.
 *
 * Oldest attachment first. `added_at` is when the file was attached rather than
 * when it was last opened, which is a proxy and not a measurement — but the cost
 * of choosing wrong is one re-download, and a stamp per file would be a schema
 * migration to buy a slightly better guess.
 */
export async function pruneCache(notes: Note[], budget = CACHE_BUDGET): Promise<number> {
  const cached = await cachedFiles();
  if (cached.length === 0) return 0;
  const total = cached.reduce((n, f) => n + f.size, 0);
  if (total <= budget) return 0;

  /** Attachment id -> when it was attached, for the ones the server also has. */
  const spare = new Map<string, string>();
  const known = new Set<string>();
  const fold = (atts: Attachment[] | undefined) => {
    for (const att of atts ?? []) {
      known.add(att.id);
      if (att.path !== null) spare.set(att.id, att.added_at);
    }
  };
  for (const note of notes) fold(note.attachments);
  // Held for a delete the server has not confirmed. See the note above: these
  // are as owned as anything on a board, and an un-uploaded one is still the
  // only copy of itself.
  for (const tombstone of await allTombstones()) fold(tombstone.attachments);

  const droppable = cached
    .filter((f) => spare.has(f.id) || !known.has(f.id))
    // An orphan sorts to the front on an empty stamp, which is what we want.
    .sort((a, b) => (spare.get(a.id) ?? "").localeCompare(spare.get(b.id) ?? ""));

  const drop: string[] = [];
  let freed = 0;
  for (const f of droppable) {
    if (total - freed <= budget) break;
    drop.push(f.id);
    freed += f.size;
  }

  await deleteFiles(drop);
  return drop.length;
}

/**
 * Server paths whose removal failed, kept until a later try succeeds.
 *
 * A failure here leaks a file, never a note — but a leaked file is on the
 * server for good: nothing else ever names it again. Every failed removal
 * used to be dropped on the floor (and the storage client's own refusal,
 * which it *returns* rather than throws, was never even looked at). So the
 * paths are written down, and `retryOrphans` asks again on every open.
 */
const ORPHANS = "orphanPaths";

async function rememberOrphans(paths: string[]): Promise<void> {
  try {
    const held = (await getMeta<string[]>(ORPHANS)) ?? [];
    await setMeta(ORPHANS, [...new Set([...held, ...paths])]);
  } catch (error) {
    console.error("could not note files left on the server", error);
  }
}

async function removePaths(paths: string[]): Promise<void> {
  const backend = await getBackend();
  if (!backend) return;
  const { error } = await backend.removeFiles(paths);
  if (error) throw new Error(error.message);
}

/** Removes bytes the user deleted. A failure is remembered and tried again. */
export async function removeRemote(atts: Attachment[]): Promise<void> {
  await removeRemotePaths(atts.map((a) => a.path).filter((p): p is string => Boolean(p)));
}

/** `removeRemote`, by path. */
export async function removeRemotePaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await removePaths(paths);
  } catch (error) {
    await rememberOrphans(paths);
    throw error;
  }
}

/**
 * Removes the whole storage folder (`<user>/<note>/`) of each note the server
 * has confirmed destroyed (audit DATA-5, 2026-10-10).
 *
 * The server's delete (`permanently_delete_note`, `0019`) removes the row and
 * nothing in storage; this device removes the paths it knows. A device that
 * never learned a path — the other device's upload landed after this one last
 * pulled, or a file arrived after the note was trashed — left those bytes on
 * the server for good. The folder is the note's alone, so once the delete is
 * confirmed everything in it can go. Only where the backend can list a folder
 * (`filesUnder`; the spår server removes a note's files itself). A failure is
 * remembered with the failed file removals — the folder, with its trailing
 * slash — and asked again on the next open.
 */
export async function removeNoteFolders(noteIds: string[]): Promise<void> {
  if (noteIds.length === 0) return;
  const backend = await getBackend();
  if (!backend?.filesUnder) return;
  const userId = (await backend.session())?.user?.id;
  if (!userId) return;
  const folders = noteIds.map((id) => `${userId}/${id}/`);
  try {
    await clearFolders(folders);
  } catch (error) {
    await rememberOrphans(folders);
    throw error;
  }
}

/** Everything listed under each folder (named with its trailing slash), removed. */
async function clearFolders(folders: string[]): Promise<void> {
  const backend = await getBackend();
  if (!backend?.filesUnder) return;
  const paths: string[] = [];
  for (const folder of folders) {
    const { data, error } = await backend.filesUnder(folder.slice(0, -1));
    if (error) throw new Error(error.message);
    for (const name of data ?? []) paths.push(`${folder}${name}`);
  }
  if (paths.length > 0) await removePaths(paths);
}

/**
 * Asks again for every removal that failed before. Runs beside the other
 * tidying sweeps on open; a failure leaves the list for the next one.
 * Returns how many paths were cleared.
 */
export async function retryOrphans(): Promise<number> {
  const held = (await getMeta<string[]>(ORPHANS)) ?? [];
  if (held.length === 0) return 0;
  // A path ending in a slash is a destroyed note's whole folder (`removeNoteFolders`).
  const files = held.filter((p) => !p.endsWith("/"));
  const folders = held.filter((p) => p.endsWith("/"));
  if (files.length > 0) await removePaths(files);
  if (folders.length > 0) await clearFolders(folders);
  // Only what was asked about is crossed off: a removal that failed while
  // this one was in flight added itself and must survive.
  const now = (await getMeta<string[]>(ORPHANS)) ?? [];
  const asked = new Set(held);
  await setMeta(ORPHANS, now.filter((p) => !asked.has(p)));
  return held.length;
}
