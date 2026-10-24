import type { UserBoard } from "../types";
import { getBackend } from "./backend";
import { columnProbe, probe } from "./capability";

/**
 * Sync for the user's own folder boards (migration 0016; formerly the
 * pinned-tag boards of migration 0014 — same table, same one-row-per-person
 * shape, now carrying named folders instead of a list of tag strings).
 *
 * Small enough not to need a cursor: there is exactly one row, keyed by the
 * signed-in person rather than by an id the client names, so a pull is just
 * "read my row" and a push is just "write my row." The interesting part is
 * not the plumbing, it is the conflict rule below — read `canvasSync.ts`
 * first, because this is that same problem at a smaller scale.
 *
 * **The conflict rule, and it is deliberately not the notes' plain
 * last-write-wins on `updated_at`.**
 *
 * A brand-new device — or one that has never made a folder — holds an empty
 * list it never chose, the same way opening an idea for the first time
 * invents a default canvas layout nobody asked for (`canvasSync.ts`,
 * `putCanvasLocalOnly`). If that empty list could win a timestamp race, merely
 * opening the app on a second device would wipe the shelf the first device
 * built. So the question this module asks is not "whose row is newer" but
 * "did anyone here actually touch the boards" — exactly the outbox question
 * `syncCanvasesOnce` asks, just for a single row instead of many:
 *
 *   - this device has a board change queued (`dirty`) → read the server's
 *     row, **merge** this device's change into it (`lib/boardsMerge.ts`), push
 *     the merge — written only over the row just read (migration 0028), and
 *     read, merged and sent again when another device wrote in between. It used to push its own list whole, and on 2026-10-09 a
 *     browser that had been used "on this device only" signed in and pushed an
 *     empty shelf over nine real folders. Merged, a device that has never seen
 *     the account's list can add to it and never take anything away.
 *   - otherwise → the remote row wins outright, whatever it says, including
 *     "no folders here yet."
 *
 * Two devices that both genuinely edit the same folder still resolve
 * last-write-wins on that folder; two devices editing different folders now
 * both keep their change.
 *
 * **"Dirty" is per field, and that is not tidiness.** The row carries two
 * unrelated things: a folder list the user built by hand, and an Inbox date the
 * app is allowed to answer *for* them. While they shared one flag, the app
 * answering the date offered the folder list for upload alongside it — and on a
 * browser whose store had just been cleared, the folder list it offered was
 * empty. It won, because a push is unconditional by design. Four real folders
 * were replaced on the server by the blank shelf of a device that had never seen
 * them, and every other device pulled the blankness down afterwards. `pushPrefs`
 * now sends only the fields whose own flag is set, which is the sentence above
 * said one level down.
 */

const TABLE = "prefs";

/**
 * Whether the server has been taught about preferences yet.
 *
 * The same window `serverKnowsCanvases` exists for: the client deploys from
 * one place and the schema migrates from another. Asked once and remembered
 * for the session; before the migration, boards simply stay per-device
 * exactly as they always have, and nothing here may ever take note sync down
 * with it.
 */
let hasPrefs: boolean | null = null;

export async function serverKnowsBoards(): Promise<boolean> {
  // "boards", not "owner_id": the table arrived in migration 0014 and the
  // column this then reads only in 0016, so probing the table passed against a
  // half-migrated server and every read after it failed on the column.
  const { known, remember } = await probe(hasPrefs, columnProbe(TABLE, "boards"));
  if (remember) hasPrefs = known;
  return known;
}

export interface LocalPrefs {
  boards: UserBoard[];
  /**
   * The server's folder list as this device last saw it — what the merge tells
   * "deleted here" from "made elsewhere" by. Null on a device that has never
   * seen one, which may then only add.
   */
  base?: UserBoard[] | null;
  /** The date the Inbox starts at, or null if nobody has answered yet. */
  inboxSince: string | null;
  /** ISO stamp of the last local change — the version a push is crossed off by. */
  at: string;
  /** Whether a change to the **folder list** is queued for upload. */
  boardsDirty: boolean;
  /** Whether a change to the Inbox date is queued for upload. */
  sinceDirty: boolean;
}

export interface PrefsSyncOutcome {
  pushed: boolean;
  /**
   * The folder list that went up — the server's merged with this device's
   * change — and the merge itself, for a change made while it was in flight
   * (`applyMergedBoards` in `useBoards.ts`). Absent when no folder list went up.
   */
  merged?: { boards: UserBoard[]; mergeBoards: typeof import("../lib/boardsMerge").mergeBoards };
  /**
   * The account's Inbox date, taken instead of the one queued here: this device
   * answered before it had ever seen the account's row (a store used "on this
   * device only"), and the account already had an answer (audit DATA-11).
   * The queued date is to be dropped and this one kept (`yieldInboxSince`).
   */
  yieldedSince?: string;
  pulled: {
    boards: UserBoard[];
    at: string;
    /**
     * The date the Inbox starts at, as the server holds it — `null` for "nobody
     * has answered", and **absent** for "this server cannot say", which is a
     * different fact and must not overwrite the answer this device already has.
     * That is the whole reason it is optional rather than nullable.
     */
    inboxSince?: string | null;
  } | null;
}

/**
 * Whether the server has been taught about the Inbox date yet (migration 0018).
 *
 * The same window `serverKnowsBoards` exists for, one column later: the client
 * deploys from one place and the schema migrates from another. Asked once and
 * remembered for the session; before the migration the folders still sync
 * exactly as they always have and the Inbox date simply stays per-device.
 */
let hasSince: boolean | null = null;

async function serverKnowsInboxSince(): Promise<boolean> {
  const { known, remember } = await probe(hasSince, columnProbe(TABLE, "inbox_since"));
  if (remember) hasSince = known;
  return known;
}

/** The row as the client reads it; `inboxSince` is absent on a server without the column. */
export interface RemotePrefsRow {
  boards: UserBoard[];
  at: string;
  inboxSince?: string | null;
}

/** Downloads the one row belonging to whoever is signed in, if any. */
async function pullPrefs(withSince: boolean): Promise<RemotePrefsRow | null> {
  const backend = await getBackend();
  if (!backend) return null;
  const { data: row, error } = await backend.readPrefs(
    withSince ? "boards,inbox_since,updated_at" : "boards,updated_at",
  );
  if (error) throw new Error(error.message);
  if (!row) return null;
  return {
    boards: (row.boards as UserBoard[] | null) ?? [],
    at: String(row.updated_at),
    // A server without the column says *nothing* about the date rather than
    // saying "no answer": reported as null, it would wipe the answer already
    // given on this device every time the loop ran against an old server.
    ...(withSince ? { inboxSince: (row.inbox_since as string | null) ?? null } : {}),
  };
}

/**
 * One turn of preferences sync. See the module comment for the conflict rule
 * — it is the whole point of this file.
 */
export async function syncBoardsOnce(
  local: LocalPrefs,
  ahead?: RemotePrefsRow | null,
): Promise<PrefsSyncOutcome> {
  const asking = hasPrefs === null;
  const { known, remember } = await probe(hasPrefs, columnProbe(TABLE, "boards"));
  if (remember) hasPrefs = known;
  if (!known) {
    // "Could not ask" is a failed turn, never a quiet one. Answered as "nothing
    // to do", the tick came round clean, the app took it as the server's word
    // on the shelf, and Inspiration could be adopted over a list never read.
    // A server that really has no table (remembered) or no server at all stays
    // the quiet answer it always was.
    if (asking && !remember && (await getBackend())) throw new Error("could not ask the server about boards");
    return { pushed: false, pulled: null };
  }
  const withSince = await serverKnowsInboxSince();

  // A change queued here goes up through `boardPush.ts`, loaded only when
  // there is one — the merge, the conditional write and its retries are not
  // first-paint code.
  if (local.boardsDirty || local.sinceDirty) {
    const { pushQueued } = await import("./boardPush");
    return pushQueued(local, withSince, ahead, pullPrefs);
  }

  // The row the combined pull already brought down — `null` there means the
  // server holds none, which is an answer — or the table itself.
  const pulled = ahead !== undefined ? ahead : await pullPrefs(withSince);
  return { pushed: false, pulled };
}
