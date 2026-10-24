import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { caretPoint } from "./caret";
import {
  LAMP_BREATH_MS,
  LAMP_DIM_MS,
  LAMP_DWELL_MS,
  LAMP_FADE_MS,
  LAMP_FLICKER_MS,
  LAMP_FOLLOW_MS,
} from "./motion";

/**
 * The five durations the lamp's stylesheet rules read, handed to the element
 * as inline custom properties rather than written in the stylesheet, so
 * `lib/motion.ts` stays the only copy of each (`styles.test.ts` holds the
 * stylesheet to one duration property of its own).
 */
export const LAMP_STYLE = {
  "--lamp-follow": `${LAMP_FOLLOW_MS}ms`,
  "--lamp-fade": `${LAMP_FADE_MS}ms`,
  "--lamp-dim": `${LAMP_DIM_MS}ms`,
  "--lamp-breath": `${LAMP_BREATH_MS}ms`,
  "--lamp-flicker": `${LAMP_FLICKER_MS}ms`,
} as CSSProperties;

/**
 * The lamp: a pool of light under the caret of a write surface, showing the
 * paper's own grain where it falls (DESIGN.md §2c; `.capture-lamp` and
 * `.editor-lamp` in styles.css). Everything about how it *looks* is in the
 * stylesheet; the only thing that cannot be is where the caret is, which no
 * textarea will tell you and which is therefore measured in a hidden mirror
 * of the field (`lib/caret.ts`).
 *
 * The position is written straight onto the element rather than held in
 * state: it moves on every keystroke and every click, and a re-render per
 * character to move a background is the sort of thing that turns a 50ms
 * write into a 60ms one. The light stays up while the field is being used
 * and settles after a pause (`LAMP_DWELL_MS`): each stroke or caret move
 * restarts the countdown, when it runs out the caller's element carries
 * `data-lamp-idle` and the stylesheet fades the pool away, and the next
 * activity brings it straight back.
 *
 * The capture bar and the editor each carried all of this, line for line.
 * What stays with each caller is the layout effect that re-measures after
 * the field has grown: it has to be declared *after* the caller's own grow
 * effect, because React runs layout effects in the order they are written,
 * and a pool measured before the field grew is measured against the wrong
 * box.
 */
export function useLamp(field: RefObject<HTMLTextAreaElement | null>) {
  const lampRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);

  const moveLamp = useCallback(() => {
    const pool = lampRef.current;
    const glass = mirrorRef.current;
    const el = field.current;
    if (!pool || !glass || !el) return;
    const { x, y } = caretPoint(el, glass);
    pool.style.setProperty("--lamp-x", `${x.toFixed(1)}px`);
    pool.style.setProperty("--lamp-y", `${y.toFixed(1)}px`);
  }, [field]);

  const dwell = useRef<number | null>(null);
  const [lampIdle, setLampIdle] = useState(false);
  const wakeLamp = useCallback(() => {
    setLampIdle(false);
    if (dwell.current !== null) window.clearTimeout(dwell.current);
    dwell.current = window.setTimeout(() => setLampIdle(true), LAMP_DWELL_MS);
  }, []);

  /** The light follows the caret, and any activity restarts its countdown. */
  const lampMoved = useCallback(() => {
    moveLamp();
    wakeLamp();
  }, [moveLamp, wakeLamp]);

  useEffect(() => {
    return () => {
      if (dwell.current !== null) window.clearTimeout(dwell.current);
    };
  }, []);

  return { lampRef, mirrorRef, lampIdle, moveLamp, wakeLamp, lampMoved };
}
