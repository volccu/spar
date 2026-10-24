import { linkify } from "./links";

/**
 * Emphasis inside a line of a note.
 *
 * Three marks and no more: `**bold**`, `*italic*` and `` `code` ``. They are
 * the ones people already type without being asked to, which is the whole test
 * — 121 bold spans, 6 italics and 16 inline snippets are sitting in the real
 * archive right now, pasted in from somewhere else, and until this file existed
 * every one of them was drawn as literal asterisks.
 *
 * THE HARD RULE, the same one linkify() and parseBlocks() carry: concatenating
 * every segment's `text`, in order, must reproduce the input exactly, character
 * for character. The note view maps a tap onto a caret position by measuring
 * rendered text, so one character invented or dropped here puts the caret in
 * the wrong place for the rest of the note. The delimiters therefore stay in
 * the string and are marked `hidden` — in the DOM, where the range arithmetic
 * counts them, and not on the page. It is exactly what the ``` fences do.
 *
 * Detection is deliberately strict, for the same reason unfenced code detection
 * is: a wrong guess is worse than a miss. Two rules do nearly all the work —
 *
 *   - a delimiter must hug its text. "*word*" is emphasis; "* *" is not, and
 *     the archive holds six of the latter (a lone star used as a separator)
 *     that a loose rule would have set in italic.
 *   - a delimiter run never crosses a newline, so an unclosed one costs one
 *     line rather than swallowing the rest of the note.
 *
 * Underscores are not a mark. `snake_case` is ordinary in a notes app that
 * holds code, and there is nothing `_x_` says that `*x*` does not.
 */

export interface InlineSeg {
  text: string;
  /** In the DOM so the caret still counts it, but not drawn. A delimiter. */
  hidden?: boolean;
  strong?: boolean;
  em?: boolean;
  code?: boolean;
  /** Where this points, for a segment linkify() claimed. */
  href?: string;
  /**
   * Part of what the user just searched for (`markHits` in face.ts). Set on a
   * card face while a search is running, and on the open note's reader when
   * the note was opened from a search — until the first tap into its text,
   * after which the reader never marks it again. `markHits` only ever splits
   * a segment, never adds or drops a character, so the reader's round trip
   * stays character for character with hits drawn. Nothing about it is
   * stored: a hit is a fact about the query rather than about the note.
   */
  hit?: boolean;
  /**
   * A hit on the line that answers the whole query — the first line holding
   * the most of several searched words (`bestLine` in face.ts). Drawn at full
   * ink while the other hits step one tone down (review 2026-10-04, UI-A-11).
   * Never set without `hit`, and never for a one-word search.
   */
  best?: boolean;
}

type Kind = "code" | "strong" | "em";

interface Span {
  kind: Kind;
  /** Index of the first delimiter character in the source. */
  at: number;
  open: string;
  inner: string;
  close: string;
}

interface Style {
  strong?: boolean;
  em?: boolean;
}

/** Emphasis may not open straight after a letter or a digit: 3*4*5 is sums. */
function wordish(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function space(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/**
 * The spans in a string, in order and never overlapping.
 *
 * A single forward walk. At each delimiter it looks for the matching close on
 * the same line; finding none it moves on one character and the delimiter stays
 * an ordinary character, which is the behaviour that makes an unpaired asterisk
 * harmless.
 */
function scan(src: string): Span[] {
  const out: Span[] = [];
  let i = 0;
  /**
   * Per delimiter, how far a close is already known not to exist. Whether a
   * place can close a run depends only on that place, so a search that found
   * none from one point finds none from any later point on the same line.
   * Without this a long line of unpaired marks (a pasted log, minified code)
   * was searched to its end once per mark and froze the page for seconds
   * (bughunt 2026-10-15).
   */
  const dead: Record<string, number> = {};
  const close = (from: number, mark: string, width: number): number => {
    if (from < (dead[mark] ?? 0)) return -1;
    if (space(src[from])) return -1;
    const end = closeAt(src, from, mark, width);
    if (end < 0) {
      const eol = src.indexOf("\n", from);
      dead[mark] = eol < 0 ? src.length : eol;
    }
    return end;
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === "`") {
      const end = close(i + 1, "`", 1);
      if (end > 0) {
        out.push({ kind: "code", at: i, open: "`", inner: src.slice(i + 1, end), close: "`" });
        i = end + 1;
        continue;
      }
    } else if (ch === "*" && src[i + 1] === "*") {
      const end = close(i + 2, "**", 2);
      if (end > 0) {
        out.push({ kind: "strong", at: i, open: "**", inner: src.slice(i + 2, end), close: "**" });
        i = end + 2;
        continue;
      }
    } else if (ch === "*" && !wordish(src[i - 1]) && src[i - 1] !== "*") {
      const end = close(i + 1, "*", 1);
      // A lone star's run may not contain another: italic inside italic is not
      // a thing, and allowing it would let "*a*b*" claim two overlapping spans.
      if (end > 0 && !src.slice(i + 1, end).includes("*") && src[end + 1] !== "*") {
        out.push({ kind: "em", at: i, open: "*", inner: src.slice(i + 1, end), close: "*" });
        i = end + 1;
        continue;
      }
    }

    i++;
  }

  return out;
}

/**
 * Where the run opened at `from` closes, or -1.
 *
 * The two hugging rules live here: the character after the opening delimiter
 * must not be a space, and the one before the closing delimiter must not be
 * either. A newline ends the search — an unclosed mark costs its own line and
 * nothing beyond it.
 */
function closeAt(src: string, from: number, mark: string, width: number): number {
  if (space(src[from])) return -1;
  for (let k = from; k < src.length; k++) {
    if (src[k] === "\n") return -1;
    if (!src.startsWith(mark, k)) continue;
    if (k === from) continue;
    if (space(src[k - 1])) continue;
    // "**" must not be read as the close of a "*" run that opened one char in.
    if (width === 1 && mark === "*" && src[k - 1] === "*") continue;
    return k;
  }
  return -1;
}

/** How deep emphasis may nest. Italic inside bold is real; three deep is not. */
const MAX_DEPTH = 3;

/**
 * `#word` used to be a hand-typed tag, detected structurally the same way
 * `**bold**` is — see git history (and `web/CLAUDE.md`) for the mechanism,
 * removed along with tagging and tag-boards. It is ordinary text now, the
 * same as any other word, and gets no segment of its own.
 */
function push(text: string, style: Style, out: InlineSeg[]): void {
  if (text === "") return;
  for (const seg of linkify(text)) {
    if (seg.href) {
      out.push({ text: seg.text, ...style, href: seg.href });
      continue;
    }
    out.push({ text: seg.text, ...style });
  }
}

function build(src: string, style: Style, depth: number, out: InlineSeg[]): void {
  if (src === "") return;
  if (depth >= MAX_DEPTH) {
    push(src, style, out);
    return;
  }

  let last = 0;
  for (const span of scan(src)) {
    push(src.slice(last, span.at), style, out);
    out.push({ text: span.open, hidden: true });

    if (span.kind === "code") {
      // Code is literal: nothing inside it is a mark, and an address in it is
      // a string in a program rather than something to follow.
      out.push({ text: span.inner, ...style, code: true });
    } else {
      build(span.inner, { ...style, [span.kind]: true }, depth + 1, out);
    }

    out.push({ text: span.close, hidden: true });
    last = span.at + span.open.length + span.inner.length + span.close.length;
  }
  push(src.slice(last), style, out);
}

/**
 * Splits a run of prose into styled segments that tile it exactly — links
 * included, since linkify() runs inside every plain stretch.
 */
export function parseInline(src: string): InlineSeg[] {
  const out: InlineSeg[] = [];
  build(src, {}, 0, out);
  return out;
}

/**
 * The same segments with the delimiters dropped rather than hidden.
 *
 * For the card, which is display-only and has no caret to keep honest. A card
 * showing "**Tuesday**" is worse than one showing Tuesday in bold, and worse
 * again than one showing Tuesday plain.
 */
export function plainInline(src: string): InlineSeg[] {
  return parseInline(src).filter((seg) => !seg.hidden);
}
