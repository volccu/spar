/**
 * The Inbox's count on the app's icon (review PL-12): the one reminder,
 * outside the app, that the pile is growing — the way a mail app shows unread
 * mail. Nothing is added to the screen.
 *
 * The Badging API (`navigator.setAppBadge`) draws it where the platform does:
 * an installed app in Chrome or Edge on Windows and macOS. Android does not
 * show it, Safari has its own rules, and a browser tab has no icon of its own
 * to badge. So it is feature-detected, and **it never throws**: a refusal (a
 * rejected promise, or a browser that throws outright) is the badge not
 * appearing, which is what that platform was going to show anyway.
 *
 * The number is the Inbox tab's own (`counts[0]` in App.tsx), so the icon and
 * the strip cannot disagree. Zero clears it rather than drawing a 0.
 *
 * It is on unless this device was told otherwise: one switch on the About page
 * (`setAppBadgeOn`), kept in this device's storage beside the pulse's.
 */

export const APP_BADGE_KEY = "spar.appBadge";

interface Badging {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

function badging(): Badging | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & Badging;
  return typeof nav.setAppBadge === "function" ? nav : null;
}

/** Whether this browser can put a number on the app's icon at all. */
export function canBadge(): boolean {
  return badging() !== null;
}

/**
 * Whether the app is running installed, in a window of its own — the only
 * place there is an icon of its own to badge. The switch is offered only
 * there; a tab would be offering a number nobody can see.
 */
export function installed(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      (window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: window-controls-overlay)").matches)
    );
  } catch {
    return false;
  }
}

/** On unless this device was told otherwise. Storage that throws reads as on. */
export function appBadgeOn(): boolean {
  try {
    return localStorage.getItem(APP_BADGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The last count asked for, so turning the switch back on can draw it at once. */
let lastCount = 0;

/** Puts `count` on the icon, or clears it at zero or while switched off. */
export function showInboxBadge(count: number): void {
  lastCount = count;
  const api = badging();
  if (!api) return;
  try {
    const shown = appBadgeOn() && count > 0;
    const done = shown
      ? api.setAppBadge!(count)
      : api.clearAppBadge
        ? api.clearAppBadge()
        : api.setAppBadge!(0);
    // A refusal (no permission, not installed) is the badge not appearing.
    void Promise.resolve(done).catch(() => {});
  } catch {
    // Some engines throw rather than reject; the answer is the same.
  }
}

export function setAppBadgeOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(APP_BADGE_KEY);
    else localStorage.setItem(APP_BADGE_KEY, "off");
  } catch {
    // A private window that refuses storage keeps the default; nothing to say.
  }
  showInboxBadge(lastCount);
}
