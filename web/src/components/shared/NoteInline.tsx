import { Fragment, type ReactNode } from "react";
import { parseInline, type InlineSeg } from "../../lib/inline";
import { leaveForLink } from "../../lib/returnState";

interface Props {
  /** Pass segments when a card has already removed display-only delimiters. */
  segs?: InlineSeg[];
  text?: string;
  /** Cards stay inside their button; the reader is allowed to expose links. */
  interactive?: boolean;
}

/**
 * The inline grammar has one renderer. The reader keeps delimiters as drawn,
 * muted nodes so caret offsets remain exact and tapping into the note moves
 * nothing; cards pass plain segments and therefore
 * remain display-only without ever nesting an anchor in their button.
 *
 * A segment is not always a whole thing, which is why this walks the list
 * rather than mapping it. `markHits` splits a segment by character offset so a
 * matched run can be held at full ink, and it copies every flag onto each
 * piece — `code` included. Drawn a piece at a time, one snippet came out as
 * several adjacent boxes, each with the padding and the hairline `.inline-code`
 * carries. A run of code segments is therefore gathered back into the one
 * `<code>` it came from, with the hit marked inside it.
 */
export function NoteInline({ segs, text = "", interactive = false }: Props) {
  const parts = segs ?? parseInline(text);
  const out: ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];

    // A delimiter: `**`, `*`, a backtick. Drawn, in muted, never hidden — the
    // open note swaps this for a textarea that shows every character, and a
    // mark that appeared only then would move the words after it
    // (styles.css, "one line grid").
    if (seg.hidden) {
      out.push(
        <span className="note-mark" key={i}>
          {seg.text}
        </span>,
      );
      continue;
    }

    // --- one snippet, one box ------------------------------------------------
    // Searching "note" against a card holding an inline `deriveFace(note)` used
    // to draw that snippet as three boxes in a row with the joins showing. The
    // pieces of one snippet always arrive adjacent and carrying the same
    // emphasis, so gathering the run back up is enough — and it puts the hit
    // *inside* the box, which is what the stylesheet needs to hook the emphasis
    // onto rather than losing it to the code span's own colour.
    if (seg.code) {
      const at = i;
      const run: InlineSeg[] = [];
      while (i < parts.length && parts[i].code && !parts[i].hidden) run.push(parts[i++]);
      i--;
      const first = run[0];
      const box = (
        <code className="inline-code">
          {run.map((piece, k) =>
            piece.hit ? (
              <span data-hit="true" data-best={piece.best ? true : undefined} key={k}>
                {piece.text}
              </span>
            ) : (
              <Fragment key={k}>{piece.text}</Fragment>
            ),
          )}
        </code>
      );
      out.push(
        first.strong || first.em ? (
          <span className="em" data-strong={first.strong} data-em={first.em} key={at}>
            {box}
          </span>
        ) : (
          <span key={at}>{box}</span>
        ),
      );
      continue;
    }

    let inner: ReactNode = seg.text;
    if (seg.href && interactive) {
      const href = seg.href;
      inner = (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => leaveForLink(e, href)}
        >
          {seg.text}
        </a>
      );
    }

    // `hit` is only ever set during a search (`markHits`) — on a card face, or
    // on the reader of a note opened from a result until it is tapped into —
    // so this attribute is absent everywhere else.
    if (!seg.strong && !seg.em) {
      out.push(
        <span key={i} data-hit={seg.hit ? true : undefined} data-best={seg.best ? true : undefined}>
          {inner}
        </span>,
      );
      continue;
    }
    out.push(
      <span
        className="em"
        data-strong={seg.strong}
        data-em={seg.em}
        data-hit={seg.hit ? true : undefined}
        data-best={seg.best ? true : undefined}
        key={i}
      >
        {inner}
      </span>,
    );
  }

  return <>{out}</>;
}
