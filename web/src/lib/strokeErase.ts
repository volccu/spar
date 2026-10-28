import type { DrawingStroke } from "../types";

/**
 * How near a finger has to be to a stroke to rub it out, in screen pixels. A
 * fingertip is wider than the line it is aiming at, so this is a reach, not a
 * pixel: it is divided by the zoom before it is used, so a pinched-out canvas
 * is as easy to rub out as a pinched-in one.
 */
export const ERASE_REACH = 14;

/** How far a point is from the segment a–b (a lone point when a is b). */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Whether a world point touches a stroke: within `reach` of any line between
 * two of its points (not only the points themselves, which a quick stroke
 * leaves far apart), plus half the pen's own width.
 */
export function strokeHit(stroke: DrawingStroke, x: number, y: number, reach: number): boolean {
  const near = reach + stroke.width / 2;
  const pts = stroke.points;
  if (pts.length === 0) return false;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= near;
  for (let i = 0; i < pts.length - 1; i++) {
    if (distanceToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= near) return true;
  }
  // A filled shape is all ink: rubbing anywhere inside takes it, not only its edge.
  return stroke.fill === true && insideOutline(x, y, pts);
}

/** Even-odd: is the point inside the outline the points close round? */
function insideOutline(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The points a rubbing finger covered between two readings. A quick drag
 * reports samples many pixels apart, and a stroke thinner than that gap could
 * be stepped over; so the gap is walked in steps no longer than half the reach.
 */
export function pathBetween(
  from: [number, number] | null,
  to: [number, number],
  reach: number,
): [number, number][] {
  if (!from) return [to];
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1, reach / 2)));
  const out: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    out.push([from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]);
  }
  return out;
}
