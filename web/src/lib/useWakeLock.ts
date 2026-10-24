import { useEffect } from "react";

/**
 * Keeps the screen on for as long as `active` is true — the Ticker's, because
 * a list is ticked with the phone in one hand and a basket in the other, and a
 * screen that goes dark between the milk and the bread is a screen that has to
 * be woken and unlocked for every aisle.
 *
 * The Screen Wake Lock API, and only where it exists. Everything about it is a
 * request the browser may refuse — no support, a battery saver, a page that is
 * not the one in front — and a refusal costs nothing but the screen dimming
 * the way it always did. So there is no answer to wait on, nothing to show and
 * no error to report: this hook fails silently by design, the same way a
 * device with no voices simply has no Read aloud.
 *
 * **The browser drops the lock whenever the page is hidden** — switching apps,
 * turning the screen off by hand — and does not give it back. So it is asked
 * for again each time the page comes back to the front while the mode is still
 * up, and released the moment the mode closes, which is the only release that
 * is ours to make.
 *
 * It holds no state and returns nothing: whether the screen is being kept on
 * is not something the app ever draws.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    const lock = navigator.wakeLock;
    if (!lock || typeof lock.request !== "function") return;

    let held: WakeLockSentinel | null = null;
    // One request in flight at a time: opening the mode and the page coming
    // back to the front can land in the same moment, and two sentinels would
    // leave one that nothing ever releases.
    let asking = false;
    let live = true;

    const acquire = () => {
      if (!live || asking) return;
      if (held && !held.released) return;
      if (document.visibilityState !== "visible") return;
      asking = true;
      let request: Promise<WakeLockSentinel>;
      try {
        request = lock.request("screen");
      } catch {
        asking = false;
        return;
      }
      request.then(
        (sentinel) => {
          asking = false;
          // The mode closed while the browser was answering: the lock is let
          // go at once rather than kept by a screen that is no longer here.
          if (!live) {
            sentinel.release().catch(() => {});
            return;
          }
          held = sentinel;
        },
        () => {
          asking = false;
        },
      );
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (held && !held.released) held.release().catch(() => {});
      held = null;
    };
  }, [active]);
}
