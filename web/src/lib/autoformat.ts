/**
 * Typing help, applied as you write.
 *
 * Two rules, both triggered by the space bar and nothing else:
 *   "- "  at the start of a line becomes "– " (en dash)
 *   "[] " at the start of a line becomes "[ ] " (a tick box)
 *
 * And one rule on Enter: a line that starts with a marker continues the list on
 * the next line. Pressing Enter at the end of an empty item ends the list
 * instead of leaving a dangling marker — which is the behaviour every list in
 * every editor has, and the only one that doesn't require reaching for
 * backspace. Empty is a fact about the whole line, never about the half of it
 * in front of the caret; `continueList` says what that cost when it was not.
 *
 * A third marker continues but has nothing to rewrite: "1. " needs no
 * substitution, it is already what it should be. It only counts up on Enter,
 * so "1. milk" gives you "2. " and then "3. " for free.
 *
 * Everything here is a pure function of (value, caret). Nothing fires unless
 * the caret is sitting exactly after the trigger, so typing "-" mid-sentence,
 * pasting a note, or editing an old line never rewrites anything under you.
 */

export interface Edit {
  value: string;
  caret: number;
}

export const DASH = "–";

/** The start of the line the caret is on. */
function lineStart(value: string, caret: number): number {
  return value.lastIndexOf("\n", caret - 1) + 1;
}

/** The end of that line: the next newline, or the end of the note. */
function lineEnd(value: string, caret: number): number {
  const nl = value.indexOf("\n", caret);
  return nl === -1 ? value.length : nl;
}

/**
 * Run after every change to the field. Returns null when there is nothing to
 * do, which is almost always — the caller only re-sets the value on a hit, so
 * an untouched keystroke never disturbs the caret.
 */
export function autoformat(value: string, caret: number): Edit | null {
  const start = lineStart(value, caret);
  const head = value.slice(start, caret);

  // "- " or "* " -> "– ". Only the marker, only at the head of the line.
  //
  // The optional marker in the middle is the one that is already there: Enter
  // continues a list, so the next line opens with "– " before you type. Typing
  // "- " out of habit on top of that gave "– - ". Nobody means that, so the
  // second marker replaces the first instead of joining it.
  const dash = head.match(/^([ \t]*)(?:[–—][ \t]+)?[-*] $/);
  if (dash) {
    const next = `${dash[1]}${DASH} `;
    return {
      value: value.slice(0, start) + next + value.slice(caret),
      caret: start + next.length,
    };
  }

  // "[] " or "[]" + space -> "[ ] ". Typing the space is what commits it.
  // A box already marks the item, so it takes over from any dash before it.
  const box = head.match(/^([ \t]*)(?:[-*–][ \t]+)?\[\] $/);
  if (box) {
    const next = `${box[1]}[ ] `;
    return {
      value: value.slice(0, start) + next + value.slice(caret),
      caret: start + next.length,
    };
  }

  return null;
}

/**
 * A dash item or a tick box, and everything written after the marker.
 *
 * The tail is `[^\n]*` rather than `.*` because `.` does not match a carriage
 * return, and the line is now measured to the newline rather than to the caret
 * (see `continueList`) — so a body that arrived from somewhere that never
 * normalised its line endings keeps a stray "\r" *inside* the line, and with
 * `.*` the item would stop being an item at exactly the moment Enter is pressed
 * on it. `blocks.ts` carries the same widening for the same reason.
 *
 * A box written after a dash — "– [ ] milk", the shape `CHECK_RE` has always
 * read as a box and the one the insert panel's Tick box writes onto a dash
 * line — is one marker, not a dash whose words begin with brackets. Read the
 * second way, Enter continued it as a bare "– " and the next item had no box
 * to tick. The box alternative is tried first for that reason. This is not a
 * fourth rule: it is Enter continuing an item exactly as it was written.
 */
const ITEM_RE = /^([ \t]*)((?:[-*–][ \t]+)?\[[ xX]\][ \t]+|[-*–][ \t]+)([^\n]*)$/;

/**
 * A numbered item: "1. buy milk" or "3) call the bank".
 *
 * Capped at three digits on purpose. Unbounded, a line opening "1998. Best
 * year" is a list item, and pressing Enter after it silently offers "1999. " —
 * a year at the head of a sentence is ordinary writing, a hundred-item list is
 * not. Across the real archive this matches 95 lines in 20 notes and every one
 * of them is a genuine list, numbered 1 to 9.
 */
const NUM_RE = /^([ \t]*)(\d{1,3})([.)])[ \t]+([^\n]*)$/;

/**
 * Enter inside a list. Returns null when the caret is not in one, so the
 * keypress falls through to the browser's own newline.
 *
 * A ticked box never continues as ticked — the next item is always empty.
 *
 * -- on measuring the whole line, not the half in front of the caret --
 * This used to read the line as `value.slice(start, caret)`, so "is this item
 * empty?" was really "is there nothing between the marker and the caret?" —
 * two different questions that only agree when the caret is at the end of the
 * line. Park the caret just after the marker of a *full* item ("– |milk", Home
 * then two rights) and the item read as empty, so Enter took the list-is-over
 * branch and **deleted the marker instead of breaking the line**: the words
 * stayed, the mark the user made was gone, and since every keystroke is saved
 * the browser's own undo could not bring it back.
 *
 * So the line is read whole, and the two questions are asked separately: the
 * item is empty if there are no words *on the line*, and the list ends only if
 * the caret is also at the end of it. Anywhere else inside the words, Enter
 * breaks the line and opens the next item — which is what Enter in a list has
 * always meant everywhere else.
 *
 * A caret sitting *inside* the indent or the marker gets nothing at all: there
 * is no item in front of it to continue, and a bare newline is the only honest
 * answer.
 */
export function continueList(value: string, caret: number): Edit | null {
  const start = lineStart(value, caret);
  const end = lineEnd(value, caret);
  const line = value.slice(start, end);

  // A number counts up; a dash or a box repeats. Otherwise identical, down to
  // ending the list on an empty item rather than laying down another marker.
  //
  // Only this one new line is ever written. Pressing Enter in the *middle* of
  // a numbered list therefore leaves the items below it on their old numbers —
  // deliberately, because renumbering them means rewriting lines the user is
  // not typing on, which is the one thing this file never does.
  const num = line.match(NUM_RE);
  if (num) {
    const [, indent, digits, dot, content] = num;
    if (caret < wordsAt(start, line, content)) return null;
    if (content.trim() === "" && caret === end) return endList(value, start, caret);
    const insert = `\n${indent}${Number(digits) + 1}${dot} `;
    return {
      value: value.slice(0, caret) + insert + value.slice(caret),
      caret: caret + insert.length,
    };
  }

  const m = line.match(ITEM_RE);
  if (!m) return null;

  const [, indent, marker, content] = m;
  if (caret < wordsAt(start, line, content)) return null;

  // Empty item, with nothing after the caret either: the list is over. Clear
  // the marker rather than adding another.
  if (content.trim() === "" && caret === end) return endList(value, start, caret);

  // The marker as written — dash and box together where both are there — with
  // its box always unticked and one space after it.
  const next = `${marker.replace(/\[[xX]\]/, "[ ]").trimEnd()} `;
  const insert = `\n${indent}${next}`;
  return {
    value: value.slice(0, caret) + insert + value.slice(caret),
    caret: caret + insert.length,
  };
}

/**
 * Where the item's own words begin, in the note's own offsets.
 *
 * Both patterns capture everything after the marker as their last group and
 * both run to the end of the line, so the marker ends exactly that many
 * characters from the end — no second regex, and no counting the pieces of a
 * marker whose gap is not even captured.
 */
function wordsAt(start: number, line: string, content: string): number {
  return start + line.length - content.length;
}

/** Drops the dangling marker the caret is sitting behind. */
function endList(value: string, start: number, caret: number): Edit {
  return { value: value.slice(0, start) + value.slice(caret), caret: start };
}

/** A line that already holds a tick box, written either way `CHECK_RE` reads. */
const BOXED_RE = /^[ \t]*(?:[-*–][ \t]+)?(?:\[[ xX]\]|☐|☑)/;
/** The marker a box takes over from: a dash, a bullet or a number. */
const MARKER_RE = /^([ \t]*)(?:[-*–]|\d{1,3}[.)])[ \t]+/;
/** The longest first line `asChecklist` reads as a name rather than an item. */
const NAME_MAX = 30;

/**
 * A capture of several lines, made into a list to tick — **only because the
 * user pressed To-do on it** (review 2026-10-01, UX-05).
 *
 * This is the one place outside typing where the app writes a marker into
 * somebody's words, and the licence is the press: "typing help never rewrites
 * text the user is not typing" is a rule about help nobody asked for, and the
 * To-do mark is the asking. A Keep user writes three lines and taps To-do
 * expecting a list; without this they got a note with nothing to tick, which
 * the Ticker does not even offer.
 *
 * Deliberately narrow. One line is a to-do, not a list, and is left alone. A
 * note that already holds a box was made into a list by its writer and is
 * left exactly as written — its heading line is theirs. A `# ` name on the
 * first line stays the name. Blank lines stay blank; indentation stays where
 * it was; a dash or a number in front of a line gives way to the box, as a
 * typed `[] ` already takes over from a dash.
 *
 * One more reading, for a heading typed above the items (dogfooding
 * 2026-10-18), and only when the writer signalled it: text alone cannot tell
 * "Shopping" from "Milk", so a plain first line is an item like every other.
 * The first line becomes the note's name, written as `# Shopping` (the app's
 * own name rule, `lib/name.ts`), when it is short, has no list marker, is not
 * already a `#` line and has at least one item under it, and either (a) ends
 * with a colon ("Shopping:", the colon dropped) or (b) has a blank line right
 * under it. In (b) a first line that ends a sentence is not a name. Only the
 * rest is boxed.
 */
export function asChecklist(text: string): string {
  const lines = text.split("\n");
  const filled = lines.filter((l) => l.trim() !== "").length;
  if (filled < 2) return text;
  if (lines.some((l) => BOXED_RE.test(l))) return text;
  const first = lines[0].trim();
  const colon = first.endsWith(":");
  const name = colon ? first.slice(0, -1).trimEnd() : first;
  const names =
    name !== "" &&
    name.length <= NAME_MAX &&
    !first.startsWith("#") &&
    !MARKER_RE.test(lines[0]) &&
    (colon || (lines[1].trim() === "" && !/[.!?]$/.test(first)));
  return lines
    .map((line, i) => {
      if (line.trim() === "") return line;
      if (i === 0 && /^#[ \t]/.test(line)) return line;
      if (i === 0 && names) return `# ${name}`;
      const marker = line.match(MARKER_RE);
      if (marker) return `${marker[1]}[ ] ${line.slice(marker[0].length)}`;
      const indent = line.match(/^[ \t]*/)![0];
      return `${indent}[ ] ${line.slice(indent.length)}`;
    })
    .join("\n");
}
