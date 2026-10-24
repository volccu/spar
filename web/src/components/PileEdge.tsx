/**
 * The edge of the pile under the note in Tidy up and Tick off: up to three
 * hairlines, each a little shorter than the one above, like the edge of a deck
 * (joy review 2026-10-14, #4). It says how much is left, in levels and never a
 * count, and it is built from rules alone — no shadow, no fill, no hue.
 *
 * `after` is how many notes wait behind the one on screen. The box is the same
 * height whatever it holds, so the note above never shifts when a line goes;
 * the last note simply stands on bare paper.
 */
export const PILE_EDGE_MAX = 3;

/** How many hairlines show: three when three or more wait, then two, one, none. */
export function pileEdge(after: number): number {
  return Math.max(0, Math.min(PILE_EDGE_MAX, Math.floor(after)));
}

export function PileEdge({ after }: { after: number }) {
  const lines = pileEdge(after);
  return (
    <div className="pile-edge" aria-hidden data-lines={lines}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="pile-edge-line" />
      ))}
    </div>
  );
}
