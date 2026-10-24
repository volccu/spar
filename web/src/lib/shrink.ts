/**
 * A decoded picture drawn small, as a JPEG data URL — the attachment's
 * thumbnail (`lib/describeFile.ts`) and a link's stored picture
 * (`store/useLinkUnfurl.ts`). Its own module, reached by dynamic import from
 * both, because neither runs on the first paint and the first paint has a
 * ceiling (`buildInvariants.test.ts`).
 */

/**
 * What `shrinkSized` answers when the picture decoded but the canvas drew
 * nothing at all — every pixel still fully transparent. Not the picture's
 * fault, so not the same answer as `null` (this is not a picture): the browser
 * failed for a moment, and the same bytes may draw perfectly on the next try.
 */
export const DREW_BLANK = false;

/**
 * A decoded picture drawn no larger than `px` on its long edge, as a JPEG data
 * URL — or null where the canvas will not give one, or `DREW_BLANK` where it
 * drew nothing. Closes the bitmap.
 *
 * JPEG even for a PNG screenshot: this is a thumbnail, not the file, and a
 * lossless copy of it would cost several times as much to carry.
 *
 * **An empty canvas is never encoded.** A JPEG has no transparency, so a
 * canvas the draw never reached comes out as a solid black picture — and that
 * black picture was stored, synced and stamped as answered. On 2026-10-09 every
 * link picture one browser shrank in a burst came out that way (the Inspiration
 * wall drew a column of black boxes), while the same bytes drew perfectly in
 * another. So the canvas is asked for `willReadFrequently`, which keeps it in
 * ordinary memory rather than on the graphics card (where a hidden tab or a
 * busy card can lose the drawing), and the pixels are read back before
 * anything is encoded. A genuinely black photograph is opaque and still passes.
 */
export function shrinkSized(
  bitmap: ImageBitmap,
  px: number,
  quality: number,
): { thumb: string; width: number; height: number } | typeof DREW_BLANK | null {
  const { width, height } = bitmap;
  const scale = Math.min(1, px / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  // Painted at all? An empty canvas is zero in every byte; any picture, even a
  // black one, has at least its alpha.
  if (!ctx.getImageData(0, 0, w, h).data.some(Boolean)) return DREW_BLANK;
  paperBehind(ctx, w, h);

  const thumb = canvas.toDataURL("image/jpeg", quality);
  return thumb.startsWith("data:image") ? { thumb, width: w, height: h } : null;
}

/**
 * White laid in *behind* what is already drawn, before a canvas is encoded as
 * a JPEG (audit BUG-1, 2026-10-10).
 *
 * A JPEG has no transparency, so every see-through pixel of a PNG, WebP or GIF
 * — a logo, a screenshot with rounded corners, a sticker — came out black: on
 * the card, in the link preview, and on the Inspiration wall at 1080px. The
 * paper goes *under* the picture (`destination-over`), so it is laid only
 * after the empty-canvas check has read the real alpha, and an opaque photo is
 * untouched by it. White because that is what such a picture was made to sit
 * on — the paper `svgFace` and the PDF pages are drawn against too. It is the
 * picture's content, not the app's chrome, so it is not a ramp token.
 */
export function paperBehind(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

/** `shrinkSized`'s picture alone; a blank draw is no thumbnail rather than a black one. */
export function shrink(bitmap: ImageBitmap, px: number, quality: number): string | null {
  const out = shrinkSized(bitmap, px, quality);
  return out ? out.thumb : null;
}

/**
 * Shrinks a data URL (an og:image the link-preview function already fetched
 * and embedded) down to a small JPEG data URL, the same shape `measure()`
 * produces for a dropped file.
 *
 * The raw og:image is transient — this is what actually gets written into
 * `note.link_previews` and pushed through sync, so it is paid for on every
 * pull, forever. Never store the input to this function directly.
 *
 * Same restraint as `measure()`: returns `null` rather than throwing on
 * anything it cannot decode, and `null` when `createImageBitmap` is absent,
 * so a picture that will not shrink simply does not show one. A data URL is
 * same-origin, so the canvas it is drawn into is never tainted.
 *
 * The decode must never go through `fetch()`. The deployed site's
 * Content-Security-Policy allows connections to itself and Supabase only, and
 * `fetch` of a `data:` URL counts as a connection — so on production every
 * picture the server had already fetched was thrown away right here, silently,
 * while local dev (no CSP) kept working. `atob` is string arithmetic, not a
 * connection, and no policy applies to it.
 *
 * Also reports the size of what it stored — what the Inspiration wall needs to
 * reserve a tile's shape before the picture loads. That is the **shrunk**
 * picture's size, which is the one the tile draws.
 *
 * `DREW_BLANK` when the picture decoded and the canvas drew nothing: the caller
 * stores nothing and asks again later (`useLinkUnfurl`), never a black picture.
 */
export async function shrunkFromDataUrl(
  dataUrl: string,
  px: number,
  quality: number,
): Promise<{ thumb: string; width: number; height: number } | typeof DREW_BLANK | null> {
  try {
    const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]*)$/.exec(dataUrl);
    if (!match) return null;
    const binary = atob(match[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: match[1] });
    if (typeof createImageBitmap !== "function") return null;

    return shrinkSized(await createImageBitmap(blob), px, quality);
  } catch {
    return null;
  }
}

/** `shrunkFromDataUrl` without the size; see it for why the decode never touches `fetch`. */
export async function thumbFromDataUrl(
  dataUrl: string,
  px: number,
  quality: number,
): Promise<string | null> {
  const out = await shrunkFromDataUrl(dataUrl, px, quality);
  return out ? out.thumb : null;
}
