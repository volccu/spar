/* --- asking the browser to keep the notes ----------------------------------------
   IndexedDB is this app's source of truth (SPEC §3), and by default a browser
   treats it as a cache: under storage pressure, or after Safari's seven days
   without a visit to a site that is not installed, it may clear the whole
   origin. For most sites that loses a cache. Here it loses every edit still in
   the outbox and every file whose bytes have not reached the server yet
   (`att.path === null`) — the only copies in existence.

   `navigator.storage.persist()` asks for the origin to be kept until the
   person clears it themselves. Chromium answers silently (an installed app,
   or one used often, is granted); Firefox asks the person once. So it is asked
   the way a reminder's permission is asked — at the moment it matters, which
   is the first time this session something is written to the device, never
   on first open (`askToKeep`, called from `useNotes`'s persist paths). The
   answer is shown on the About page (`storageKept`).

   Nothing here may block or fail a write: every call is fire-and-forget and
   every error is an "unknown".
   -------------------------------------------------------------------------- */

/** `true` kept, `false` the browser may clear it, `null` this browser cannot say. */
export type Kept = boolean | null;

let asked: Promise<Kept> | null = null;

function storage(): StorageManager | null {
  try {
    const s = typeof navigator !== "undefined" ? navigator.storage : undefined;
    return s && typeof s.persisted === "function" ? s : null;
  } catch {
    return null;
  }
}

/** Whether the browser has already agreed to keep this origin's storage. */
export async function storageKept(): Promise<Kept> {
  const s = storage();
  if (!s) return null;
  try {
    return await s.persisted();
  } catch {
    return null;
  }
}

/**
 * Asks once per session, and only if the answer is not already yes. Every
 * caller after the first gets the same promise, so a burst of writes asks one
 * question.
 */
export function askToKeep(): Promise<Kept> {
  if (asked) return asked;
  asked = (async () => {
    const s = storage();
    if (!s || typeof s.persist !== "function") return null;
    try {
      if (await s.persisted()) return true;
      return await s.persist();
    } catch {
      return null;
    }
  })();
  return asked;
}

/** Tests only: forget that this session has asked. */
export function resetAskedForTests(): void {
  asked = null;
}
