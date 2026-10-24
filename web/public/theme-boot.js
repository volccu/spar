/*
 * The theme, on <html>, before the stylesheet paints (2026-10-11, owner
 * approved: a light ramp as this device's choice, dark the default; a new
 * device opens dark whatever its own setting, review LEAD-01 2026-10-13).
 *
 * A plain synchronous script in index.html's head, loaded from the app's own
 * origin because the CSP allows no inline script. It writes exactly what
 * applyTheme() in src/lib/theme.ts writes, from the same two keys
 * (src/lib/settings.ts), so a light device opens on paper instead of a flash
 * of black; theme.ts takes over once the app runs. themeBoot.test.ts runs this
 * file against resolvedTheme() for every case — change one, change both.
 *
 *   spar.theme   "light" | "system", or absent/anything else = dark. System is
 *                light only when the device says (prefers-color-scheme: light)
 *   spar.motion  "reduced" sets data-motion; anything else leaves it off
 *
 * Storage that throws (a private window) reads as no choice. Nothing here may
 * stop the page from loading, so every step is inside the try.
 */
(function () {
  var root = document.documentElement;
  var theme = "dark";
  var motion = null;
  try {
    var stored = localStorage.getItem("spar.theme");
    if (stored === "light") theme = "light";
    else if (
      stored === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      theme = "light";
    }
    if (localStorage.getItem("spar.motion") === "reduced") motion = "reduced";
  } catch {
    // No storage: no choice made, so the app's own ground.
  }
  root.setAttribute("data-theme", theme);
  if (motion) root.setAttribute("data-motion", motion);
  else root.removeAttribute("data-motion");
  // The bars round an installed app, for the first paint only: the light
  // ramp's --paper. themeColor.ts rewrites this from the stylesheet as soon
  // as the app runs, so the stylesheet stays the one definition.
  if (theme === "light") {
    var bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.setAttribute("content", "#f3efe7");
  }
})();
