import { shrinkSized } from "./shrink";

/**
 * Faces for the two kinds of file a photograph's decode cannot read: a film
 * (a frame of it) and a drawing (drawn through an <img>). Split out of
 * `describeFile.ts` and reached by a dynamic import from `measure()`, because they
 * are wanted only when one is attached and the first paint has a ceiling
 * (`buildInvariants.test.ts`).
 */

interface Measured {
  thumb: string | null;
  width: number | null;
  height: number | null;
}

/** How long a film or a drawing may take to give up a face before it goes without one. */
const FACE_WAIT_MS = 6_000;

function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timed out")), ms);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * A frame from a tenth of the way into a film (a second at most — past the fade
 * from black most clips open with), as the same small JPEG a photograph gets,
 * plus the film's own size. Null where this browser cannot play the file —
 * which is then still kept, and still shows its four letters.
 */
export async function videoFrame(file: File, px: number, quality: number): Promise<Measured | null> {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return null;
  if (typeof createImageBitmap !== "function") return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await within(
      FACE_WAIT_MS,
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("video will not load"));
        video.src = url;
      }),
    );
    const at = Number.isFinite(video.duration) ? Math.min(1, video.duration / 10) : 0;
    if (at > 0) {
      await within(
        FACE_WAIT_MS,
        new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          video.currentTime = at;
        }),
      );
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const drawn = shrinkSized(await createImageBitmap(video), px, quality);
    return drawn ? { thumb: drawn.thumb, width, height } : null;
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * A drawing's face: drawn through an <img> onto paper, because a drawing is
 * nearly always made for a light page and its transparent ground would come
 * out of a JPEG black — black lines on black. One with no size of its own is
 * drawn into a square.
 */
export async function svgFace(file: File, px: number, quality: number): Promise<Measured | null> {
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await within(
      FACE_WAIT_MS,
      new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("drawing will not load"));
        img.src = url;
      }),
    );
    const width = img.naturalWidth || px;
    const height = img.naturalHeight || px;
    const scale = px / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // The paper a drawing was made on — the picture's content, not the app's
    // chrome, which is why it is not a token from the ramp.
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const thumb = canvas.toDataURL("image/jpeg", quality);
    return thumb.startsWith("data:image") ? { thumb, width, height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
