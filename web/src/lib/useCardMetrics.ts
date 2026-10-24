import { useCallback, useLayoutEffect, useState } from "react";
import { CARD_METRICS, type CardMetrics } from "./face";

/**
 * How much text a card can hold, measured from the card rather than guessed.
 *
 * Two hardcoded numbers were never going to work: a desktop column is anywhere
 * from 246px to 323px wide depending on how many fit, and a value tuned for one
 * end spills over at the other. So this reads the real width off a rendered
 * card and the line count out of CSS, and derives the budget from those.
 *
 * Nothing here duplicates the grid's column maths — it asks the browser what
 * actually happened.
 */

import { AVG_CHAR_PX } from "./metrics";

/**
 * Lines break on words, so a line never fills its width — and a note of many
 * short lines wraps every one of them. Sizing to the raw average left a third
 * of the archive spilling past its clamp.
 *
 * Measured over all 98 active notes at five window widths (390 / 700 / 820 /
 * 1280 / 1920): at 0.85, nothing overflows on desktop at any width, four
 * phone cards run over by 17px — less than one line, so the clamp swallows it
 * whole and the cut still lands on a baseline — and a truncated card leaves
 * about half a line unused. Lower is safer but visibly wasteful; higher spills
 * a full line on narrow desktop columns.
 */
const FILL = 0.85;

export function useCardMetrics(
  grid: HTMLElement | null,
  /**
   * Names the shape currently on screen. A change to it re-measures.
   *
   * The grid element survives a change of board, and so did the measurement:
   * the ResizeObserver below only fires when the *grid* changes size, which
   * paging never does on a phone. That was harmless while every board drew the
   * same card, and stopped being harmless the moment the Links board started
   * drawing full-width rows — a row's words are more than twice as wide as a
   * column's, so a board switch either way left every face cut to the shape
   * that had just left the screen.
   */
  view: string,
): CardMetrics {
  const [metrics, setMetrics] = useState<CardMetrics>(CARD_METRICS);

  const measure = useCallback(() => {
    if (!grid) return;
    const body = grid.querySelector<HTMLElement>(".card-body, .check-list");
    if (!body) return;

    const width = body.getBoundingClientRect().width;
    if (width < 40) return;

    // The line count belongs to CSS, which is what actually clamps the card.
    const declared = getComputedStyle(document.documentElement)
      .getPropertyValue("--card-lines")
      .trim();
    const lines = Number.parseInt(declared, 10);

    const next: CardMetrics = {
      lines: Number.isFinite(lines) && lines > 0 ? lines : CARD_METRICS.lines,
      charsPerLine: Math.max(8, Math.floor((width / AVG_CHAR_PX) * FILL)),
    };

    setMetrics((prev) =>
      prev.lines === next.lines && prev.charsPerLine === next.charsPerLine ? prev : next,
    );
  }, [grid]);

  // Before paint: the first frame should already be cut to the right length.
  useLayoutEffect(() => {
    measure();
    if (!grid || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [grid, measure, view]);

  return metrics;
}
