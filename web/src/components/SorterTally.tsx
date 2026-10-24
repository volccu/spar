import { useLayoutEffect, useRef } from "react";
import { animates, ENTER, TALLY_DRAW_MS, TALLY_STAGGER_MS } from "../lib/motion";

/** What a run came to as a report: only the lines that happened, in order. */
export function tallyLines(
  lines: ReadonlyArray<readonly [string, number]>,
): Array<readonly [string, number]> {
  return lines.filter(([, n]) => n > 0);
}

/**
 * The end of Tidy up (joy review 2026-10-14, #9). A line is drawn only if its
 * count is more than nothing, so a run that only moved and left shows two
 * lines and not seven; a run with no answers at all says so in one plain
 * sentence rather than an empty list. Each line's hairline draws in, left to
 * right, a beat after the one above it (clip, never scale). Still a report: no
 * total, no praise.
 */
export function SorterTally({ lines }: { lines: ReadonlyArray<readonly [string, number]> }) {
  const shown = tallyLines(lines);
  const list = useRef<HTMLUListElement | null>(null);

  useLayoutEffect(() => {
    const el = list.current;
    if (!animates(el)) return;
    // The hairline is each line's own `::after` (the last line has none).
    el.querySelectorAll<HTMLElement>(".sorter-end-line").forEach((line, i) => {
      line.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], {
        pseudoElement: "::after",
        duration: TALLY_DRAW_MS,
        delay: i * TALLY_STAGGER_MS,
        easing: ENTER,
        // Backwards, never both: it is hidden until its turn and then simply there.
        fill: "backwards",
      });
    });
  }, []);

  if (shown.length === 0) return <p className="sorter-end-none">Nothing changed.</p>;
  return (
    <ul className="sorter-end-tally mono" ref={list}>
      {shown.map(([word, n]) => (
        <li key={word} className="sorter-end-line">
          <span>{word}</span>
          <span>{n}</span>
        </li>
      ))}
    </ul>
  );
}
