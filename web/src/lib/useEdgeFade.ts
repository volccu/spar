import { useEffect, type RefObject } from "react";

/**
 * Whether a horizontally scrolling strip has more past either edge, written
 * straight onto the node as `data-fade-left` / `data-fade-right` so a mask
 * rule in `styles.css` can fade the cut edge open.
 *
 * Written onto the DOM rather than through React state on purpose: this runs
 * on every scroll frame while a finger drags the strip, and a state update per
 * frame would re-render the whole panel for something two attribute selectors
 * answer on their own. The tab strip in `App.tsx` (`updateBoardsFade`) does
 * the same thing by hand; this is that logic for a strip that owns its own
 * node. Read on mount, on scroll, on resize, and whenever `deps` change — a
 * row added or removed changes how much there is to fit.
 *
 * A strip that fits is left with both attributes `"false"`, so the mask rule
 * draws nothing and the strip is exactly what it was before the fade existed.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.dataset.fadeLeft = el.scrollLeft > 1 ? "true" : "false";
      el.dataset.fadeRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ? "true" : "false";
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}
