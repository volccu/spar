/*
 * Hold-to-snap: draw a rough line, oval or box, rest the pen, and it becomes the clean one
 * (`lib/shapes.ts` draws it). The recogniser is deliberately timid. A wrong guess ruins a
 * word someone was writing, a missed one costs a second stroke, so anything that is not
 * plainly one of the three comes back `null`: letters, scribbles, spirals, triangles, an
 * open "U". The caller owns the timer and the undo; this file only looks at the points.
 */

type Point = [number, number];

/** How long the pen must rest before the stroke is offered as a shape. */
export const SNAP_HOLD_MS = 500;
/** Screen pixels the pointer may wander and still count as resting. */
export const SNAP_STILL_PX = 6;

export type SnapKind = "line" | "ellipse" | "rect";

export interface Snap {
  kind: SnapKind;
  /** A line's start; a rectangle's or ellipse's top-left corner. */
  from: Point;
  /** A line's end; a rectangle's or ellipse's bottom-right corner. */
  to: Point;
}

const MIN_POINTS = 6;
const MIN_LENGTH = 24;
/** Where the hold's jitter ends and the stroke begins: points this close to the last one are the rest. */
const TAIL_PX = SNAP_STILL_PX * 1.5;
/** Every stroke is measured as this many equal steps, so a slow, dense stretch weighs no more than a quick one. */
const SAMPLES = 64;

const LINE_STRAIGHTNESS = 0.92;
/** A line may bow this much of its length (but never less than `LINE_SLACK_PX`, so a short line survives a shaky hand). */
const LINE_BOW = 0.07;
const LINE_SLACK_PX = 3;

/** A loop is closed when its ends meet within this, or a quarter of its larger side. */
const CLOSE_PX = 20;
const CLOSE_FRACTION = 0.25;
/** Thinner than this and a "box" is a line drawn out and back. */
const MIN_SIDE = 10;
/** One full turn, give or take an overshoot at the closure; a figure 8 turns none, a spiral two. */
const TURN_MIN = Math.PI * 1.5;
const TURN_MAX = Math.PI * 2.6;
/** Mean misfit, as a share of the box's average side, under which a loop counts as that shape. */
const FIT_MAX = 0.06;
/** A rectangle must be drawn along every side, not just touch the box at a few places. */
const SIDE_BINS = 8;
const SIDE_BINS_NEEDED = 6;
/** An ellipse must go all the way round. */
const ANGLE_BINS = 12;
const ANGLE_BINS_NEEDED = 11;

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** The stroke without the pen's rest at the end. */
function withoutRest(points: Point[]): Point[] {
  const last = points[points.length - 1];
  let end = points.length;
  while (end > 1 && distance(points[end - 1], last) <= TAIL_PX) end--;
  // One point of the rest stays, so the stroke still ends where the pen came to a stop.
  return points.slice(0, Math.min(points.length, end + 1));
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** `SAMPLES + 1` points an equal distance apart along the path. */
function resample(points: Point[], length: number): Point[] {
  const out: Point[] = [points[0]];
  const step = length / SAMPLES;
  let segment = 1;
  let walked = 0;
  for (let k = 1; k < SAMPLES; k++) {
    const target = k * step;
    while (segment < points.length - 1 && walked + distance(points[segment - 1], points[segment]) < target) {
      walked += distance(points[segment - 1], points[segment]);
      segment++;
    }
    const a = points[segment - 1];
    const b = points[segment];
    const run = distance(a, b);
    const t = run === 0 ? 0 : Math.min(1, Math.max(0, (target - walked) / run));
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** A three-point average, ends kept where they are: it takes the shake out without rounding a corner much. */
function smooth(points: Point[]): Point[] {
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const a = points[i - 1];
    const b = points[i + 1];
    return [(a[0] + p[0] + b[0]) / 3, (a[1] + p[1] + b[1]) / 3] as Point;
  });
}

/** How far the path turns in all, in radians, counting a left turn one way and a right turn the other. */
function totalTurn(points: Point[]): number {
  let turn = 0;
  let previous: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    if (dx === 0 && dy === 0) continue;
    const heading = Math.atan2(dy, dx);
    if (previous !== null) {
      let change = heading - previous;
      while (change > Math.PI) change -= Math.PI * 2;
      while (change <= -Math.PI) change += Math.PI * 2;
      turn += change;
    }
    previous = heading;
  }
  return turn;
}

/** Which way the path faces, read over a few steps so one shaky sample does not decide it. */
function headingOver(from: Point, to: Point): number {
  return Math.atan2(to[1] - from[1], to[0] - from[0]);
}

/**
 * The turn of a path that comes back to where it began, counting the bend where the ends join:
 * a box begun at a corner has only three bends along the way and the fourth is the join.
 */
function loopTurn(points: Point[]): number {
  const reach = 4;
  const last = points.length - 1;
  let join = headingOver(points[0], points[reach]) - headingOver(points[last - reach], points[last]);
  while (join > Math.PI) join -= Math.PI * 2;
  while (join <= -Math.PI) join += Math.PI * 2;
  return totalTurn(points) + join;
}

/** The farthest any point strays from the straight line through the two ends. */
function maxBow(points: Point[]): number {
  const a = points[0];
  const b = points[points.length - 1];
  const chord = distance(a, b);
  if (chord === 0) return Infinity;
  let worst = 0;
  for (const p of points) {
    const off = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / chord;
    if (off > worst) worst = off;
  }
  return worst;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function ellipseMisfit(points: Point[], box: Box): number {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const rx = (box.right - box.left) / 2;
  const ry = (box.bottom - box.top) / 2;
  const bins = new Set<number>();
  let sum = 0;
  for (const [x, y] of points) {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    sum += Math.abs(Math.hypot(nx, ny) - 1);
    const turns = (Math.atan2(ny, nx) + Math.PI) / (Math.PI * 2);
    bins.add(Math.min(ANGLE_BINS - 1, Math.floor(turns * ANGLE_BINS)));
  }
  if (bins.size < ANGLE_BINS_NEEDED) return Infinity;
  // Mean |r - 1| in units of the radius; the box's average side is two radii.
  return sum / points.length / 2;
}

function rectMisfit(points: Point[], box: Box): number {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const tolerance = ((w + h) / 2) * 0.1;
  const covered = { top: new Set<number>(), bottom: new Set<number>(), left: new Set<number>(), right: new Set<number>() };
  const bin = (along: number, length: number) => Math.min(SIDE_BINS - 1, Math.max(0, Math.floor((along / length) * SIDE_BINS)));
  let sum = 0;
  for (const [x, y] of points) {
    const dTop = Math.abs(y - box.top);
    const dBottom = Math.abs(y - box.bottom);
    const dLeft = Math.abs(x - box.left);
    const dRight = Math.abs(x - box.right);
    sum += Math.min(dTop, dBottom, dLeft, dRight);
    if (dTop <= tolerance) covered.top.add(bin(x - box.left, w));
    if (dBottom <= tolerance) covered.bottom.add(bin(x - box.left, w));
    if (dLeft <= tolerance) covered.left.add(bin(y - box.top, h));
    if (dRight <= tolerance) covered.right.add(bin(y - box.top, h));
  }
  for (const side of Object.values(covered)) if (side.size < SIDE_BINS_NEEDED) return Infinity;
  return sum / points.length / ((w + h) / 2);
}

/**
 * Is this stroke plainly a line, an ellipse or an upright rectangle? `null` is the common
 * answer and the safe one. For a line `from`/`to` are its two ends; for the other two they are
 * the corners of the box that holds it, ready for `shapePoints`.
 */
export function recogniseShape(points: Point[]): Snap | null {
  if (points.length < MIN_POINTS) return null;
  const stroke = withoutRest(points);
  if (stroke.length < 2) return null;
  const length = pathLength(stroke);
  if (length < MIN_LENGTH) return null;

  const path = smooth(resample(stroke, length));
  const pathLen = pathLength(path);
  const chord = distance(path[0], path[path.length - 1]);

  if (chord / pathLen > LINE_STRAIGHTNESS && maxBow(path) < Math.max(chord * LINE_BOW, LINE_SLACK_PX)) {
    return { kind: "line", from: points[0], to: points[points.length - 1] };
  }

  const box: Box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const [x, y] of stroke) {
    if (x < box.left) box.left = x;
    if (x > box.right) box.right = x;
    if (y < box.top) box.top = y;
    if (y > box.bottom) box.bottom = y;
  }
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  if (Math.min(w, h) < MIN_SIDE) return null;
  if (chord > Math.max(CLOSE_PX, Math.max(w, h) * CLOSE_FRACTION)) return null;
  const turn = Math.abs(loopTurn(path));
  if (turn < TURN_MIN || turn > TURN_MAX) return null;

  const ellipse = ellipseMisfit(path, box);
  const rect = rectMisfit(path, box);
  const best = Math.min(ellipse, rect);
  if (!(best < FIT_MAX)) return null;
  return { kind: rect < ellipse ? "rect" : "ellipse", from: [box.left, box.top], to: [box.right, box.bottom] };
}
