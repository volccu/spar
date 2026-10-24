/**
 * The desktop board strip, when it holds more boards than the window does.
 *
 * At 1440px with five folders the strip ran out of room and hid Links, Files
 * and All past its right edge — All being the documented answer to "where did
 * that note go" — and nothing said they were there: a 28px fade over an empty
 * slot, and a mouse wheel that did nothing at all over the strip (review
 * UX-04). Two answers live here, as arithmetic `App.tsx` can call and a test
 * can hold without a layout engine: how many boards are out of sight on each
 * side (drawn as a count you can click), and what a vertical wheel means over
 * a row that only scrolls sideways.
 */

/** A box along the strip's one axis, in the same coordinates as the view. */
export interface Span {
  left: number;
  right: number;
}

export interface Hidden {
  /** Boards scrolled off past the left edge. */
  before: number;
  /** Boards scrolled off past the right edge. */
  after: number;
}

/**
 * How many tabs are out of sight on each side of `view`.
 *
 * A tab counts as hidden when its **middle** is past the edge — less than half
 * of it showing is a tab you cannot read, and more than half is one you can.
 * `fadeL` / `fadeR` move the edges in by the width of the mask, because a tab
 * sitting under the fade is drawn at a fraction of its tone and is not, for
 * the person looking, there.
 */
export function hiddenTabs(view: Span, tabs: readonly Span[], fadeL = 0, fadeR = 0): Hidden {
  const from = view.left + fadeL;
  const to = view.right - fadeR;
  let before = 0;
  let after = 0;
  for (const t of tabs) {
    const mid = (t.left + t.right) / 2;
    if (mid < from) before++;
    else if (mid > to) after++;
  }
  return { before, after };
}

/** `WheelEvent.deltaMode`: pixels, lines, pages. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** What one "line" of wheel is worth in pixels, where the browser says lines
 *  (Firefox with a mouse wheel). The same figure the browsers themselves use
 *  for a line of their own scrolling, near enough. */
const LINE_PX = 16;

/**
 * How far a wheel event should move the strip sideways, in pixels — or 0 when
 * the strip should leave it alone.
 *
 * A mouse wheel only speaks vertically, and over a row that only scrolls
 * sideways that vertical movement went nowhere. So a mostly-vertical wheel is
 * turned through ninety degrees. A mostly-sideways one (a trackpad's two-finger
 * swipe, a tilt wheel) is the browser's own to handle, and already works:
 * answering it here as well would scroll the strip twice.
 */
export function sidewaysWheel(
  e: { deltaX: number; deltaY: number; deltaMode: number },
  pageWidth: number,
): number {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return 0;
  if (e.deltaMode === DOM_DELTA_LINE) return e.deltaY * LINE_PX;
  if (e.deltaMode === DOM_DELTA_PAGE) return e.deltaY * pageWidth;
  return e.deltaY;
}
