import { useEffect, useState } from "react";

interface Inputs {
  /**
   * A whole sync tick came round without failing, with a session behind it —
   * App.tsx's `heardFromServer`. `idle` and nothing else: `error` and
   * `offline` are exactly the ticks that learned nothing.
   */
  heardFromServer: boolean;
  /** The user is working without an account, so there is nobody to ask. */
  deviceOnly: boolean;
  /** Whether this build can sync at all. */
  syncConfigured: boolean;
}

/**
 * Whether this device knows what the archive holds.
 *
 * An empty local store means two opposite things, and the app cannot tell them
 * apart by looking at it: an account with nothing in it, or a device that has
 * not been told yet. Saying the wrong one is not symmetrical. "Nothing written
 * yet" to somebody whose four hundred notes are still coming down the wire is
 * the scariest sentence this app can say; a spinner for one beat on a genuinely
 * new account costs nothing. So the empty board waits for an answer, and the
 * spinner covers the not-knowing.
 *
 * **The latch is the whole point.** App.tsx already has `firstSyncDone` for the
 * first-open question, which reads `syncState === "idle"` at the moment it is
 * asked — right for a question asked once, wrong for words drawn on every
 * render. Sync ticks, so on an account that really is empty the unlatched
 * version flips back to `false` on every poll, and the empty Inbox flickers
 * "Fetching your notes" at a user who has no notes to fetch, forever. Once a
 * tick has come round clean, this device has had its answer and the answer does
 * not expire.
 *
 * Device-only and an unconfigured build answer `true` from the start: there is
 * no server, so the store *is* the archive and there is nothing to wait for.
 * Signing in from device-only clears that flag (`useAccount.offerSignIn`) and
 * drops back to the latch, which is still `false` — correct, because a session
 * that has never synced knows no more about the server than it did a second
 * ago.
 */
export function useServerAnswered({
  heardFromServer,
  deviceOnly,
  syncConfigured,
}: Inputs): boolean {
  const [heardOnce, setHeardOnce] = useState(false);
  useEffect(() => {
    if (heardFromServer) setHeardOnce(true);
  }, [heardFromServer]);
  return deviceOnly || !syncConfigured || heardOnce;
}
