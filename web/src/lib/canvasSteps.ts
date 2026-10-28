import type { Canvas, CanvasImage, CanvasText, DrawingStroke } from "../types";

/*
 * Undo and Redo on a canvas, for the sitting you are in. Kept by the sheet, never stored or
 * synced — the way back is this visit's, the same as zoom.
 *
 * A step is what one action changed, item by item: each thing it touched, as it was and as
 * it became. Undo writes the befores back by id and Redo the afters, so a step never rewinds
 * anything it did not touch — a stroke the other device drew a moment ago stays drawn.
 */

/** A picture's place and width, the two things a canvas holds about it. */
export interface PicturePlace extends CanvasImage {
  width?: number;
}

type Part =
  | { part: "stroke"; before: DrawingStroke | null; after: DrawingStroke | null }
  | { part: "text"; before: CanvasText | null; after: CanvasText | null }
  | { part: "image"; before: PicturePlace | null; after: PicturePlace | null };

/** One item an action touched. `index` is where it stood, so taking a removal back puts it there. */
export type Change = Part & { id: string; index: number };

/** Everything one action changed. Never empty. */
export type Step = Change[];

/** How many steps back Undo goes. A sitting's worth, not a history. */
export const UNDO_DEPTH = 100;

export function strokeAdded(stroke: DrawingStroke, index: number): Change {
  return { part: "stroke", id: stroke.id, index, before: null, after: stroke };
}

export function strokeRemoved(stroke: DrawingStroke, index: number): Change {
  return { part: "stroke", id: stroke.id, index, before: stroke, after: null };
}

export function strokeChanged(before: DrawingStroke, after: DrawingStroke, index: number): Change {
  return { part: "stroke", id: before.id, index, before, after };
}

export function textAdded(text: CanvasText, index: number): Change {
  return { part: "text", id: text.id, index, before: null, after: text };
}

export function textRemoved(text: CanvasText, index: number): Change {
  return { part: "text", id: text.id, index, before: text, after: null };
}

export function textChanged(before: CanvasText, after: CanvasText, index: number): Change {
  return { part: "text", id: before.id, index, before, after };
}

export function pictureChanged(before: PicturePlace, after: PicturePlace, index: number): Change {
  return { part: "image", id: before.attachment_id, index, before, after };
}

/** Sets one item to `value` by id: replaced where it stands, put back at `index`, or taken off. */
function put<T>(list: T[], idOf: (item: T) => string, id: string, index: number, value: T | null): T[] {
  const at = list.findIndex((item) => idOf(item) === id);
  if (value === null) return at === -1 ? list : list.filter((_, i) => i !== at);
  if (at !== -1) return list.map((item, i) => (i === at ? value : item));
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, value);
  return next;
}

/**
 * What a change that only altered an item (it was there before and after) writes onto the item
 * as it stands now: just the fields the step changed. A label whose words were edited since it
 * was moved gets its place back and keeps its new words; an item gone since — deleted here or on
 * the other device — is left gone, never brought back by an old move.
 */
function patch<T extends object>(list: T[], idOf: (item: T) => string, id: string, from: T, to: T): T[] {
  const at = list.findIndex((item) => idOf(item) === id);
  if (at === -1) return list;
  const changed = (Object.keys({ ...from, ...to }) as (keyof T)[]).filter(
    (key) => JSON.stringify(from[key]) !== JSON.stringify(to[key]),
  );
  if (changed.length === 0) return list;
  const next = { ...list[at] };
  for (const key of changed) {
    if (to[key] === undefined) delete next[key];
    else next[key] = to[key];
  }
  return list.map((item, i) => (i === at ? next : item));
}

/** One change, one way. */
function write(canvas: Canvas, change: Change, which: "before" | "after"): Canvas {
  const other = which === "before" ? "after" : "before";
  if (change.part === "stroke") {
    const strokes = canvas.strokes ?? [];
    const from = change[other];
    const to = change[which];
    return {
      ...canvas,
      strokes: from && to ? patch(strokes, (s) => s.id, change.id, from, to) : put(strokes, (s) => s.id, change.id, change.index, to),
    };
  }
  if (change.part === "text") {
    const texts = canvas.text_elements ?? [];
    const from = change[other];
    const to = change[which];
    return {
      ...canvas,
      text_elements: from && to ? patch(texts, (t) => t.id, change.id, from, to) : put(texts, (t) => t.id, change.id, change.index, to),
    };
  }
  // A picture is only ever moved or stretched by a step (removing one destroys its file and is
  // never undone), and only while it is still on the canvas.
  const value = change[which];
  const images = canvas.images ?? [];
  if (!value || !images.some((i) => i.attachment_id === change.id)) return canvas;
  const place = { attachment_id: value.attachment_id, x: value.x, y: value.y };
  const widths = { ...(canvas.image_widths ?? {}) };
  if (value.width !== undefined) widths[change.id] = value.width;
  return { ...canvas, images: put(images, (i) => i.attachment_id, change.id, change.index, place), image_widths: widths };
}

/** Takes a step back: its befores, newest change first. */
export function undoStep(canvas: Canvas, step: Step): Canvas {
  return [...step].reverse().reduce((next, change) => write(next, change, "before"), canvas);
}

/** Does a step (again): its afters, in the order they were made. */
export function redoStep(canvas: Canvas, step: Step): Canvas {
  return step.reduce((next, change) => write(next, change, "after"), canvas);
}
