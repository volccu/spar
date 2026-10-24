import {
  clipOfCentre,
  clipOfRect,
  BAR_FADE_IN_MS,
  CLOSE_MS,
  ENTER,
  EXIT,
  FULL_CLIP,
  OPEN_MS,
  SLIDE_IN_MS,
  VANISH_MS,
  WORDS_FADE_CLOSE_MS,
  WORDS_FADE_VANISH_MS,
  WORDS_RISE_DELAY_MS,
  WORDS_RISE_MS,
} from "./motion";

/**
 * Opening a note is a container changing shape, not a picture being blown up.
 *
 * The sheet is laid out full-screen from the first frame and stays that size
 * for the whole move — what animates is its *clip*, from the rect the card
 * occupied out to the edges of the screen. Nothing inside is ever scaled, so
 * the type is set once, at reading size, and the stretch is gone. That was the
 * whole of the old "stretchy" feel: a non-uniform scale squashing every letter
 * for 200ms and then letting go.
 *
 * The two halves are deliberately out of step. The frame arrives first on a
 * hard decelerate; the words follow it in 50ms later and rise a few pixels as
 * they fade. Motion reads as fast when the parts don't move together — one
 * thing leading and another catching up is what makes a transition feel
 * driven rather than merely long.
 */
export interface Parts {
  bar: HTMLElement | null;
  body: HTMLElement | null;
}

export function openMorph(
  sheet: HTMLElement,
  { bar, body }: Parts,
  from: DOMRect | null,
  enterFrom: -1 | 0 | 1,
) {
  if (enterFrom !== 0) {
    // A note reached by swiping has no card to grow out of, and it has a
    // neighbour to travel from rather than a mark to fade in from. Only the
    // words move — the bar is already sitting where it belongs and must stay
    // there, the same way the board's own header stays put while its deck
    // pages (useBoardPaging). Sliding the whole sheet used to carry the bar
    // sideways with it, which read as the header itself swiping away.
    return slideIn(body ?? sheet, enterFrom);
  }
  const a = sheet.animate(
    from
      ? [{ clipPath: clipOfRect(from) }, { clipPath: FULL_CLIP }]
      : // A merged note came from no card, so there is no shape to grow from.
        [{ opacity: 0 }, { opacity: 1 }],
    { duration: OPEN_MS, easing: ENTER, fill: "both" },
  );
  // The clip is a window onto a sheet that is already full size, so whatever
  // sits under the window shows through it at full size. Opening a card in the
  // top row would otherwise start on four icons filling a card-sized hole. The
  // frame arrives as blank paper; the chrome and then the words land on it.
  bar?.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: BAR_FADE_IN_MS,
    easing: ENTER,
    fill: "both",
  });
  body?.animate(
    [
      { opacity: 0, transform: "translateY(9px)" },
      { opacity: 1, transform: "translateY(0px)" },
    ],
    { duration: WORDS_RISE_MS, delay: WORDS_RISE_DELAY_MS, easing: ENTER, fill: "both" },
  );
  return a;
}

/** The half of a swipe a note plays on arrival: it comes in from the side the
 *  old one left and decelerates hard into place. Played on the body, not the
 *  sheet — see openMorph — so the bar above it never moves. */
function slideIn(el: HTMLElement, from: -1 | 1) {
  const width = window.innerWidth || 1;
  return el.animate(
    [
      { transform: `translate3d(${from * width}px, 0, 0)`, opacity: 0 },
      { transform: "translate3d(0px, 0px, 0)", opacity: 1 },
    ],
    // Backwards, not both: a filled animation outranks an inline style forever,
    // and a swipe writes an inline style. Held after it finished, this one
    // would quietly freeze the body.
    { duration: SLIDE_IN_MS, easing: ENTER, fill: "backwards" },
  );
}

/** Back into the card it came from, faster than it left — leaving is never
 *  the part you want to watch. The words go first so the frame travels empty. */
export function closeMorph(sheet: HTMLElement, parts: Parts, from: DOMRect | null) {
  fadeOut(parts, WORDS_FADE_CLOSE_MS);
  return sheet.animate(
    from
      ? [{ clipPath: FULL_CLIP }, { clipPath: clipOfRect(from) }]
      : [{ opacity: 1 }, { opacity: 0 }],
    { duration: CLOSE_MS, easing: EXIT, fill: "both" },
  );
}

function fadeOut({ bar, body }: Parts, duration: number) {
  for (const el of [bar, body]) {
    el?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration,
      easing: EXIT,
      fill: "both",
    });
  }
}

/**
 * Archived or deleted, the note does *not* go back to the grid — its card
 * isn't there any more. It collapses to the middle of the screen and into the
 * mark of whatever just happened to it, so the gesture ends on the reason.
 * The words are gone by 80ms, so what shrinks is a blank sheet of paper and
 * nothing is squashed on the way down.
 */
export function vanishMorph(sheet: HTMLElement, parts: Parts) {
  fadeOut(parts, WORDS_FADE_VANISH_MS);
  return sheet.animate(
    [
      { clipPath: FULL_CLIP, opacity: 1, offset: 0 },
      { clipPath: clipOfCentre(150), opacity: 1, offset: 0.5 },
      // Holds here, as a small square of paper with the mark alone in it. The
      // hold is what makes the mark readable; without it the note simply went.
      { clipPath: clipOfCentre(72), opacity: 1, offset: 0.72 },
      { clipPath: clipOfCentre(72), opacity: 1, offset: 0.86 },
      { clipPath: clipOfCentre(72), opacity: 0, offset: 1 },
    ],
    { duration: VANISH_MS, easing: EXIT, fill: "both" },
  );
}
