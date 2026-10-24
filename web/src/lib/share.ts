/**
 * Share, said once.
 *
 * The browser's own share sheet: Android's on a phone, the Windows share
 * panel in Chrome and Edge on a PC. It is the one way *out* of the app that
 * reaches other apps — Copy reaches the clipboard, this reaches WhatsApp.
 * Sharing *into* the app is the manifest's `share_target` — a different door,
 * answered by `public/share-sw.js` and collected by `lib/shareTarget.ts`.
 */

/** Whether this browser has a share sheet at all. Desktop Firefox does not. */
export function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export type ShareOutcome = "shared" | "dismissed" | "failed";

/**
 * Hands a note to the share sheet: its words, and its files where the browser
 * will take them. A note that is only a photograph had no way out of the app
 * at all — the strip was drawn only for a note with words, and the words were
 * all it ever sent.
 *
 * Files go only where `navigator.canShare({ files })` says yes: Android
 * Chrome and the Windows panel take them, and a browser that shares text
 * alone still gets the words rather than nothing. A note with neither words
 * nor shareable files is `failed`, which the strip says out loud. Closing the sheet
 * without choosing anywhere is `dismissed` (an `AbortError`: the user changing
 * their mind, not something to show); anything else is `failed`. Never a
 * throw, for the same reason `copyText` never throws.
 */
export async function shareNote(text: string, files: File[]): Promise<ShareOutcome> {
  if (!canShare()) return "failed";
  const data: ShareData = {};
  if (text.trim() !== "") data.text = text;
  if (
    files.length > 0 &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files })
  ) {
    data.files = files;
  }
  if (!data.text && !data.files) return "failed";
  return send(data);
}

/**
 * Hands one file to the share sheet, its name as the title — the viewer's
 * Share, for the file or the picture on screen. Where the browser says it
 * cannot take the file the sheet is not opened at all, and that is `failed`.
 */
export async function shareFile(file: File, title: string): Promise<ShareOutcome> {
  if (!canShare()) return "failed";
  const data: ShareData = { files: [file], title };
  if (typeof navigator.canShare === "function" && !navigator.canShare(data)) return "failed";
  return send(data);
}

/** The sheet itself, its three answers told apart (see `shareNote`). */
async function send(data: ShareData): Promise<ShareOutcome> {
  try {
    await navigator.share(data);
    return "shared";
  } catch (e) {
    // By name, not by class: a DOMException is not an Error everywhere.
    const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : null;
    return name === "AbortError" ? "dismissed" : "failed";
  }
}
