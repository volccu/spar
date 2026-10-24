import { mergeBoards } from "../lib/boardsMerge";
import { getBackend } from "./backend";
import { reallyMissing } from "./capability";
import { PREFS_ROW, rememberSent } from "./echo";
import type { LocalPrefs, PrefsSyncOutcome, RemotePrefsRow } from "./boardSync";

/**
 * The half of `syncBoardsOnce` that sends a change queued on this device —
 * loaded only when there is one, so the merge, the conditional write and its
 * retries stay out of the first paint. See `boardSync.ts` for the rule.
 */

/**
 * Whether the server writes the folder list conditionally (migration 0028's
 * `write_prefs_if_unchanged`; always, on the spår server). Null until asked;
 * a "no" is remembered only when the server really lacks it (`reallyMissing`),
 * and then the plain upsert is used, which is how every push went before.
 */
let conditional: boolean | null = null;

/** How many times a merge is re-read and re-sent before the turn gives up. */
const MERGE_ATTEMPTS = 3;

/**
 * Uploads the preferences row, carrying **only the fields this device changed.**
 *
 * An upsert writes the columns it is given and leaves the rest of the row alone,
 * which is the whole reason the payload is built rather than fixed: a device that
 * answered the Inbox question and never touched a folder sends the date and says
 * nothing about the shelf. Sending the folder list anyway is how four real
 * folders were replaced by the empty list of a browser whose store had just been
 * cleared — see `useBoards.ts`'s `DIRTY_KEY`.
 */
async function pushPrefs(local: LocalPrefs, withSince: boolean, readAt?: string | null): Promise<boolean> {
  const backend = await getBackend();
  if (!backend) return true;
  const row = {
    ...(local.boardsDirty ? { boards: local.boards } : {}),
    updated_at: local.at,
    ...(withSince && local.sinceDirty ? { inbox_since: local.inboxSince } : {}),
  };
  // A merged folder list is written only over the row it was merged against
  // (audit DATA-1): `false` means another device wrote in between, and the
  // caller reads, merges and sends again.
  let written = false;
  if (readAt !== undefined && local.boardsDirty && conditional !== false) {
    const { data, error } = await backend.writePrefsIf(row, readAt);
    if (!error) {
      conditional = true;
      if (!data) return false;
      written = true;
    } else if (reallyMissing(error)) {
      conditional = false;
    } else {
      throw new Error(error.message);
    }
  }
  if (!written) {
    const { error } = await backend.upsertPrefs(row);
    if (error) throw new Error(error.message);
  }
  // Same as the notes and canvas pushes: the stamp that went up, so this
  // device's own row coming back through realtime wakes nothing. The row has
  // no id of its own — it is keyed by the owner, which the client never
  // writes — so it is remembered under a fixed one.
  rememberSent("prefs", [{ id: PREFS_ROW, updated_at: local.at }]);
  return true;
}

/**
 * Sends what is queued here: the Inbox date alone, or the folder list merged
 * into the server's row (with the date, unless it yields — DATA-11).
 */
export async function pushQueued(
  local: LocalPrefs,
  withSince: boolean,
  ahead: RemotePrefsRow | null | undefined,
  pullPrefs: (withSince: boolean) => Promise<RemotePrefsRow | null>,
): Promise<PrefsSyncOutcome> {
  // A device that has never applied the account's row (no `base`) answered the
  // Inbox question on its own — a store used "on this device only". Its answer
  // must not go up over one the account already has: the account's wins
  // (audit DATA-11, 2026-10-10), the same rule the folder list follows, where
  // such a device may add and never take away.
  const firstContact = withSince && local.sinceDirty && (local.base ?? null) === null;
  const accountSince = (remote: RemotePrefsRow | null): string | undefined =>
    firstContact && typeof remote?.inboxSince === "string" ? remote.inboxSince : undefined;

  if (!local.boardsDirty) {
    if (firstContact) {
      const remote = ahead !== undefined ? ahead : await pullPrefs(withSince);
      const yielded = accountSince(remote);
      if (yielded !== undefined) return { pushed: false, pulled: remote, yieldedSince: yielded };
    }
    await pushPrefs(local, withSince);
    return { pushed: true, pulled: null };
  }
  // The server's list as it stands **now**, read just before merging —
  // never the combined pull's copy, which was read at the start of the
  // tick, before notes, files and canvases had taken their minutes; a
  // folder change the other device made in that span was overwritten
  // (audit DATA-1, 2026-10-10). The write is conditional on the stamp read
  // here, so a change landing between this read and the write is caught
  // too: read again, merge again, send again.
  for (let attempt = 1; ; attempt++) {
    const remote = await pullPrefs(withSince);
    const boards = remote ? mergeBoards(remote.boards, local.boards, local.base ?? null) : local.boards;
    const yielded = accountSince(remote);
    const sending = { ...local, boards, sinceDirty: local.sinceDirty && yielded === undefined };
    if (await pushPrefs(sending, withSince, remote ? remote.at : null)) {
      // Not pulled again in the same turn: our own upload would come straight
      // back down, identical, and an older row must never be laid over it.
      return {
        pushed: true,
        pulled: null,
        merged: { boards, mergeBoards },
        ...(yielded !== undefined ? { yieldedSince: yielded } : {}),
      };
    }
    if (attempt >= MERGE_ATTEMPTS) {
      throw new Error("the folder list kept changing on the server; trying again next turn");
    }
  }
}
