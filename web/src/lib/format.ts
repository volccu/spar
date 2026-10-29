import { boxLine } from "./blocks";

/**
 * The open note's formatting and inserting, as text in and text out.
 *
 * Everything here is the arithmetic `NoteView` used to do inline against the
 * field and its refs: each function is handed the note as the field counts it
 * (`fieldValue` in lib/editText.ts) and the offsets that belong to that string,
 * and hands back the new string and where the selection goes. Reading the
 * field, remembering the selection a phone threw away and writing the result
 * back through the browser's undo stack all stay in the component — none of it
 * is a question about text.
 */

/**
 * Formatting, which is a different question from inserting and is asked
 * differently.
 *
 * These four act on text that is already there — the selection, or the line the
 * caret is on — so they are not "put this in", and giving them four rows of
 * their own would have taken the panel to nine on a phone screen. They share
 * one row of short marks instead, which is also how every editor in the world
 * has drawn them for thirty years.
 *
 * `line` marks the line the caret sits on and toggles; `wrap` wraps the
 * selection, or lays down a pair with the caret between them when there is
 * none. Both are toggles, because a control that can only be turned on is half
 * a control.
 */
export const F_HEAD = { label: "H", title: "Heading", mode: "line", mark: "# " } as const;
export const F_BOLD = { label: "B", title: "Bold", mode: "wrap", mark: "**" } as const;
export const F_EM = { label: "I", title: "Italic", mode: "wrap", mark: "*" } as const;

/**
 * Three, and there was very nearly a fourth.
 *
 * A subheading was built and withdrawn on sight: at reading size in the bold
 * cut it is character for character what inline bold already is, so the panel
 * held two controls with one appearance between them. Giving it a size of its
 * own meant a seventh in a scale that allows six; giving it a rule meant
 * furniture in the middle of a note. One heading and one emphasis is the whole
 * hierarchy a note can carry before the hierarchy is worth more than the note.
 */
export const FORMATS = [F_HEAD, F_BOLD, F_EM] as const;

export type Format = (typeof FORMATS)[number];

/* --- formatting what is already written -----------------------------------
   Insert puts characters in; these change characters that are there. Both end
   up as text in the note and nothing else — the marks are the ones people
   already type, they stay in the string, and a note stripped of every one of
   them still reads. Nothing here is a field, a style attribute or a second
   copy of the text. --------------------------------------------------------- */

/**
 * The selection, or the caret twice — from the editor, or from memory.
 *
 * Memory wins in exactly one case: the field says its selection is collapsed
 * and the last one we were told about was not. Nothing the user does produces
 * that — `onSelect` fires when a selection collapses too, so a deliberate
 * collapse updates both. It is the signature of a blur having thrown the
 * selection away between the tap and the button, which is a phone.
 *
 * `len` is the length of the note as the field counts it, `held` the last
 * selection the field reported (`lastRange`), and `field` the field's own
 * selection while it is open — null while the note is being read.
 */
export function pickRange(
  len: number,
  held: readonly [number, number] | null,
  field: readonly [number, number] | null,
): [number, number] {
  const usable: [number, number] | null =
    held && held[0] !== held[1] && held[1] <= len ? [held[0], held[1]] : null;
  if (field) {
    if (field[0] !== field[1]) return [field[0], field[1]];
    return usable ?? [field[0], field[1]];
  }
  if (usable) return usable;
  const at = held?.[1] ?? null;
  const c = at !== null && at <= len ? at : len;
  return [c, c];
}

export interface Rewrite {
  value: string;
  from: number;
  to: number;
}

/** Wraps the selection, unwraps it if it is already wrapped, and lays down an
 *  empty pair with the caret between them when there is no selection. */
export function wrapWith(value: string, from: number, to: number, mark: string): Rewrite | null {
  const before = value.slice(0, from);
  const inner = value.slice(from, to);
  const after = value.slice(to);
  // A single star must not take one star off each end of a bold run — the
  // user asked for italic, not for half of the bold they already had.
  const doubled = mark === "*" && (before.endsWith("**") || after.startsWith("**"));
  // ...and the same inside the selection. "**bold**" picked out with its
  // stars starts and ends with a star, so it was unwrapped into "*bold*": the
  // bold gone, for an italic nobody had. Wrapping it instead gives
  // "***bold***", which `lib/inline.ts` closes at the first "**" and draws as
  // bold "*bold" beside a stray star — marks the reader cannot render, for the
  // life of the note. Teaching the parser a run of three would move the
  // archive's pinned emphasis counts, so this writes nothing at all: an italic
  // that cannot be drawn is not one worth putting in the text.
  if (
    mark === "*" &&
    inner.length > 4 &&
    inner.startsWith("**") &&
    inner.endsWith("**") &&
    !(inner.startsWith("***") && inner.endsWith("***"))
  ) {
    return null;
  }

  if (!doubled && before.endsWith(mark) && after.startsWith(mark)) {
    return {
      value: before.slice(0, -mark.length) + inner + after.slice(mark.length),
      from: from - mark.length,
      to: to - mark.length,
    };
  }
  if (
    !doubled &&
    inner.length > mark.length * 2 &&
    inner.startsWith(mark) &&
    inner.endsWith(mark)
  ) {
    return {
      value: before + inner.slice(mark.length, -mark.length) + after,
      from,
      to: to - mark.length * 2,
    };
  }
  // **A mark never crosses a newline** (`lib/inline.ts` refuses to close one
  // that does, and `inline.test.ts` pins it). Wrapping a two-line selection
  // therefore wrote `**one\ntwo**` into the note and the reader drew four
  // literal asterisks with no emphasis anywhere — marks the user asked for,
  // present in the text, and unable to render for the life of the note. Each
  // line is wrapped on its own instead, which is what was meant; a line with
  // no words on it is left alone, because a pair of marks around nothing is
  // a pair of characters to delete by hand.
  if (inner.includes("\n")) {
    const wrapped = inner
      .split("\n")
      .map((line) => {
        const lead = line.match(/^[ \t]*/)?.[0] ?? "";
        const tail = line.slice(lead.length).replace(/[ \t]+$/, "");
        if (tail.length === 0) return line;
        const trail = line.slice(lead.length + tail.length);
        return lead + mark + tail + mark + trail;
      })
      .join("\n");
    return { value: before + wrapped + after, from, to: from + wrapped.length };
  }
  // The same rule on one line. A selection that caught a space at either end
  // — a double-click takes the word and the space after it — was wrapped as
  // `**word **`, which `lib/inline.ts` rightly refuses to draw, since a mark
  // has to hug its words. The spaces go outside the marks and the words stay
  // selected; a selection of nothing but spaces keeps them in front of the
  // empty pair a bare caret would lay down.
  const lead = inner.match(/^[ \t]*/)?.[0] ?? "";
  const words = inner.slice(lead.length).replace(/[ \t]+$/, "");
  const trail = inner.slice(lead.length + words.length);
  const at = from + lead.length + mark.length;
  return {
    value: before + lead + mark + words + mark + trail + after,
    from: at,
    to: at + words.length,
  };
}

/** Where the line holding `at` begins. A negative start to `lastIndexOf`
 *  reads as 0, so an empty first line would hand back the line below. */
function lineStart(value: string, at: number): number {
  return at <= 0 ? 0 : value.lastIndexOf("\n", at - 1) + 1;
}

/** Puts a heading mark on the line the caret is on — or takes it off, or
 *  swaps one level for the other. Never touches a line you are not on. */
export function markLine(value: string, from: number, mark: string): Rewrite {
  const start = lineStart(value, from);
  const nl = value.indexOf("\n", start);
  const end = nl === -1 ? value.length : nl;
  const line = value.slice(start, end);
  const indent = line.match(/^[ \t]*/)?.[0] ?? "";
  const rest = line.slice(indent.length);
  const had = rest.match(/^#{1,2}[ \t]+/)?.[0] ?? "";
  const next = had === mark ? "" : mark;
  const rewritten = indent + next + rest.slice(had.length);
  const at = Math.max(start, from + (rewritten.length - line.length));
  return {
    value: value.slice(0, start) + rewritten + value.slice(end),
    from: at,
    to: at,
  };
}

/** A new text and the one place the caret goes in it. */
export interface Placed {
  value: string;
  caret: number;
}

/**
 * Turns every line a selection touches into a tick box item, rather than
 * inserting one box — what the Tick box row does when there is a selection.
 */
export function boxSelectedLines(value: string, from: number, to: number): Placed {
  // From the head of the line the selection starts on, not from wherever
  // inside it the selection began. A box is a mark on a line: boxing the
  // slice put it mid-sentence, "buy [ ] milk today", which is two brackets
  // and not an item.
  const sfrom = lineStart(value, from);
  const selected = value.slice(sfrom, to);
  const lines = selected.split("\n");
  // `boxLine` rather than a bare prefix: a line that already carries a box
  // came back as `[ ] [ ] milk`, which parses as one box whose *words* are
  // `[ ] milk` — a tick box followed by two literal brackets.
  const boxed = lines.map(boxLine).join("\n");
  return { value: value.slice(0, sfrom) + boxed + value.slice(to), caret: sfrom + boxed.length };
}

/**
 * Puts the lines a selection touches between ``` fences — what the Code block
 * row does when there is a selection, so code pasted in as plain lines becomes
 * a block without being cut out and pasted back between empty fences.
 *
 * Whole lines, for the reason `boxSelectedLines` takes them: a fence owns its
 * line, and a selection that starts after a line's indent must not leave the
 * indent outside the block. A selection ending just past a newline (a
 * triple-click, a drag to the next line's start) ends on the line above.
 * Nothing between the fences changes; the caret lands after the closing one.
 */
export function fenceSelectedLines(value: string, from: number, to: number): Placed {
  const end = to > from && value[to - 1] === "\n" ? to - 1 : to;
  const sfrom = lineStart(value, from);
  const nl = value.indexOf("\n", end);
  const sto = nl === -1 ? value.length : nl;
  const fenced = "```\n" + value.slice(sfrom, sto) + "\n```";
  return { value: value.slice(0, sfrom) + fenced + value.slice(sto), caret: sfrom + fenced.length };
}

/** What an insert row does to a selection instead of inserting, or null when
 *  it has nothing to do with one (the date goes in after it). */
export function onSelectedLines(label: string, value: string, from: number, to: number): Placed | null {
  if (label === "Tick box") return boxSelectedLines(value, from, to);
  if (label === "Code block") return fenceSelectedLines(value, from, to);
  return null;
}

/**
 * Puts `text` in at `at`, on a line of its own, with the caret `caret`
 * characters into what was inserted.
 */
export function insertOnOwnLine(value: string, at: number, text: string, caret: number): Placed {
  // A box or a fence has to own its line, or it is just characters in a
  // sentence. Only add the break when there isn't one already.
  const before = at > 0 && value[at - 1] !== "\n" ? "\n" : "";
  const after = at < value.length && value[at] !== "\n" ? "\n" : "";
  const added = before + text + after;
  return {
    value: value.slice(0, at) + added + value.slice(at),
    caret: at + before.length + caret,
  };
}

/**
 * Puts `text` in at `at`, inside the line, with the caret straight after it —
 * the insert that is a word rather than a block (the Date row).
 *
 * `insertOnOwnLine` exists because a box or a fence means nothing mid-sentence.
 * A date is the opposite case: "call back on 27 Sep 2026" is a sentence, and
 * a date forced onto a line of its own would break the one it was put into.
 * So it goes exactly where the caret is, and the only thing added around it is
 * the space a word needs — before it when it would otherwise run into the word
 * or the full stop in front, after it when a word follows straight on. Nothing
 * is ever replaced: with a selection it lands after the selection, as every
 * other insert does, because an insert that overwrote picked words would be
 * the one row in the panel that could lose text.
 */
export function insertInline(value: string, at: number, text: string): Placed {
  const before = at > 0 && /[\p{L}\p{N}.,;:!?)\]]/u.test(value[at - 1]) ? " " : "";
  const after = at < value.length && /[\p{L}\p{N}(]/u.test(value[at]) ? " " : "";
  return {
    value: value.slice(0, at) + before + text + after + value.slice(at),
    caret: at + before.length + text.length,
  };
}

/** What `cutSelection` leaves behind, what it takes, and where the caret goes. */
export interface Cut {
  /** The note with the selection gone and the join tidied. */
  rest: string;
  /** The selection, without the blank lines and trailing space at its ends. */
  moved: string;
  /** Where the cut was, in `rest`. */
  caret: number;
}

/**
 * Takes the selection out of the note — "New note from selection", the
 * inverse of merge. Null when there is nothing to take (a selection of
 * spaces) or nothing would be left (the whole note: that is not a split, it is
 * the same note twice).
 *
 * **The only text this touches beyond the selection is the whitespace at the
 * join**, and that is the whole of what "tidy" means here. A cut out of the
 * middle of a note leaves the separators from both sides of it lying end to
 * end — a paragraph lifted from between two others left four newlines where
 * there had been two blank lines, and a line lifted out of a list left an
 * empty line in the list. So the join keeps the *larger* of the two
 * separators the selection had, never their sum: a paragraph cut from between
 * paragraphs leaves one blank line, a line cut from a list leaves one break,
 * and a phrase cut from a sentence leaves one space. That can never invent a
 * blank line the note did not already have on one side of the cut. The
 * indentation of the line after the join is kept, and a cut at the very top or
 * the very bottom leaves no separator at all. Nothing else — no renumbering,
 * no stray marker taken away, no line not touching the cut rewritten.
 */
export function cutSelection(value: string, from: number, to: number): Cut | null {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(value.length, Math.max(from, to));
  const picked = value.slice(lo, hi);
  // Blank lines at either end of the selection are separators, not words, and
  // a new note opening on an empty line opens on nothing.
  const moved = picked.replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
  if (moved.trim() === "") return null;

  const a = value.slice(0, lo);
  const b = value.slice(hi);
  const wsA = /[ \t\n]*$/.exec(a)?.[0] ?? "";
  const wsB = /^[ \t\n]*/.exec(b)?.[0] ?? "";
  const selLead = /^[ \t\n]*/.exec(picked)?.[0] ?? "";
  const selTrail = /[ \t\n]*$/.exec(picked)?.[0] ?? "";
  const head = a.slice(0, a.length - wsA.length);
  const tail = b.slice(wsB.length);
  if (head === "" && tail === "") return null;

  const breaks = (s: string) => s.split("\n").length - 1;
  // The separator on each side of the selection, counted in line breaks —
  // whichever side of the selection's own edge the breaks happened to fall on,
  // since a whole line picked up with its newline is the same cut as one
  // picked up without it.
  const joinBreaks = Math.max(breaks(wsA + selLead), breaks(selTrail + wsB));

  // The indentation of the line that now follows the join: after the last
  // break on the far side if there is one there, else what stands in front of
  // the tail, else the indentation of the line the cut began on.
  let indent = "";
  if (joinBreaks > 0) {
    if (wsB.includes("\n")) indent = wsB.slice(wsB.lastIndexOf("\n") + 1);
    else if (selTrail.includes("\n")) indent = wsB;
    else {
      const near = wsA + selLead;
      indent = near.slice(near.lastIndexOf("\n") + 1);
    }
  }

  let join: string;
  if (head === "") join = joinBreaks > 0 ? indent : "";
  else if (tail === "") join = "";
  else if (joinBreaks > 0) join = "\n".repeat(joinBreaks) + indent;
  else join = wsA + selLead + selTrail + wsB !== "" ? " " : "";

  return { rest: head + join + tail, moved, caret: head.length + join.length };
}
