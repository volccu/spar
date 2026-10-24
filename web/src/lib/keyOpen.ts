import { useLayoutEffect, type RefObject } from "react";
import { fieldOffset } from "./editText";

/**
 * A note opened by a key (Enter on its card) opens ready to type (review
 * UX-06). The card says so here and the note asks once as it opens: a flag
 * handed from one to the other rather than a prop through the board, and only
 * for the note it was set for. Every click on a card sets it, a tap to
 * nothing, so it does not outlive the open it was set for.
 */
let pending: string | null = null;

export function markKeyOpen(id: string | null): void {
  pending = id;
}

/** Whether a key opened this note. Asking clears the flag. */
export function takeKeyOpen(id: string): boolean {
  const was = pending === id;
  pending = null;
  return was;
}

/**
 * Where the caret goes in a note a key opened from a search: just after the
 * hit it opened on, the one it is scrolled to (`data-best`, else the first
 * `data-hit`); null, which is the end, with no hit. Counted in the rendered
 * note, which is the stored note character for character, then turned into
 * the field's count.
 */
export function caretAtHit(body: HTMLElement | null, text: string): number | null {
  const reader = body?.querySelector(".reader");
  const hit =
    reader?.querySelector('[data-best="true"]') ?? reader?.querySelector('[data-hit="true"]');
  if (!reader || !hit) return null;
  const upTo = document.createRange();
  upTo.setStart(reader, 0);
  upTo.setEndAfter(hit);
  return fieldOffset(text, upTo.toString().length);
}

/**
 * The open note's side: opened by a key, a note with words opens ready to
 * type, the caret at the end or after the search hit it opened in view of.
 * Runs once per note, before paint, after the reading position is set.
 */
export function useKeyOpen(
  noteId: string,
  draftRef: RefObject<string>,
  bodyRef: RefObject<HTMLElement | null>,
  caretRef: RefObject<number | null>,
  startEditing: () => void,
): void {
  useLayoutEffect(() => {
    if (!takeKeyOpen(noteId) || !draftRef.current.trim()) return;
    caretRef.current = caretAtHit(bodyRef.current, draftRef.current);
    startEditing();
    // Once per note: the refs are stable and the flag is spent on the first ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);
}
