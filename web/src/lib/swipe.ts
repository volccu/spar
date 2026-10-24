import { animates, ENTER, SETTLE_BACK_MS } from "./motion";

/**
 * The decisions every sideways swipe on a touch screen makes, made in one place.
 *
 * Board paging (`useBoardPaging`), the open note's swipe (`useNoteSwiping`) and
 * the Sorter and Ticker (`useModeLayer`) each carried their own copy of these
 * numbers, which is how one of them gets retuned and the other two go on
 * feeling different under the same thumb. The Lightbox is left out on purpose:
 * it reads pointers rather than touches, and its axis lock waits until a finger
 * is *past* ten pixels rather than at them.
 */

/** How far a swipe has to travel before it counts as one rather than a tap —
 *  a thumb resting on a note it is reading must not step off it. */
const SWIPE_MIN = 60;

/** Where a finger went down, and which way it has since been decided to be going. */
export interface SwipeStart {
  x: number;
  y: number;
  axis: "?" | "x" | "y";
}

/**
 * Which way a touch that has moved `dx`, `dy` is going: `"?"` inside its first
 * ten pixels, then sideways only when it is clearly more across than down.
 * Callers decide once and stay decided — a surface that shifts sideways while
 * you are scrolling it is unusable.
 */
export function axisOf(dx: number, dy: number): SwipeStart["axis"] {
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return "?";
  return Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
}

/** Whether a lifted finger went far enough, and flat enough, to be a swipe.
 *  A mostly vertical drag is reading, not stepping off. */
export function isSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) >= Math.abs(dy) * 1.5;
}

/** Lets go of the finger: whatever it was dragging lands back where it started. */
export function settleBack(el: HTMLElement | null) {
  if (!el) return;
  const held = el.style.transform;
  el.style.transform = "";
  if (!held || !animates(el)) return;
  el.animate([{ transform: held }, { transform: "translate3d(0px, 0px, 0)" }], {
    duration: SETTLE_BACK_MS,
    easing: ENTER,
  });
}

/* --- a card carried by the finger -------------------------------------------
   The Sorter answers a swipe, and an answer made on release alone was a guess
   about a thing the hand could not see: the note did not move, nothing said
   which way it was going, and there was no way to change your mind halfway
   (review 2026-10-01, UX-08). A mode that spends the swipe on a decision now
   carries its card with the finger, tilted a little, with the word for what
   letting go would do standing in its corner — and letting go short of the
   line puts it back. */

/** How far a card carried by a mode's swipe has to be taken before letting go
 *  decides. A little more than a tap-sized `SWIPE_MIN`, because here the
 *  release is a verdict and the card is plainly in hand; a fifth of the screen
 *  on a phone, never more than 110px on a wide one. */
export function commitDistance(width: number): number {
  return Math.min(110, Math.max(SWIPE_MIN, width * 0.2));
}

/** Whether a lifted finger took the card past the line, flat enough to mean it. */
export function commits(dx: number, dy: number, width: number): boolean {
  return Math.abs(dx) >= commitDistance(width) && Math.abs(dx) >= Math.abs(dy) * 1.5;
}

/** How far back under the line a card has to be brought before it is once more
 *  short of it: a finger held on the line trembles, and every tremor must not
 *  tick. */
const RE_ARM = 8;

/**
 * Whether a card carried `dx`, `dy` is past the line where letting go decides,
 * given whether it was a moment ago (joy review 2026-10-14, #6). Past, it is the
 * same question `commits` asks on release; once past, it stays past until the
 * card is a few pixels back under the line, so the one tick a crossing makes
 * cannot be repeated by a hand that is only resting there.
 */
export function pastTheLine(was: boolean, dx: number, dy: number, width: number): boolean {
  if (commits(dx, dy, width)) return true;
  if (!was) return false;
  return Math.abs(dx) >= commitDistance(width) - RE_ARM && Math.abs(dx) >= Math.abs(dy) * 1.5;
}

/** The most the card leans, in degrees — "a little", never a spin. */
export const TILT_MAX = 8;

/** Where a card carried `dx` pixels sits, and how plainly its word is drawn. */
export interface DragPose {
  /** The card's own offset: it follows the finger one for one. */
  x: number;
  /** Degrees of lean, with the finger's direction. */
  tilt: number;
  /** 0 to 1: nothing for the first few pixels, then the word comes up, and it
   *  is whole exactly where letting go would decide. */
  cue: number;
}

/** The first pixels of a drag say nothing: a thumb resting on a note moves. */
const CUE_FROM = 12;

export function dragPose(dx: number, width: number): DragPose {
  const w = width || 1;
  const x = Math.max(-w, Math.min(w, dx));
  const tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, (dx / w) * 16));
  const span = Math.max(1, commitDistance(w) - CUE_FROM);
  const cue = Math.max(0, Math.min(1, (Math.abs(dx) - CUE_FROM) / span));
  return { x, tilt, cue };
}
