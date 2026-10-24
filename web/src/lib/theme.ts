import { onSettingsChange, readSetting } from "./settings";

/**
 * Puts the chosen theme and motion on the document (2026-10-11, owner
 * approved: a light theme as a choice, dark the default — DESIGN.md §2).
 *
 * The stylesheet keys on the *resolved* answer only: `data-theme` on <html>
 * is always "light" or "dark", never "system", so the light ramp is one block
 * and not a second copy inside a media query. "System" is resolved here
 * against `prefers-color-scheme: light` — a device that states no preference
 * gets dark, the app's own ground. `public/theme-boot.js` does the same sum
 * before the stylesheet paints (the CSP allows no inline script), and this
 * takes over once the app runs; the two must agree.
 *
 * `data-motion="reduced"` is set only when this device asked for less motion
 * than its system does; `lib/motion.ts` and the stylesheet read it beside
 * `prefers-reduced-motion`.
 */

export const LIGHT_QUERY = "(prefers-color-scheme: light)";

export function resolvedTheme(): "light" | "dark" {
  const choice = readSetting("theme");
  if (choice !== "system") return choice;
  return typeof window.matchMedia === "function" && window.matchMedia(LIGHT_QUERY).matches
    ? "light"
    : "dark";
}

export function applyTheme(): void {
  const root = document.documentElement;
  const theme = resolvedTheme();
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  if (readSetting("motion") === "reduced") root.dataset.motion = "reduced";
  else delete root.dataset.motion;
}

let tracking = false;

/** Once, before the first render: apply, then follow the system and the switch. */
export function trackTheme(): void {
  applyTheme();
  if (tracking) return;
  tracking = true;
  onSettingsChange(applyTheme);
  if (typeof window.matchMedia !== "function") return;
  const mq = window.matchMedia(LIGHT_QUERY);
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", applyTheme);
  else if (typeof mq.addListener === "function") mq.addListener(applyTheme);
}
