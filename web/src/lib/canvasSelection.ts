import type { CanvasText, DrawingStroke } from "../types";
import { TEXT_MAX_W, TEXT_MIN_W } from "./canvas";

/*
 * The Select tool's arithmetic: what a loop or a box takes in, how big the taking is, and
 * what moving or stretching it does to each thing. Kept out of the sheet so it can be read
 * and tested without a pointer.
 */

type Point = [number, number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What is picked. Source notes stay with Move: they are notes, not marks on the paper. */
export interface Selection {
  strokes: string[];
  texts: string[];
  images: string[];
}

/** A label or a picture as the page draws it, measured in world units. */
export interface Placed {
  id: string;
  box: Box;
}

/** The share of a stroke's points that must fall inside for the stroke to be taken. */
const STROKE_SHARE = 0.6;

export function isEmptySelection(selection: Selection | null): boolean {
  return !selection || selection.strokes.length + selection.texts.length + selection.images.length === 0;
}

/** Even-odd ray casting: is the point inside the loop the finger drew? */
export function insideLoop([x, y]: Point, loop: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function insideBox([x, y]: Point, box: Box): boolean {
  return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

/** The box two corners of a drag make, whichever way it was dragged. */
export function boxBetween(a: Point, b: Point): Box {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

const middle = (box: Box): Point => [box.x + box.w / 2, box.y + box.h / 2];

/**
 * What a loop (a finger's) or a box (a mouse's) takes in. A stroke is taken when most of it
 * is inside, so a loop that clips the end of a long line leaves it; a label or a picture when
 * its middle is.
 */
export function pick(
  region: { loop: Point[] } | { box: Box },
  strokes: DrawingStroke[],
  texts: Placed[],
  images: Placed[],
): Selection {
  const inside = "loop" in region ? (p: Point) => insideLoop(p, region.loop) : (p: Point) => insideBox(p, region.box);
  return {
    strokes: strokes
      .filter((s) => s.points.length > 0 && s.points.filter(inside).length / s.points.length >= STROKE_SHARE)
      .map((s) => s.id),
    texts: texts.filter((t) => inside(middle(t.box))).map((t) => t.id),
    images: images.filter((i) => inside(middle(i.box))).map((i) => i.id),
  };
}

/** The box round everything picked, a stroke's own thickness included. */
export function selectionBounds(selection: Selection, strokes: DrawingStroke[], texts: Placed[], images: Placed[]): Box | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const take = (x0: number, y0: number, x1: number, y1: number) => {
    left = Math.min(left, x0);
    top = Math.min(top, y0);
    right = Math.max(right, x1);
    bottom = Math.max(bottom, y1);
  };
  const strokeIds = new Set(selection.strokes);
  for (const stroke of strokes) {
    if (!strokeIds.has(stroke.id)) continue;
    const half = stroke.width / 2;
    for (const [x, y] of stroke.points) take(x - half, y - half, x + half, y + half);
  }
  const textIds = new Set(selection.texts);
  const imageIds = new Set(selection.images);
  for (const t of texts) if (textIds.has(t.id)) take(t.box.x, t.box.y, t.box.x + t.box.w, t.box.y + t.box.h);
  for (const i of images) if (imageIds.has(i.id)) take(i.box.x, i.box.y, i.box.x + i.box.w, i.box.y + i.box.h);
  return left === Infinity ? null : { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Moving and stretching, as one rule: every point is carried by `dx, dy` and scaled by
 * `scale` away from `anchor` (the corner that stays put). One scale for both directions, so
 * a circle stays a circle and a word stays readable.
 */
export interface Carry {
  dx: number;
  dy: number;
  scale: number;
  anchor: Point;
}

export const STILL: Carry = { dx: 0, dy: 0, scale: 1, anchor: [0, 0] };

export function carryPoint([x, y]: Point, carry: Carry): Point {
  const [ax, ay] = carry.anchor;
  return [
    Math.round((ax + (x - ax) * carry.scale + carry.dx) * 10) / 10,
    Math.round((ay + (y - ay) * carry.scale + carry.dy) * 10) / 10,
  ];
}

/** A stroke carried. Its thickness is the pen's and stays as it was. */
export function carryStroke(stroke: DrawingStroke, carry: Carry): DrawingStroke {
  return { ...stroke, points: stroke.points.map((p) => carryPoint(p, carry)) };
}

/** A label carried: its corner moves, and its width stretches inside the label's own limits. */
export function carryText(text: CanvasText, carry: Carry, width: number): CanvasText {
  const [x, y] = carryPoint([text.x, text.y], carry);
  if (carry.scale === 1) return { ...text, x, y };
  const stretched = Math.round(Math.min(TEXT_MAX_W, Math.max(TEXT_MIN_W, width * carry.scale)));
  return { ...text, x, y, width: stretched };
}

/** A picture carried: its corner moves and its width stretches, never under `min`. */
export function carryPicture(place: { x: number; y: number; width: number }, carry: Carry, min: number) {
  const [x, y] = carryPoint([place.x, place.y], carry);
  return { x, y, width: Math.max(min, Math.round(place.width * carry.scale)) };
}

/**
 * How much a drag on the stretch handle (the box's bottom-right corner) scales the box,
 * keeping the top-left still. Never so small the selection vanishes under the finger.
 */
export function stretchScale(box: Box, dx: number, dy: number): number {
  const size = Math.max(box.w, box.h, 1);
  const grow = Math.abs(dx) > Math.abs(dy) ? (box.w + dx) / Math.max(box.w, 1) : (box.h + dy) / Math.max(box.h, 1);
  return Math.max(16 / size, grow);
}
