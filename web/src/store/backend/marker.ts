/**
 * The spår server's stored-session marker: who this browser last signed in as.
 *
 * The server's session is an httpOnly cookie, which script cannot read — so
 * without something of the client's own, a signed-in device could not tell,
 * synchronously and before any backend has loaded, that it is signed in.
 * `hasStoredSession` (`store/session.ts`) needs exactly that answer to paint
 * the archive at once instead of waiting on Loading (web/CLAUDE.md, "what the
 * claim gates is sync, never paint"). supabase-js leaves its own key behind for
 * the same question; this is the spår server's.
 *
 * It holds the user's id and nothing else: no token, no email. It says "who is
 * this likely to be", never "is the session valid" — `SparServerBackend`
 * confirms it with the server behind the grid, and clears it on sign-out, on
 * account deletion and on any `401`.
 *
 * Kept in a module of its own, with no imports, so the paint path can read the
 * key without pulling the backend in, and so the backend runs anywhere.
 */

export const SERVER_SESSION_KEY = "spar.server-session";

/** The one piece of `Storage` the marker needs, so a test can hand in a map. */
export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's storage, or null where there is none or it is blocked. */
export function browserStorage(): MarkerStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Private mode at its strictest throws on the property itself.
    return null;
  }
}

/** The id the marker names, or null. Anything unreadable is no marker. */
export function parseMarker(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const id = (value as { id?: unknown } | null)?.id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

export function readMarker(storage: MarkerStorage | null): string | null {
  try {
    return parseMarker(storage?.getItem(SERVER_SESSION_KEY) ?? null);
  } catch {
    return null;
  }
}

export function writeMarker(storage: MarkerStorage | null, id: string): void {
  try {
    storage?.setItem(SERVER_SESSION_KEY, JSON.stringify({ id }));
  } catch {
    // Without it the next open waits on the server before painting; nothing
    // is lost but that moment.
  }
}

export function clearMarker(storage: MarkerStorage | null): void {
  try {
    storage?.removeItem(SERVER_SESSION_KEY);
  } catch {
    // Nothing to clear where nothing could be written.
  }
}
