import { useEffect, useLayoutEffect, useRef } from "react";
import { recallReadingPosition, rememberReadingPosition } from "./readingPosition";

/**
 * Where the open note was being read, put back before the first paint and
 * written down once as it closes — the rules are in `lib/readingPosition.ts`.
 *
 * Hands back the ref the scroller copies its offset into (`readAt`): the note
 * writes it on every scroll event, and reads it again when the editor opens so
 * the page stays where it was.
 */
export function useReadingPosition(
  noteId: string,
  /** The body's length as the note opens, which a remembered place is checked against. */
  bodyLength: number,
  /** The scroller the position belongs to — the sheet's body. */
  bodyRef: { readonly current: HTMLElement | null },
  /** The text as it stands, read once on the way out — the note's `draft`. */
  textRef: { readonly current: string },
) {
  /**
   * Reopening a long note puts you back where you were reading it.
   *
   * **Before the first paint, which is what makes it not a move.**
   * `DESIGN.md` §10 says every animation comes from `lib/motion.ts` and this
   * is not in it — deliberately, because the right answer here is not a
   * gentler scroll but no scroll at all. A note that opens at the top and then
   * travels is a target you have to wait for, and at the speed a jump would
   * have to happen it reads as a glitch rather than as a movement. Spent in a
   * `useLayoutEffect`, the position is set in the same commit the sheet is
   * laid out in, so the first frame anyone sees is already the right one and
   * there is nothing to animate. It is the same reason the capture bar sizes
   * its field before paint rather than growing it afterwards.
   *
   * The answer is a plain number and `0` means the top (`lib/readingPosition.ts`
   * holds the rules: device-local, never synced, dropped when the text has
   * changed length under it, and never set at all for somewhere inside the
   * first screenful).
   */
  useLayoutEffect(() => {
    const at = recallReadingPosition(noteId, bodyLength);
    if (at > 0 && bodyRef.current) bodyRef.current.scrollTop = at;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only.
  }, []);

  /**
   * ...and it is written down once, when the note closes.
   *
   * Not on every scroll event, which would be synchronous disk I/O in the
   * middle of a gesture, and not on a timer either. **The asymmetry with the
   * editor's is on purpose and is the whole rule: words are
   * irreplaceable and a scroll offset is not.** An edit pays a write per
   * keystroke because losing a sentence to a killed tab is real damage; a
   * reading position pays one write on the way out, and a tab Android kills
   * mid-note simply reopens at the top, which is exactly what it did before
   * this existed.
   *
   * The offset is kept in a ref as it changes so that this cleanup never has
   * to read the DOM — by the time it runs the element may already be detached,
   * and a number that was copied out while it was still on screen cannot be.
   *
   * It measures `draft` and not `note.body`, which matters in exactly one
   * case and gets it right: `commit` renumbers a list on the way out, so the
   * text this note will *next* be opened with is the draft, and stamping the
   * length of the older body would throw the position away on the very next
   * open for a change the user did not make.
   */
  const readAt = useRef(0);
  useEffect(() => {
    const id = noteId;
    return () => {
      // The offset and the text as they stand at close are exactly what is
      // wanted here, which is what this rule warns about.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      rememberReadingPosition(id, readAt.current, textRef.current.length);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on close only.
  }, []);
  return readAt;
}
