import { COLD_LAMP_MS, ENTER, animates } from "./motion";

/**
 * The light comes on when you walk in (joy review #10, 2026-10-14, owner
 * approved). DESIGN.md §2c says the board you are on does not animate, and
 * that stays true of the stylesheet: no board surface carries an `animation`.
 * This is the one exception, and it is narrow on purpose: once, on the first
 * paint of the session, the lit board's lamp (its `::before`, nothing else)
 * rises from dark to its normal light over `COLD_LAMP_MS`, along ENTER. The
 * content is already on screen and nothing waits for it, it does not run
 * under reduced motion, and a board chosen afterwards simply is lit.
 *
 * It is driven from here rather than from CSS because a rule keyed on "the
 * first paint" would also fire for every board chosen while it was in force;
 * an animation started by hand starts exactly one. The three selectors are
 * the three surfaces §2c names: the strip's tab, the Trash tab beside it and
 * the drawer's row.
 */
const LIT =
  '.board-tab[aria-selected="true"], .board-trash[aria-selected="true"], .shelf-row[aria-selected="true"]';

/** How long to look for the lit board before deciding there is none to light. */
const LOOK_FRAMES = 60;

let spent = false;

export function lightUp(): void {
  if (spent) return;
  spent = true;
  let frames = 0;
  const look = () => {
    const lit = document.querySelector<HTMLElement>(LIT);
    if (lit) {
      if (animates(lit)) {
        lit.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: COLD_LAMP_MS,
          easing: ENTER,
          pseudoElement: "::before",
        });
      }
      return;
    }
    if (++frames < LOOK_FRAMES) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/** For tests only: a fresh session. */
export function forgetColdLight(): void {
  spent = false;
}
