import type { Attachment, LinkPreview, Note } from "../types";
import { wordsBesideLinks } from "./face";
import { canPreview, isVideo } from "./files";
import { namesTheSite, overlaySaved, pathLabel, previewsFor, visiblePreviews } from "./links";

/**
 * The Inspiration wall's arithmetic — pure, and the whole of what it decides.
 *
 * The wall is the one board with a masonry geometry (DESIGN.md §8, web/CLAUDE.md
 * "The grid"): columns of equal width, each tile its own height. Placement is
 * done here in JavaScript rather than by CSS `columns`, for two reasons that
 * are both about reading order: `columns` fills a column top to bottom before
 * starting the next, so a newest-first board reads down the left edge and then
 * jumps; and its balance moves tiles between columns as pictures load. Here
 * every tile goes into the currently shortest column in board order, and its
 * height is known **before its picture loads** (stored width and height), so
 * nothing ever jumps.
 */

/** height ÷ width, clamped to 1:2 … 2:1 so one panorama or long screenshot cannot take a column. */
export const WALL_RATIO_MIN = 0.5;
export const WALL_RATIO_MAX = 2;
/** Two columns down to 360px — one on the narrowest phone is too few to be a wall. */
export const WALL_MIN_COLUMNS = 2;
/**
 * A column is never wider than this; the count is the fewest columns that keep
 * it so (DESIGN.md: about 240–300), so at in-between widths one may dip a
 * little under 240.
 */
export const WALL_COLUMN_MAX_PX = 300;
/**
 * The column width placement *assumes*. Real columns are `1fr` of the board, so
 * this only converts "units of column width" to pixels for the fixed rows under
 * a picture; being off by a few percent costs a few pixels of imbalance, never a
 * wrong tile.
 */
export const WALL_NOMINAL_PX = 260;
/**
 * The pinned heights of what is printed on a tile. `styles.css` states the same
 * numbers as `--wall-caption-h` and the rest, and `styles.test.ts` holds the
 * two together — the arithmetic here and the layout there must agree.
 */
export const WALL_CAPTION_PX = 26;
export const WALL_SITE_PX = 26;
export const WALL_TITLE_PX = 132;
export const WALL_QUOTE_PX = 150;
/** How many lines of the note a quote tile shows (set as the tile's `--card-lines`). */
export const WALL_QUOTE_LINES = 6;

/** What a picture is when nothing says how big it is: a plain 4:3. */
const UNKNOWN_RATIO = 0.75;

function size(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** A tile's height over its width, never zero and never NaN. */
export function clampRatio(width: number | null | undefined, height: number | null | undefined): number {
  if (!size(width) || !size(height)) return UNKNOWN_RATIO;
  return Math.min(WALL_RATIO_MAX, Math.max(WALL_RATIO_MIN, height / width));
}

/**
 * How many columns a board `width` pixels wide holds: the fewest that keep every
 * column at or under `WALL_COLUMN_MAX_PX`, and never fewer than two. A width that
 * is not a positive finite number (jsdom, a hidden tab) answers two.
 */
export function wallColumns(width: number): number {
  if (!size(width)) return WALL_MIN_COLUMNS;
  return Math.max(WALL_MIN_COLUMNS, Math.ceil(width / WALL_COLUMN_MAX_PX));
}

/**
 * Tile indices per column: each, in order, into the column that is shortest so
 * far (the leftmost on a tie). The first `columns` tiles therefore stand at the
 * top of their own column — which is what lets the grid keyboard count a row by
 * measuring tops. A column count that is not a count is one column; no tile is
 * ever dropped.
 */
export function placeTiles(heights: readonly number[], columns: number): number[][] {
  const count = Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : 1;
  const out: number[][] = Array.from({ length: count }, () => []);
  const sums = new Array<number>(count).fill(0);
  heights.forEach((height, i) => {
    let at = 0;
    for (let c = 1; c < count; c++) if (sums[c] < sums[at]) at = c;
    out[at].push(i);
    sums[at] += size(height) ? height : 0;
  });
  return out;
}

/** A video the viewer may play in place. `src` is the address (file) or the id (youtube, vimeo). */
export type VideoSource = NonNullable<LinkPreview["video"]>;

/**
 * `videoPlayback` — the gate a stored video source passes through before it may
 * become a `<video>` or `<iframe>` source — lives in its own module so the first
 * paint, which reads this file for the wall's arithmetic, does not carry it; the
 * viewer (a lazy chunk) is its only caller. Re-exported here so the wall's one
 * vocabulary stays in one place.
 */
export { videoPlayback } from "./videoPlayback";

export type WallFace =
  | { kind: "picture"; from: "file"; att: Attachment; ratio: number; more: number; caption: string }
  | {
      kind: "picture";
      from: "link";
      link: LinkPreview;
      ratio: number;
      video: boolean;
      site: string;
      caption: string;
    }
  /** `site` is the footer line: the domain, or the path when the title has had to
   *  be the domain, or "" when there is no path (the line is then left out). */
  | { kind: "title"; title: string; site: string }
  /**
   * Words alone — or, for a note with no words at all and only files the tile
   * cannot draw (audio, video, an archive, a document), the first of those
   * files, so the tile says what it is instead of standing empty. `more` counts
   * the others. The tile is the same pinned height either way.
   */
  | { kind: "quote"; file?: Attachment; more?: number };

/** The first line of the note's own words — never the address, never a `# ` — or "". */
function captionOf(note: Note): string {
  for (const raw of wordsBesideLinks(note).split("\n")) {
    const line = raw.replace(/^#{1,2}\s+/, "").trim();
    if (line) return line.length > 140 ? `${line.slice(0, 139)}…` : line;
  }
  return "";
}

/**
 * The note's tile, in the spec's order: an attachment you can see, then a link
 * with a picture, then a link with none (a title card), then words alone. A
 * preview the owner put away is never drawn, so it never makes a picture tile.
 */
export function wallFace(note: Note): WallFace {
  const caption = captionOf(note);
  // A film with a frame taken from it is a picture tile too, wearing the play
  // mark; the viewer plays it (`WallViewer`).
  const shown = (note.attachments ?? []).filter((a) => canPreview(a) || (isVideo(a) && Boolean(a.thumb)));
  if (shown.length > 0) {
    const att = shown[0];
    return {
      kind: "picture",
      from: "file",
      att,
      ratio: clampRatio(att.width, att.height),
      more: shown.length - 1,
      caption,
    };
  }
  const previews = visiblePreviews(overlaySaved(previewsFor(note.body ?? ""), note.link_previews));
  const pictured = previews.find((p) => typeof p.image === "string" && p.image !== "");
  if (pictured) {
    return {
      kind: "picture",
      from: "link",
      link: pictured,
      ratio: clampRatio(pictured.width, pictured.height),
      video: pictured.media === "video",
      site: pictured.domain,
      caption,
    };
  }
  if (previews.length > 0) {
    const first = previews[0];
    // A title that only says the site again is no title (`namesTheSite`, the
    // Links row's own rule): the card is named by the site and its footer says
    // the path, so the one word is never printed twice.
    if (!first.title || namesTheSite(first.title, first.domain)) {
      return { kind: "title", title: first.domain, site: pathLabel(first.href) ?? "" };
    }
    return { kind: "title", title: first.title, site: first.domain };
  }
  const files = note.attachments ?? [];
  if (files.length > 0 && caption === "") return { kind: "quote", file: files[0], more: files.length - 1 };
  return { kind: "quote" };
}

/** A tile's height in pixels at the nominal column width. */
export function tileHeight(face: WallFace): number {
  switch (face.kind) {
    case "picture":
      return (
        WALL_NOMINAL_PX * face.ratio +
        (face.caption ? WALL_CAPTION_PX : 0) +
        (face.from === "link" ? WALL_SITE_PX : 0)
      );
    case "title":
      return WALL_TITLE_PX;
    case "quote":
      return WALL_QUOTE_PX;
  }
}

/** One thing the viewer can show, in board order. */
export interface ViewerEntry {
  noteId: string;
  /** The file's name, or the link's page title. */
  title: string;
  kind: "file" | "link";
  att?: Attachment;
  link?: LinkPreview;
}

/** Every picture tile of the board, in the order the board draws them. */
export function viewerEntries(notes: readonly Note[]): ViewerEntry[] {
  const out: ViewerEntry[] = [];
  for (const note of notes) {
    const face = wallFace(note);
    if (face.kind !== "picture") continue;
    if (face.from === "file") {
      out.push({ noteId: note.id, title: face.att.name, kind: "file", att: face.att });
    } else {
      out.push({ noteId: note.id, title: face.link.title || face.site, kind: "link", link: face.link });
    }
  }
  return out;
}
