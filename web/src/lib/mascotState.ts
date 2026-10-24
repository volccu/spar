import { useEffect, useRef, useState } from "react";
import type { MascotState } from "../components/mascot-element";

/**
 * What the mascot is doing, decided in one place for both of them.
 *
 * The header mascot is the app's sync state made into a creature, and a
 * creature that flicks between two poses inside one animation cycle is not a
 * creature, it is a broken spinner. Two thresholds are what separate the one
 * from the other, and both are here rather than in `lib/motion.ts` on purpose:
 * neither is a *move*. They are how long something has to be true before it is
 * worth drawing, and how long it stays drawn once it is — the same kind of
 * number as `PEEK_WAIT_MS`, which sits beside the long press for the same
 * reason. The motion itself is entirely inside the element.
 *
 * The precedence is fixed and offline is at the top of it: a sync cannot be in
 * flight without a connection, so a header showing `working` while the device
 * is disconnected is the interface lying about the one thing this mark exists
 * to report.
 */

/**
 * How long a sync has to still be running before the mascot sets off walking.
 *
 * Without it the header strobed on every keystroke-triggered push, which is a
 * worse report of "everything is fine" than showing nothing at all. The number
 * started at 250ms on the assumption that most syncs finish well inside it;
 * on a real connection most syncs do not, so the creature walked on nearly
 * every tick and the walk stopped meaning anything. A mark that is always up
 * reports the same amount as a mark that is never up. This is set instead to
 * roughly the point where a person starts to wonder whether the app heard
 * them: below it a sync is simply the app working, and only above it is there
 * a wait worth drawing a creature for.
 */
export const WORKING_ENTER_MS = 600;

/**
 * And how long it keeps walking once it has started, however quickly the sync
 * that started it finished. A state that appears and vanishes inside one turn
 * of the walk cycle reads as a glitch rather than as an event.
 */
export const WORKING_DWELL_MS = 800;

export interface MascotInputs {
  /** A sync, upload or push actually in flight right now — not the held mark. */
  busy: boolean;
  online: boolean;
  /** Only the board's own mascot may ever be `empty`; the header's never is. */
  empty?: boolean;
}

/**
 * Holds `working` open across the two thresholds above, then resolves the
 * whole precedence. `busy` is deliberately the raw in-flight flag rather than
 * `useSync`'s reported state: that one is already held open for a full turn of
 * the sync *mark*, so a debounce measured against it could never suppress
 * anything.
 */
export function useMascotState({ busy, online, empty = false }: MascotInputs): MascotState {
  const [working, setWorking] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (busy) {
      // Already walking, and something else has started: nothing to schedule.
      // This is also what makes three overlapping saves one visible state and
      // not three — the flag is only ever false once they have all finished.
      if (working) return;
      const enter = window.setTimeout(() => {
        shownAt.current = Date.now();
        setWorking(true);
      }, WORKING_ENTER_MS);
      return () => window.clearTimeout(enter);
    }
    if (!working) return;
    const left = Math.max(0, WORKING_DWELL_MS - (Date.now() - shownAt.current));
    const leave = window.setTimeout(() => setWorking(false), left);
    return () => window.clearTimeout(leave);
  }, [busy, working]);

  if (!online) return "offline";
  if (working) return "working";
  return empty ? "empty" : "idle";
}

/** What the live region says, for the states that are worth saying. */
const ANNOUNCEMENT: Record<MascotState, string> = {
  idle: "Synced",
  working: "Syncing",
  offline: "Offline",
  empty: "",
};

/**
 * The words behind the header mascot.
 *
 * The element sets `role="img"` and a matching `aria-label`, which makes it
 * perceivable and reachable — it can be poked, so it has to be — and is still
 * not enough to make it a *status*: a screen reader will not reliably
 * re-announce a label that changed on an element that is not live. So the
 * label answers "what am I looking at" for whoever lands on the drawing, and
 * this drives a live region beside it for the announcing, which is the half
 * that actually gets spoken.
 *
 * It says nothing about the state the app opened in. An announcement is for a
 * change, and "Synced" read out on every launch is the kind of noise that gets
 * a live region switched off.
 */
export function useSyncAnnouncement(state: MascotState, failed: boolean, synced = true): string {
  const [said, setSaid] = useState("");
  const last = useRef<string | null>(null);
  // With nothing to sync to, "Synced" promises a server that is not there
  // (review CD-03): coming back from offline is said as what it is.
  const message = failed ? "Sync failed" : state === "idle" && !synced ? "Online" : ANNOUNCEMENT[state];

  useEffect(() => {
    if (last.current === null) {
      last.current = message;
      return;
    }
    if (last.current === message) return;
    last.current = message;
    setSaid(message);
  }, [message]);

  return said;
}
