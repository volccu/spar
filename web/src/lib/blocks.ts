/**
 * Structure inside a note's text.
 *
 * A note is one string. This finds the things in it that want to be drawn
 * differently — a tick box, a run of code, a heading, and everything else —
 * without ever changing the string. Nothing here rewrites, reformats or
 * reorders the note. Emphasis *inside* a line is `inline.ts`, under the same
 * rule and for the same reason.
 *
 * THE HARD RULE, same as linkify(): concatenating every block's `text`, in
 * order, must reproduce the input exactly, character for character. The note
 * view maps a tap onto a caret position by measuring rendered text, so a single
 * character invented or dropped here puts the caret in the wrong place for the
 * rest of the note. `blocks.test.ts` asserts it on every fixture.
 *
 * Characters that must exist for the offsets to work but must not be seen — the
 * ``` fences, the newline a block element supplies for itself — are kept in the
 * text and marked to be rendered hidden. They stay in the DOM, so the range
 * arithmetic still counts them; they just don't take up a line.
 */

export interface ProseBlock {
  kind: "prose";
  text: string;
}

/**
 * One item of a list — a tick box or a dash. Both are drawn as block elements
 * so a wrapped item can be set on its own tighter leading, which is what makes
 * a two-line item read as one thing instead of as two lines of prose.
 *
 * `lead` and `tail` are newlines the item owns rather than the paragraph around
 * it: a block element supplies its own break, so the newline in the text would
 * otherwise be drawn *as well*, and every item would sit a blank line apart.
 */
export interface ItemBlock {
  kind: "check" | "list";
  text: string;
  /** The newline claimed from the line above. Hidden. */
  lead: string;
  /** Indent, and any "- " written before a box. */
  prefix: string;
  /** "[ ]", "[x]", "☐", "☑" — or the dash, for a plain list item. */
  marker: string;
  /** The item's own words. */
  words: string;
  /** The newline that ended the line. Hidden. */
  tail: string;
  /** Where the marker sits in the note's text — what a tick rewrites. */
  markerAt: number;
  done: boolean;
  /**
   * A counted item rather than a bullet. Every dash is the same width, so a
   * dash list already puts its words on one left edge; "1." and "10." do not,
   * and the ragged edge is the whole difference between a list that is set and
   * a list that is merely typed. The marker is drawn in a column when this is
   * true — see `.item-mark` in styles.css.
   */
  numbered: boolean;
}

/**
 * A line the user marked as a heading.
 *
 * ONE level, and there is no second. A second was built and withdrawn on
 * sight: it came out as reading size in the bold cut, which is character for
 * character what inline bold already is, so the app had two controls producing
 * one appearance. Adding a size for it would have meant a seventh in a scale
 * that allows six, and a rule under it would have been furniture in the middle
 * of a note. A note is a page, not a manual — one heading to name a part of it,
 * and bold for a phrase inside, is the whole hierarchy a note can carry before
 * the hierarchy is worth more than the note.
 *
 * `##` is still *accepted*, and draws the same as `#`. Markdown is pasted in
 * here constantly and three `##` lines are already sitting in the archive;
 * refusing them would print hashes at people for no gain. The app reads both
 * spellings and has one thing to say.
 *
 * The hashes stay in the text and are drawn hidden, exactly like the ``` fences.
 * This is not the app deriving a heading — it never does, and `title` is still
 * never rendered. It is the user writing one, which is a different thing.
 */
export interface HeadingBlock {
  kind: "heading";
  text: string;
  /** The newline claimed from the line above. Hidden. */
  lead: string;
  /** Indent before the hashes. */
  prefix: string;
  /** "# " or "## ", the space included. Hidden. */
  marker: string;
  /** The heading's own words. */
  words: string;
  /** The newline that ended the line. Hidden. */
  tail: string;
  /** Where the hashes sit in the note's text — what a toggle rewrites. */
  markerAt: number;
}

export interface CodeBlock {
  kind: "code";
  text: string;
  /** The newline this block takes from the line above, so its own block box
   *  supplies the break instead of leaving a blank line above the code. */
  lead: string;
  /** The opening fence line, when the user wrote one. Hidden. */
  open: string;
  /** The code itself — the only visible part. */
  code: string;
  /** The closing fence line. Hidden. */
  close: string;
  /** The newline below, for the same reason as `lead`. Hidden. */
  tail: string;
  lang: string | null;
}

export type Block = ProseBlock | ItemBlock | CodeBlock | HeadingBlock;

/** A fence line. `\r?` for the reason the four patterns below carry `[^\n]`;
 *  here it can simply be dropped, since nothing rebuilds the line from these
 *  groups — the block keeps the fence line's text whole. */
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9+#._-]*)[ \t]*\r?$/;
/**
 * -- on `[^\n]` where every one of these once said `.` --
 *
 * `.` matches anything except a line terminator, and a carriage return is one.
 * So a body whose lines end "\r\n" — one that arrived from a share sheet, a
 * merge, an import or a device that never normalised its newlines — matched
 * none of the four patterns below, and the note drew with no tick boxes, no
 * headings and no list items at all: every mark the user made, invisible, with
 * nothing on screen to say why. `composeShared` now normalises at the one entry
 * point we know of; this is the floor under the ones we do not.
 *
 * The widening is safe only because the "\r" stays in `words`, which is what
 * the reader draws: `[^\n]*` keeps it, `(.*)\r?$` would have eaten it, and an
 * eaten character is the round trip broken and every tap after it landing on
 * the wrong caret. The line patterns still refuse to cross a newline, which is
 * the rule that matters. `\S` in the two below still rejects a bare "\r" as
 * words, so "– \r" is an empty item exactly as "– " is.
 */
const CHECK_RE = /^([ \t]*(?:[-*–][ \t]+)?)(\[[ xX]\]|☐|☑)([^\n]*)$/;
/** A dash item, but only one that actually has words after the marker. */
const LIST_RE = /^([ \t]*)([-*–][ \t]+)(\S[^\n]*)$/;
/**
 * A numbered item — same shape, so it falls out as the same kind of block.
 *
 * Three digits at most, and words required after the marker. Unbounded it would
 * claim "1998. Best year" and set an ordinary sentence as a list; bounded, it
 * matches 95 lines across 20 notes of the real archive and every one is a real
 * list, numbered 1 to 9. Nothing in the archive is a date, a price or a year.
 */
const NUM_RE = /^([ \t]*)(\d{1,3}[.)][ \t]+)(\S[^\n]*)$/;
/**
 * A heading. One or two hashes, a space, and words — all three required.
 *
 * The space is what keeps "#include" and "#1" and a bare "#" out of it, and
 * capping at two is the same kind of bound as the three digits above: `###` and
 * deeper exist in markdown because markdown sets books, and a note is not one.
 * Both spellings draw the same thing — see HeadingBlock for why there is only
 * one. Four lines in the whole real archive match, which is what a mark should
 * cost before anyone has started using it.
 */
const HEADING_RE = /^([ \t]*)(#{1,2}[ \t]+)(\S[^\n]*)$/;

export interface Heading {
  prefix: string;
  marker: string;
  words: string;
}

/** The heading at the head of a line, if the line is one. One definition. */
export function headingOf(line: string): Heading | null {
  const m = line.match(HEADING_RE);
  if (!m) return null;
  return { prefix: m[1], marker: m[2], words: m[3] };
}

/**
 * The marker at the head of a line, if the line has one.
 *
 * One definition, shared. `parseBlocks` needs it to build blocks whose text
 * tiles the note exactly; the card face needs it only to know a list when it
 * sees one. Written twice they would drift, and a card would eventually
 * disagree with the note it stands for about what counts as an item.
 *
 * Order matters: a box first, because "- [ ] milk" is something to tick rather
 * than a dash item, and a number last, because it is the only marker that can
 * never also open a box.
 */
export interface Marker {
  kind: "check" | "list";
  /** Indent, and any "- " written before a box. */
  prefix: string;
  /** "[ ]", "[x]", "☐", "☑", the dash, or "1. ". */
  marker: string;
  /** The item's own words. */
  words: string;
  done: boolean;
  numbered: boolean;
}

export function markerOf(line: string): Marker | null {
  const check = line.match(CHECK_RE);
  const dash = check ? null : line.match(LIST_RE);
  const num = check || dash ? null : line.match(NUM_RE);
  const m = check ?? dash ?? num;
  if (!m) return null;
  const marker = m[2];
  return {
    kind: check ? "check" : "list",
    prefix: m[1],
    marker,
    words: m[3],
    done: marker === "[x]" || marker === "[X]" || marker === "☑",
    numbered: num !== null,
  };
}

/**
 * Signals that a line is code rather than a sentence. Split into strong and
 * weak on purpose: a run has to earn its way in on strong evidence, because a
 * paragraph wrongly set in a monospace box is far more damage than a snippet
 * left as prose. Measured against the real archive in blocks.test.ts.
 */
const STRONG = [
  /=>/,
  /;\s*$/,
  /^\s*[{}]\s*$/,
  /\b(?:function|const|let|var|def|class|import|export|return|public|private)\s/,
  /^\s*(?:#include|#!\/|package |using )/,
  /<\/[a-z][\w-]*>|\/>/i,
  /^\s*\$ /,
  /^\s*(?:npm|npx|git|curl|sudo|docker|pip|cargo|brew|apt)\s+[a-z-]/,
  /\bSELECT\b.+\bFROM\b/i,
  /^\s*[\w.$]+\([^)]*\)\s*[;{]?\s*$/,
  /^\s*[\w.$]+\s*[:=]\s*[[{]\s*$/,
  // A line that only closes something. Pasted code is mostly middles and ends,
  // and without these a snippet was recognised from its first line and then
  // abandoned before its last.
  /^\s*[)\]}]+[,;]?\s*$/,
  // Control flow, in every language that has any.
  /^\s*(?:if|for|while|switch|try|catch|except|else|elif|foreach|with)\s*[({:]/,
  // A markup or JSX tag opening the line.
  /^\s*<\/?[A-Za-z][\w.:-]*(?:\s|\/?>)/,
  // The line a page of HTML opens with. It is no tag by the pattern above, so
  // a pasted page began its panel one line in.
  /^\s*<!DOCTYPE\b/i,
  // A CSS rule opening: a selector and a brace, nothing else on the line.
  /^\s*[.#]?[\w-]+[\w\s.,#:>[\]="'-]*\{\s*$/,
  // A JSON key.
  /^\s*"[\w$-]+"\s*:/,
];

const WEAK = [
  /[{}[\]();]/,
  /^\s{2,}\S/,
  /^\t/,
  /\b(?:true|false|null|undefined|void|int|bool|string)\b/,
  /[<>]=|!==?|===|\+\+|--|&&|\|\|/,
];

/** Anything that looks like prose disqualifies a line outright. */
function isSentence(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  // A box or a dash is something the user wrote on purpose. Detection is a
  // guess, and a guess never overrules a marker — "[ ] foo(a);" is an item to
  // tick, not a program, and swallowing it into a code block loses the box.
  if (markerOf(line)) return true;
  // Same reasoning, and it matters more here: "# do the thing" is a shell
  // comment as often as it is a heading, and a run of code must never be able
  // to swallow a line the user marked by hand.
  if (headingOf(line)) return true;
  // An address is a link, not a snippet — a quarter of this archive is links.
  if (/https?:\/\/|www\./i.test(t)) return true;
  // Four or more ordinary words in a row with no code punctuation between them.
  return /(?:^|\s)(?:[A-Za-zÅÄÖåäö'’]+\s+){4,}[A-Za-zÅÄÖåäö'’]+/.test(t) &&
    !/[{};=]/.test(t);
}

/**
 * A comment in code: `<!-- … -->`, `// …`, `/* … *\/`. Its words read as a
 * sentence, and a sentence ended the run, so a snippet with a comment in it
 * was boxed from the line under the comment only. A comment is no evidence of
 * code on its own either — `// to do` is a line of a note as often as of a
 * program — so it is neither: it rides inside a run the way a blank line does,
 * and joins one at either end (`detectRuns`), but never starts one.
 */
const COMMENT_RE = /^\s*(?:<!--|-->|\/\/|\/\*|\*\/)/;

interface Score {
  strong: number;
  weak: number;
  comment?: true;
}

function codeScore(line: string): Score {
  if (line.trim() === "") return { strong: 0, weak: 0 };
  if (COMMENT_RE.test(line) && !markerOf(line) && !headingOf(line)) {
    return { strong: 0, weak: 0, comment: true };
  }
  if (isSentence(line)) return { strong: -1, weak: 0 };
  let strong = 0;
  let weak = 0;
  for (const re of STRONG) if (re.test(line)) strong++;
  for (const re of WEAK) if (re.test(line)) weak++;
  return { strong, weak };
}

interface Line {
  text: string;
  /** Offset of the first character of the line in the source. */
  start: number;
  /** "\n", or "" for the final line of the note. */
  nl: string;
}

function toLines(src: string): Line[] {
  const parts = src.split("\n");
  const out: Line[] = [];
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    const nl = i < parts.length - 1 ? "\n" : "";
    out.push({ text: parts[i], start: at, nl });
    at += parts[i].length + nl.length;
  }
  return out;
}

/**
 * Runs of lines that are code beyond reasonable doubt, anywhere in the note —
 * a note is very often a paragraph, a snippet, and then another paragraph, and
 * only the snippet should end up in a box.
 *
 * A run is a maximal span of consecutive lines where every line carries at
 * least some code signal and none of them reads as a sentence. Blank lines are
 * allowed inside it, because pasted code has blank lines in it. The span is
 * then accepted only if it is two lines or more, at least two of those lines
 * carry *strong* evidence, and at least half of them do.
 *
 * The half rule is what keeps this honest. Counting total signals let one
 * dense line drag three innocent ones in behind it; requiring the evidence to
 * be spread across the run means a paragraph with one bracket in it can never
 * qualify, however many brackets that one line has.
 *
 * The span is not anchored on a strong line, which is the other half of the
 * fix: `.card {` and `SELECT id, name` carry no strong signal of their own, so
 * a run that had to *start* strong began one line into the snippet and left
 * its first line outside the box.
 */
function detectRuns(lines: Line[], taken: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  // Each line is scored once. A failed span steps forward a single line and
  // walks the same lines again, and `codeScore` is a dozen regular expressions
  // a line — re-run for every retry, a long note of code-ish prose cost the
  // square of its length in regex work on every keystroke and every card face.
  const scores: Score[] = [];
  const score = (k: number) => (scores[k] ??= codeScore(lines[k].text));
  let i = 0;

  while (i < lines.length) {
    const start = score(i);
    if (taken[i] || lines[i].text.trim() === "" || start.strong < 0 || start.strong + start.weak < 1) {
      i++;
      continue;
    }

    let j = i;
    let last = i;
    let body = 0;
    let strongLines = 0;
    while (j < lines.length && !taken[j]) {
      const s = score(j);
      if (lines[j].text.trim() === "" || s.comment) {
        // A blank or a comment may sit inside a run, but never end one: `last`
        // doesn't move.
        j++;
        continue;
      }
      if (s.strong < 0 || s.strong + s.weak < 1) break;
      body++;
      if (s.strong >= 1) strongLines++;
      last = j;
      j++;
    }

    if (body >= 2 && strongLines >= 2 && strongLines * 2 >= body) {
      // Comments touching the run's ends are its own: the header above a
      // snippet, the closing remark under it. Only with no blank between.
      let first = i;
      while (first > 0 && !taken[first - 1] && score(first - 1).comment) first--;
      while (last + 1 < lines.length && !taken[last + 1] && score(last + 1).comment) last++;
      runs.push([first, last]);
      for (let k = first; k <= last; k++) taken[k] = true;
      i = last + 1;
    } else {
      // Step one line, not past the whole span: a span that failed only
      // because of the lines at its head can still succeed without them.
      i++;
    }
  }

  return runs;
}

function fenceRuns(lines: Line[], taken: boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  // The fence lines, found once. An opening fence with no partner used to scan
  // every line to the end of the note for one; now it looks only at the other
  // fences. Same pairing as before: an opener takes the next fence of its own
  // character, and an unmatched one is skipped so a later fence may open.
  const fences: { at: number; char: string }[] = [];
  for (let k = 0; k < lines.length; k++) {
    const m = lines[k].text.match(FENCE_RE);
    if (m) fences.push({ at: k, char: m[1][0] });
  }
  for (let a = 0; a < fences.length; a++) {
    const open = fences[a];
    for (let b = a + 1; b < fences.length; b++) {
      if (fences[b].char !== open.char) continue;
      const i = open.at;
      const j = fences[b].at;
      for (let k = i; k <= j; k++) taken[k] = true;
      runs.push([i, j]);
      a = b;
      break;
    }
  }
  return runs;
}

/**
 * Splits a note into blocks that tile it exactly.
 *
 * `fenced` alone is the safe mode, used where a wrong guess would be expensive.
 * Detection of unfenced code is on by default in the note view, where the user
 * can see and correct it.
 */
export function parseBlocks(src: string, detect = true): Block[] {
  if (src === "") return [];

  const lines = toLines(src);
  const taken = new Array(lines.length).fill(false);

  const fenced = fenceRuns(lines, taken).map((r) => ({ run: r, fence: true }));
  const found = detect
    ? detectRuns(lines, taken).map((r) => ({ run: r, fence: false }))
    : [];
  const code = [...fenced, ...found].sort((a, b) => a.run[0] - b.run[0]);

  // Where each code run starts, so the line walk below can jump over it.
  const runAt = new Map<number, { end: number; fence: boolean }>();
  for (const { run, fence } of code) runAt.set(run[0], { end: run[1], fence });

  const blocks: Block[] = [];
  let pending = "";

  /** Emits the prose gathered so far, optionally giving up its last newline. */
  function flushProse(claimNewline: boolean): string {
    let lead = "";
    if (claimNewline && pending.endsWith("\n")) {
      lead = "\n";
      pending = pending.slice(0, -1);
    }
    if (pending) blocks.push({ kind: "prose", text: pending });
    pending = "";
    return lead;
  }

  for (let i = 0; i < lines.length; ) {
    const run = runAt.get(i);

    if (run) {
      const a = i;
      const b = run.end;
      const first = lines[a];
      const last = lines[b];
      const lead = flushProse(true);

      const open = run.fence ? first.text + first.nl : "";
      const close = run.fence ? last.text : "";
      // The newline under the block belongs to the block box, not to the line
      // below it, or the code sits in a hole two lines deep.
      const tail = last.nl;
      const from = run.fence ? lines[a + 1].start : first.start;
      const to = run.fence ? last.start : last.start + last.text.length;
      const codeText = from <= to ? src.slice(from, to) : "";

      blocks.push({
        kind: "code",
        text: lead + open + codeText + close + tail,
        lead,
        open,
        code: codeText,
        close,
        tail,
        lang: run.fence ? first.text.match(FENCE_RE)?.[2] || null : null,
      });

      i = b + 1;
      continue;
    }

    const l = lines[i];
    const h = headingOf(l.text);
    if (h) {
      // A block element, so it takes the newlines above and below into itself
      // rather than letting the paragraph draw them a second time.
      const lead = flushProse(true);
      blocks.push({
        kind: "heading",
        text: lead + l.text + l.nl,
        lead,
        prefix: h.prefix,
        marker: h.marker,
        words: h.words,
        tail: l.nl,
        markerAt: l.start + h.prefix.length,
      });
      i++;
      continue;
    }

    const m = markerOf(l.text);
    if (m) {
      // Both are block elements, so both take the newline above and below into
      // themselves rather than letting the paragraph draw it a second time.
      const lead = flushProse(true);
      blocks.push({
        kind: m.kind,
        text: lead + l.text + l.nl,
        lead,
        prefix: m.prefix,
        marker: m.marker,
        words: m.words,
        tail: l.nl,
        markerAt: l.start + m.prefix.length,
        done: m.done,
        numbered: m.numbered,
      });
    } else {
      pending += l.text + l.nl;
    }
    i++;
  }

  flushProse(false);
  return blocks;
}

/**
 * The note's text with one box ticked or unticked. Nothing else changes —
 * including which of the two spellings of a box the note is written in.
 *
 * `markerOf` accepts "☐"/"☑" as well as "[ ]"/"[x]", because Keep wrote them
 * that way and notes imported from it still do. Ticking one used to answer in
 * brackets whatever it found, so the first tick silently replaced one character
 * of the user's own text with three — the same class of thing as rewriting a
 * dash, and against the rule that everything the user marks stays in the text.
 * A box now toggles inside the spelling it is already written in.
 *
 * The glyph case is also the safer arithmetic: one character for one, where it
 * used to be one for three. Every offset downstream — `markerAt` on the blocks
 * that were parsed from the *old* string, `lineAt` in `tickItem`, the caret in
 * the open note — is measured against that string, and a same-length rewrite
 * leaves all of them true. Never make this replacement change length.
 */
export function toggleBox(src: string, block: ItemBlock): string {
  const glyph = block.marker === "☐" || block.marker === "☑";
  const next = glyph ? (block.done ? "☐" : "☑") : block.done ? "[ ]" : "[x]";
  return (
    src.slice(0, block.markerAt) +
    next +
    src.slice(block.markerAt + block.marker.length)
  );
}

/**
 * One line with a tick box on it, and nothing done to a line that has one.
 *
 * The insert panel's Tick box row, given a selection, turns every selected line
 * into an item. It did that with a bare `"[ ] " + line`, so a line that was
 * already a box came out "[ ] [ ] milk" — which parses as one box whose *words*
 * are "[ ] milk", so the second box is drawn as text, ticking the item does not
 * touch it, and the note now says something the user did not write. Re-boxing a
 * box is the one thing this must not do; anything else it can only make better.
 *
 * Where the box goes is decided by what is already at the head of the line:
 *   - a box (in either spelling)  -> the line is returned untouched, by identity
 *   - a blank line                -> untouched too; a marker with no words is
 *                                    a dangling marker, and the user selected a
 *                                    gap between items, not an item
 *   - a dash item                 -> after the dash, "– [ ] milk", which is the
 *                                    shape CHECK_RE has always accepted (its
 *                                    prefix is "indent, and any '- ' written
 *                                    before a box")
 *   - anything else               -> after the indent, so "  1. milk" becomes
 *                                    "  [ ] 1. milk" and keeps its number as
 *                                    words rather than losing it. A number
 *                                    cannot live in CHECK_RE's prefix, so the
 *                                    box has to go in front of it or it would
 *                                    not be a box at all.
 */
export function boxLine(line: string): string {
  if (line.trim() === "") return line;
  const m = markerOf(line);
  if (m && m.kind === "check") return line;
  // A dash marker joins the prefix; an indent is all a numbered or plain line
  // may keep in front of the box.
  const at = m && !m.numbered ? m.prefix.length + m.marker.length : line.length - line.trimStart().length;
  return `${line.slice(0, at)}[ ] ${line.slice(at)}`;
}

/** Whether a note has any code in it — cheap enough to call while rendering. */
export function hasCode(src: string): boolean {
  return parseBlocks(src).some((b) => b.kind === "code");
}

/**
 * Whether a note still has something to tick.
 *
 * The Ticker's whole pile is answered with this: Todos holds notes that are a
 * checklist *and* notes the user marked as a to-do, and the second kind may
 * have no boxes in it at all. Offering a screen of tick targets for a note with
 * none is offering nothing.
 *
 * Parsing the note to answer it, rather than a regex over the lines, for the
 * reason `markerOf` exists — one definition of what a tick box is, so the mode
 * cannot disagree with the note it opens.
 */
export function hasOpenBox(src: string): boolean {
  return parseBlocks(src).some((b) => b.kind === "check" && !b.done);
}

/** The ticked boxes in a note, in the order they are written. */
function doneBoxes(src: string): ItemBlock[] {
  return parseBlocks(src).filter((b): b is ItemBlock => b.kind === "check" && b.done);
}

/**
 * How many boxes in the note are ticked — what Untick all and Clear done are
 * offered on, and what their undo offer counts.
 *
 * Through `parseBlocks`, for the reason `hasOpenBox` is: a `[x]` inside a run
 * of code is code, and a verb that reached into it would be rewriting a
 * snippet the reader is drawing as a snippet.
 */
export function doneCount(src: string): number {
  return doneBoxes(src).length;
}

/**
 * Every ticked box turned back to an open one, and nothing else touched.
 *
 * The list that is used again — the weekly shopping, the packing list — was
 * unticked box by box, which is as many taps as it has items for a decision
 * that is one. Each box keeps the spelling it is written in (`toggleBox`), and
 * every rewrite is the same length as what it replaces, so the offsets parsed
 * from the original string stay true for every box after the first. Nothing is
 * reordered: the settle already put the done boxes at the foot of their run,
 * and unticking them leaves the list in exactly that order, which is the order
 * the user last saw it in.
 *
 * Returns the note untouched, by identity, when nothing was ticked.
 */
export function untickAll(src: string): string {
  let out = src;
  for (const box of doneBoxes(src)) out = toggleBox(out, box);
  return out;
}

/**
 * The note with every ticked item taken out of it — the running list that
 * only ever grows, cleared of what is finished in one go.
 *
 * An item is one line in the block model (an item "wraps" only on screen,
 * never in the text), so an item leaving is its line leaving, newline and all.
 * Everything else — the heading over the list, the prose between runs, the
 * open items, the blank lines — stays character for character. A ticked box
 * inside a run of code is code and stays too, which is why this asks
 * `parseBlocks` rather than `markerOf` line by line.
 *
 * This removes text, so the callers offer it back through the ordinary undo;
 * `raw_content` keeps the original capture either way.
 *
 * Returns the note untouched, by identity, when nothing was ticked.
 */
export function clearDone(src: string): string {
  const done = doneBoxes(src);
  if (done.length === 0) return src;
  // Where each ticked item's line begins: the marker's offset less whatever
  // stands in front of it on the line.
  const gone = new Set(done.map((b) => b.markerAt - b.prefix.length));
  return toLines(src)
    .filter((line) => !gone.has(line.start))
    .map((line) => line.text)
    .join("\n");
}
