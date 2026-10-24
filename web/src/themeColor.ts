/**
 * Keeps the phone's status bar and gesture bar the same colour as the app.
 *
 * An installed PWA takes its system-bar colour from the manifest, and a
 * manifest holds exactly one `theme_color` — it cannot answer to
 * prefers-color-scheme. So a dark-mode phone got a light grey status bar with
 * black icons sitting above a black app: two white bands, top and bottom.
 *
 * The static <meta name="theme-color"> tag in index.html handles the first
 * paint (public/theme-boot.js sets it to the light paper on a light device).
 * This keeps it true afterwards by reading the ground colour the stylesheet
 * actually resolved rather than repeating it here — there is one definition
 * of the background, and it lives in styles.css.
 *
 * Dark is the ground and light is this device's choice (2026-10-11, owner
 * approved), put on <html> as `data-theme` by lib/theme.ts. So this re-reads
 * whenever that attribute changes — the Settings switch, or System following
 * the device — and on the media change too, which reaches the same place. The
 * manifest still holds one `theme_color`, the dark one: an installed app's
 * splash before the page runs stays dark whichever theme is chosen.
 */

const DARK = "(prefers-color-scheme: dark)";

function paperColour(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--paper")
    .trim();
  // The ground. Only ever reached if the stylesheet has not resolved.
  return value || "#0c0a08";
}

function apply() {
  const colour = paperColour();
  // Drop the media-scoped pair from index.html: one unconditional tag beats
  // two conditional ones, and leaving them would let the browser pick again.
  for (const tag of document.querySelectorAll('meta[name="theme-color"][media]')) {
    tag.remove();
  }
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  if (meta.content !== colour) meta.content = colour;
}

export function trackThemeColor(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  apply();
  const mq = window.matchMedia(DARK);
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", apply);
  else if (typeof mq.addListener === "function") mq.addListener(apply);
  if (typeof MutationObserver === "function") {
    new MutationObserver(apply).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
}
