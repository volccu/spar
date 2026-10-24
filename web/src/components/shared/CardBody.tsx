import type { ReactNode } from "react";
import type { CardLine } from "../../lib/face";
import type { InlineSeg } from "../../lib/inline";
import { NoteInline } from "./NoteInline";
import { Pen } from "./Pen";

/**
 * Whether the thing about to be drawn is really showing a hit.
 *
 * The body of a search result used to step down to `--muted` merely because a
 * query was running, and that step only reads as "the ink is over there" when
 * there is ink somewhere to look at. A note matched on an attachment's
 * filename, or a link note whose match sat inside an address the face strips,
 * dimmed every word it had and marked none of them — a card that reported
 * being a result by being harder to read. So the dimming is keyed on the mark
 * rather than on the query: this is set only where a hit is actually drawn,
 * and the stylesheet hangs the whole effect off it.
 */
export function drawsHit(segs: InlineSeg[]): true | undefined {
  return segs.some((seg) => seg.hit) ? true : undefined;
}

/**
 * Set where a search of several words singles out one line (`bestLine` in
 * lib/face.ts): that line's hits keep full ink and every other hit steps one
 * tone down, so the eye goes to the line that answers the whole query rather
 * than to the first of sixty marked words (review 2026-10-04, UI-A-11).
 */
export function ranksHits(segs: InlineSeg[]): true | undefined {
  return segs.some((seg) => seg.best) ? true : undefined;
}

/**
 * The note's own words, as lines. Shared by the card face, the Links row and
 * the canvas's notes, so a list, a heading, a code fence, a tag line and the
 * cut fade are drawn the same in all three — written twice they drift, which
 * is the same argument `markerOf` settles. The canvas's copy did drift: it
 * spelled the backticks of a code fence out and drew a Keep tag line at full
 * ink, until it was folded back in here.
 */
export function CardBody({
  lines,
  cut,
  name = null,
  className,
  children,
}: {
  lines: CardLine[];
  cut: boolean;
  /**
   * The note's name, when it has one. Its line is drawn the way an idea card
   * draws an idea's name — in place, in the line slot it already had, so the
   * card's height and the cut are exactly what they were. Only when the face
   * actually opens on it: a search result winds forward past it.
   */
  name?: string | null;
  /** A second class beside `card-body` — the canvas's `spatial-card-body`. */
  className?: string;
  /** Drawn in place of the lines when there are none (the canvas's "Empty note"). */
  children?: ReactNode;
}) {
  return (
    <div
      className={className ? `card-body ${className}` : "card-body"}
      data-cut={cut}
      data-dim={drawsHit(lines.flatMap((line) => line.segs))}
      data-ranked={ranksHits(lines.flatMap((line) => line.segs))}
    >
      {/* Every line is its own box, so an item can carry its own leading the
          way it does in the open note. A line costs exactly what it cost as
          pre-wrapped text, so the cut and the fade still land where the budget
          says they do. */}
      {lines.length === 0
        ? children
        : lines.map((line, i) =>
            line.code === "fence" ? (
              <span className="card-line card-code-fence" key={i} aria-hidden />
            ) : line.marker === null ? (
              <span
                className="card-line"
                key={i}
                data-heading={line.heading}
                data-name={
                  i === 0 && name !== null && line.heading && line.words.trim() === name
                    ? true
                    : undefined
                }
                data-tag={line.tag}
                data-code={line.code === "body"}
              >
                <NoteInline segs={line.segs} />
              </span>
            ) : (
              <span className="card-item" key={i} data-done={line.done}>
                <span className="card-mark" data-num={line.numbered}>
                  {line.marker}
                </span>
                <Pen>
                  <NoteInline segs={line.segs} />
                </Pen>
              </span>
            ),
          )}
    </div>
  );
}
