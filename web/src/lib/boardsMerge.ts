import type { UserBoard } from "../types";
import { INSPIRATION_NAME, isInspirationEntry, SHELF_ORDER_ID } from "./boards";

/**
 * The preferences row's folder list, merged rather than overwritten
 * (2026-10-09). Reached by a dynamic import from `syncBoardsOnce`, only when a
 * device has a change to the list queued — never on the first paint.
 *
 * Until this existed a queued change was pushed whole, and the whole list it
 * pushed was whatever this device held. On 2026-10-09 a browser that had been
 * used "on this device only" — an empty shelf, plus an Inspiration it made for
 * itself — signed in and pushed that list over the account's nine folders. No
 * note was lost (each keeps its `board_id`), but every folder left the shelf on
 * every device. See `docs/decisions/web-ui.md`.
 *
 * Three lists: what the server holds now, what this device holds, and `base` —
 * the server's list as this device last saw it (stored in IndexedDB as
 * `boardsBase` whenever a server list is applied or a merge is pushed).
 *
 * - An entry on the server and here: **field by field** — each field this
 *   device changed since `base` is this device's, every other field the
 *   server's. It used to be the whole entry, and a reorder (which renumbers
 *   the whole run) then undid every rename, mark and tint the other device
 *   had made meanwhile (audit DATA-12, 2026-10-10). The folders' `position`
 *   is the one exception: an order is a property of the whole run, so if this
 *   device moved any folder, every folder's position is this device's, and
 *   otherwise every one is the server's — never a mix of two orders that
 *   seats two folders in one place. Without a `base` entry to compare with,
 *   the entry is this device's.
 * - On the server, not here: kept, unless `base` had it — then this device
 *   deleted it, and the delete stands.
 * - Here, not on the server: added, unless `base` had it — then another device
 *   deleted it, and that delete stands.
 * - **No `base` (a device that has never seen the account's list): it can add,
 *   never remove.** That is the rule that would have saved the shelf.
 * - One Inspiration: when the server already holds one, an Inspiration this
 *   device made for itself (over a list that did not know the account had
 *   one) is **demoted to a plain folder**, never dropped. It used to be
 *   dropped, and the notes filed into it then named a board that existed
 *   nowhere — on the server it had never reached, `prefs_history` could not
 *   bring it back either — so they fell into the Inbox with their sorting lost
 *   (audit DATA-3, 2026-10-10). Demoted, it keeps its id, so every note filed
 *   there stays filed; it keeps the name it had if it was adopted from a folder
 *   ("inspo"), and is called "Inspiration 2" (the next free number) if it was
 *   made new. The server's entry stays the wall even when the newcomer's id is
 *   lower: `inspirationOf` picks the lowest id, and a newcomer winning that
 *   would take the account's wall off its own notes.
 *
 * New folders from this device go after the server's, in the order they had
 * here, so two devices' positions never collide.
 */
export function mergeBoards(
  server: readonly UserBoard[],
  local: readonly UserBoard[],
  base: readonly UserBoard[] | null,
): UserBoard[] {
  const baseById = new Map((base ?? []).map((b) => [b.id, b]));
  const localById = new Map(local.map((b) => [b.id, b]));
  const serverIds = new Set(server.map((b) => b.id));

  const serverHasInspiration = server.some(isInspirationEntry);
  const movedHere = local.some((mine) => {
    const seen = baseById.get(mine.id);
    return seen !== undefined && isFolder(mine) && mine.position !== seen.position;
  });

  const out: UserBoard[] = [];
  for (const theirs of server) {
    const mine = localById.get(theirs.id);
    const seen = baseById.get(theirs.id);
    if (!mine) {
      if (seen) continue; // deleted here
      out.push(theirs);
      continue;
    }
    const merged = mergeEntry(theirs, mine, seen, movedHere);
    // This device adopted a folder as Inspiration while the account already
    // had one: the server's stays the wall, and this one stays a folder.
    out.push(
      serverHasInspiration && !isInspirationEntry(theirs) && isInspirationEntry(merged)
        ? demote(merged, out)
        : merged,
    );
  }

  const lastPosition = out.reduce(
    (max, b) => (isFolder(b) ? Math.max(max, b.position) : max),
    -1,
  );
  let next = lastPosition + 1;
  const added = local
    .filter((b) => !serverIds.has(b.id) && !baseById.has(b.id))
    .sort((a, b) => a.position - b.position);
  for (const arrived of added) {
    const entry = serverHasInspiration && isInspirationEntry(arrived) ? demote(arrived, out) : arrived;
    out.push(isFolder(entry) ? { ...entry, position: next++ } : entry);
  }
  return out;
}

/**
 * A second Inspiration as the plain folder it becomes — same id, so its notes
 * stay filed. See the merge's comment for why it is never dropped.
 */
function demote(entry: UserBoard, list: readonly UserBoard[]): UserBoard {
  const { kind: _kind, ...plain } = entry;
  if (plain.name.trim().toLowerCase() !== INSPIRATION_NAME.toLowerCase()) return plain;
  const taken = new Set(list.map((b) => b.name.trim().toLowerCase()));
  let n = 2;
  while (taken.has(`${INSPIRATION_NAME} ${n}`.toLowerCase())) n++;
  return { ...plain, name: `${INSPIRATION_NAME} ${n}` };
}

/** A folder the user made — not Inspiration, not the shelf's order entry. */
function isFolder(b: UserBoard): boolean {
  return b.id !== SHELF_ORDER_ID && !isInspirationEntry(b);
}

/**
 * One entry held on both sides: each field this device changed since `seen`
 * is this device's, the rest the server's (see the merge's comment, and its
 * one exception, a folder's `position`). A field taken off — a mark removed —
 * counts as changed, and comes back absent.
 */
function mergeEntry(
  theirs: UserBoard,
  mine: UserBoard,
  seen: UserBoard | undefined,
  movedHere: boolean,
): UserBoard {
  if (!seen) return mine;
  const ownOrder = movedHere && isFolder(mine);
  if (same(mine, seen) && !ownOrder) return theirs;
  const t = theirs as unknown as Record<string, unknown>;
  const m = mine as unknown as Record<string, unknown>;
  const s = seen as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(s)])) {
    const fromMine = field === "position" && isFolder(mine) ? ownOrder : canonical(m[field]) !== canonical(s[field]);
    // The shelf's hidden boards are a set, not one value: two devices hiding
    // different boards before either synced both keep their hide (2026-10-23).
    const value =
      field === "hidden" && mine.id === SHELF_ORDER_ID && fromMine
        ? mergedSet(t[field], m[field], s[field])
        : fromMine
          ? m[field]
          : t[field];
    if (value !== undefined) out[field] = value;
  }
  return out as unknown as UserBoard;
}

/** The server's set, plus what this device added since `base`, minus what it took away; absent when empty. */
function mergedSet(theirs: unknown, mine: unknown, seen: unknown): string[] | undefined {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const [t, m, s] = [list(theirs), list(mine), list(seen)];
  const added = m.filter((x) => !s.includes(x));
  const removed = s.filter((x) => !m.includes(x));
  const out = [...t, ...added.filter((x) => !t.includes(x))].filter((x) => !removed.includes(x));
  return out.length > 0 ? out : undefined;
}

/** The same entry, field for field, whatever order the fields were written in. */
function same(a: UserBoard, b: UserBoard): boolean {
  return canonical(a) === canonical(b);
}

/** A value as text, objects with their keys sorted — `undefined` for an absent field. */
function canonical(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.keys(inner).sort().map((k) => [k, (inner as Record<string, unknown>)[k]]))
      : inner,
  );
}
