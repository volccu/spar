import { useEffect, useState } from "react";

/**
 * What the device is, as a question React can answer.
 *
 * Two of those questions are asked in this app and both are media queries:
 * *is this a phone-width window* and *does this machine have a hardware
 * keyboard* (`lib/hotkeys.ts`, which owns the second one and reaches it
 * through the two helpers here). The stylesheet answers nearly everything
 * about shape by itself and should go on doing so; what lives here is the
 * handful of cases CSS cannot do honestly.
 *
 * The board shelf is the reason the width question exists in JS at all: it is
 * a horizontal tab strip on a desktop and a drawer behind a burger on a phone,
 * and those are two *different structures*, not one structure laid out twice.
 * (The desktop can open the same drawer too, from a burger at the strip's left
 * end; what the branch decides is whether the strip is built at all, and
 * whether the drawer's rows are the ones carrying the tab ids.)
 * Rendering both and hiding one with `display: none` would put two elements
 * carrying the same `id`, and two `role="tab"` sets naming the same panel, into
 * the accessibility tree at once — hidden to the eye, present to a screen
 * reader, and duplicate ids are simply invalid. So the branch is made here, in
 * JS, and only one of the two is ever built.
 *
 * (For a few days this file held nothing but the number, because the shelf was
 * one full-screen page at every width. The strip is back on desktop, where a
 * wide window shows the whole shelf in one row and a page over the grid is a
 * detour, and the drawer is back on a phone — so the branch is back with them.)
 *
 * `matchMedia` is the right instrument and is not always there: jsdom (which
 * the test suite runs in) has no implementation of it at all, which is why
 * `lib/motion.ts` guards its own call the same way. Every caller therefore
 * hands in what to answer where the question cannot be put — see
 * `matchesMedia`.
 */

/**
 * The phone breakpoint, in pixels. **This must equal the `@media (max-width:
 * 699px)` / `@media (min-width: 700px)` pair in `styles.css`** — the layout and
 * the structure have to change at the same pixel, or there is a band of widths
 * showing a burger with no drawer styling behind it, or a tab strip with the
 * phone's rules on it. `breakpoint.test.ts` checks the two agree.
 */
export const PHONE_MAX = 699;

const QUERY = `(max-width: ${PHONE_MAX}px)`;

/**
 * Read one media query now, however this browser is willing to be asked.
 *
 * `unasked` is what to answer where the question cannot be put at all — no
 * `window`, or a `window` with no `matchMedia` on it, which is every test in
 * the suite. It is a function rather than a value because a fallback is
 * sometimes a *measurement* (the viewport's own width), and measuring the
 * window before the window has been checked for is how a fallback throws.
 * It is also not always the same answer for the same query: the two callers
 * asking about a keyboard want opposite things when nobody will answer, and
 * both are right — see `hasKeyboard`.
 */
export function matchesMedia(query: string, unasked: () => boolean): boolean {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia(query).matches;
  }
  return unasked();
}

/**
 * The same query, held as state that follows the device.
 *
 * One hook, because there were two — the width one here and a line-for-line
 * copy of it in `lib/hotkeys.ts` with the query string swapped. Written twice
 * they drift, which is the same reason `markerOf` and `isLinkNote` are each
 * the only definition of themselves.
 *
 * `read` is the read-now function for this query and must be a stable
 * identity — a module-level function, never an arrow written at the call
 * site — or the subscription is torn down and rebuilt on every render.
 *
 * The resize listener is registered **only** where there is no `matchMedia`
 * to change. That is the one case a fallback is doing the answering, and a
 * fallback is either a constant (nothing to re-read) or a measurement of the
 * window (which resize is exactly the event for). A real browser has the
 * `change` event and needs no second instrument firing sixty times a second
 * through a window drag.
 */
export function useMediaQuery(query: string, read: () => boolean): boolean {
  const [on, setOn] = useState(read);

  useEffect(() => {
    const again = () => setOn(read());
    // Re-read on mount: the first render may have happened before layout, and
    // a value read then is a guess this corrects without a flash of the wrong
    // shelf, since it runs before the browser paints anything the user acts on.
    again();

    // `addEventListener` on a MediaQueryList is the modern spelling and the
    // only one this app needs.
    const mql =
      typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
    mql?.addEventListener?.("change", again);
    if (!mql) window.addEventListener("resize", again);
    return () => {
      mql?.removeEventListener?.("change", again);
      if (!mql) window.removeEventListener("resize", again);
    };
  }, [query, read]);

  return on;
}

/** Read the viewport now, however this browser is willing to be asked. */
export function isPhoneWidth(): boolean {
  return matchesMedia(
    QUERY,
    () => typeof window !== "undefined" && window.innerWidth <= PHONE_MAX,
  );
}

export function useIsPhone(): boolean {
  return useMediaQuery(QUERY, isPhoneWidth);
}

/**
 * The short-screen height, in pixels: a phone on its side, a 200% zoom. **This
 * must equal the `@media (max-height: 500px)` block in `styles.css`**, where
 * the header band folds away and its creature rides in the board row's left
 * cell (`breakpoint.test.ts` checks the two agree).
 *
 * Asked in JS for one reason: the phone's board row may stand at the foot
 * (the `boardRow` setting), and that is a change of *structure* — the row is
 * rendered after the grid, so the reading and Tab order follow the screen —
 * which a short screen refuses, because the folded header has nowhere to
 * stand but that row's left cell at the top.
 */
export const SHORT_MAX = 500;

const SHORT_QUERY = `(max-height: ${SHORT_MAX}px)`;

function isShortHeight(): boolean {
  return matchesMedia(
    SHORT_QUERY,
    () => typeof window !== "undefined" && window.innerHeight <= SHORT_MAX,
  );
}

export function useIsShort(): boolean {
  return useMediaQuery(SHORT_QUERY, isShortHeight);
}
