/**
 * Writing a programmatic edit into a textarea **without throwing away the
 * browser's undo stack**.
 *
 * `web/CLAUDE.md` states the rule plainly: "Ctrl+Z is the board's, never the
 * editor's… Ctrl+Z inside one is the browser's own undo, working as it does
 * everywhere else", and `App.tsx` stands its own listener down entirely while
 * a note is open. That left the browser's undo as the *only* undo an editor
 * has — and assigning `el.value` from script resets the undo and redo stacks
 * in Chromium, Gecko and WebKit alike. So every autoformat (`- ` → `– `,
 * `[] ` → `[ ] `), every Enter that continued a list, every insert and every
 * Ctrl+B wiped it. On a list note, where every Enter goes through that path,
 * Ctrl+Z did nothing at all: the app had quietly taken undo away from the one
 * surface it had promised it to.
 *
 * `document.execCommand("insertText")` is the one mutation path browsers still
 * fold into their own undo stack. It is deprecated and has been for years, and
 * it is also the only thing that does this job — the Input Events spec's
 * replacement was never shipped anywhere. So it is *tried*, and a plain
 * assignment is the fallback, which is exactly the behaviour this file
 * replaces: nothing gets worse where it is unavailable (jsdom has no
 * `execCommand` at all), and undo survives where it is.
 *
 * The edit is narrowed to the span that actually changed before it is made.
 * Replacing the whole value would make one undo step out of the entire note,
 * which is worse than useless — Ctrl+Z would wipe everything back to the last
 * programmatic edit. The walk is over code units, so it can split a surrogate
 * pair; that only affects what the browser counts as one edit, never the
 * result, and the result is checked against the string that was asked for
 * before this reports success.
 */

/** The changed middle: what to select, and what to put in its place. */
export function changedSpan(
  before: string,
  after: string,
): { from: number; to: number; text: string } {
  const max = Math.min(before.length, after.length);
  let head = 0;
  while (head < max && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < max - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  return {
    from: head,
    to: before.length - tail,
    text: after.slice(head, after.length - tail),
  };
}

/**
 * Puts `value` into the field and leaves the selection at `[from, to]`.
 *
 * Returns true when the write went through the browser's own editing command
 * and so joined its undo stack, false when it had to be assigned. Callers do
 * not need to care which; the field holds `value` either way.
 */
export function writeThrough(
  el: HTMLTextAreaElement,
  value: string,
  from: number,
  to = from,
): boolean {
  let undoable = false;
  if (el.value !== value) undoable = throughCommand(el, value);
  if (!undoable) el.value = value;
  el.setSelectionRange(from, to);
  return undoable;
}

/**
 * The note as a textarea holds it: every "\r\n", and every lone "\r", one "\n".
 *
 * A textarea normalises line endings in the value it reports, whatever it was
 * given — so a body that arrived from a share sheet, an import or a device
 * that never normalised its newlines is one string in `draft` and a shorter one
 * in `el.value`. Every selection offset the field reports is counted in the
 * second, and applying it to the first lands each edit one character early for
 * every "\r\n" above it: Ctrl+B on "wor" wrote `line2** wor**d`.
 *
 * So the editor is *given* the text in its own convention (React then has
 * nothing to re-assign between renders, which in a real browser throws the
 * selection away), and every programmatic edit is computed against this
 * string. The stored body is left exactly as it arrived until something
 * actually edits it — the same moment a typed character already normalised it.
 */
export function fieldValue(src: string): string {
  return src.includes("\r") ? src.replace(/\r\n?/g, "\n") : src;
}

/**
 * An offset into `src` as the field counts it. A pair split by the offset
 * counts as behind it, so a tap between "\r" and "\n" stays on its own line.
 */
export function fieldOffset(src: string, offset: number): number {
  let at = offset;
  for (let i = 0; i < offset && i + 1 < src.length; i++) {
    if (src[i] === "\r" && src[i + 1] === "\n") at--;
  }
  return at;
}

function throughCommand(el: HTMLTextAreaElement, value: string): boolean {
  const exec = typeof document !== "undefined" ? document.execCommand : undefined;
  if (typeof exec !== "function") return false;
  // The command acts on the focused element's own selection, so a field that
  // is not focused cannot be written this way. Reading mode is the case: the
  // editor does not exist yet, and its caller opens it instead.
  if (document.activeElement !== el) return false;
  const span = changedSpan(el.value, value);
  el.setSelectionRange(span.from, span.to);
  try {
    const took =
      span.text.length > 0
        ? exec.call(document, "insertText", false, span.text)
        : exec.call(document, "delete", false);
    // Believe the field, not the return value: `execCommand` reports true in
    // places it has done nothing, and a half-applied edit is far worse than a
    // lost undo step.
    return took === true && el.value === value;
  } catch {
    return false;
  }
}
