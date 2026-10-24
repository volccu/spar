import { clampZoom } from "./canvas";

/*
 * Kept out of `lib/canvas.ts` on purpose: that module rides on the first
 * paint (the board draws ideas' snapshots from it), and this is read only by
 * the canvas sheet, which is its own chunk loaded when an idea opens.
 */
/**
 * The zoom and scroll that show a whole arrangement at once, or `null` when it
 * already fits at 100% and nothing needs to change.
 *
 * For a merge that has just been made (review 2026-10-01, UX-26): on a phone
 * the second of two notes stood half off the screen's edge, and someone who
 * asked for "these two as one" was shown one and a half cards and had to pan
 * for the rest. `box` is what the notes cover, in the "scroll-space at zoom 1"
 * coordinates `anchorScroll` uses; `view` is the canvas's own size on screen;
 * `edge` the air left round it, and `top` the room kept clear above it — the
 * line a fresh merge opens with hangs over the canvas's top. It only ever
 * zooms **out** — a small merge on a
 * big screen keeps its 100% — and never past `MIN_ZOOM`, past which a long
 * idea is simply shown from its top. Centred across, from the top down.
 *
 * `floor` raises that limit for a screen where text must stay readable: past it
 * the notes are shown at the floor from their left edge, and the rest is a pan
 * away (a phone showing three notes at 44% drew them in 7px type).
 */
export function fitView(
  box: { x: number; y: number; w: number; h: number },
  view: { w: number; h: number },
  edge: number,
  top = edge,
  floor = 0,
): { zoom: number; left: number; top: number } | null {
  if (box.w <= 0 || box.h <= 0 || view.w <= 0 || view.h <= 0) return null;
  const want = Math.min((view.w - 2 * edge) / box.w, (view.h - top - edge) / box.h);
  if (want >= 1) return null;
  const zoom = clampZoom(Math.max(want, floor));
  return {
    zoom,
    left: want < floor ? box.x * zoom - edge : (box.x + box.w / 2) * zoom - view.w / 2,
    top: box.y * zoom - top,
  };
}
