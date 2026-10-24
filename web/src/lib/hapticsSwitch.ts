import { HAPTICS_KEY } from "./haptics";
import { hasKeyboard } from "./hotkeys";

/** The About page's switch for `haptics.ts` — loads with that page, not the first paint. */

/**
 * A motor, not merely the function: desktop Chrome and Edge have
 * `navigator.vibrate` and nothing to shake, so the switch stood there doing
 * nothing (audit 2026-10-24, UX-009). A device with a keyboard and a fine
 * pointer is not one that buzzes — `hasKeyboard` is the app's one definition.
 */
export function canVibrate(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function" &&
    !hasKeyboard(false)
  );
}

/** On unless this device was told otherwise. Storage that throws reads as on. */
export function hapticsOn(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(HAPTICS_KEY);
    else localStorage.setItem(HAPTICS_KEY, "off");
  } catch {
    // A private window that refuses storage keeps the default; nothing to say.
  }
}
