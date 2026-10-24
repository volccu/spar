import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { lightUp } from "./lib/coldLight";
import { trackTheme } from "./lib/theme";
import { trackThemeColor } from "./themeColor";
import "./styles.css";

// Before render: the theme first, so the system bars read the right ground on the first frame.
trackTheme();
trackThemeColor();

/**
 * A deploy replaces every hashed chunk at once, and a tab opened before it
 * holds a shell that still asks for the old names. The first lazy import
 * after that — the canvas, the PDF viewer, the icon set, the sync client —
 * is a 404, which Vite raises as this event; unhandled, it threw into the
 * error boundary, and the sync client simply never arrived. One reload gets
 * the new shell. The stamp keeps a chunk that is genuinely gone from
 * reloading forever: a second failure within the minute is left to throw.
 */
window.addEventListener("vite:preloadError", (event) => {
  const key = "spar:chunk-reload";
  const RECENT_MS = 60_000;
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < RECENT_MS) return;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // No session storage means no way to tell a second failure from the
    // first, and a tab that reloads forever is worse than one that errors.
    return;
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// The lit board comes up from dark, once, on a cold open (lib/coldLight.ts).
lightUp();

// Every `title` is shown in the app's own hint, not the browser's (lib/hoverTips.ts).
// Fetched after the first paint: nothing hovers before there is something to
// hover, and the first paint has a size ceiling (buildInvariants.test.ts).
void import("./lib/hoverTips").then(({ startHoverTips }) => startHoverTips());
