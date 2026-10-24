/**
 * A screenshot or a photograph, read for its words.
 *
 * Keep finds a picture by what is written in it, and a screenshot of a
 * timetable, a receipt or a slide is a note with no words of its own. This
 * reads them **on this device** (tesseract.js, running in a worker of its own)
 * so search can match them like a PDF's text layer. Nothing is sent anywhere:
 * no server, no AI service, no embedding — the engine and its two language
 * files are static files of this app, served under `/ocr/` (copied out of the
 * installed packages by `ocrAssets` in `vite.config.ts` at build time; nothing
 * is committed), fetched from this origin the first time a picture needs
 * reading and kept by a runtime cache rule, never the precache. This is
 * character recognition, which is not the AI layer CLAUDE.md withdrew: it
 * invents nothing and files nothing, and its output is derived text exactly as
 * a PDF's is.
 *
 * Reached only from `store/imageTextReader.ts`, which the app loads by dynamic
 * import at idle — so, like the engine behind it, none of this is on the first
 * paint.
 */

/** How much of a picture's text search keeps, per file. A page of small print is ~5 000. */
export const IMAGE_TEXT_CHARS = 20_000;
/**
 * Past this the file is not decoded at all: a 60 MB camera original on a phone
 * is how a tab gets killed for a search nobody has typed yet.
 */
export const IMAGE_TEXT_BYTES = 30 * 1024 * 1024;
/** The long side a picture is shrunk to before reading. Print stays legible well under this. */
export const IMAGE_READ_SIDE = 2600;
/** A picture with a side shorter than this holds no sentences, only an icon. */
export const IMAGE_MIN_SIDE = 60;
/** Under this mean confidence (0-100) what came back is noise from a photo of a hillside. */
export const IMAGE_MIN_CONFIDENCE = 45;
/** Fewer letters and digits than this is not a word anybody will search for. */
export const IMAGE_MIN_CHARS = 4;

/**
 * What reading a picture's words came to. Every outcome but the engine failing
 * to *load* is final for that file on this device and stored as such: a photo
 * with no writing in it has none tomorrow either.
 *
 * `text` is the only one carrying anything; `none` is no writing found (or too
 * unsure to trust), `unreadable` a file the browser would not decode or the
 * engine choked on, `large` one past `IMAGE_TEXT_BYTES`.
 */
export type ImageTextOutcome = "text" | "none" | "unreadable" | "large";

export interface ImageText {
  outcome: ImageTextOutcome;
  /** Empty unless `outcome` is "text". At most `IMAGE_TEXT_CHARS` long. */
  text: string;
}

/** The two languages the owner reads in. Finnish first-class, like the rest of the app. */
const LANGUAGES = ["eng", "fin"];

interface Engine {
  recognize: (image: Blob) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
}

let engine: Promise<Engine> | null = null;

/**
 * The engine, started once and kept for the pass. **Throws only when it could
 * not be loaded** — the library chunk, the worker, the core or a language file
 * did not arrive, a dropped connection most likely. That is the one failure
 * worth another try, so the caller must not record it; the half-made promise
 * is forgotten so the next call starts afresh.
 */
function start(): Promise<Engine> {
  if (!engine) {
    const base = import.meta.env.BASE_URL;
    engine = import("tesseract.js")
      .then(({ createWorker, OEM }) =>
        createWorker(LANGUAGES, OEM.LSTM_ONLY, {
          workerPath: `${base}ocr/worker.min.js`,
          // A directory: the worker picks the plain, SIMD or relaxed-SIMD build
          // of the core by asking the device what it can run.
          corePath: `${base}ocr`,
          langPath: `${base}ocr`,
          gzip: true,
          // Direct, not through a blob: URL (the CSP would allow it, the extra
          // hop buys nothing), and no copy of the language files in IndexedDB —
          // the service worker's cache already keeps them.
          workerBlobURL: false,
          cacheMethod: "none",
          logger: () => {},
        }),
      )
      .then((worker) => worker as Engine);
    engine.catch(() => {
      engine = null;
    });
  }
  return engine;
}

/**
 * Lets the engine go — its worker holds a hundred-odd megabytes while it
 * lives. Called when a pass is over; the next one starts it again.
 */
export async function closeEngine(): Promise<void> {
  const running = engine;
  engine = null;
  if (!running) return;
  try {
    await (await running).terminate();
  } catch {
    // Already gone, or never started.
  }
}

/**
 * The picture, at a size worth reading. A phone photograph is twelve
 * megapixels; the engine's time and memory go with the square of its side, and
 * print that is legible at all is legible at a fraction of that. Null when the
 * file is not an image the browser can decode, or is too small to hold text.
 * Where the browser cannot resize (no `createImageBitmap` or `OffscreenCanvas`)
 * the file goes in as it is.
 */
async function prepare(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    if (Math.min(width, height) < IMAGE_MIN_SIDE) return null;
    const scale = Math.min(1, IMAGE_READ_SIDE / Math.max(width, height));
    if (scale === 1 || typeof OffscreenCanvas !== "function") return file;
    const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}

/**
 * The words in a picture, for search to match against.
 *
 * NFKC for the reason a PDF's is: one character on the page and two in
 * anybody's query. Whitespace is folded, so a screenshot's column gaps do not
 * cost a phrase its match.
 */
export async function imageText(file: Blob): Promise<ImageText> {
  if (file.size > IMAGE_TEXT_BYTES) return { outcome: "large", text: "" };
  const worker = await start();
  let source: Blob | null;
  try {
    source = await prepare(file);
  } catch {
    return { outcome: "unreadable", text: "" };
  }
  if (!source) return { outcome: "unreadable", text: "" };
  try {
    const { data } = await worker.recognize(source);
    if (data.confidence < IMAGE_MIN_CONFIDENCE) return { outcome: "none", text: "" };
    const text = data.text
      .normalize("NFKC")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n\s*/g, "\n")
      .trim()
      .slice(0, IMAGE_TEXT_CHARS);
    const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    return letters < IMAGE_MIN_CHARS ? { outcome: "none", text: "" } : { outcome: "text", text };
  } catch {
    return { outcome: "unreadable", text: "" };
  }
}
