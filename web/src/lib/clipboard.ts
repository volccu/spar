import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy, said once.
 *
 * Three places put text on the clipboard — a code block's own corner button,
 * the open note's meta row, and the selection panel — and the first of them
 * grew a private `copied` flag and a private 1200ms timer before the other
 * two existed. This is that flag and that timer, pulled out so a fourth place
 * cannot quietly pick a different length. The viewer's Copy picture grew its
 * own pair all the same; it goes through `useCopiedWith` now.
 */

/**
 * How long a copy button says "Copied" before it goes back to offering. A
 * threshold the user is given, not a movement — the same reason `UNDO_MS`
 * lives beside its hook rather than in `lib/motion.ts`.
 */
export const COPIED_MS = 1200;

/**
 * Puts `text` on the clipboard and says whether it got there.
 *
 * `navigator.clipboard` is absent on plain-http origins and in some embedded
 * browsers, and the write can be refused when the page is not focused. Either
 * way the answer is `false`, never a throw — a copy that did not happen is a
 * fact for the button to show, not an error for the app to crash on.
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Several notes as one piece of text: each body as it is, a blank line between
 * them, and nothing for a note that has no words at all — a picture-only note
 * contributes no paragraph rather than an empty one. No headings, no bullets,
 * no separators drawn in dashes: what you paste is what the notes hold.
 */
export function joinNotes(bodies: string[]): string {
  return bodies
    .map((b) => b.trim())
    .filter((b) => b !== "")
    .join("\n\n");
}

/** Whether this browser can put a picture on the clipboard at all. */
export function canCopyPicture(): boolean {
  return (
    typeof ClipboardItem === "function" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.clipboard?.write)
  );
}

/**
 * Puts a PNG on the clipboard and says whether it got there.
 *
 * The picture is handed over as a promise, which is what lets Safari keep the
 * tap's permission while it is drawn — so the write starts before anything
 * here waits, and the caller passes the drawing still in progress. A drawing
 * that comes back empty is `false`, never a throw, as it is for `copyText`.
 */
export async function copyPicture(png: Promise<Blob | null>): Promise<boolean> {
  if (!canCopyPicture()) return false;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": png.then((b) => {
          if (!b) throw new Error("nothing drawn");
          return b;
        }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** `useCopiedWith(copyText)`: the copy button for words, which is most of them. */
export function useCopied(): [boolean, (text: string) => Promise<boolean>] {
  return useCopiedWith(copyText);
}

/**
 * The state of a copy button: whether it just worked, and how to make it try.
 *
 * `copied` flips on for `COPIED_MS` after a successful write and then off
 * again; a second copy inside that window restarts the clock rather than
 * stacking a second timeout. Unmounting clears the timer, so a note closed
 * mid-flash never sets state on a button that is gone. `write` is what is
 * copied and how — `copyText` for words, `copyPicture` for the viewer's
 * picture — and must be a stable function (a module's own, not an arrow).
 */
export function useCopiedWith<T>(
  write: (what: T) => Promise<boolean>,
): [boolean, (what: T) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (what: T) => {
      const ok = await write(what);
      if (!ok) return false;
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setCopied(false);
      }, COPIED_MS);
      return true;
    },
    [write],
  );

  return [copied, copy];
}
