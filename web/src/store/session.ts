import { RUNTIME_CONFIG } from "./backend/config";
import { SERVER_SESSION_KEY } from "./backend/marker";

/**
 * Does this browser hold a persisted sign-in, answered synchronously.
 *
 * The boot gate has to tell a returning sign-in from a first visit *before*
 * the auth client has resolved a session — that resolution can involve a
 * network round-trip (a token inside its expiry margin is refreshed before
 * `getSession()` returns), and the archive it would hold up is already on
 * the device. supabase-js persists its session in localStorage under
 * `sb-<project-ref>-auth-token`, so the key's presence is the local answer.
 *
 * The token may be stale or revoked; that is fine. This answers "who is this
 * likely to be", never "is the session valid" — the real check still runs
 * behind the grid, and an owner change still purges and reloads exactly as
 * it always has (see `useAccount`).
 *
 * A spår server's session is an httpOnly cookie script cannot see, so its
 * backend leaves a marker of its own (`backend/marker.ts`), read here first.
 * Only a build that reads `/config.json` can be pointed at a spår server, and
 * `RUNTIME_CONFIG` is a literal, so in every other build that line is dropped.
 */
export function hasStoredSession(): boolean {
  try {
    // Its own block, so the bundler drops the read whole where the flag is false.
    if (RUNTIME_CONFIG) {
      if (localStorage.getItem(SERVER_SESSION_KEY) !== null) return true;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && /^sb-.+-auth-token$/.test(key)) return true;
    }
  } catch {
    // Storage blocked (private mode at its strictest): treat as no session,
    // which lands on the sign-in screen — the same place a browser that
    // cannot persist a session always ends up.
  }
  return false;
}
