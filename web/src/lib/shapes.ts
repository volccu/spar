import type { DrawingStroke, ShapeKind } from "../types";

/*
 * A shape on a canvas is a stroke whose points are its outline (`DrawingStroke.shape`).
 * The points stay the truth: an older device, the card's miniature and the eraser all
 * read a rectangle as the five points it is drawn through, and only the sheet and the
 * picture export know to draw them straight rather than smoothed.
 */

type Point = [number, number];

/** How many points an ellipse is drawn through: enough that no facet shows on a big one. */
const ELLIPSE_STEPS = 72;
/** The arrowhead's barbs, against the shaft. */
const BARB_ANGLE = Math.PI / 6.5;

/** Closed shapes are the ones a fill can take. */
export function isClosedShape(kind: ShapeKind | undefined): boolean {
  return kind === "rect" || kind === "ellipse";
}

/** How long an arrow's barbs are: grows with the pen, never shorter than a fingertip can see. */
export function barbLength(width: number): number {
  return Math.max(14, width * 4);
}

/**
 * The outline of a shape dragged from `a` to `b`. A rectangle and an ellipse fill the box
 * the two corners make; a line and an arrow run from one to the other, the arrow pointing at
 * `b`. The outline closes on itself, so the eraser reaches every side.
 */
export function shapePoints(kind: ShapeKind, a: Point, b: Point, width: number): Point[] {
  const round = (p: Point): Point => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  if (kind === "line") return [round(a), round(b)];
  if (kind === "arrow") {
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const length = Math.min(barbLength(width), Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.6);
    const barb = (turn: number): Point => [
      b[0] - length * Math.cos(angle + turn),
      b[1] - length * Math.sin(angle + turn),
    ];
    return [a, b, barb(BARB_ANGLE), b, barb(-BARB_ANGLE)].map(round);
  }
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  const bottom = Math.max(a[1], b[1]);
  if (kind === "rect") {
    return [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]].map((p) => round(p as Point));
  }
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left) / 2;
  const ry = (bottom - top) / 2;
  const out: Point[] = [];
  for (let i = 0; i <= ELLIPSE_STEPS; i++) {
    const t = (i / ELLIPSE_STEPS) * Math.PI * 2;
    out.push(round([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]));
  }
  return out;
}

/**
 * Where the dragging corner really lands. Shift makes the box square (so a circle) and a
 * line step in eighths of a turn. A finger has no Shift, so a line or arrow within a few
 * degrees of level, upright or diagonal settles onto it by itself — a hand-held drag is
 * never exactly level, and that is almost always what it meant.
 */
export function constrainShape(kind: ShapeKind, a: Point, b: Point, shift: boolean): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (kind === "line" || kind === "arrow") {
    const length = Math.hypot(dx, dy);
    if (length === 0) return b;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const nearest = Math.round(angle / step) * step;
    const settle = shift || Math.abs(angle - nearest) < (4 * Math.PI) / 180;
    if (!settle) return b;
    return [a[0] + length * Math.cos(nearest), a[1] + length * Math.sin(nearest)];
  }
  if (!shift) return b;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + side * Math.sign(dx || 1), a[1] + side * Math.sign(dy || 1)];
}

/** A shape stroke ready to store. `fill` only rides on a closed shape. */
export function shapeStroke(
  id: string,
  kind: ShapeKind,
  a: Point,
  b: Point,
  pen: { color: string; width: number; fill: boolean },
): DrawingStroke {
  const stroke: DrawingStroke = { id, points: shapePoints(kind, a, b, pen.width), color: pen.color, width: pen.width, shape: kind };
  if (pen.fill && isClosedShape(kind)) stroke.fill = true;
  return stroke;
}

/** Too small to have meant anything: a tap with the shape tool, not a drag. */
export function tooSmall(a: Point, b: Point, zoom: number): boolean {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * zoom < 6;
}
