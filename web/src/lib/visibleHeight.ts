import { useEffect, type RefObject } from "react";

/**
 * The custom property `useVisibleHeight` writes — the height of the part of
 * the screen that can actually be seen, in px.
 */
export const VISIBLE_H = "--visible-h";

/**
 * Writes the visible viewport's height onto an element, as `--visible-h`, and
 * keeps it current.
 *
 * `100dvh` is the obvious instrument and it answers a different question. On
 * a phone the screen keyboard takes roughly half the screen, and whether the
 * *layout* viewport shrinks to make room for it is the browser's choice:
 * Chrome's default since 108 is to leave it alone and shrink only the visual
 * viewport, so `dvh` goes on reporting the whole screen while half of it is
 * keys. A cap written in `dvh` is then a cap measured against space nobody can
 * see. `visualViewport.height` is the height of what is on the glass whichever
 * way the browser went, so this is the one number a "take no more than this
 * much of the screen" rule can honestly be written against.
 *
 * Written straight onto the element's style rather than through React state:
 * the keyboard animates in, and a re-render per resize frame buys nothing a
 * custom property does not already do. Where there is no visual viewport at
 * all — jsdom, and so every test — nothing is written, and the stylesheet's
 * own fallback (`var(--visible-h, 100dvh)`) answers instead.
 */
export function useVisibleHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!el || !vv) return;
    const put = () => el.style.setProperty(VISIBLE_H, `${Math.round(vv.height)}px`);
    put();
    vv.addEventListener("resize", put);
    return () => vv.removeEventListener("resize", put);
  }, [ref]);
}
