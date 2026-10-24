/**
 * The arithmetic of carrying a board along its run, kept apart from the
 * gesture (`useBoardPress.ts`) so it can be tested without a layout engine —
 * jsdom has none, and every number here is a measurement in a real one.
 *
 * A run is measured once, when the board is picked up: one slot per board,
 * its leading edge and its length along the shelf's own axis (x on the strip,
 * y in the drawer), in the scroller's content coordinates so that scrolling
 * mid-drag moves nothing that was measured. The carried board is then only
 * ever an offset from its own slot.
 */
export interface Slot {
  /** Leading edge along the axis, in the scroller's content coordinates. */
  start: number;
  /** Length along the axis, borders included — what the board occupies. */
  size: number;
}

const middle = (slot: Slot) => slot.start + slot.size / 2;

/**
 * How far the carried board may travel: to the leading edge of the run's
 * first board and the trailing edge of its last, and no further. This is the
 * fence made visible — the board stops at the hairline, at the Inbox and at
 * the Archive rather than sliding over them and then snapping back on release,
 * which would say "you may go there" right up until it said you may not.
 */
export function clampOffset(slots: readonly Slot[], from: number, offset: number): number {
  const self = slots[from];
  if (!self || slots.length === 0) return 0;
  const first = slots[0];
  const last = slots[slots.length - 1];
  const least = first.start - self.start;
  const most = last.start + last.size - (self.start + self.size);
  return Math.min(most, Math.max(least, offset));
}

/**
 * The seat the carried board would take if let go now: it has taken a
 * neighbour's seat once its **leading edge** has reached that neighbour's
 * middle — the edge it is travelling with, so the front edge going back and
 * the back edge going on. That is "half the neighbour's width", whichever is
 * the wider of the two, which is what a strip of tabs as unlike as INSP and
 * VERKKOKAUPPA needs: measured by the carried board's own middle instead, a
 * wide tab pressed hard against the end of its run would stop there, plainly
 * sitting in the end seat, and land one short of it.
 *
 * Measured against the neighbours where they were *before* they moved aside,
 * so a gap opening under the finger can never make the answer flicker back.
 */
export function dropIndex(slots: readonly Slot[], from: number, offset: number): number {
  const self = slots[from];
  if (!self) return from;
  const lead = self.start + offset;
  const tail = self.start + self.size + offset;
  let to = from;
  for (let i = from + 1; i < slots.length; i++) if (tail >= middle(slots[i])) to = i;
  for (let i = from - 1; i >= 0; i--) if (lead <= middle(slots[i])) to = i;
  return to;
}

/**
 * How far neighbour `i` steps aside while the carried board would land at
 * `to`: by exactly the carried board's own length, towards the seat it left,
 * for every board between the two seats — and not at all for anyone else.
 * The boards in a run sit edge to edge (the strip's tabs share their rules,
 * the drawer's rows stack), so the length is the whole of the gap.
 */
export function makeWay(slots: readonly Slot[], from: number, to: number, i: number): number {
  const size = slots[from]?.size ?? 0;
  if (i === from) return 0;
  if (to > from && i > from && i <= to) return -size;
  if (to < from && i >= to && i < from) return size;
  return 0;
}

/**
 * How fast to scroll while the finger rests near an edge of the shelf, in
 * pixels per frame, signed: negative towards the start. Nothing until the
 * pointer is inside `edge` of either end, then faster the closer it gets, up
 * to `most` at the edge itself — so resting a little way in creeps and
 * pressing against the edge runs.
 */
export function edgeScroll(
  pointer: number,
  near: number,
  far: number,
  edge = 36,
  most = 14,
): number {
  if (pointer < near + edge) return -Math.ceil(most * Math.min(1, (near + edge - pointer) / edge));
  if (pointer > far - edge) return Math.ceil(most * Math.min(1, (pointer - (far - edge)) / edge));
  return 0;
}
