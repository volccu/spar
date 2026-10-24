import type { CSSProperties } from "react";
import { isPhoneWidth } from "./breakpoint";
import { hasKeyboard } from "./hotkeys";

/** How close a panel opened at the pointer may come to an edge it stops at. */
export const ANCHOR_EDGE = 8;

/**
 * Where a panel opened at the pointer stands — the selection's verbs on a
 * desktop right-click (review 2026-10-01, UX-11).
 *
 * Across, it grows away from the pointer into whichever half of the window has
 * more room: rightwards from a pointer in the left half, leftwards from one in
 * the right half. Down, it hangs from the pointer, and `keepAbove` lifts it
 * once it has been drawn and can be measured — a desktop's own context menu
 * does the same. All four sides are stated, because the panel's own class
 * anchors it to the bottom-right corner and a side left unsaid would keep it.
 */
export function pointerAnchor(
  at: { x: number; y: number },
  view: { width: number; height: number },
): CSSProperties {
  const leftHalf = at.x < view.width / 2;
  return {
    left: leftHalf ? at.x : "auto",
    right: leftHalf ? "auto" : view.width - at.x,
    top: at.y,
    bottom: "auto",
    maxHeight: view.height - 2 * ANCHOR_EDGE,
    overflowY: "auto",
  };
}

/**
 * The top a panel of `height` hanging from `top` should take so that it ends
 * above `floor` (the capture bar's top edge) — lifted only as far as it has
 * to be, and never above the window's own top.
 */
export function keepAbove(top: number, height: number, floor: number): number {
  if (top + height <= floor - ANCHOR_EDGE) return top;
  return Math.max(ANCHOR_EDGE, floor - ANCHOR_EDGE - height);
}

/**
 * The left a panel already drawn at `left`, `width` wide, should take so that
 * it stays inside a window `view` wide — or null when it already does. Opened
 * from a pointer just right of the middle of a narrow window, a panel growing
 * leftwards is wider than the room it has and stood off the left edge (UX
 * review 2026-10-18); a desktop's own menu slides back in, and so does this.
 */
export function insideLeft(left: number, width: number, view: number): number | null {
  const most = view - ANCHOR_EDGE - width;
  if (left >= ANCHOR_EDGE && left <= most) return null;
  return Math.max(ANCHOR_EDGE, Math.min(left, most));
}

/** Sets a measured panel's left with `insideLeft`, dropping its right anchor. */
export function slideInside(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const left = insideLeft(rect.left, rect.width, window.innerWidth);
  if (left === null) return;
  el.style.left = `${left}px`;
  el.style.right = "auto";
}

/** A control's foot, which is where a panel about it hangs from. */
export interface UnderAnchor {
  left: number;
  top: number;
}

/**
 * Where a panel hung under the control it is about stands: a folder's menu
 * under its tab on the desktop strip (review UI-15), and with a mouse the open
 * note's reminder panel under its line and Move chooser under its button
 * (review UI-A-03). Its left edge at the control's, its top at the control's
 * foot. `--panel-top` is what lets `.selpanel-under` stop it at the foot of
 * the glass, so a panel hung low on a short window scrolls inside itself.
 */
export function hangUnder(anchor: UnderAnchor): CSSProperties {
  return {
    left: anchor.left,
    top: anchor.top,
    ["--panel-top" as string]: `${anchor.top}px`,
  } as CSSProperties;
}

/**
 * A hung panel near the right end of the window would run off it: pulled back
 * in by its own width, measured once it is drawn. Nothing measured (a test,
 * which has no layout) leaves it where it was hung.
 */
export function keepInside(el: HTMLElement, anchor: UnderAnchor): void {
  const over = el.getBoundingClientRect().right - window.innerWidth;
  if (over > 0) el.style.left = `${Math.max(0, anchor.left - over)}px`;
}

/** The foot of a control, as the anchor a panel about it hangs from. */
export function underOf(el: Element | null): UnderAnchor | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.bottom };
}

/**
 * Where a panel opened from a mark in the open note's bar hangs: under the
 * mark with a mouse, and nowhere (the corner, above the bar) otherwise.
 *
 * **Not at phone width, whatever the pointer.** There the marks stand in the
 * bar at the foot of the glass (`.sheet-marks`), so a panel hung from the foot
 * of one has no room under it — a half-snapped desktop window with a mouse
 * opened the Insert menu with its top at the bottom edge and no height. The
 * panels that stand in the corner are the ones the stylesheet lifts over that
 * bar, and `selpanel-under` is the class that skips the lift.
 */
export function hangFrom(el: Element | null): UnderAnchor | undefined {
  return hasKeyboard(false) && !isPhoneWidth() ? underOf(el) : undefined;
}
