/**
 * What this device just sent, so that its own write coming back through
 * realtime is not mistaken for the other device writing.
 *
 * The notes channel listens to every change on the table, and the server
 * does not know which client caused one: an upsert from here is echoed back
 * here, the handler woke the loop, and every edit burst cost two full ticks
 * — the echo's tick pulled the row it had just pushed, whole, thumbnails and
 * all. The stamp the row went up with is remembered; an event carrying the
 * same id and the same instant is this device's own, and wakes nothing.
 *
 * A row the server *changed* on the way in — a merge against a newer copy
 * from the other device — comes back with a different `updated_at`, and that
 * is exactly the wake the loop wants. Compared as instants rather than
 * strings: the row goes up as `...Z` and comes back as `...+00:00`.
 *
 * **Keyed by table as well as by id, and that is not tidiness.** A canvas's
 * id *is* its idea note's id — migration 0010 makes it a foreign key — so
 * one map keyed by id alone has the canvas for note X and note X itself
 * fighting over one entry, and whichever was pushed second silently
 * disarmed the other's guard. The prefs row has no id of its own at all and
 * is remembered under its own table name with a fixed one.
 */
export type EchoTable = "notes" | "folders" | "prefs";

/** The prefs row is one row a person; its stamp is the whole of its identity. */
export const PREFS_ROW = "prefs";

const sent = new Map<string, number>();

/** Bounded, oldest first: the map's own insertion order is the queue. */
const REMEMBERED = 256;

export function rememberSent(
  table: EchoTable,
  rows: { id: string; updated_at: string }[],
): void {
  for (const row of rows) {
    const key = `${table}:${row.id}`;
    sent.delete(key);
    sent.set(key, Date.parse(row.updated_at));
  }
  while (sent.size > REMEMBERED) {
    const oldest = sent.keys().next().value;
    if (oldest === undefined) break;
    sent.delete(oldest);
  }
}

/**
 * Whether a realtime row is one this device sent, stamp for stamp.
 *
 * `rowId` names the row for a table whose payload carries no id this device
 * can match on — the prefs row, which is keyed by the owner the client never
 * writes. Everything else reads its own `id`.
 */
export function isOwnEcho(table: EchoTable, row: unknown, rowId?: string): boolean {
  if (typeof row !== "object" || row === null) return false;
  const { id, updated_at } = row as { id?: unknown; updated_at?: unknown };
  const key = rowId ?? id;
  if (typeof key !== "string" || typeof updated_at !== "string") return false;
  const at = sent.get(`${table}:${key}`);
  return at !== undefined && at === Date.parse(updated_at);
}

/** For tests. */
export function forgetSent(): void {
  sent.clear();
}
