import { useLayoutEffect, useRef, useState } from "react";
import { COUNT_ROLL_MS, ENTER, animates, finishOnce, stopAnimations } from "../lib/motion";

/**
 * A count that turns like the frame counter on a film camera (joy review #1,
 * 2026-10-14, owner approved).
 *
 * When the number changes, only the digits that differ move: the old one slides
 * up out of a one-digit window, the new one rises in behind it. The window is a
 * clip, never a scale. Everything that is not a change of number is plain text:
 * the first paint, a count that simply appears because its row was mounted,
 * `still` (the app is still reading its notes), reduced motion, and a change in
 * the words after the number ("3 selected" to "2 found").
 *
 * The count's text is what a screen reader and a test read: the old digits are
 * `aria-hidden` and the whole move is gone again after `COUNT_ROLL_MS`, back to
 * one text node. A mono face keeps every digit one `ch` wide, so the roll never
 * moves a neighbour.
 */

export interface Roll {
  from: string;
  to: string;
  rest: string;
}

/** The leading figure and what follows it ("12", " found"). */
function parts(text: string): [string, string] {
  const m = /^(\d+)([\s\S]*)$/.exec(text);
  return m ? [m[1], m[2]] : ["", text];
}

/** "reminder" and "reminders" are the same words, one more or one less. */
const words = (rest: string) => rest.replace(/s$/, "");

/** What rolls between two texts, or null when it is not one number turning. */
export function rollOf(was: string, now: string): Roll | null {
  const [a, aRest] = parts(was);
  const [b, bRest] = parts(now);
  if (!a || !b || a === b || words(aRest) !== words(bRest)) return null;
  return { from: a, to: b, rest: bRest };
}

const BLANK = " ";

export function Count({
  text,
  className,
  still = false,
}: {
  text: string | number;
  className?: string;
  /** Changes are absorbed silently while true (the notes are still loading). */
  still?: boolean;
}) {
  const shown = String(text);
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(shown);
  const stillBefore = useRef(still);
  const [roll, setRoll] = useState<Roll | null>(null);

  // Decided before paint, so the plain text never shows for a frame first.
  useLayoutEffect(() => {
    const was = last.current;
    last.current = shown;
    // `still` ending in the very render that carries the first real number is
    // still the app arriving, not a count changing.
    const held = still || stillBefore.current;
    stillBefore.current = still;
    if (was === shown) return;
    const next = held ? null : rollOf(was, shown);
    setRoll(next && animates(ref.current) ? next : null);
  }, [shown, still]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!roll || !el) return;
    const cancels: (() => void)[] = [];
    for (const slot of el.querySelectorAll<HTMLElement>("[data-roll]")) {
      const old = slot.firstElementChild as HTMLElement;
      const fresh = slot.lastElementChild as HTMLElement;
      const opts = { duration: COUNT_ROLL_MS, easing: ENTER };
      old.animate(
        [{ transform: "translateY(0%)" }, { transform: "translateY(-100%)" }],
        { ...opts, fill: "forwards" },
      );
      const move = fresh.animate(
        [{ transform: "translateY(100%)" }, { transform: "translateY(0%)" }],
        { ...opts, fill: "backwards" },
      );
      cancels.push(finishOnce(move, () => setRoll(null), COUNT_ROLL_MS + 150));
    }
    return () => {
      for (const c of cancels) c();
      for (const d of el.querySelectorAll("[data-roll] > *")) stopAnimations(d);
    };
  }, [roll]);

  if (!roll) {
    return (
      <span ref={ref} className={className}>
        {shown}
      </span>
    );
  }
  const width = Math.max(roll.from.length, roll.to.length);
  const from = roll.from.padStart(width, BLANK);
  const to = roll.to.padStart(width, BLANK);
  return (
    <span ref={ref} className={className}>
      {[...to].map((digit, i) => {
        const blank = digit === BLANK;
        if (from[i] === digit) {
          return (
            <span key={i} className="roll-d" aria-hidden={blank || undefined}>
              {digit}
            </span>
          );
        }
        return (
          <span key={i} className="roll-d" data-roll>
            <span className="roll-old" aria-hidden="true">
              {from[i]}
            </span>
            <span aria-hidden={blank || undefined}>{digit}</span>
          </span>
        );
      })}
      {roll.rest}
    </span>
  );
}
