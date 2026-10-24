import { stripJpegLocation, stripWebpLocation } from "./exifStrip";
import { mimeFor } from "./files";
import { paperBehind } from "./shrink";

/**
 * What happens to a file between arriving and being kept — every door: drop,
 * paste, the picker, the share sheet, and the open note's own three. Loaded on
 * the first attach, never on the first paint (`withinLimit` in
 * `lib/useCapture.ts` reaches it by a dynamic import).
 *
 * Four things, each one only where it is plainly right, and each one falling
 * back to the file exactly as it came on any failure — never block an attach:
 *
 * 1. **An iPhone photograph is made a JPEG.** HEIC is the iPhone camera's own
 *    format and no browser but Safari draws it, so it arrived as a broken
 *    picture on the card, in the note and on the wall. Decoded once here —
 *    by the browser where it can, otherwise by a decoder that is fetched the
 *    first time one is attached (`heic-to`, a chunk of its own, never
 *    precached) — and kept as the JPEG every device can draw.
 * 2. **A camera-sized photograph is kept at 2560px on its long edge.** A
 *    phone photo is 3–12 MB; kept whole it fills the device's file budget and
 *    the server's quota for detail no screen in this app shows. The long edge
 *    of a 4K screen is kept, so the viewer still has more than it can draw.
 *    Screenshots (PNG), GIFs and anything already small are left alone.
 * 3. **Where a photograph was taken is taken out of it** (`exifStrip.ts`) —
 *    by the re-encode itself when one happens, surgically when not.
 * 4. **A pasted picture gets a name.** The browser calls every pasted
 *    picture `image.png`, so a board of screenshots was a board of
 *    `image.png`s, in the row, in Save and in search.
 * 5. **Where a film was made is taken out of it** (`filmStrip.ts`, MP4 and
 *    QuickTime, 2026-10-10) — in place, frames untouched, or not at all.
 */

/** The films whose index `filmStrip.ts` can read: the MP4 family. */
const FILM_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v", "video/3gpp"]);

/** The long edge a photograph is kept at. */
export const PHOTO_MAX_PX = 2560;
const PHOTO_QUALITY = 0.88;
/** A JPEG under this is kept at its own size, whatever its pixels. */
const PHOTO_SHRINK_BYTES = 1_500_000;
/** The names browsers give a pasted picture. */
const PASTED = /^image\.(png|jpe?g|gif|webp|bmp|avif)$/i;
/** HEIF major brands that mean an HEVC still — what an iPhone writes. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function withExt(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${ext}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `image.png` → `Image 2026-10-09 13.14.png`; any other name is left alone.
 *  Dots for the clock, because a colon is not allowed in a Windows file name. */
export function pastedName(name: string, now: Date = new Date()): string {
  if (!PASTED.test(name)) return name;
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Image ${day} ${pad(now.getHours())}.${pad(now.getMinutes())}.${extOf(name)}`;
}

async function headOf(file: Blob, bytes: number): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
  } catch {
    return new Uint8Array();
  }
}

/** By the type, the name, or the bytes' own `ftyp` box — a share often says nothing. */
export async function looksLikeHeic(file: File): Promise<boolean> {
  const mime = mimeFor(file.name, file.type).toLowerCase();
  if (mime === "image/heic" || mime === "image/heif" || mime.startsWith("image/heic") || mime.startsWith("image/heif")) {
    return true;
  }
  const head = await headOf(file, 12);
  if (head.length < 12) return false;
  const box = String.fromCharCode(head[4], head[5], head[6], head[7]);
  const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
  return box === "ftyp" && HEIC_BRANDS.has(brand);
}

function canDraw(): boolean {
  return typeof createImageBitmap === "function" && typeof document !== "undefined";
}

/**
 * A bitmap drawn as a JPEG no larger than `max` on its long edge — or null if
 * the canvas would not draw it. Asks whether anything was painted before it
 * encodes, as `shrinkSized` does: a canvas that lost its drawing encodes as a
 * solid black JPEG, and here that would *replace the photograph*.
 */
async function encode(bitmap: ImageBitmap, max: number): Promise<Blob | null> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  // Eight rows across the picture: an empty canvas is zero in every one.
  let painted = false;
  for (let i = 0; i < 8 && !painted; i++) {
    const y = Math.min(h - 1, Math.floor(((i + 0.5) * h) / 8));
    painted = ctx.getImageData(0, y, w, 1).data.some(Boolean);
  }
  if (!painted) return null;
  // A large WebP can be see-through, and a JPEG would make that black (BUG-1).
  paperBehind(ctx, w, h);
  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
}

/**
 * The photograph turned upright and drawn at `max`, or null. With `onlyLarger`,
 * also null for one already no larger than that — decided on the same decode.
 */
async function redraw(blob: Blob, max: number, onlyLarger = false): Promise<Blob | null> {
  if (!canDraw()) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    if (onlyLarger && Math.max(bitmap.width, bitmap.height) <= max) return null;
    return await encode(bitmap, max);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/** An HEIC as a JPEG blob: the browser's own decoder first (Safari has one), then the fetched one. */
async function heicToJpeg(file: File): Promise<Blob | null> {
  const own = await redraw(file, PHOTO_MAX_PX);
  if (own) return own;
  try {
    const { heicTo } = await import("heic-to/csp");
    return await heicTo({ blob: file, type: "image/jpeg", quality: PHOTO_QUALITY });
  } catch (error) {
    console.error("could not convert an HEIC photograph", error);
    return null;
  }
}

function asFile(blob: Blob, name: string, type: string, from: File): File {
  return new File([blob], name, { type, lastModified: from.lastModified });
}

/** One file, made ready to keep. Never throws; the worst answer is the file as it came. */
export async function prepareFile(file: File, now: Date = new Date()): Promise<File> {
  const name = pastedName(file.name, now);
  let out = name === file.name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified });
  try {
    if (await looksLikeHeic(file)) {
      const jpeg = await heicToJpeg(file);
      if (!jpeg) return out;
      out = asFile(jpeg, withExt(name, "jpg"), "image/jpeg", file);
    }
    const mime = mimeFor(out.name, out.type).toLowerCase();
    if (FILM_TYPES.has(mime)) {
      // Where it was filmed, taken out the same leave-it-if-unsure way
      // (`filmStrip.ts`, audit BUG-8): the same bytes back when unsure.
      const { stripFilmLocation } = await import("./filmStrip");
      const clean = await stripFilmLocation(out);
      return clean && clean !== out ? asFile(clean, out.name, out.type, file) : out;
    }
    const camera = mime === "image/jpeg" || mime === "image/webp";
    if (!camera) return out;

    if (out.size > PHOTO_SHRINK_BYTES) {
      const smaller = await redraw(out, PHOTO_MAX_PX, true);
      // A re-encode carries no metadata at all, the place included.
      if (smaller && smaller.size < out.size) {
        return asFile(smaller, mime === "image/webp" ? withExt(out.name, "jpg") : out.name, "image/jpeg", file);
      }
    }
    const bytes = new Uint8Array(await out.arrayBuffer());
    // A WebP too: a phone may save one, and a small one skips the redraw
    // above with its place still in it (bughunt 2026-10-15).
    const clean = mime === "image/jpeg" ? stripJpegLocation(bytes) : stripWebpLocation(bytes);
    if (clean === bytes) return out;
    return asFile(new Blob([clean as BlobPart], { type: mime }), out.name, mime, file);
  } catch (error) {
    console.error("could not prepare a file; keeping it as it came", error);
    return out;
  }
}

/** Every file of a batch, two at a time — a photo decoded whole is a lot of memory on a phone. */
export async function prepareFiles(files: File[], now: Date = new Date()): Promise<File[]> {
  const out: File[] = new Array(files.length);
  let next = 0;
  const lane = async () => {
    while (next < files.length) {
      const i = next++;
      out[i] = await prepareFile(files[i], now);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, files.length) }, lane));
  return out;
}
