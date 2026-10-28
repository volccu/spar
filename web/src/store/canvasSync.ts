import { nowIso } from "../lib/when";
import type { CanvasImage, CanvasText, DrawingStroke, Canvas, CanvasItem } from "../types";
import { getBackend, type Row } from "./backend";
import { stampForUpload } from "./serverClock";
import { columnProbe, probe } from "./capability";
import { isOwnEcho, rememberSent } from "./echo";
import { cmpIso } from "../lib/versions";
import {
  FOLDERS_CURSOR,
  cappedAtServerTime,
  laterCursor,
  readCursor,
  repairStart,
  type Cursor,
} from "./cursors";
import type { Page } from "./pullChanges";
import { HELD_CANVASES, clearRefusals, heldNotes, isHeld, recordRefusal, type HeldNote } from "./held";
import { namesTheRow, tooLarge } from "./sync";
import {
  clearCanvasDirtySent,
  dirtyCanvasEntries,
  getMeta,
  putCanvasesFromServer,
  setMeta,
  type DirtyEntry,
} from "./db";

/**
 * Sync for the canvas an idea is arranged on (migration 0010).
 *
 * It is the notes path in miniature — push the outbox, pull what changed, and
 * keep the local store the source of truth — with one deliberate difference,
 * which is the conflict rule. See `syncCanvasesOnce`.
 */

const PAGE = 200;

const COLUMNS = "id,items,strokes,image_widths,text_elements,created_at,updated_at";

/**
 * Whether the server has been taught about folders yet.
 *
 * The same window the attachments and link-preview checks exist for: the client
 * deploys from one place and the schema migrates from another, so for a while
 * they disagree. Asking for a table that isn't there fails, and folder sync must
 * fail *quietly* — the notes are the part that cannot be reconstructed, and they
 * are not going to be held up by a canvas.
 *
 * Asked once and remembered for the session. Before the migration: exactly the
 * behaviour that shipped, arrangements stay on the device that made them. After
 * it: the next run picks them up. Neither state needs anybody to intervene.
 */
let hasFolders: boolean | null = null;

export async function serverKnowsCanvases(): Promise<boolean> {
  const { known, remember } = await probe(hasFolders, columnProbe("folders", "id"));
  if (remember) hasFolders = known;
  return known;
}

function toRow(folder: Canvas) {
  // `owner_id` is left to the column default (auth.uid()), exactly as notes do
  // — the client never names an owner, so it can never name the wrong one.
  return {
    id: folder.id,
    // Pictures placed on the canvas ride in `items` beside the notes, told
    // apart by `attachment_id` — no column of their own, so no migration and
    // nothing for the self-hosted server to learn. An older build skips them
    // (it finds no note by that id) and writes them back untouched.
    items: [...(folder.items ?? []), ...(folder.images ?? [])],
    strokes: folder.strokes ?? [],
    image_widths: folder.image_widths ?? {},
    text_elements: folder.text_elements ?? [],
    created_at: folder.created_at,
    updated_at: folder.updated_at,
  };
}

export function canvasFromRow(row: Row): Canvas {
  const id = String(row.id);
  const placed = (row.items as (Record<string, unknown> | null)[] | null) ?? [];
  return {
    id,
    // The folder *is* the idea's arrangement; the foreign key says so, and a
    // second stored copy of the same value could only ever drift from it.
    idea_id: id,
    items: placed.filter((item) => typeof item?.note_id === "string") as unknown as CanvasItem[],
    images: placed.filter((item) => typeof item?.attachment_id === "string") as unknown as CanvasImage[],
    strokes: (row.strokes as DrawingStroke[]) ?? [],
    image_widths: (row.image_widths as Record<string, number>) ?? {},
    // Absent from any row written before labels existed, and null reads as
    // "no labels" rather than as something the UI has to defend against.
    text_elements: (row.text_elements as CanvasText[]) ?? [],
    created_at: (row.created_at as string) ?? nowIso(),
    updated_at: (row.updated_at as string) ?? nowIso(),
  };
}

/**
 * Uploads every arrangement changed since the last successful push.
 *
 * Crossing an entry off follows the notes rule to the letter: only if it still
 * names the version that actually went up. Dragging a note across the canvas
 * writes several times a second, so an edit landing mid-flight is not an edge
 * case here — it is what dragging *is*.
 *
 * A refusal is handed back, never thrown, so the pull after it still runs
 * (review 2026-10-13, EH-07): one canvas whose idea note the server lacks
 * used to stop every arrangement from the other device arriving. A canvas
 * refused `HOLD_AFTER` times is held, as a note is (`held.ts`), and not
 * offered again until it is arranged anew or the user asks.
 */
async function pushFolders(
  localById: Map<string, Canvas>,
): Promise<{ sent: number; attempted: Set<string>; refused: Error | null }> {
  const nothing = { sent: 0, attempted: new Set<string>(), refused: null };
  if (!(await getBackend())) return nothing;
  const entries = await dirtyCanvasEntries();
  if (entries.length === 0) return nothing;

  const held = await heldNotes(HELD_CANVASES);
  const pending = entries
    .map((entry) => ({ entry, folder: localById.get(entry.id) }))
    .filter((p): p is { entry: DirtyEntry; folder: Canvas } =>
      Boolean(p.folder) && !isHeld(held, p.folder!.id, p.folder!.updated_at),
    );

  let sent = 0;
  let refused: Error | null = null;
  for (let i = 0; i < pending.length; i += PAGE) {
    const outcome = await sendFolders(pending.slice(i, i + PAGE));
    sent += outcome.sent;
    refused ??= outcome.refused;
  }
  return { sent, attempted: new Set(pending.map((p) => p.folder.id)), refused };
}

/**
 * Sends one chunk, and on refusal halves it to find the row the server will
 * not take — the notes path's rule (`send` in `sync.ts`), which this did not
 * have.
 *
 * An upsert is one statement, so one bad row failed the whole chunk and
 * everything queued behind it. A canvas whose idea note has been permanently
 * deleted violates the foreign key in migration 0010, and that is enough: the
 * throw reached an empty catch in `useSync`, so every canvas on the device
 * stopped syncing, for good, without a word. Halving finds the offender in
 * log₂(n) requests and everything either side of it goes up as normal.
 */
async function sendFolders(
  chunk: { entry: DirtyEntry; folder: Canvas }[],
): Promise<{ sent: number; refused: Error | null }> {
  // No earlier than the server's clock, for the notes' reason and more so: a
  // canvas's pull has no repair window at all (`stampForUpload`).
  const stamps = chunk.map((p) => stampForUpload(p.folder.updated_at));
  const { error } = await (await getBackend())!.upsertCanvases(
    chunk.map((p, i) => ({ ...toRow(p.folder), updated_at: stamps[i] })),
  );
  if (!error) {
    // The stamps that went up — sent, not the canvas's own — so the server
    // echoing this very upsert back through realtime does not wake a tick to
    // pull what it just pushed, and dragging a note across a canvas pushes
    // every 700ms. The pull's conflict filter reads the same memory.
    rememberSent("folders", chunk.map((p, i) => ({ id: p.folder.id, updated_at: stamps[i] })));
    await clearRefusals(chunk.map((p) => p.folder.id), HELD_CANVASES);
    await clearCanvasDirtySent(
      chunk.map((p) => ({ id: p.folder.id, stamp: p.folder.updated_at })),
    );
    return { sent: chunk.length, refused: null };
  }
  // A failed request is no row's fault: not halved, and nothing charged.
  if (!namesTheRow(error) && !tooLarge(error)) {
    return { sent: 0, refused: new Error(error.message) };
  }
  if (chunk.length === 1) {
    // Left in the outbox on purpose: it is retried, and the arrangement is
    // still on this device meanwhile. Held once refused often enough.
    const { folder } = chunk[0];
    const nowHeld = await recordRefusal(folder.id, folder.updated_at, error.message, HELD_CANVASES);
    return {
      sent: 0,
      refused: nowHeld ? null : new Error(`canvas ${folder.id}: ${error.message}`),
    };
  }
  const half = Math.ceil(chunk.length / 2);
  const first = await sendFolders(chunk.slice(0, half));
  const second = await sendFolders(chunk.slice(half));
  return {
    sent: first.sent + second.sent,
    refused: first.refused ?? second.refused,
  };
}

interface PullOutcome {
  folders: Canvas[];
  cursor: Cursor | null;
}

/**
 * Downloads any canvas the other device rearranged since we last looked.
 *
 * `start` continues from where a page the combined pull fetched left off.
 * Without it the read begins at the saved cursor stepped back over the repair
 * window (`repairStart`), which this pull did not have: an upload is stamped
 * with the server's clock read a second or so early, and a slow commit lands
 * behind a read that has already passed its stamp, and either puts a canvas
 * just behind the other device's cursor, where a strict keyset never looks
 * again. What comes back is the later of the saved cursor and the last row
 * read, so reading the window again never walks the position backwards.
 */
async function pullFolders(start?: Cursor): Promise<PullOutcome> {
  const backend = await getBackend();
  if (!backend) return { folders: [], cursor: null };
  const since = start ?? readCursor(await getMeta<Cursor | string>(FOLDERS_CURSOR));

  const out: Canvas[] = [];
  let cursor = start ?? repairStart(since);
  let latest = since;
  for (;;) {
    // A cursor with no id — a device that has never completed a pull, or any
    // first page, since `repairStart` drops the id — reads from the stamp
    // *inclusive* (the backend's `pullCanvases`, which says why).
    const { data, error } = await backend.pullCanvases(COLUMNS, cursor, PAGE);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    const rows = data;
    out.push(...rows.map(canvasFromRow));
    cursor = {
      at: String(rows[rows.length - 1].updated_at),
      id: String(rows[rows.length - 1].id),
    };
    if (laterCursor(cursor, latest)) latest = cursor;
    if (data.length < PAGE) break;
  }

  // Persist the pulled arrangement before advancing the cursor. A closed tab
  // must replay a page rather than permanently skipping a canvas.
  return { folders: out, cursor: out.length > 0 ? latest : null };
}

export interface CanvasSyncOutcome {
  pushed: number;
  pulled: Canvas[];
  /** The first canvas the server would not take, handed back after the pull. */
  refused: Error | null;
  /** Canvases refused too often to keep sending (`held.ts`). */
  held: HeldNote[];
}

/**
 * One turn of folder sync.
 *
 * The conflict rule is **remote wins unless this device has an arrangement
 * still waiting to go up** — and that is not the same as the notes' plain
 * last-write-wins on `updated_at`, on purpose.
 *
 * A note only ever exists because somebody wrote it. A folder does not: opening
 * an idea for the first time invents a default layout, stamped now. Compared by
 * timestamp, that invention is newer than the arrangement made on the laptop
 * last week, so merely *looking* at an idea on the phone would win the argument
 * and flatten it. Comparing outboxes instead asks the question that actually
 * matters — did anyone here move anything — and the invented default never
 * enters the outbox at all (`putCanvasLocalOnly`).
 *
 * Two devices that both genuinely rearrange the same canvas still resolve
 * last-write-wins, which is right and is what SPEC §3 chose for one person with
 * two devices.
 */
export async function syncCanvasesOnce(
  local: Canvas[],
  ahead: Page<Canvas> | null = null,
): Promise<CanvasSyncOutcome> {
  if (!(await serverKnowsCanvases())) return { pushed: 0, pulled: [], refused: null, held: [] };

  const byId = new Map(local.map((folder) => [folder.id, folder]));
  // Push first, so our own arrangement wins over the copy we then pull back.
  const { sent: pushed, attempted, refused } = await pushFolders(byId);
  // What the combined pull already brought down, or the table itself; a full
  // page ahead is followed from where it ended. A row fetched *before* the
  // push for a canvas the push just sent is older than what went up, by
  // construction — and the conflict rule below is deliberately not a
  // timestamp race, so it would have applied it. Whatever was attempted is
  // dropped from the page: what went up needs no copy of itself, and what
  // was refused is still queued and is filtered below anyway.
  let remote: PullOutcome;
  if (!ahead) {
    remote = await pullFolders();
  } else {
    const fresh = ahead.rows.filter((folder) => !attempted.has(folder.id));
    if (ahead.complete || !ahead.cursor) {
      remote = { folders: fresh, cursor: ahead.cursor };
    } else {
      const rest = await pullFolders(ahead.cursor);
      remote = { folders: [...fresh, ...rest.folders], cursor: rest.cursor ?? ahead.cursor };
    }
  }

  // Read *after* the push: whatever is still queued was re-stamped while the
  // upload was in flight, and is the one thing a pull must not overwrite.
  const queued = new Set((await dirtyCanvasEntries()).map((entry) => entry.id));

  const wanted = remote.folders.filter((folder) => {
    if (queued.has(folder.id)) return false;
    // Our own upload comes straight back down the pull. Applying it would be
    // harmless and identical, but it would re-render the canvas under the hand
    // that is still dragging on it. It comes back under the stamp it was
    // *sent* with, which may be later than the canvas's own
    // (`stampForUpload`), so it is known by what the echo guard was told.
    // Compared as instants, not strings: a stamp that goes up as `...Z` comes
    // back as `...+00:00`, and the repair window now reads every recent row
    // again on every tick.
    const mine = byId.get(folder.id);
    return (
      !mine ||
      (cmpIso(mine.updated_at, folder.updated_at) !== 0 && !isOwnEcho("folders", folder))
    );
  });

  // Persist only arrangements that won the outbox conflict rule. Advancing the
  // cursor after this durable write prevents a queued local canvas from being
  // replaced in IndexedDB by a remote row that was deliberately ignored.
  const pulled = await putCanvasesFromServer(wanted);
  // Capped at the server's clock, as the notes cursor is: a canvas stamped by a
  // device whose clock runs fast must not carry this cursor into the future,
  // where everything written in the meantime sits behind it for good.
  if (remote.cursor) await setMeta(FOLDERS_CURSOR, cappedAtServerTime(remote.cursor));

  return { pushed, pulled, refused, held: await heldNotes(HELD_CANVASES) };
}
