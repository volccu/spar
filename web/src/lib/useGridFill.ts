import { useEffect, useState } from "react";
import { SLIDE_IN_MS } from "./motion";

/**
 * useGridFill — a big board arrives a screenful first, the rest a beat later.
 *
 * Paging to a board used to mount every card it holds in one React commit,
 * squeezed into the gap between the deck sliding out and sliding back in. On
 * the Archive that is getting on for two hundred cards built in a single
 * frame, and the frame showed it: the slide-in started late and stuttered.
 * `content-visibility: auto` already spares the browser *painting* what is off
 * screen, but React still had to build all of it before anything could move.
 *
 * So a freshly arrived view mounts only what the first screen can show plus a
 * margin, and the remainder is committed once the slide-in has finished — by
 * then the cards being added are all below the fold, so the second commit
 * changes nothing the eye can see. The user is not waiting on it either: the
 * scroll bar is briefly optimistic, and a flick that outruns the fill meets
 * the rest of the board already there.
 *
 * The *first* view of a boot is deliberately exempt and renders whole. Boot
 * has its own budget, and the back-from-a-link restore (`lib/returnState.ts`)
 * puts the scroll position back on frame one — against a grid two screens
 * short, a deep `scrollTop` would clamp and land the user somewhere else.
 */

/**
 * More cards than any first screen shows. A desktop grid runs to five columns
 * of three-and-a-bit rows; a phone shows four or five cards of its single
 * column. Forty covers the worst case with a full screen of headroom, and is
 * small enough that the arrival commit stays inside a frame or two.
 */
export const GRID_FILL_COUNT = 40;

/**
 * When the rest arrives: after the slide-in has settled, plus a margin so the
 * commit cannot clip the animation's last frames. Filling any earlier would
 * spend the saving in the middle of the very motion it exists to protect.
 */
export const GRID_FILL_AFTER_MS = SLIDE_IN_MS + 80;

/**
 * How many of `total` this view should render right now.
 *
 * `view` names what the grid is showing — the same key `useGridReflow` gets,
 * because "the whole set was replaced" is the same event for both hooks. A
 * change of `view` restarts the bargain; anything else (a capture landing, a
 * sync pulling a note in) only moves `total`, and a still-filling view holds
 * at the first screenful until its own timer runs out.
 *
 * `whole` opts a view out of the bargain as it arrives, for the same reason
 * the boot render is exempt: a board coming back to where it was left
 * (`useBoardScroll`) is put back at its scroll offset in the arrival commit,
 * and against the first screenful alone a deep offset would clamp. Read only
 * when `view` changes; a view already on screen is not re-chunked by it.
 */
export function useGridFill(view: string, total: number, whole = false): number {
  // One state for both facts, so a view change resets them together during
  // the render itself — an effect would be a frame late, and the whole point
  // is what the *first* commit of the new view contains.
  const [state, setState] = useState({ view, filled: true });
  const fits = whole || total <= GRID_FILL_COUNT;
  if (state.view !== view) setState({ view, filled: fits });
  const filled = state.view !== view ? fits : state.filled;

  useEffect(() => {
    if (filled) return;
    const t = window.setTimeout(
      () =>
        setState((s) =>
          // The view may have moved on while the timer ran; its own reset
          // already decided what the new one shows.
          s.view === view && !s.filled ? { view, filled: true } : s,
        ),
      GRID_FILL_AFTER_MS,
    );
    return () => window.clearTimeout(t);
  }, [view, filled]);

  return filled ? total : GRID_FILL_COUNT;
}
