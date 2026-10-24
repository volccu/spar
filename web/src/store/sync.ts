import { nowIso } from "../lib/when";
import type { Attachment, LinkPreview, Note } from "../types";
import { getBackend, type Row } from "./backend";
import { stampForUpload } from "./serverClock";
import { columnProbe, probe } from "./capability";
import { removeNoteFolders, removeRemote } from "./attachments";
import { rememberSent } from "./echo";
import { clearRefusals, heldNotes, isHeld, recordRefusal, type HeldNote } from "./held";
import {
  NOTES_CURSOR,
  TOMBSTONES_CURSOR,
  cappedAtServerTime,
  laterCursor,
  readCursor,
  repairStart,
  type Cursor,
} from "./cursors";
import type { Ahead, Page, TombstoneRow } from "./pullChanges";
import {
  CONFLICT_FIELDS,
  cmpIso,
  deletionMarker,
  fieldClocks,
  mergeNoteFields,
  remoteIsNewer,
  type FieldClocks,
} from "../lib/versions";
import {
  allTombstones,
  applyRemoteTombstones,
  clearTombstoneDirtySent,
  clearDirtySent,
  dirtyTombstoneEntries,
  forgetTombstones,
  dirtyEntries,
  getMeta,
  purgeTombstoneFiles,
  putNotesFromServer,
  setMeta,
  type DirtyEntry,
  type Tombstone,
} from "./db";

/**
 * Sync (SPEC §3): the local store stays the source of truth for the UI, and
 * this pushes local changes up and pulls remote ones down in the background.
 * Conflicts resolve last-write-wins on `updated_at` — right for one person
 * with two devices, and the reason CRDTs were rejected.
 */

/**
 * Notes whose incoming change was put back because this device still had
 * unsent work for them. Fetched again by id on the next pull, since the cursor
 * has already moved past where they sat.
 */
const DEFERRED_PULL = "deferredPullIds";
const PAGE = 500;
/**
 * The columns every server has, whatever migrations it has run.
 *
 * Anything added after launch belongs in `columns()` behind its own probe, not
 * here — a column in this list is one the client will name unconditionally, and
 * naming a column the server has not got fails every select and every upsert
 * for every note at once.
 */
const BASE_COLUMNS = [
  "id",
  "raw_content",
  "body",
  "source",
  "created_at",
  "updated_at",
  "note_type",
  "status",
  "priority",
  "reminder_at",
  "done",
  "merged_from",
  "keep_id",
];

/**
 * What this server turned out to understand, asked once per session.
 *
 * Carried as one object rather than five positional booleans: they were four
 * already, all of the same type, and `toRow(note, a, b, c, d)` is a
 * transposition away from writing a note's attachments into its link previews
 * with nothing to catch it.
 */
interface Caps {
  attachments: boolean;
  linkPreviews: boolean;
  mergedInto: boolean;
  fieldVersions: boolean;
  boardId: boolean;
  reminderRepeat: boolean;
}

/**
 * Whether the server has been taught about a newer piece of the schema yet.
 *
 * The client is deployed from one place and the schema is migrated from
 * another, so for some window they disagree — and the app must not care.
 * Asking for a column that isn't there fails the whole select, which would
 * take *note* syncing down over a feature the user may not even be using.
 *
 * So it is asked once, cheaply, and remembered for the session. Before the
 * migration: notes sync exactly as they did, files stay on the device that
 * made them. After it: nothing to do, the next run picks it up. Neither state
 * needs anybody to intervene.
 *
 * Every optional piece of the schema sync asks about, and where it lives.
 * One row each; `serverKnows` is the only reader. A new column is a new row
 * here and a `caps.x ? "x" : ""` guard in `columns()` — `constants.test.ts`
 * checks the guard, which is the half that ever went missing.
 *
 * `boardId` is the row with a history. Boards arrived in migration 0016 with
 * no probe at all — the column sat in the hardcoded list, so a client deployed
 * ahead of its database failed every select and every upsert with 42703, for
 * every note, permanently. That is the outage migration 0012 was written to
 * end, reintroduced by a column that skipped the rule.
 *
 * `reminderRepeat` (migration 0020) earns a sentence too: a repeating reminder
 * is set on the phone, and the phone is the device most likely to be running a
 * build the database has not caught up with yet.
 */
const CAPABILITIES = {
  attachments: ["notes", "attachments"],
  linkPreviews: ["notes", "link_previews"],
  mergedInto: ["notes", "merged_into"],
  fieldVersions: ["notes", "field_updated_at"],
  boardId: ["notes", "board_id"],
  reminderRepeat: ["notes", "reminder_repeat"],
  tombstones: ["note_tombstones", "note_id"],
} as const satisfies Record<string, readonly [string, string]>;

type Capability = keyof typeof CAPABILITIES;

/** What the server was found to support, this session. Absent = not asked yet. */
const known: Partial<Record<Capability, boolean>> = {};

/**
 * Whether the server has this piece of the schema, asked once and remembered.
 * `probe` (in `capability.ts`) decides which answers are worth remembering: a
 * missing column or table is, a dropped connection is not.
 */
async function serverKnows(cap: Capability): Promise<boolean> {
  const [table, column] = CAPABILITIES[cap];
  const outcome = await probe(known[cap] ?? null, columnProbe(table, column));
  if (outcome.remember) known[cap] = outcome.known;
  return outcome.known;
}

/** Whether files can be uploaded — `store/attachments.ts` asks before it tries. */
export function serverKnowsAttachments(): Promise<boolean> {
  return serverKnows("attachments");
}

/** Test seam: forget what the server was known to support. */
export function resetServerCapabilities(): void {
  for (const cap of Object.keys(known) as Capability[]) delete known[cap];
}

function columns(caps: Caps): string {
  return [
    ...BASE_COLUMNS,
    caps.boardId ? "board_id" : "",
    caps.reminderRepeat ? "reminder_repeat" : "",
    caps.mergedInto ? "merged_into" : "",
    caps.attachments ? "attachments" : "",
    caps.linkPreviews ? "link_previews" : "",
    caps.fieldVersions ? "field_updated_at" : "",
  ]
    .filter(Boolean)
    .join(",");
}

/**
 * Re-exported so the callers that already name it keep working. The definition
 * lives in `lib/versions.ts` because `db.ts` and `useNotes.ts` need the same
 * answer and used to each carry their own version of it.
 *
 * `remoteIsNewer` was re-exported here too, under the name
 * `hasNewerFieldVersion`, for the same reason — but no caller ever took it up:
 * `db.ts` imports it from `lib/versions.ts` directly, which is where it lives.
 * An alias with no callers is a second name for one thing, and the next person
 * to read `db.ts` beside `sync.ts` has to work out that they are the same
 * function. It is gone; import `remoteIsNewer` from `lib/versions.ts`.
 */
export { mergeNoteFields };

/**
 * The clocks, minus any field this server has not been taught about yet.
 *
 * A clock is a claim about a column, and a claim about a column that is not
 * there is what broke sync. The server's merge trigger reads the clock set and
 * looks up each named field, so a clock for `merged_into` against a schema
 * missing that column answered `42703: record "new" has no field "merged_into"`
 * and failed the upsert — and with it every note batched alongside. Migration
 * 0012 makes the trigger shrug that off; not sending it is the other half, and
 * the half that also protects a client newer than its server tomorrow.
 *
 * The row itself already omits these columns. The clocks simply have to agree.
 */
function knownClocks(note: Note, caps: Caps): FieldClocks {
  const clocks = fieldClocks(note);
  // A clock for every field (sync contract §4.3). A note made here carries
  // one only for what it touched, and the server writes a field sent without
  // one outright, dropping its own clock: an edit to the words from a device
  // that had not heard of an archive elsewhere undid the archive. A field
  // this device never touched goes up at the note's birth, which loses to any
  // clock the server holds (bughunt 2026-10-15).
  const born = Date.parse(note.created_at);
  const birth = Number.isFinite(born) ? new Date(born).toISOString() : null;
  if (birth) {
    for (const field of CONFLICT_FIELDS) clocks[field] ??= birth;
  }
  if (!caps.mergedInto) delete clocks.merged_into;
  if (!caps.attachments) delete clocks.attachments;
  if (!caps.linkPreviews) delete clocks.link_previews;
  if (!caps.boardId) delete clocks.board_id;
  if (!caps.reminderRepeat) delete clocks.reminder_repeat;
  return clocks;
}

function toRow(note: Note, caps: Caps) {
  const row = {
    id: note.id,
    raw_content: note.raw_content,
    body: note.body,
    source: note.source,
    created_at: note.created_at,
    updated_at: note.updated_at,
    note_type: note.note_type,
    status: note.status,
    priority: note.priority ?? 0,
    reminder_at: note.reminder_at,
    done: note.done,
    merged_from: note.merged_from,
    keep_id: note.keep_id,
    ...(caps.boardId ? { board_id: note.board_id ?? null } : {}),
    ...(caps.reminderRepeat ? { reminder_repeat: note.reminder_repeat ?? null } : {}),
    ...(caps.mergedInto ? { merged_into: note.merged_into ?? null } : {}),
    ...(caps.fieldVersions ? { field_updated_at: knownClocks(note, caps) } : {}),
  };
  // Sending a column the server hasn't got rejects the whole upsert, so a note
  // written before the migration would fail to sync at all.
  return {
    ...row,
    ...(caps.attachments ? { attachments: note.attachments ?? [] } : {}),
    ...(caps.linkPreviews ? { link_previews: note.link_previews ?? [] } : {}),
  };
}

export function noteFromRow(row: Row): Note {
  const note: Note = {
    id: String(row.id),
    raw_content: (row.raw_content as string) ?? "",
    body: (row.body as string) ?? (row.raw_content as string) ?? "",
    source: (row.source as string) ?? "import",
    created_at: (row.created_at as string) ?? nowIso(),
    updated_at: (row.updated_at as string) ?? nowIso(),
    note_type: (row.note_type as Note["note_type"]) ?? null,
    board_id: (row.board_id as string) ?? null,
    status: (row.status as Note["status"]) ?? "active",
    priority: (row.priority as number) ?? 0,
    reminder_at: (row.reminder_at as string) ?? null,
    // Null on a server that has not run 0020, and on every note that rings
    // once — which reads the same and means the same thing.
    reminder_repeat: (row.reminder_repeat as Note["reminder_repeat"]) ?? null,
    done: (row.done as boolean) ?? null,
    merged_from: (row.merged_from as string[]) ?? null,
    merged_into: (row.merged_into as string) ?? null,
    keep_id: (row.keep_id as string) ?? null,
    // Absent for every note written before files existed, and for every row a
    // server without the column returns. An empty list is the honest reading.
    attachments: (row.attachments as Attachment[]) ?? [],
    link_previews: (row.link_previews as LinkPreview[]) ?? [],
  };
  if (row.field_updated_at && typeof row.field_updated_at === "object") {
    note.field_updated_at = row.field_updated_at as FieldClocks;
  }
  return note;
}

export interface SyncOutcome {
  pushed: number;
  pulled: Note[];
  /** Notes the server has refused too often to keep asking about. */
  held: HeldNote[];
  /**
   * What the server would not take, if anything — returned rather than thrown.
   *
   * A failed upload and a failed *sync* are not the same event, and collapsing
   * them lost the pull: the notes were already fetched, merged and written to
   * IndexedDB, and then the throw unwound past `applyRemote` so none of them
   * reached the screen until the next reload. The caller applies what arrived
   * and raises this afterwards.
   */
  refused: Error | null;
  /**
   * False when the notes themselves could not be read this turn (the deletes
   * read before them still arrive in `pulled`). Absent means they were. The
   * first pull is a gate for reminder answers, and a turn that never read
   * the notes must not open it.
   */
  notesPulled?: boolean;
}

/**
 * Uploads everything changed locally since the last successful push.
 *
 * Each note is carried alongside the outbox entry that put it here, and the
 * entry is only crossed off if it still names the version that actually went
 * up. The note is sent from the caller's snapshot while the entry was read
 * from the store, so the two can disagree — and when they do it is always
 * because a newer edit arrived, which is exactly the case that must stay
 * queued. Uploading is an upsert on the note's own id, so a note sent twice is
 * a note stored once, and erring towards sending again is free.
 */
async function push(
  localById: Map<string, Note>,
  caps: Caps,
): Promise<{ sent: number; refused: Error | null }> {
  const nothing = { sent: 0, refused: null };
  if (!(await getBackend())) return nothing;
  const entries = await dirtyEntries();
  if (entries.length === 0) return nothing;

  // A note the server has refused often enough is not offered again until
  // the user asks or edits it (`held.ts`). It stays in the outbox: being
  // held is a fact about how the sending has gone, not about what is
  // waiting to be sent.
  const held = await heldNotes();
  const pending = entries
    .map((entry) => ({ entry, note: localById.get(entry.id) }))
    .filter((p): p is { entry: DirtyEntry; note: Note } =>
      Boolean(p.note) && !isHeld(held, p.note!.id, p.note!.updated_at),
    );

  let sent = 0;
  let refused: Error | null = null;
  for (const chunk of uploadBatches(pending, caps)) {
    const outcome = await send(chunk, caps);
    sent += outcome.sent;
    refused ??= outcome.refused;
  }
  // Handed back rather than thrown. Everything that could go, went, and has
  // been crossed off; the count of it is worth as much as the failure is, and a
  // throw here used to discard both along with the pull that comes after.
  return { sent, refused };
}

/**
 * Roughly how many bytes of JSON one notes upsert may carry (audit DATA-10,
 * PERF-9, 2026-10-10). Batches were cut by count alone — 500 rows — and a row
 * can carry 1080px wall pictures in `link_previews`, so a first sync of a
 * picture-heavy archive could ask the server to take tens of megabytes in one
 * request, past what a proxy or the server accepts; a 413 then came back on
 * every tick for ever. Four megabytes is well under every limit in the path.
 */
export const UPSERT_BYTES = 4 * 1024 * 1024;

/** About how many bytes of JSON this note's row is. */
export function rowBytes(note: Note, caps: Caps): number {
  return JSON.stringify(toRow(note, caps)).length;
}

/**
 * The outbox cut into upserts of at most `PAGE` rows and about `UPSERT_BYTES`
 * of JSON each, in order. A single row larger than the cap goes alone.
 */
export function uploadBatches<T extends { note: Note }>(pending: T[], caps: Caps, maxBytes = UPSERT_BYTES): T[][] {
  const out: T[][] = [];
  let chunk: T[] = [];
  let bytes = 0;
  for (const item of pending) {
    const size = rowBytes(item.note, caps);
    if (chunk.length > 0 && (chunk.length === PAGE || bytes + size > maxBytes)) {
      out.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(item);
    bytes += size;
  }
  if (chunk.length > 0) out.push(chunk);
  return out;
}

/**
 * The server would not take a request this large — a 413, from the server
 * itself or a proxy in front of it. Said about the size of the batch, not about
 * any row in it, so the batch is split rather than any note charged with it.
 */
export function tooLarge(error: { code?: string | null; message?: string }): boolean {
  return error.code === "413" || /payload too large|entity too large|request too large/i.test(error.message ?? "");
}

/**
 * Does this error name the row, or the request that carried it?
 *
 * supabase-js *resolves* with an `error` object for everything — a constraint
 * violation, a 401 on an expired token, a 503, a captive portal eating the
 * fetch. Treating them alike was a quiet disaster in three parts. The
 * bisection took a whole-request failure and asked it again all the way down,
 * which is up to 2N−1 doomed round trips a tick on a phone that has just lost
 * its signal. Every note in the batch was then charged a refusal, and five
 * ticks — which arrive in seconds, because a tab regaining focus, coming back
 * online, or any local edit runs one immediately, backoff and all — put every
 * one of them past `HOLD_AFTER`. A held note is dropped from the outbox scan
 * and its error stops being reported, so the mark went **calm** over an
 * archive that had stopped syncing entirely; the banner's way out, "Stop
 * sending" (once "Keep here only"), then throws the outbox entry away, which on a network blip is a
 * version that never syncs again.
 *
 * `navigator.onLine` is not the guard for this and never was: a captive
 * portal, a dead-but-associated wifi and an expired refresh token all report
 * online.
 *
 * So the question is asked of the error's `code`, which is the one part of a
 * PostgREST failure that says where it came from. A SQLSTATE in class 22 (data
 * exception), class 23 (integrity constraint violation — the anti-resurrection
 * trigger from migration 0011 raises 23505) or `P0001` (a `raise` in a
 * trigger, which is how `raw_content` immutability refuses) is the server
 * having read this row and declined it. Anything else — a transport failure
 * with no code at all, `PGRST301` for a bad JWT, a 5xx from the gateway — is
 * the request, and the notes in it are blameless.
 */
export function namesTheRow(error: { code?: string | null }): boolean {
  const code = error.code ?? "";
  return /^2[23]/.test(code) || code === "P0001";
}

/**
 * Uploads one batch, and bisects it if the server refuses.
 *
 * An upsert is one statement: a single row the server will not accept fails all
 * five hundred of them, and since the outbox is only crossed off on success,
 * every note behind that row stops syncing — permanently, silently, and with
 * "sync failed" as the entire explanation. The row that does this is not
 * hypothetical: a note the other device permanently deleted trips the
 * anti-resurrection trigger from migration 0011, and a note whose `raw_content`
 * ever drifted trips the immutability trigger from 0001.
 *
 * Halving finds the offending row in log₂(n) requests — nine for a full page —
 * and everything either side of it goes up as normal. The failure is still
 * reported; it is simply no longer contagious.
 *
 * Bisecting to a single row is also the only moment the app learns *which*
 * note a refusal belongs to, so it is where the refusal is counted. Once a
 * note has been refused `HOLD_AFTER` times it is held and its error stops
 * being reported: the mark is for things that might work next time, and this
 * one will not (`held.ts`).
 *
 * **All of that is only true of an error that names a row.** See
 * `namesTheRow` above: an error that does not is a fact about the request, and
 * halving it only asks the same broken question twice.
 */
async function send(
  chunk: { entry: DirtyEntry; note: Note }[],
  caps: Caps,
): Promise<{ sent: number; refused: Error | null }> {
  // Sent no earlier than the server's clock, so a note written offline is not
  // uploaded behind a cursor the other device has already passed. The note
  // itself keeps its own stamp — see `stampForUpload`.
  const stamps = chunk.map((p) => stampForUpload(p.note.updated_at));
  const rows = chunk.map((p, i) => ({ ...toRow(p.note, caps), updated_at: stamps[i] }));
  const { error } = await (await getBackend())!.upsertNotes(rows);
  if (!error) {
    // The stamps that went up are remembered — the ones sent, not the notes'
    // own — so the server echoing this very upsert back through realtime does
    // not start a second tick.
    rememberSent("notes", chunk.map((p, i) => ({ id: p.note.id, updated_at: stamps[i] })));
    // Whatever these notes were refused for before, they are past it.
    await clearRefusals(chunk.map((p) => p.note.id));
    // What went up, not what was queued: an edit made during the upload keeps
    // its place in the outbox and goes on the next run. Named by the note's own
    // stamp, which is what the entry holds, not the one the row was sent with.
    await clearDirtySent(chunk.map((p) => ({ id: p.note.id, stamp: p.note.updated_at })));
    return { sent: chunk.length, refused: null };
  }
  // Too large to take at once: halved, uncharged, until it fits. A single row
  // the server will still not take is that row's own refusal, below.
  if (tooLarge(error) && chunk.length > 1) return sendHalves(chunk, caps);
  if (!namesTheRow(error) && !tooLarge(error)) {
    // Nothing here is this batch's fault, so nothing here is bisected and
    // nothing is charged a refusal. Reported once, which keeps the mark honest
    // and the backoff climbing — the two things that are actually true.
    return { sent: 0, refused: new Error(error.message) };
  }
  if (chunk.length === 1) {
    const { note } = chunk[0];
    const nowHeld = await recordRefusal(note.id, note.updated_at, error.message);
    return {
      sent: 0,
      // A held note is reported to the user by name, in its own words, rather
      // than as one more failed sync — see `held.ts`. Reported as a failure it
      // would also keep the backoff climbing and the mark red over an archive
      // that is otherwise syncing perfectly.
      refused: nowHeld ? null : new Error(`note ${note.id}: ${error.message}`),
    };
  }
  return sendHalves(chunk, caps);
}

/** `send` for each half of a chunk in turn, the first half first, answers added up. */
async function sendHalves(
  chunk: { entry: DirtyEntry; note: Note }[],
  caps: Caps,
): Promise<{ sent: number; refused: Error | null }> {
  const half = Math.ceil(chunk.length / 2);
  const first = await send(chunk.slice(0, half), caps);
  const second = await send(chunk.slice(half), caps);
  return { sent: first.sent + second.sent, refused: first.refused ?? second.refused };
}

interface PullOutcome {
  notes: Note[];
  cursor: Cursor | null;
  /**
   * Deferred ids this turn did **not** manage to ask about — the ones past the
   * page limit, and every one of them if the by-id request itself failed.
   *
   * The stored list used to be replaced wholesale on the grounds that "every id
   * in the old set was asked for again just now", which is true only when that
   * request succeeded. A dropped connection therefore emptied the list of notes
   * nobody had looked at, and each one stopped receiving remote changes for
   * good. They are carried forward instead.
   */
  unasked: string[];
}

/**
 * Downloads changes, with a recent overlap to repair interrupted applies.
 *
 * `head` is the first page when the combined pull already fetched it
 * (`pullChanges.ts`); the table is then asked only for what may lie behind a
 * full page, and for the deferred ids, which the combined pull does not carry.
 */
async function pull(caps: Caps, head?: Page<Note> | null): Promise<PullOutcome> {
  const backend = await getBackend();
  if (!backend) return { notes: [], cursor: null, unasked: [] };
  const saved = await getMeta<Cursor | string>(NOTES_CURSOR);
  const since = readCursor(saved);
  const select = columns(caps);

  const out: Note[] = [];
  let cursor: Cursor = repairStart(since);
  let latest = since;
  if (head) {
    out.push(...head.rows);
    if (head.cursor) {
      cursor = head.cursor;
      if (laterCursor(head.cursor, latest)) latest = head.cursor;
    }
  }
  for (; !head || !head.complete; ) {
    const { data, error } = await backend.pullNotes(select, cursor, PAGE);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    const rows = data;
    out.push(...rows.map(noteFromRow));
    cursor = {
      at: String(rows[rows.length - 1].updated_at),
      id: String(rows[rows.length - 1].id),
    };
    if (laterCursor(cursor, latest)) latest = cursor;
    if (data.length < PAGE) break;
  }

  // Rows the last turn had to put back, fetched by id because the cursor has
  // already moved past them. Without this a note that sits in the outbox stops
  // receiving remote changes for good: the pull correctly declines to overwrite
  // unsent work, and the position advances anyway, so the change is never
  // offered again and the two devices disagree about that note indefinitely.
  const deferred = (await getMeta<string[]>(DEFERRED_PULL)) ?? [];
  const unasked: string[] = [];
  if (deferred.length > 0) {
    const batch = deferred.slice(0, PAGE);
    // A list longer than one page is asked about a page at a time. The rest are
    // reported as unasked so they survive into the next turn rather than being
    // quietly forgotten by the wholesale rewrite that follows the pull.
    unasked.push(...deferred.slice(PAGE));
    const { data, error } = await backend.notesById(select, batch);
    // Not fatal: the cursor pass above has already done the work that must not
    // be lost. But the ids do have to be kept, or a single failed request is
    // the last anyone hears of them.
    if (error) {
      console.error("could not re-fetch deferred notes", error);
      unasked.push(...batch);
    } else {
      for (const row of data ?? []) out.push(noteFromRow(row));
    }
  }

  return { notes: out, cursor: out.length > 0 ? latest : null, unasked };
}

/**
 * How many deletes to have in the air at once.
 *
 * `permanently_delete_note` takes one note, because the check it performs is
 * about one note. Emptying a trash of sixty then meant sixty round trips in a
 * row — eighteen seconds on a phone, with the notes pull sitting behind it and
 * any one of them able to abort the lot. They do not depend on each other, so
 * they need not queue; a handful at a time keeps the phone's connection from
 * being the next bottleneck.
 */
const DELETE_LANES = 6;

/**
 * What one turn of delete-pushing did.
 *
 * `restored` is the half that used to be thrown away. The server declines a
 * permanent delete when the note is no longer trashed there, or when its
 * `updated_at` has moved past what this device expected — and the note has
 * already been removed locally by then. Naming those ids is what lets the pull
 * in the same turn ask for them again by id; without it the note was gone here,
 * present on the server, and past the pull cursor, so nothing would ever have
 * mentioned it again.
 */
interface TombstonePushOutcome {
  pushed: number;
  /** Notes the server would not destroy, and which must be fetched back. */
  restored: string[];
  refused: Error | null;
}

/**
 * A delete the server refused: was the note restored elsewhere, or has the
 * server simply never heard that it was trashed?
 *
 * `permanently_delete_note` will only destroy a note that is `trashed` on the
 * server. Trash a note offline and empty the trash offline and it never was:
 * `deleteNotes` removes the note **and its outbox entry** in one transaction,
 * so the write that would have said so is gone, and `pushTombstones` runs
 * ahead of the notes push in any case. The connection comes back, the delete
 * is offered against an active note, the server says no — and the app read
 * that no as "the other device restored it", dropped the marker, fetched the
 * note back by id and put it on the board as an **ordinary active note**. A
 * deliberate destroy, undone, silently. It is the case `tombstones.test.ts`
 * has carried as a failing-by-design test since it was found.
 *
 * The two causes are told apart by the one thing only a client ever writes:
 * the per-field clock on `status`. Newer on the server than what this device
 * believed means somebody really did restore it, and the note is entitled to
 * come back. Not newer means this device is holding a write the server has
 * never seen, so the honest repair is to *deliver* it — one narrow `update`,
 * never an upsert, so a row that is genuinely gone is not re-created as a stub
 * — and then ask for the delete a second time.
 *
 * Three answers, because there are three things it can find out: the note is
 * gone from the server, which is what the user asked for; the note was really
 * restored, and is entitled to come back; or the repair could not be finished
 * — the read, the write or the second delete failed on the way. That third one
 * used to be answered `false`, which is the second, so a dropped connection in
 * the middle of this repair dropped the marker and fetched a deliberately
 * destroyed note back onto the board as active. Not knowing is not a verdict:
 * the delete stays queued and is asked again on the next tick.
 */
type Trashing =
  | { outcome: "destroyed" }
  | { outcome: "restored" }
  | { outcome: "unknown"; error: string };

const DESTROYED: Trashing = { outcome: "destroyed" };
const RESTORED: Trashing = { outcome: "restored" };

async function deliverTrashing(tombstone: Tombstone): Promise<Trashing> {
  const backend = await getBackend();
  if (!backend) return { outcome: "unknown", error: "no server to ask" };
  const believed = tombstone.believed;
  // A marker written before this was recorded (or by an older build) knows
  // nothing, and the old behaviour — bring the note back — is the safe answer.
  if (!believed || believed.status !== "trashed") return RESTORED;
  const expected = tombstone.expected_updated_at ?? tombstone.deleted_at;

  const { data: row, error } = await backend.noteState(tombstone.id);
  if (error) return { outcome: "unknown", error: error.message };
  // No row at all: the note is already gone from the server, which is the
  // outcome that was wanted. Nothing to restore and nothing left to ask.
  if (!row) return DESTROYED;
  if (String(row.status) === "trashed") return RESTORED;

  const theirs = (row.field_updated_at ?? {}) as Record<string, string>;
  const mine = believed.clocks.status ?? expected;
  // Their restore is newer than this device's trashing: they win, and the note
  // is entitled to come back exactly as it always did.
  if (theirs.status && cmpIso(theirs.status, mine) > 0) return RESTORED;

  const { error: writeError } = await backend.patchNote(tombstone.id, {
    status: "trashed",
    updated_at: expected,
    field_updated_at: { ...theirs, ...believed.clocks },
  });
  if (writeError) return { outcome: "unknown", error: writeError.message };

  const { data: second, error: secondError } = await backend.permanentlyDeleteNote(
    tombstone.id,
    expected,
  );
  if (secondError) return { outcome: "unknown", error: secondError.message };
  return second === true ? DESTROYED : RESTORED;
}

async function pushTombstones(): Promise<TombstonePushOutcome> {
  const backend = await getBackend();
  if (!backend) return { pushed: 0, restored: [], refused: null };
  const entries = await dirtyTombstoneEntries();
  if (entries.length === 0) return { pushed: 0, restored: [], refused: null };
  const tombstones = new Map((await allTombstones()).map((t) => [t.id, t]));
  const pending = entries
    .map((entry) => ({ entry, tombstone: tombstones.get(entry.id) }))
    .filter((item): item is { entry: DirtyEntry; tombstone: Tombstone } =>
      Boolean(item.tombstone),
    );

  const restored: string[] = [];
  /** Deletes the server actually took, and only those. */
  const confirmed: string[] = [];
  const acknowledged: DirtyEntry[] = [];
  let refused: Error | null = null;

  for (let i = 0; i < pending.length; i += DELETE_LANES) {
    const lane = pending.slice(i, i + DELETE_LANES);
    await Promise.all(
      lane.map(async ({ tombstone }) => {
        const { data, error } = await backend.permanentlyDeleteNote(
          tombstone.id,
          tombstone.expected_updated_at ?? tombstone.deleted_at,
        );
        // One delete the server will not take is one delete, not a broken sync.
        // It stays in the outbox and is offered again on the next tick.
        if (error) {
          refused ??= new Error(`delete ${tombstone.id}: ${error.message}`);
          return;
        }
        if (data !== true) {
          // Refused. Which of the two refusals this is decides whether the
          // note comes back or the delete is completed — `deliverTrashing`.
          const trashing = await deliverTrashing(tombstone);
          if (trashing.outcome === "unknown") {
            // Neither: the repair was cut off. Left exactly as a delete that
            // could not be asked at all is left, above — queued, marker and
            // bytes kept, nothing fetched back — and reported.
            refused ??= new Error(`delete ${tombstone.id}: ${trashing.error}`);
            return;
          }
          if (trashing.outcome === "destroyed") confirmed.push(tombstone.id);
          else restored.push(tombstone.id);
        } else confirmed.push(tombstone.id);
        acknowledged.push({ id: tombstone.id, stamp: tombstone.deleted_at });
      }),
    );
  }

  if (restored.length > 0) await forgetTombstones(restored);
  // Only now are the bytes destroyed. Emptying the trash used to remove them
  // first and ask afterwards, so a delete the server refused restored the note
  // without its files — and for a file that never finished uploading, the
  // local copy it destroyed was the only one there was.
  if (confirmed.length > 0) {
    const orphaned = await purgeTombstoneFiles(confirmed);
    if (orphaned.length > 0) {
      // Best effort: the note is gone either way, and a leaked object costs
      // storage rather than data. Retrying it would mean a second outbox.
      await removeRemote(orphaned).catch((error: unknown) => {
        console.error("could not remove stored files for a deleted note", error);
      });
    }
    // And whatever else is in each note's folder, paths this device never
    // learned included (audit DATA-5). Remembered and retried on failure.
    await removeNoteFolders(confirmed).catch((error: unknown) => {
      console.error("could not clear a deleted note's folder; will try again", error);
    });
  }
  await clearTombstoneDirtySent(acknowledged);
  return { pushed: acknowledged.length, restored, refused };
}

/**
 * Reads deletes from `from` — where a page the combined pull fetched ended —
 * or, with none, from the cursor on disk.
 */
async function pullTombstones(from?: Cursor): Promise<{
  rows: { id: string; deleted_at: string }[];
  cursor: Cursor | null;
}> {
  const backend = await getBackend();
  if (!backend) return { rows: [], cursor: null };
  // From disk the read steps back over the repair window, as the notes pull
  // does and for the same reason (`repairStart`): a delete is stamped with the
  // server's `now()` when its transaction runs, and one committing after this
  // device read past that instant would otherwise never be seen. The saved
  // position itself only ever moves forward.
  const since = from ?? readCursor(await getMeta<Cursor | string>(TOMBSTONES_CURSOR));
  const rows: { id: string; deleted_at: string }[] = [];
  let cursor = from ?? repairStart(since);
  let latest: Cursor = since;
  for (;;) {
    const { data, error } = await backend.pullTombstones(cursor, PAGE);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    const page = data;
    for (const row of page) rows.push({ id: String(row.note_id), deleted_at: String(row.deleted_at) });
    const last = page[page.length - 1];
    cursor = { at: String(last.deleted_at), id: String(last.note_id) };
    if (laterCursor(cursor, latest)) latest = cursor;
    if (data.length < PAGE) break;
  }
  return { rows, cursor: rows.length > 0 ? latest : null };
}

/**
 * Adds ids to the deferred-pull list on disk, without disturbing what is
 * already in it.
 *
 * Written before the pull rather than handed to it, so a turn that dies between
 * the two still asks about them next time. The pull reads this same key.
 */
async function deferPull(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const stored = (await getMeta<string[]>(DEFERRED_PULL)) ?? [];
  await setMeta(DEFERRED_PULL, [...new Set([...stored, ...ids])]);
}

/**
 * One turn. `ahead` is what the combined pull already brought down this tick
 * (`pullChanges.ts`), or null; every rule below is applied the same either way.
 */
export async function syncOnce(local: Note[], ahead: Ahead | null = null): Promise<SyncOutcome> {
  // Seven independent questions, asked together. Sequential, they were seven
  // network round-trips standing single file in front of every session's
  // first pull — the answers are cached after that, so this costs the
  // parallelism only once, and the probes touch nothing they could race on.
  const [
    attachments,
    linkPreviews,
    mergedInto,
    fieldVersions,
    boardId,
    reminderRepeat,
    withTombstones,
  ] = await Promise.all([
    serverKnows("attachments"),
    serverKnows("linkPreviews"),
    serverKnows("mergedInto"),
    serverKnows("fieldVersions"),
    serverKnows("boardId"),
    serverKnows("reminderRepeat"),
    serverKnows("tombstones"),
  ]);
  const caps: Caps = {
    attachments,
    linkPreviews,
    mergedInto,
    fieldVersions,
    boardId,
    reminderRepeat,
  };
  /**
   * Every delete applied to the store this turn, from whichever read brought
   * it — added the moment it is written rather than when the read returns, so
   * a read that fails after writing some still hands those to the screen.
   */
  const deletedIds = new Set<string>();
  const receiveTombstones = async (head?: Page<TombstoneRow>): Promise<string[]> => {
    if (!withTombstones) return [];
    const ids: string[] = [];
    // The page the combined pull fetched, then the table for anything behind
    // a full one, asked from where that page ended. This used to say the
    // page's cursor was on disk before the table was asked, and it was not:
    // the table was read first, from the old cursor, and read the page again.
    // It is handed the page's cursor instead of waiting for the disk, which
    // keeps the order that does matter — both reads finish before either is
    // applied, so a read that fails ahead of the upload leaves nothing
    // half-written.
    const rest = head?.complete ? null : await pullTombstones(head?.cursor ?? undefined);
    for (const incoming of [head, rest]) {
      if (!incoming) continue;
      if (incoming.rows.length > 0) await applyRemoteTombstones(incoming.rows);
      for (const row of incoming.rows) {
        ids.push(row.id);
        deletedIds.add(row.id);
      }
      if (incoming.cursor) await setMeta(TOMBSTONES_CURSOR, incoming.cursor);
    }
    return ids;
  };
  // Pull permanent deletes before note uploads. Otherwise an old dirty copy
  // can hit the server's anti-resurrection trigger and prevent this sync turn
  // from ever reaching the tombstone pull.
  await receiveTombstones(ahead?.tombstones);
  const localTombstones = new Set((await allTombstones()).map((t) => t.id));
  let byId = new Map(local.filter((note) => !localTombstones.has(note.id)).map((n) => [n.id, n]));

  /**
   * The first thing that refused, held rather than thrown.
   *
   * Nothing after this point is allowed to skip the pull. Whatever went wrong
   * with an upload, the other device's notes are already on the server and this
   * one is entitled to them — the old order meant a single stuck delete or one
   * unacceptable row stopped every incoming change as well, which is how "sync
   * failed" came to mean "this device stopped receiving".
   */
  let refused: Error | null = null;

  let tombstonesPushed = 0;
  if (withTombstones) {
    const outcome = await pushTombstones();
    tombstonesPushed = outcome.pushed;
    refused ??= outcome.refused;
    // A delete the server would not take. The note has already gone from this
    // device — `destroy` removes it before anything is asked of the server —
    // so unless it is fetched back it is simply lost here while living on
    // there, and past the cursor, so no ordinary pull would ever mention it
    // again. The list is on disk before the pull below reads it, so an
    // interrupted turn asks again rather than dropping the note for good.
    await deferPull(outcome.restored);
  }

  // Push first: our own edits should win over a stale copy we then pull.
  const upload = await push(
    byId,
    caps,
  );
  let pushed = upload.sent;
  if (upload.refused) {
    // A note the server refuses is most often one the other device deleted for
    // good. Ask for the deletes we have not seen yet, drop those notes, and
    // offer the rest again; whatever is still refused is reported after the
    // pull, never instead of it.
    let newlyDeleted: string[] = [];
    try {
      newlyDeleted = await receiveTombstones();
    } catch (error) {
      // Asked only in the hope of explaining the refusal, so a read that fails
      // explains nothing and the refusal stands. Thrown from here, it unwound
      // the whole turn after the combined pull's deletes were already in
      // IndexedDB with their cursor on disk: nothing returned their ids, so
      // those notes stayed on screen as ghosts, and an edit to one queued a
      // write the server would never take.
      console.error("could not read deletes after a refused upload", error);
    }
    if (newlyDeleted.length === 0) {
      refused ??= upload.refused;
    } else {
      const deleted = deletedIds;
      byId = new Map(local.filter((note) => !deleted.has(note.id)).map((n) => [n.id, n]));
      const retry = await push(byId, caps);
      pushed += retry.sent;
      refused ??= retry.refused;
    }
  }
  let answer: Awaited<ReturnType<typeof pull>>;
  try {
    answer = await pull(caps, ahead?.notes);
  } catch (error) {
    // The deletes read above are already out of IndexedDB with their cursor
    // on disk. Thrown from here, nothing would hand their ids back, and the
    // notes would stay on screen as ghosts that an edit writes back. So the
    // failure is reported as a refusal and the deletes still arrive.
    return {
      pushed: pushed + tombstonesPushed,
      pulled: [...deletedIds].map(deletionMarker),
      held: await heldNotes(),
      refused: refused ?? (error instanceof Error ? error : new Error(String(error))),
      notesPulled: false,
    };
  }
  const { notes: remote, cursor, unasked } = answer;

  // Last-write-wins per note. A remote row only replaces a local one when it
  // is genuinely newer, so an edit made offline is never clobbered.
  const newer = remote.filter((r) => {
    const mine = byId.get(r.id);
    return (
      !mine ||
      (caps.fieldVersions ? remoteIsNewer(mine, r) : cmpIso(r.updated_at, mine.updated_at) > 0)
    );
  });

  // A server that has never heard of attachments holds no opinion about them,
  // and must not be allowed to express one. Without this, attaching a file to
  // a note before the migration lands would push the note up, pull it back
  // with an empty list — the column simply isn't in the row — and destroy the
  // attachment on the way past, entirely inside a normal sync.
  const pulled = newer.map((r) => {
    const mine = byId.get(r.id);
    const merged = mine ? mergeNoteFields(mine, r) : r;
    return {
      ...merged,
      attachments: caps.attachments ? merged.attachments : (mine?.attachments ?? []),
      link_previews: caps.linkPreviews ? merged.link_previews : (mine?.link_previews ?? []),
      merged_into: caps.mergedInto ? merged.merged_into : (mine?.merged_into ?? null),
      board_id: caps.boardId ? merged.board_id : (mine?.board_id ?? null),
      // The fifth optional column, and it was missing from this list. A server
      // that has not been migrated to `reminder_repeat` does not answer with
      // it, `noteFromRow` reads the absence as `null`, and the merge then took
      // the remote as the base and quietly cleared the rule — after which
      // `remoteIsNewer` never fires for it again, so it never heals, and the
      // next local edit pushes the null up with a fresh clock and destroys the
      // repeat on the server too.
      reminder_repeat: caps.reminderRepeat
        ? merged.reminder_repeat
        : (mine?.reminder_repeat ?? null),
    };
  });

  // The cursor is committed only after the durable local write. If IndexedDB
  // fails or the page closes, the same rows are fetched again next time.
  const { accepted: stored, deferred } = await putNotesFromServer(pulled);
  if (cursor) await setMeta(NOTES_CURSOR, cappedAtServerTime(cursor));
  // Rewritten rather than merged, because every id the pull actually asked
  // about is answered for: anything still unsent is back in `deferred`, and
  // anything that finally landed has dropped out by itself. The exception is
  // what the pull could not reach — a page past the limit, or a request that
  // failed — which is carried forward rather than forgotten.
  await setMeta(DEFERRED_PULL, [...new Set([...deferred, ...unasked])]);

  // No third tombstone pull here. One used to follow the notes pull, so a
  // delete made on the other device in the second between the pull before
  // the push and the pull of the notes landed in this turn rather than the
  // next — at the price of a round trip on every idle tick, twenty seconds
  // apart, for the rest of the session. The next turn is never far: the
  // backstop, a focus, or the realtime wake the delete itself sends.
  const deletionMarkers = [...deletedIds].map(deletionMarker);
  return {
    pushed: pushed + tombstonesPushed,
    pulled: [...stored, ...deletionMarkers],
    held: await heldNotes(),
    refused,
  };
}
