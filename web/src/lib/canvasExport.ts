import type { DrawingStroke } from "../types";
import { strokePath } from "./strokePath";

/*
 * "Save as picture": an idea's strokes, words, pictures and cards drawn onto one flat canvas
 * and handed over as a PNG. Strokes go through the same `strokePath` the sheet draws with, so
 * the picture is what was on screen. Nothing here touches React or the DOM until a function
 * is called, so the module imports cleanly under jsdom (which has no `Path2D` and no
 * `canvas.toBlob`); the drawing itself answers `null` there rather than throwing.
 */

export interface ExportScene {
  /** The world area to export; the caller adds the margin. */
  box: { x: number; y: number; w: number; h: number };
  strokes: DrawingStroke[];
  /** Top-left corner and wrapping width, in world pixels. */
  labels: { x: number; y: number; width: number; text: string }[];
  pictures: { img: HTMLImageElement; x: number; y: number; w: number; h: number }[];
  notes: { x: number; y: number; w: number; h: number; text: string }[];
}

export interface ExportLook {
  /** Resolved colours, never `var(...)`: a canvas cannot read the page's custom properties. */
  paper: string;
  ink: string;
  rule: string;
  /** Turns a stroke's token (`var(--ink)`, `var(--board-ember)`) into the colour it wears now. */
  colour: (token: string) => string;
  /** A CSS font shorthand for labels and notes. */
  font: string;
  /** Pixels per line of text. */
  lineHeight: number;
  highlightOpacity: number;
}

/** The longest side of the picture, in device pixels; past this some browsers refuse the canvas. */
const MAX_SIDE = 8000;
/** ...and its area: iOS Safari refuses a canvas over about 16.7 million pixels. */
const MAX_AREA = 16_000_000;
const DEFAULT_SCALE = 2;
/** A label's own top padding on the sheet. */
const LABEL_PAD_Y = 4;
const NOTE_PAD = 12;

/** The scale to draw at: what was asked, lowered until the longest side fits `MAX_SIDE` and the area `MAX_AREA`. */
export function exportScale(box: { w: number; h: number }, scale = DEFAULT_SCALE): number {
  const longest = Math.max(box.w, box.h, 1);
  const area = Math.max(box.w, 1) * Math.max(box.h, 1);
  return Math.min(scale, MAX_SIDE / longest, Math.sqrt(MAX_AREA / area));
}

/**
 * Words wrapped into `maxWidth`, one entry per line. A line break in the text stays one; a word
 * wider than the whole line is broken where it must be rather than run off the edge.
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const tryLine = line ? `${line} ${word}` : word;
      if (measure(tryLine) <= maxWidth) {
        line = tryLine;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (measure(rest) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawingStroke, look: ExportLook): void {
  if (stroke.points.length === 0) return;
  const colour = look.colour(stroke.color);
  if (stroke.points.length === 1) {
    // A tap leaves a dot; a one-point path draws nothing.
    const [x, y] = stroke.points[0];
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const path = new Path2D(strokePath(stroke, 0));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;
  ctx.strokeStyle = colour;
  if (stroke.fill) {
    ctx.fillStyle = colour;
    ctx.fill(path);
  }
  ctx.stroke(path);
}

function drawLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, top: number, look: ExportLook, bottom = Infinity): void {
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = look.ink;
  lines.forEach((line, i) => {
    const y = top + look.lineHeight * (i + 0.5);
    if (line && y - look.lineHeight / 2 < bottom) ctx.fillText(line, x, y);
  });
}

function draw(ctx: CanvasRenderingContext2D, scene: ExportScene, look: ExportLook, w: number, h: number): void {
  const { box } = scene;
  ctx.fillStyle = look.paper;
  ctx.fillRect(0, 0, w, h);
  ctx.translate(-box.x, -box.y);

  for (const p of scene.pictures) {
    try {
      ctx.drawImage(p.img, p.x, p.y, p.w, p.h);
    } catch {
      // A picture that will not draw (not decoded, broken) is left out; the rest still saves.
    }
  }

  ctx.save();
  ctx.globalAlpha = look.highlightOpacity;
  for (const s of scene.strokes) if (s.highlight) drawStroke(ctx, s, look);
  ctx.restore();
  for (const s of scene.strokes) if (!s.highlight) drawStroke(ctx, s, look);

  ctx.font = look.font;
  for (const label of scene.labels) {
    const lines = wrapLines(label.text, label.width, (s) => ctx.measureText(s).width);
    drawLines(ctx, lines, label.x, label.y + LABEL_PAD_Y, look);
  }

  for (const note of scene.notes) {
    ctx.fillStyle = look.paper;
    ctx.fillRect(note.x, note.y, note.w, note.h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = look.rule;
    ctx.strokeRect(note.x + 0.5, note.y + 0.5, note.w - 1, note.h - 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(note.x, note.y, note.w, note.h);
    ctx.clip();
    ctx.font = look.font;
    const lines = wrapLines(note.text, Math.max(1, note.w - NOTE_PAD * 2), (s) => ctx.measureText(s).width);
    drawLines(ctx, lines, note.x + NOTE_PAD, note.y + NOTE_PAD, look, note.y + note.h);
    ctx.restore();
  }
}

/**
 * The scene as a PNG, drawn at `scale` (2 is a retina screen) and lowered if that would make
 * the picture too large to draw. `null` when this browser cannot draw it.
 */
export async function renderCanvasPicture(scene: ExportScene, look: ExportLook, scale = DEFAULT_SCALE): Promise<Blob | null> {
  try {
    if (typeof document === "undefined" || typeof Path2D === "undefined") return null;
    const s = exportScale(scene.box, scale);
    const w = Math.max(1, Math.round(scene.box.w * s));
    const h = Math.max(1, Math.round(scene.box.h * s));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(w / scene.box.w, h / scene.box.h);
    draw(ctx, scene, look, scene.box.w, scene.box.h);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
  } catch {
    return null;
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

/**
 * Hands the picture to the person: the phone's share sheet when it takes files, otherwise a
 * download. A share they back out of is `"cancelled"` and downloads nothing; a share the
 * browser refuses for any other reason falls through to the download.
 */
export async function savePicture(
  blob: Blob,
  name: string,
  share = true,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], name, { type: blob.type || "image/png" });
  // A desktop browser can share too (Windows opens its share panel), but a mouse asking to
  // save means a file in Downloads: the caller says which this device is.
  if (share && typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function") {
    let canShare: boolean;
    try {
      canShare = navigator.canShare({ files: [file] });
    } catch {
      canShare = false;
    }
    if (canShare) {
      try {
        await navigator.share({ files: [file] });
        return "shared";
      } catch (error) {
        if (isAbort(error)) return "cancelled";
      }
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the download after the click returns; the address is let go once they have.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}

const NAME_MAX = 60;

/** A file name the idea's name can safely become: no character Windows or Android refuses, 60 at most, `.png`. */
export function pictureName(name: string | null): string {
  const cleaned = (name ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = Array.from(cleaned).slice(0, NAME_MAX).join("").replace(/[\s.]+$/, "").trim();
  return `${cut || "Sketch"}.png`;
}
