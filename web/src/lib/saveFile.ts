/**
 * Save, said once.
 *
 * Five places hand the browser a file to save — a note's file row, its
 * Save all, the viewer's Save, the export in Settings and the copy the
 * sign-in screen offers of unsent work — and each had grown its own anchor and
 * its own guess at how long the address behind it should live: 8 s in three of
 * them, 60 s in the other two. A save on a slow phone can still be reading the
 * address after 8 s, so the long one is the one kept, here, for all of them.
 *
 * Share is `lib/share.ts`; copy is `lib/clipboard.ts`.
 */

/**
 * How long an address made for a save stays valid. Generous on purpose: the
 * browser reads it after the click, on its own schedule, and an address taken
 * back too early is a save that silently never happens. The bytes it holds go
 * with it, so it is not forever either.
 */
export const OBJECT_URL_TTL_MS = 60_000;

/** An address of this page's own for `blob`, given back after `OBJECT_URL_TTL_MS`. */
export function passingUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_TTL_MS);
  return url;
}

/**
 * The browser's own save dialogue for whatever `href` points at. An anchor is
 * the only thing that opens it without a plugin, so one is made, put in the
 * page for the click (an anchor outside the document is not clicked by every
 * browser), and taken out again.
 */
export function saveHref(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Hands the browser `blob` to save as `name`; the address outlives the click by a while. */
export function saveBlob(blob: Blob, name: string): void {
  saveHref(passingUrl(blob), name);
}
