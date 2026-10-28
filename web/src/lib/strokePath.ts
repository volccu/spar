import type { DrawingStroke } from "../types";

/*
 * The one place a stroke becomes an SVG path, read by the sheet and by the picture export
 * (`canvasExport.ts`, through `Path2D`), so what is saved as a picture is what was drawn.
 */

type Point = [number, number];

/** A hand-drawn line: smoothed through the midpoints, at draw time only — the points stay raw. */
export function freehandPath(points: Point[], origin: number): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M ${origin + first[0]} ${origin + first[1]}`;
  if (rest.length === 0) return d;
  if (rest.length === 1) {
    const [p] = rest;
    d += ` L ${origin + p[0]} ${origin + p[1]}`;
    return d;
  }
  for (let i = 0; i < rest.length - 1; i++) {
    const cp = rest[i];
    const end = rest[i + 1];
    const mx = (origin + cp[0] + origin + end[0]) / 2;
    const my = (origin + cp[1] + origin + end[1]) / 2;
    d += ` Q ${origin + cp[0]} ${origin + cp[1]} ${mx} ${my}`;
  }
  const last = rest[rest.length - 1];
  d += ` L ${origin + last[0]} ${origin + last[1]}`;
  return d;
}

/** A shape: straight from point to point, and closed when it comes back to where it began. */
export function straightPath(points: Point[], origin: number): string {
  if (points.length === 0) return "";
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${origin + x} ${origin + y}`).join(" ");
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  return points.length > 2 && fx === lx && fy === ly ? `${d} Z` : d;
}

export function strokePath(stroke: DrawingStroke, origin: number): string {
  return stroke.shape ? straightPath(stroke.points, origin) : freehandPath(stroke.points, origin);
}
