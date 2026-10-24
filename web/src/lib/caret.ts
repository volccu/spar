/**
 * Where the caret is, in the field's own pixels.
 *
 * A textarea will not say. There is no API for it and there never has been, so
 * the only honest answer is to build a copy of the field that lays text out the
 * same way, put the text up to the caret into it, and read off where that text
 * ends. The browser does the line-breaking, which is the whole point — the
 * cheap version of this measures the last line with `canvas.measureText` and is
 * exactly right until a line soft-wraps, which in a field that grows to seven
 * rows is most of the time it matters.
 *
 * The mirror is a real element the caller owns and keeps: building one per
 * keystroke would allocate a node, force a layout and throw it away on every
 * character typed. It carries no text of its own between calls.
 *
 * Used by the two lamps (`--lamp-x`/`--lamp-y`): the capture bar's, and the
 * open note's editor. That second caller is why this was written as a shared
 * function against any textarea and any mirror rather than as two lines inside
 * CaptureBar — the two fields have different fonts, different measures and
 * different padding, and every one of those is read off the field it is
 * pointed at, so neither knows the other exists.
 */

/**
 * The properties that decide where a character lands. Anything that changes
 * the shape of a line has to be copied or the mirror wraps somewhere the field
 * does not, and the light lands on the wrong word.
 *
 * `width` is set separately from `clientWidth`, because the field's own width
 * excludes its scrollbar and the mirror must wrap at the same place.
 */
const MIRRORED = [
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "tabSize",
  "textIndent",
  "textTransform",
  "wordSpacing",
] as const;

export interface CaretPoint {
  /** Distance from the field's left edge, in CSS pixels. */
  x: number;
  /** The middle of the caret's own line, measured from the field's top edge. */
  y: number;
}

/**
 * Point the mirror at the field and read the caret off it.
 *
 * `y` is the *middle* of the line rather than its top, because every caller so
 * far wants to centre something on it, and half a line height computed in two
 * places is half a line height that will disagree in one of them.
 *
 * The field's own `scrollTop` is subtracted, so the answer is where the caret
 * is on screen and not where it is in the text — a field scrolled past its cap
 * would otherwise light a line that has been scrolled out of view.
 */
export function caretPoint(
  field: HTMLTextAreaElement,
  mirror: HTMLElement,
): CaretPoint {
  const style = window.getComputedStyle(field);
  for (const prop of MIRRORED) mirror.style[prop] = style[prop];
  mirror.style.width = `${field.clientWidth}px`;

  // Everything up to the caret, then a zero-width span standing exactly where
  // the caret does. `textContent` rather than innerHTML: the note is the
  // user's text and must never be parsed as markup on its way through here.
  mirror.textContent = field.value.slice(0, field.selectionStart);
  const mark = document.createElement("span");
  mark.textContent = "​";
  mirror.appendChild(mark);

  const lineHeight = Number.parseFloat(style.lineHeight) || 0;
  const point: CaretPoint = {
    x: mark.offsetLeft,
    y: mark.offsetTop + lineHeight / 2 - field.scrollTop,
  };

  // Emptied on the way out. The mirror is `visibility: hidden` and so is never
  // seen, but a copy of whatever is being written should not sit in the DOM
  // between keystrokes for anything else to find.
  mirror.textContent = "";
  return point;
}

/**
 * Where a caret would land for a point on screen, as an offset into the note's
 * raw text. Only works because linkify() and parseBlocks() put every character
 * back exactly where it was — including the ``` fences, which are in the DOM
 * but hidden — so the rendered text and the stored text share one index.
 * Returns null in environments without caret hit-testing (jsdom, old Safari) —
 * the caller falls back to the end of the note.
 */
export function offsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = root.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };

  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  }
  if (!node || !root.contains(node)) return null;

  const upTo = doc.createRange();
  upTo.selectNodeContents(root);
  upTo.setEnd(node, offset);
  return upTo.toString().length;
}
