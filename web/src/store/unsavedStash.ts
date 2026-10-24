import type { Note } from "../types";

/* --- the last resort for a write IndexedDB refused -------------------------------
   `putNote` writes a note and its outbox entry in one transaction, so when it
   fails the edit is neither on the device nor queued for the server — it is only
   in memory, and a reload used to lose it for good. The store retries on its own
   (`useNotes`), but a retry that never gets its turn — the tab closed, the phone
   killed the app — still lost it.

   So a note whose write failed is also copied here, into `localStorage`, which is
   a separate store with its own quota and survives a reload. On the next open the
   copy is laid back over whatever IndexedDB held, if it is newer, and written
   properly. It is emptied the moment every failed write has landed, and by the
   account purge (`purgeEverything`), so it never outlives the store it stands in
   for.

   Every call swallows its own failure: this is the fallback for a storage
   failure, and it must never become a second one.
   -------------------------------------------------------------------------- */

const KEY = "spar.unsaved";

function writeStash(notes: Note[]): void {
  if (notes.length === 0) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(notes));
}

/**
 * Adds these notes to the stash, each over an older copy of itself. The key is
 * shared by every open tab, so what another tab stashed stays: writing only
 * this tab's list used to drop it.
 */
export function stashUnsaved(notes: Note[]): void {
  try {
    const byId = new Map(readUnsaved().map((n) => [n.id, n]));
    for (const note of notes) {
      const held = byId.get(note.id);
      if (!held || Date.parse(held.updated_at) <= Date.parse(note.updated_at)) byId.set(note.id, note);
    }
    writeStash([...byId.values()]);
  } catch {
    // Full or blocked as well. The in-memory copy and the retry still stand.
  }
}

export function readUnsaved(): Note[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((n): n is Note => typeof n?.id === "string" && typeof n?.updated_at === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Empties the stash, or with `ids` takes out only those notes: a tab whose own
 * writes have landed must not throw away another tab's unsaved words.
 */
export function clearUnsaved(ids?: Iterable<string>): void {
  try {
    if (!ids) {
      localStorage.removeItem(KEY);
      return;
    }
    const gone = new Set(ids);
    writeStash(readUnsaved().filter((n) => !gone.has(n.id)));
  } catch {
    // Nothing to do.
  }
}

/**
 * The archive as read from IndexedDB with the stashed copies laid over it —
 * each only where it is newer than the note already there, or where the note
 * is not there at all. Returns the merged list and the notes that still need
 * writing properly.
 */
export function withUnsaved(loaded: Note[], stashed: Note[]): { notes: Note[]; pending: Note[] } {
  if (stashed.length === 0) return { notes: loaded, pending: [] };
  const byId = new Map(loaded.map((n) => [n.id, n]));
  const pending: Note[] = [];
  for (const note of stashed) {
    const held = byId.get(note.id);
    if (held && Date.parse(held.updated_at) >= Date.parse(note.updated_at)) continue;
    byId.set(note.id, note);
    pending.push(note);
  }
  if (pending.length === 0) return { notes: loaded, pending };
  return { notes: [...byId.values()], pending };
}
