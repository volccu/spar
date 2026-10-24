import { nowIso } from "./when";
import type { Attachment } from "../types";
import { isPdf, pdfThumb } from "./pdf";
import { looksLikeImage, mimeFor, THUMB_PX, THUMB_QUALITY } from "./files";
import { shrink } from "./shrink";

/**
 * A file's face and size, made the moment it is attached — split out of
 * `files.ts` and reached by a dynamic import from the store's attach paths
 * (`store/useNotes.ts`), because nothing on the first paint attaches anything
 * and the first paint has a ceiling (`buildInvariants.test.ts`).
 */

interface Measured {
  thumb: string | null;
  width: number | null;
  height: number | null;
}

/**
 * A tiny JPEG of an image file, plus the size it really is.
 *
 * Returns nothing at all rather than throwing: a file that cannot be decoded
 * is still a perfectly good file to carry, it just shows its name instead of
 * its face. Never block an attach on this.
 */
export async function measure(file: File): Promise<Measured> {
  const empty: Measured = { thumb: null, width: null, height: null };

  // A document has a face too — its first page. It goes through this same
  // function and comes out as the same small JPEG, so everything downstream —
  // the card, the note, the sync, the other device — treats it as a picture
  // without knowing or caring that it came from a PDF.
  if (isPdf(file.type, file.name)) {
    return (await pdfThumb(file, THUMB_PX, THUMB_QUALITY)) ?? empty;
  }

  // A film's face is a frame of it — the card, the open note and the wall all
  // drew a file mark and four letters for a video before.
  if (mimeFor(file.name, file.type).startsWith("video/")) {
    const { videoFrame } = await import("./mediaFaces");
    return (await videoFrame(file, THUMB_PX, THUMB_QUALITY)) ?? empty;
  }

  // The extension counts as much as the type here, for the same reason it does
  // in `fileKind` and `fileIconKey`: a share arriving with an empty `file.type`
  // used to fall out on this line and be stored with no thumbnail at all, which
  // is what the other device would then have drawn forever.
  if (!looksLikeImage(file.type, file.name)) return empty;
  // A drawing has no pixels for `createImageBitmap` to read from a blob, so it
  // is drawn through an <img> instead — or the other device got a file mark.
  if (mimeFor(file.name, file.type) === "image/svg+xml") {
    const { svgFace } = await import("./mediaFaces");
    return (await svgFace(file, THUMB_PX, THUMB_QUALITY)) ?? empty;
  }
  if (typeof createImageBitmap !== "function") return empty;

  try {
    // A phone photograph decoded whole is about 48 MB of bitmap, to draw a
    // 320px thumbnail. So the picture's size is read first — which the browser
    // can answer from the file's header — and the decode is asked for at
    // thumbnail size directly. Only the width is given, so the height follows
    // the bitmap's own proportions and nothing can be stretched even if the two
    // disagree about which way up the photograph is. Anything that will not
    // answer that way falls back to the whole decode this always did.
    const size = await naturalSize(file);
    if (size) {
      const scale = Math.min(1, THUMB_PX / Math.max(size.width, size.height));
      const small = await createImageBitmap(file, {
        resizeWidth: Math.max(1, Math.round(size.width * scale)),
        resizeQuality: "high",
      }).catch(() => null);
      if (small) {
        return { thumb: shrink(small, THUMB_PX, THUMB_QUALITY), width: size.width, height: size.height };
      }
    }
    const bitmap = await createImageBitmap(file);
    // Read before `shrink` closes the bitmap — a closed one measures 0 × 0.
    const { width, height } = bitmap;
    return { thumb: shrink(bitmap, THUMB_PX, THUMB_QUALITY), width, height };
  } catch {
    return empty;
  }
}

/** How long an image may take to say how big it is before the whole decode
 *  is used instead. */
const SIZE_WAIT_MS = 3_000;

/**
 * A picture's width and height as the browser shows it (turned upright),
 * without decoding it — or null where the browser will not say. Loading an
 * `<img>` reads the header; the pixels are decoded only when it is drawn,
 * and this one never is.
 */
function naturalSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (answer: { width: number; height: number } | null) => {
      window.clearTimeout(timer);
      img.onload = img.onerror = null;
      URL.revokeObjectURL(url);
      resolve(answer);
    };
    const timer = window.setTimeout(() => done(null), SIZE_WAIT_MS);
    img.onload = () =>
      done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/** Everything a note needs to know about a file, before it is stored. */
/** How many files are read for their faces at once. More would hold several
 *  decodes in memory together on a phone; one at a time was the slow path. */
const DESCRIBE_AT_ONCE = 3;

/**
 * `describe` for a batch — several photographs shared at once — a few at a
 * time rather than strictly one after another, answered in the order given.
 */
export async function describeAll(files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = new Array(files.length);
  let next = 0;
  const lane = async () => {
    while (next < files.length) {
      const i = next++;
      out[i] = await describe(files[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DESCRIBE_AT_ONCE, files.length) }, lane));
  return out;
}

export async function describe(file: File): Promise<Attachment> {
  const { thumb, width, height } = await measure(file);
  return {
    id: crypto.randomUUID(),
    name: file.name || "file",
    // What the browser knows, or what the name says when it knows nothing —
    // never a guess. This is the value `isImage`, `canPreview` and the upload's
    // own `contentType` (`store/attachments.ts`) are all read off, so an empty
    // one is a picture that cannot be opened and is served back as a download.
    mime: mimeFor(file.name, file.type),
    size: file.size,
    width,
    height,
    thumb,
    path: null,
    added_at: nowIso(),
  };
}
