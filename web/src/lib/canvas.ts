import type { Attachment, CanvasImage, CanvasText, DrawingStroke, Note, Canvas, CanvasItem } from "../types";
import { isImage } from "./files";
import { AVG_CHAR_PX } from "./metrics";

const NOTE_W = 248;
const GUTTER = 28;
const COLUMNS = 3;

/* --- zoom ----------------------------------------------------------------
   The canvas can be pinched or trackpad-pinched to a different scale, but the
   scale is not a fact about the arrangement — it is how far *this device*
   happened to be looking, this time. Two people never agree on that number,
   and a canvas made on a laptop has to be seen whole on a phone regardless of
   what either device last zoomed to. So the zoom is never written to a
   `Canvas`, never migrated, never synced: it is component-local state
   in `Canvas.tsx` that starts at 1 every time a canvas opens.

   The three helpers below are the entire contract between a pointer position
   on screen and a position in the canvas's own coordinate space, at whatever
   scale the canvas currently stands. Every screen-to-world conversion in the
   component — panning aside, which stays in screen pixels because scrolling
   is itself a screen-space move — goes through `worldFromClient`, so there is
   exactly one definition of "where is the pointer" and it cannot drift from
   the transform actually painted on screen. */

/** How far the canvas can be pinched in either direction. */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.5;

/** Keeps a zoom level inside the range the canvas can actually draw. */
export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * A screen point, translated into the canvas's own coordinate space.
 *
 * `scroll{Left,Top}` and `rect{Left,Top}` describe the scroller exactly as
 * `toWorldCoords` always read them; `origin` is `WORLD_ORIGIN` for a true
 * world position, or 0 for the "scroll-space at zoom 1" coordinate
 * `anchorScroll` needs — the two callers want different zero points and this
 * is the one formula both read from.
 */
export function worldFromClient(p: {
  scrollLeft: number;
  scrollTop: number;
  rectLeft: number;
  rectTop: number;
  clientX: number;
  clientY: number;
  zoom: number;
  origin: number;
}): [number, number] {
  const x = (p.scrollLeft + (p.clientX - p.rectLeft)) / p.zoom - p.origin;
  const y = (p.scrollTop + (p.clientY - p.rectTop)) / p.zoom - p.origin;
  return [x, y];
}

/**
 * Where to scroll so that a content point stays under a screen point once the
 * zoom changes to `zoom`.
 *
 * `contentX`/`contentY` are the "scroll-space at zoom 1" coordinates
 * `worldFromClient` returns when called with `origin: 0` — captured once, at
 * the start of a pinch, and held fixed for its whole duration, so the point
 * under the fingers or the cursor never drifts no matter how far the zoom
 * moves from there. `pointX`/`pointY` are the screen point to keep it under,
 * relative to the canvas's own rect (i.e. `clientX - rect.left`).
 */
export function anchorScroll(p: {
  contentX: number;
  contentY: number;
  zoom: number;
  pointX: number;
  pointY: number;
}): { left: number; top: number } {
  return {
    left: p.contentX * p.zoom - p.pointX,
    top: p.contentY * p.zoom - p.pointY,
  };
}

/**
 * Where the notes stand the first time a canvas is opened.
 *
 * Three columns, filled across in merge order, each one stacked by what the
 * note in it actually measures. The row height used to be a flat 190px while
 * `.spatial-note` is `height: auto` — so merging anything longer than a short
 * paragraph laid the next row straight over the top of it, and the first thing
 * the canvas showed you was a pile. A note is as long as it is; the column it
 * sits in has to be told.
 */
function layOut(notes: (Note | undefined)[]): { x: number; y: number }[] {
  const bottom = new Array<number>(COLUMNS).fill(0);
  return notes.map((note, index) => {
    const column = index % COLUMNS;
    const y = bottom[column];
    // Measured at the width the note is actually drawn at; NOTE_W is only the
    // pitch between columns, and leaves the 16px of air between them.
    bottom[column] = y + measureNote(note, DEFAULT_W).h + GUTTER;
    return { x: column * (NOTE_W + GUTTER), y };
  });
}

/**
 * Where a note absorbed into an *existing* idea lands, rather than the fresh
 * three-column sweep `layOut` does for a brand-new one. It reuses the same
 * pitch (`NOTE_W`, `GUTTER`, `COLUMNS`) and the same `measureNote` a default
 * layout is built from: find whichever column already runs shortest, and
 * stack the new item under it.
 *
 * An existing item's true height isn't knowable here — only its id and
 * position travelled onto `folder.items`, not the note's text — so every
 * item already on the canvas is measured the way `measureNote` measures a
 * note with no words at all, the shortest a card can ever stand (`MIN_H`).
 * That can undercount a long note and land the new item high on its
 * neighbour; the new item is an ordinary note on an ordinary canvas from
 * that point on, and can be dragged like any other.
 */
export function placeForNewItem(
  folder: Canvas,
  note: Note | undefined,
): { x: number; y: number } {
  void note; // reserved for parity with layOut's per-note measureNote call
  const bottoms = new Array<number>(COLUMNS).fill(0);
  for (const item of folder.items) {
    const column = Math.min(
      COLUMNS - 1,
      Math.max(0, Math.round(item.x / (NOTE_W + GUTTER))),
    );
    const height = measureNote(undefined, item.width ?? DEFAULT_W).h;
    bottoms[column] = Math.max(bottoms[column], item.y + height);
  }
  let column = 0;
  for (let i = 1; i < COLUMNS; i++) {
    if (bottoms[i] < bottoms[column]) column = i;
  }
  return {
    x: column * (NOTE_W + GUTTER),
    y: bottoms[column] === 0 ? 0 : bottoms[column] + GUTTER,
  };
}

/** Every x a default layout can put a note on. */
const DEFAULT_XS = new Set(
  Array.from({ length: COLUMNS }, (_, column) => column * (NOTE_W + GUTTER)),
);

/**
 * Whether anybody has actually arranged this canvas, judged from the canvas
 * alone.
 *
 * Asked once, by the upgrade to database version 5, of folders that predate the
 * outbox. Every folder written since says so for itself by being queued or not;
 * these cannot, so they are read for evidence instead. Strokes, labels and
 * explicit widths can only exist if somebody made them. Positions are the one
 * ambiguous case, and a default layout puts every note on one of exactly
 * `COLUMNS` x values — derived here from the same constants `layOut` uses, so
 * the two cannot drift apart.
 *
 * It errs towards saying no, and the two errors are not the same size. A canvas
 * wrongly called untouched simply waits for its next drag before it travels. A
 * default wrongly called arranged uploads with today's stamp and flattens the
 * real arrangement on the other device — which is the exact failure the whole
 * conflict rule exists to prevent.
 */
export function looksArranged(folder: Canvas): boolean {
  if (folder.strokes?.length) return true;
  if (folder.text_elements?.length) return true;
  if (folder.images?.length) return true;
  if (Object.keys(folder.image_widths ?? {}).length > 0) return true;
  return (folder.items ?? []).some(
    (item) => item.width !== undefined || item.y < 0 || !DEFAULT_XS.has(item.x),
  );
}

/**
 * Materializes the original notes behind an idea as independent folder items.
 * The source ids are the only join needed, so attachments and edits stay on the
 * original notes instead of being cloned into a second content model.
 */
export function buildCanvas(
  idea: Note,
  sources: Note[],
  now = new Date(),
): Canvas {
  const sourceIds = idea.merged_from ?? [];
  const byId = new Map(sources.map((note) => [note.id, note]));
  const present = sourceIds.filter((id) => byId.has(id));
  const places = layOut(present.map((id) => byId.get(id)));
  const items: CanvasItem[] = present.map((noteId, index) => ({
    note_id: noteId,
    ...places[index],
  }));

  const timestamp = now.toISOString();
  return {
    id: idea.id,
    idea_id: idea.id,
    items,
    strokes: [],
    image_widths: {},
    text_elements: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/** What a Draw note's text opens on. The heading is the idea-name convention
 *  said from the app's side for once: a sketch has to have *some* text
 *  (`raw_content` is immutable and `create` refuses none), and a `# ` line is
 *  the one kind of text that is already a name — renameable from the canvas
 *  bar, searchable, and never mistaken for something the user wrote. */
export const SKETCH_SEED = "# Sketch";

export function isCanvasIdea(note: Note): boolean {
  // Two ways to be a canvas: composed out of sources by a merge, or born
  // empty as a sketch. A draw note's source count is permanently zero and
  // that is its normal state, not the emptied state that dissolves a merge.
  if (note.source === "draw") return true;
  return note.source === "merge" && (note.merged_from?.length ?? 0) > 0;
}

/* An idea is named the way any note is — a `# ` line at the top of its own
   text — and the two functions that read and write it live in `lib/name.ts`.
   An idea needed it first: a place with no name is a place you cannot ask for,
   and a layout stays on the device that made it, so a name kept on the canvas
   would be a name the phone never sees. */

/**
 * Takes one note back out of an idea.
 *
 * The layout is the only thing lost, and it is the only thing that can be:
 * every note on a canvas is an ordinary note in the ordinary store, so putting
 * one back on the board is a change of `status` and a line removed from here.
 */
export function removeCanvasItem(
  folder: Canvas,
  noteId: string,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    items: folder.items.filter((item) => item.note_id !== noteId),
    updated_at: now.toISOString(),
  };
}

/** Puts an item back exactly where it stood — what undoing a release needs. */
export function addCanvasItem(
  folder: Canvas,
  item: CanvasItem,
  now = new Date(),
): Canvas {
  if (folder.items.some((existing) => existing.note_id === item.note_id)) return folder;
  return {
    ...folder,
    items: [...folder.items, item],
    updated_at: now.toISOString(),
  };
}

export function moveCanvasItem(
  folder: Canvas,
  noteId: string,
  x: number,
  y: number,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    items: folder.items.map((item) =>
      item.note_id === noteId ? { ...item, x, y } : item,
    ),
    updated_at: now.toISOString(),
  };
}

export function addStroke(
  folder: Canvas,
  stroke: DrawingStroke,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    strokes: [...folder.strokes, stroke],
    updated_at: now.toISOString(),
  };
}

export function removeStroke(
  folder: Canvas,
  strokeId: string,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    strokes: folder.strokes.filter((s) => s.id !== strokeId),
    updated_at: now.toISOString(),
  };
}

/**
 * Strokes put back where they stood — the way back from a rub-out or a Clear.
 * Each comes with the place it held in the list, so a pen drawn over another
 * is still over it. One already on the canvas is left alone: the other device
 * may have put it back first.
 */
export function restoreStrokes(
  folder: Canvas,
  entries: { stroke: DrawingStroke; index: number }[],
  now = new Date(),
): Canvas {
  const strokes = [...folder.strokes];
  const held = new Set(strokes.map((s) => s.id));
  for (const { stroke, index } of [...entries].sort((a, b) => a.index - b.index)) {
    if (held.has(stroke.id)) continue;
    strokes.splice(Math.min(index, strokes.length), 0, stroke);
    held.add(stroke.id);
  }
  return { ...folder, strokes, updated_at: now.toISOString() };
}

export function resizeCanvasItem(
  folder: Canvas,
  noteId: string,
  width: number,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    items: folder.items.map((item) =>
      item.note_id === noteId ? { ...item, width } : item,
    ),
    updated_at: now.toISOString(),
  };
}

export function setCanvasImageWidth(
  folder: Canvas,
  attachmentId: string,
  width: number,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    image_widths: { ...folder.image_widths, [attachmentId]: width },
    updated_at: now.toISOString(),
  };
}

export function addCanvasText(
  folder: Canvas,
  text: CanvasText,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    text_elements: [...folder.text_elements, text],
    updated_at: now.toISOString(),
  };
}

export function updateCanvasText(
  folder: Canvas,
  textId: string,
  changes: Partial<Pick<CanvasText, "text" | "x" | "y" | "width">>,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    text_elements: folder.text_elements.map((t) =>
      t.id === textId ? { ...t, ...changes } : t,
    ),
    updated_at: now.toISOString(),
  };
}

export function removeCanvasText(
  folder: Canvas,
  textId: string,
  now = new Date(),
): Canvas {
  return {
    ...folder,
    text_elements: folder.text_elements.filter((t) => t.id !== textId),
    updated_at: now.toISOString(),
  };
}

/**
 * Pictures set down on the canvas. One already placed is left where it is: a
 * second device's copy of the same placement must not stack a twin on it.
 */
export function addCanvasImages(
  folder: Canvas,
  images: CanvasImage[],
  now = new Date(),
): Canvas {
  const held = new Set((folder.images ?? []).map((image) => image.attachment_id));
  const fresh = images.filter((image) => !held.has(image.attachment_id));
  if (fresh.length === 0) return folder;
  return {
    ...folder,
    images: [...(folder.images ?? []), ...fresh],
    updated_at: now.toISOString(),
  };
}

export function moveCanvasImage(
  folder: Canvas,
  attachmentId: string,
  x: number,
  y: number,
  now = new Date(),
): Canvas {
  const images = folder.images ?? [];
  const placed = images.some((image) => image.attachment_id === attachmentId);
  return {
    ...folder,
    // A picture with no placement yet (`picturesOf` stood it at a default) is
    // given one by its first move.
    images: placed
      ? images.map((image) => (image.attachment_id === attachmentId ? { ...image, x, y } : image))
      : [...images, { attachment_id: attachmentId, x, y }],
    updated_at: now.toISOString(),
  };
}

/** The placement and its width go together; the bytes are the note's (`detach`). */
export function removeCanvasImage(
  folder: Canvas,
  attachmentId: string,
  now = new Date(),
): Canvas {
  const { [attachmentId]: _gone, ...widths } = folder.image_widths ?? {};
  return {
    ...folder,
    images: (folder.images ?? []).filter((image) => image.attachment_id !== attachmentId),
    image_widths: widths,
    updated_at: now.toISOString(),
  };
}

/** Pictures with no placement stand in a column from the world's origin, in view on opening. */
const LOOSE_GAP = 40;

/**
 * Every picture the idea note carries, each with the place it stands. A picture
 * whose placement never arrived (an older device rewrote the canvas, or the
 * placement is still on its way) is still drawn, in a column of its own, rather
 * than being a file on the note nobody can see.
 */
export function picturesOf(
  idea: Note | null | undefined,
  folder: Canvas | undefined,
): { att: Attachment; x: number; y: number }[] {
  const placed = new Map((folder?.images ?? []).map((image) => [image.attachment_id, image]));
  let looseY = 0;
  return (idea?.attachments ?? []).map((att) => {
    const at = placed.get(att.id);
    if (at) return { att, x: at.x, y: at.y };
    const y = looseY;
    looseY += 240 + LOOSE_GAP;
    return { att, x: 0, y };
  });
}

/* --- the snapshot ------------------------------------------------------------
   An idea card stands for a canvas the way a card stands for a note: by being
   the thing at a smaller size, not by being a diagram of it. So the miniature
   borrows the canvas's own geometry — the same padding, the same line height,
   the same minimum card height — and measures each source note the way the
   canvas will actually set it. A two-line note is a short block, a long one is
   a tall column, and a line that ends early ends early in the miniature too.

   Uniform rectangles were the first version and they said nothing: five equal
   squares stand for five equal squares, whatever is inside them. */

/** Matches `.spatial-note` padding, `--card-lh`, and `--card-h`. */
const PAD_X = 13;
const PAD_Y = 11;
const LINE_H = 19.5;
const FOOT_H = 18;
const MIN_H = 206;
export const DEFAULT_W = 260;
export const IMG_W = 240;
/** A label the Text tool sets down starts this wide; older labels carry no width. */
export const TEXT_W = 240;
/** How narrow and how wide a label can be stretched. */
export const TEXT_MIN_W = 80;
export const TEXT_MAX_W = 600;
/**
 * The card face and the canvas have to agree about this, or the miniature on
 * an idea card shows an arrangement the canvas does not have. It was measured
 * separately here as 6.4 and had already drifted from the 6.63 the cards use.
 */
const CHAR_W = AVG_CHAR_PX;
/**
 * A single note may not be allowed to swallow the whole viewBox. The canvas
 * draws a 300-line note at 300 lines; the miniature would then shrink every
 * other card to a hairline to fit it in.
 */
const MAX_LINES = 40;

export interface SnapshotShape {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** One entry per set line: the fraction of the column it fills, 0 for blank. */
  lines: number[];
  /** A picture the note carries, in the same world units. */
  image: { w: number; h: number } | null;
  priority: boolean;
}

export interface SnapshotLabel {
  id: string;
  x: number;
  y: number;
  lines: number[];
  /** The column the label is set in: its own width, or the default. */
  w: number;
}

export interface CanvasSnapshot {
  shapes: SnapshotShape[];
  strokes: DrawingStroke[];
  labels: SnapshotLabel[];
  /** Pictures placed on the canvas itself, drawn under the strokes as there. */
  pictures: { id: string; x: number; y: number; w: number; h: number }[];
}

/**
 * How a run of text falls into a column of `col` characters, as one fill
 * fraction per line. Blank lines are kept — they are what gives a note its
 * paragraphs — and cost a line box without drawing a mark.
 */
function ghostLines(text: string, col: number, max: number): number[] {
  const out: number[] = [];
  for (const line of text.split("\n")) {
    if (out.length >= max) break;
    const len = line.trim().length;
    if (len === 0) {
      out.push(0);
      continue;
    }
    let left = len;
    while (left > col && out.length < max) {
      out.push(1);
      left -= col;
    }
    if (out.length < max) out.push(Math.max(0.12, left / col));
  }
  return out.length > 0 ? out : [0.4];
}

function imageBox(att: Attachment | undefined, width: number): { w: number; h: number } | null {
  if (!att || !isImage(att)) return null;
  const w = Math.min(width, IMG_W);
  const ratio = att.width && att.height ? att.height / att.width : 0.66;
  return { w, h: Math.round(w * ratio) };
}

/**
 * What the canvas will make of this note at this width: how its text falls,
 * what picture it carries, and therefore how tall it stands.
 *
 * The first opening of a canvas and the miniature on the card have to agree
 * about this, or the card shows an arrangement the canvas does not have.
 */
function measureNote(
  note: Note | undefined,
  width: number,
  imageWidth?: number,
): { lines: number[]; image: { w: number; h: number } | null; h: number } {
  const col = Math.max(8, Math.floor((width - PAD_X * 2) / CHAR_W));
  const att = note?.attachments?.[0];
  const image = imageBox(att, imageWidth ?? Math.min(IMG_W, width - PAD_X * 2));
  // A note that is only a file has no words to ghost, and a note this device
  // has not got gets a plain block rather than a lie about what is in it.
  const body = note?.body.trim() ?? "";
  const lines = body ? ghostLines(body, col, MAX_LINES) : [];
  const h = Math.max(
    MIN_H,
    PAD_Y * 2 + lines.length * LINE_H + (image ? image.h + 6 : 0) + FOOT_H,
  );
  return { lines, image, h };
}

/**
 * `canvasSnapshot`, remembered per idea.
 *
 * The board asked for every idea's miniature on every change to any note —
 * every keystroke in an open note — and each one lays out and measures every
 * source. Worse, each answer was a new object, so the `snapshot` prop on every
 * idea card changed identity every time and `memo(NoteCard)` re-rendered all of
 * them. A snapshot depends on exactly three things: the idea note, its canvas
 * record, and the notes it draws (named by `merged_from` and by the canvas's
 * items). When none of those is a different object, the previous answer *is*
 * the answer, and it is handed back as the same object.
 */
export function createSnapshotCache() {
  type Entry = {
    idea: Note;
    folder: Canvas | undefined;
    ids: string[];
    sources: (Note | undefined)[];
    snap: CanvasSnapshot;
  };
  const entries = new Map<string, Entry>();
  const get = (idea: Note, folder: Canvas | undefined, byId: Map<string, Note>): CanvasSnapshot => {
    const ids = [
      ...new Set([...(idea.merged_from ?? []), ...(folder?.items ?? []).map((item) => item.note_id)]),
    ];
    const sources = ids.map((id) => byId.get(id));
    const held = entries.get(idea.id);
    if (
      held &&
      held.idea === idea &&
      held.folder === folder &&
      held.ids.length === ids.length &&
      held.ids.every((id, i) => id === ids[i] && held.sources[i] === sources[i])
    ) {
      return held.snap;
    }
    const snap = canvasSnapshot(idea, folder, byId);
    entries.set(idea.id, { idea, folder, ids, sources, snap });
    return snap;
  };
  /** Forgets every idea not in `keep`, so a deleted idea does not stay held. */
  const keepOnly = (keep: Set<string>) => {
    for (const id of entries.keys()) if (!keep.has(id)) entries.delete(id);
  };
  return { get, keepOnly };
}

/**
 * The canvas as the grid card will draw it.
 *
 * `folder` is optional on purpose. Folder layouts live only on the device that
 * arranged them, so a phone that has never opened an idea has no record of one
 * — and the card was falling all the way through to the note's text, which is
 * the one thing an idea card is not. Without a folder the snapshot is drawn
 * from the default layout the canvas would build on first open, so the card
 * shows what is inside before anybody has moved anything.
 */
export function canvasSnapshot(
  idea: Note,
  folder: Canvas | undefined,
  byId: Map<string, Note>,
): CanvasSnapshot {
  let items = folder?.items;
  if (!items) {
    const present = (idea.merged_from ?? []).filter((id) => byId.has(id));
    const places = layOut(present.map((id) => byId.get(id)));
    items = present.map((noteId, index) => ({ note_id: noteId, ...places[index] }));
  }
  // A note trashed on another device is still named in `merged_from` and in
  // `folder.items` until this device's own canvas next syncs — the idea's
  // record of its sources and the layout both travel independently of the
  // note's own status. The miniature must never draw it regardless.
  items = items.filter((item) => byId.get(item.note_id)?.status !== "trashed");

  const widths = folder?.image_widths ?? {};

  const shapes: SnapshotShape[] = items.map((item) => {
    const note = byId.get(item.note_id);
    const w = item.width ?? DEFAULT_W;
    const att = note?.attachments?.[0];
    const { lines, image, h } = measureNote(note, w, widths[att?.id ?? ""]);
    return {
      id: item.note_id,
      x: item.x,
      y: item.y,
      w,
      h,
      lines,
      image,
      priority: (note?.priority ?? 0) > 0,
    };
  });

  const labels: SnapshotLabel[] = (folder?.text_elements ?? []).map((text) => ({
    id: text.id,
    x: text.x,
    y: text.y,
    lines: ghostLines(text.text || " ", Math.max(8, Math.floor((text.width ?? TEXT_W) / CHAR_W)), 6),
    w: text.width ?? TEXT_W,
  }));

  const pictures = picturesOf(idea, folder).map(({ att, x, y }) => {
    const w = widths[att.id] ?? IMG_W;
    const ratio = att.width && att.height ? att.height / att.width : 0.66;
    return { id: att.id, x, y, w, h: Math.round(w * ratio) };
  });

  return { shapes, strokes: folder?.strokes ?? [], labels, pictures };
}

/** World-space geometry the miniature is drawn with, shared with the renderer. */
export const SNAPSHOT_METRICS = { PAD_X, PAD_Y, LINE_H, FOOT_H } as const;
