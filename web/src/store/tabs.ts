/**
 * Two tabs of the app share one archive on disk and, until this, nothing
 * else.
 *
 * Each tab holds the notes in memory and writes through to IndexedDB. A
 * keystroke in one tab reached the store and the server, but the other tab's
 * memory still held the old note — and its sync tick could not correct it:
 * the pull compared the row against the store, which already had it, and
 * dropped it as nothing new. So the second tab sat on a stale copy until a
 * reload, and a keystroke there wrote the stale body back over the fresh
 * one, with a newer clock, and the first tab's words were gone.
 *
 * So every note write to the store is announced here, by id, and a tab
 * hearing it reads those rows back and merges them the way a pull is merged
 * (`useNotes.applyRemote`, per field, by clock). One channel object per
 * page, used for both directions: a `BroadcastChannel` never delivers to
 * the object that posted, so a tab does not hear its own writes.
 *
 * Boards and canvases are not announced; they change rarely and their sync
 * tick re-reads them whole.
 */
export const TAB_CHANNEL = "spar-notes";

interface Written {
  ids: string[];
}

let channel: BroadcastChannel | null | undefined;

function shared(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(TAB_CHANNEL) : null;
    // Node's implementation keeps the process alive while open; the browser's
    // has no such method. Only tests run under Node.
    (channel as { unref?: () => void } | null)?.unref?.();
  } catch {
    channel = null;
  }
  return channel;
}

/** Tells the other tabs which notes this one just wrote or destroyed. */
export function announceWritten(ids: string[]): void {
  if (ids.length === 0) return;
  try {
    shared()?.postMessage({ ids } satisfies Written);
  } catch {
    // A closed channel or a serialisation refusal costs the other tab a
    // live update, not the note: its next reload reads the store.
  }
}

/** Hears the other tabs' writes. Returns the way to stop listening. */
export function onWrittenElsewhere(listen: (ids: string[]) => void): () => void {
  const ch = shared();
  if (!ch) return () => {};
  const handler = (event: MessageEvent) => {
    const ids = (event.data as Partial<Written> | null)?.ids;
    if (!Array.isArray(ids)) return;
    const clean = ids.filter((id): id is string => typeof id === "string");
    if (clean.length > 0) listen(clean);
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
