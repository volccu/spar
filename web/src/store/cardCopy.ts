import { boundedQueue } from "../lib/queue";

/**
 * A photograph decoded to card size, for the board (`useFileUrl`'s `"card"`
 * reach). Its own module, reached by a dynamic import the first time a card
 * draws this device's own bytes, because the first paint has a ceiling
 * (`buildInvariants.test.ts`) and a board of thumbnails never needs it.
 */

/**
 * The widest a card is ever drawn, in device pixels: a desktop column runs to
 * 323 CSS px, and at twice the density that is about 650. A little over, so a
 * screenshot on a card still reads as a screenshot.
 */
const CARD_PX = 800;

/**
 * `"card"` — `"local"`, drawn at card size.
 *
 * On the device a photograph came from, every image card used to hand its
 * `<img>` the original: a 12 MP photo is about 48 MB of decoded bitmap to fill a
 * 300px box, per card, on a phone. The board now gets a copy decoded straight
 * to `CARD_PX` wide, made once per file per session and kept here, so paging
 * back to a board costs nothing. It lives in memory only — nothing new is
 * stored, so the cache sweep, the export and sync never meet it. The open note
 * and the lightbox still read the original (`"any"`), and so does the idea
 * canvas, which zooms. A GIF keeps its animation and an SVG its vectors: both
 * are handed over as they are.
 */
const cardCopies = new Map<string, string>();

/** Whether this copy is the session's to keep — never revoked by the card that asked. */
export function keptCopy(id: string): boolean {
  return cardCopies.has(id);
}
const CARD_COPIES_KEPT = 300;

/**
 * How many photographs are decoded for cards at the same moment, across the
 * whole board (audit BUG-3, 2026-10-10). Opening a board used to start every
 * decode at once — fifty phone photographs is fifty full-size bitmaps in
 * flight, which can stall or kill the tab on a phone — while capture already
 * held itself to two or three. Two, as `prepareFiles` does.
 */
const DECODES_AT_ONCE = 2;
const decodeLane = boundedQueue(DECODES_AT_ONCE);

/**
 * The decode under way for each file, so a second card asking for the same
 * file waits on the first instead of decoding it again. Two decodes of one file
 * used to make two addresses, and the second `set` dropped the first without
 * revoking it. Resolves to the kept copy, or null where the card is to draw the
 * original.
 */
const decoding = new Map<string, Promise<string | null>>();

export async function cardCopy(id: string, blob: Blob, width: number | null): Promise<string> {
  const held = cardCopies.get(id);
  if (held) return held;
  const whole = () => URL.createObjectURL(blob);
  // Already card-sized or smaller (or of unknown size): nothing to save, and a
  // resize would only enlarge it.
  if (width === null || width <= CARD_PX) return whole();
  if (/gif|svg/i.test(blob.type) || typeof createImageBitmap !== "function") return whole();
  let job = decoding.get(id);
  if (!job) {
    job = new Promise<string | null>((resolve) => {
      decodeLane(async () => resolve(await decode(id, blob)));
    });
    decoding.set(id, job);
    void job.then(() => decoding.delete(id));
  }
  // The kept copy is shared by every card; the original is each card's own
  // address, which the card that asked revokes (`useFileUrl`).
  return (await job) ?? whole();
}

/** The card-sized copy, now kept for the session — or null, and the card draws the original. Never throws. */
async function decode(id: string, blob: Blob): Promise<string | null> {
  try {
    const probe = await createImageBitmap(blob, { resizeWidth: CARD_PX, resizeQuality: "high" });
    let url: string;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = probe.width;
      canvas.height = probe.height;
      // The same failure `shrinkSized` (lib/shrink.ts) guards against: a canvas
      // on the graphics card can lose the drawing, and a WebP of an empty
      // canvas is a perfectly valid, perfectly transparent picture — every
      // photograph on a board drawn as the tile's bare backing, and kept that
      // way for the session. Kept in ordinary memory, and asked whether
      // anything was painted before it is encoded; if not, the card draws the
      // original and nothing is remembered, so the next mount tries again.
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(probe, 0, 0);
      if (!ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(Boolean)) return null;
      const small = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.9),
      );
      if (!small) return null;
      url = URL.createObjectURL(small);
    } finally {
      probe.close();
    }
    cardCopies.set(id, url);
    while (cardCopies.size > CARD_COPIES_KEPT) {
      const [oldest, gone] = cardCopies.entries().next().value as [string, string];
      cardCopies.delete(oldest);
      URL.revokeObjectURL(gone);
    }
    return url;
  } catch {
    return null;
  }
}
