import { useCallback, useEffect, useState } from "react";
import { claimForOwner, purgeEverything, UnsentWork } from "./db";

/**
 * useAccount — who this browser's notes belong to, and whether sync may start.
 *
 * Second of the five groups pulled out of `App.tsx`. It answers three related
 * questions that were tangled together in the middle of the screen component:
 * has the user chosen to work without an account, is this device being handed
 * to somebody else, and has the local store been confirmed as belonging to
 * whoever is signed in.
 *
 * The last one is the reason this is not merely tidiness. The UI reads
 * IndexedDB, which outlives a session and answers to no server policy — so
 * until the check has run, this browser may be holding somebody else's notes,
 * and every one of them still sitting in the outbox would upload under the
 * account that just signed in. That is a display leak becoming a permanent
 * copy in someone else's archive. Sync therefore stays off until `ownerReady`.
 */

/** Set when the user has chosen to work without an account. Persisted, because
 *  the choice has to survive a reload or the sign-in screen returns forever. */
const SKIP_KEY = "spar.deviceOnly";

/**
 * Storage at its strictest (private mode) throws on the read as well as the
 * write, and this read runs in a state initializer on first paint — the one
 * place in the app that guarded every other `localStorage` touch and not
 * this one. Blocked storage reads as "never chose", which lands on sign-in,
 * the same place `hasStoredSession` sends a browser that cannot persist.
 */
function readSkip(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSkip(on: boolean): void {
  try {
    if (on) localStorage.setItem(SKIP_KEY, "1");
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    // The choice holds for this session and is asked again on the next.
  }
}

export function useAccount(userId: string | null) {
  const [deviceOnly, setDeviceOnly] = useState(readSkip);
  const [handoffRequired, setHandoffRequired] = useState(false);
  const [ownerReady, setOwnerReady] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  /**
   * A different account signed in while this device still holds the previous
   * one's unsent work — how many things, or null. Sync stays off while it is
   * set; `clearAnyway` is the only way past it that loses anything.
   */
  const [held, setHeld] = useState<number | null>(null);

  /**
   * The local store belongs to whoever last signed in here, and sync waits for
   * that to be settled.
   *
   * When the answer is that the account has changed, the page is reloaded
   * rather than patched up: a purged store leaves stale notes in half a dozen
   * pieces of React state, and a reload is the only way to be sure none of them
   * survive. An *unclaimed* store is adopted rather than emptied — that is the
   * ordinary first sign-in, and from device-only mode those notes are the only
   * copy in existence.
   */
  useEffect(() => {
    if (!userId) {
      setOwnerReady(false);
      setOwnerError(null);
      setHeld(null);
      return;
    }
    let cancelled = false;
    setOwnerError(null);
    setHeld(null);
    void claimForOwner(userId)
      .then((switched) => {
        if (cancelled) return;
        if (switched) window.location.reload();
        else setOwnerReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof UnsentWork) {
          setHeld(err.count);
          return;
        }
        setOwnerError("This device could not check whose notes it holds, so nothing is syncing yet. Reload to check again.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * "Skip sign-in", and the "this device only" mark that says the same thing.
   *
   * Purges first when the device is being handed over, because that is the one
   * case where the notes on it are not the person's own who is about to use it.
   * Ordinary skipping keeps everything — from device-only mode those notes are
   * the only copy there is.
   */
  const stayOnThisDevice = useCallback(() => {
    if (handoffRequired) {
      purgeEverything().then(
        () => {
          writeSkip(true);
          // A reload, not three setters. The purge emptied IndexedDB and left
          // everything read out of it standing in memory — the notes, the
          // previous owner's folders in `useBoards`, the recent-search chips —
          // so flipping to device-only drew the old owner's shelf over an empty
          // store, or sat on Loading. It is the same call `claimForOwner`'s
          // switch makes and for the same reason (web/CLAUDE.md, the account
          // rule): only a reload is sure of all of it. The skip is written
          // first, so the page comes back to the board and not to sign-in.
          window.location.reload();
        },
        // The handoff screen stays up, and the button can be pressed again;
        // what must never happen is the old notes staying with the skip set.
        (error: unknown) => console.error("purge before handoff failed", error),
      );
      return;
    }
    writeSkip(true);
    setDeviceOnly(true);
  }, [handoffRequired]);

  /**
   * The answer to `held` that gives the unsent work up: the device is emptied
   * for the account now signed in, and the page reloads as any switch does.
   */
  const clearAnyway = useCallback(() => {
    if (!userId) return;
    claimForOwner(userId, { evenIfUnsent: true }).then(
      () => window.location.reload(),
      () =>
        setOwnerError(
          "This device could not be cleared, so nothing is syncing yet. Reload to try again.",
        ),
    );
  }, [userId]);

  /** Bring the sign-in screen back for someone who chose to do without it. */
  const offerSignIn = useCallback(() => {
    writeSkip(false);
    setDeviceOnly(false);
  }, []);

  /**
   * Marks the *next* skip as a handover, so the notes go before the browser is
   * passed on. The caller still ends the session itself — this hook knows
   * about the store, not about auth. The menu's Sign out no longer calls it:
   * it asks outright whether to remove the notes (audit 2026-10-10, SEC-2).
   */
  const beginHandoff = useCallback(() => setHandoffRequired(true), []);

  return {
    deviceOnly,
    handoffRequired,
    ownerReady,
    ownerError,
    held,
    clearAnyway,
    stayOnThisDevice,
    offerSignIn,
    beginHandoff,
  };
}
