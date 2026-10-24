/**
 * A PDF, drawn.
 *
 * A PDF is the one common attachment that is obviously a *document* and yet
 * arrives with nothing to look at: the card showed the four letters "PDF" and
 * the note showed them again, so a receipt and a lease and a boarding pass were
 * three identical grey boxes. Everything the file feature is for — recognising
 * what you sent yourself, at a glance, without reading — stopped at the image
 * types. This closes that.
 *
 * Two jobs, one library:
 *
 *   The first page becomes the note's thumbnail, through exactly the same
 *   pipeline an image uses. That is the whole reason to do it this way: the
 *   thumbnail rides inside the note row, so the other device draws the first
 *   page the moment the note syncs and before a byte of the PDF has moved —
 *   which is the trick that makes this beat a drive, and it costs nothing extra
 *   to extend to PDFs.
 *
 *   And the pages are rendered at screen size for the full-screen view, rather
 *   than handed to the browser's own PDF plugin in an iframe. Chrome on Android
 *   has no such plugin, so the iframe version would have worked on the desktop
 *   and shown a blank sheet on the phone — which is the device this feature
 *   exists for.
 *
 * The library is 400kB and is behind a dynamic import for that reason. Nothing
 * on the 90% path — opening the app, scanning the board, capturing, editing —
 * ever reaches this module, so nothing on the 90% path ever downloads it.
 */

type PdfLib = typeof import("pdfjs-dist");

let lib: Promise<PdfLib> | null = null;

/**
 * Loaded once per session, on the first PDF, and never on startup.
 *
 * A failed load is forgotten rather than remembered. The import is half a
 * megabyte over the network, so the common reason to fail is a lift, a tunnel
 * or a dropped connection — and a cached rejected promise would answer every
 * PDF for the rest of the session with the one failure, so the document that
 * would open perfectly ten seconds later never opens at all.
 *
 * Exported for `lib/pdfWords.ts`, which reads a document's text for search and
 * lives in a chunk of its own so none of that rides on the first paint either.
 * One loader, so the engine is fetched once however many things want it.
 */
export function load(): Promise<PdfLib> {
  if (!lib) {
    lib = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // Vite emits the worker as its own asset and hands back its URL. The
      // parsing runs off the main thread, which is what keeps a 200-page
      // document from freezing the note it is being opened from.
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })().catch((err) => {
      lib = null;
      throw err;
    });
  }
  return lib;
}

/**
 * True when this browser can actually paint a canvas.
 *
 * Checked before the import rather than after, so a place that cannot draw
 * anything — jsdom under test, most obviously — never pays to download a PDF
 * engine in order to find that out.
 */
function canDraw(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("2d") !== null;
  } catch {
    return false;
  }
}

export function isPdf(mime: string, name: string): boolean {
  return mime === "application/pdf" || /\.pdf$/i.test(name);
}

/** Renders one page into a canvas at a given width, and returns it. */
async function drawPage(
  doc: Awaited<ReturnType<PdfLib["getDocument"]>["promise"]>,
  n: number,
  width: number,
): Promise<HTMLCanvasElement | null> {
  const page = await doc.getPage(n);
  const unit = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / unit.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // A PDF page is transparent where it has no ink, and a transparent page over
  // a dark screen is unreadable. Paper first, then the page — the same white
  // sheet the document was drawn against.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

export interface PdfThumb {
  thumb: string;
  width: number;
  height: number;
}

/**
 * The first page, as the same small JPEG an image file produces.
 *
 * Returns null for anything at all that goes wrong. A PDF that will not render
 * is still a perfectly good file to carry; it simply shows its four letters
 * again, exactly as it did before this existed. Attaching a file must never
 * fail because of what is inside it.
 */
export async function pdfThumb(file: Blob, px: number, quality: number): Promise<PdfThumb | null> {
  if (!canDraw()) return null;
  let task: { destroy: () => unknown } | null = null;
  try {
    const pdfjs = await load();
    const buf = await file.arrayBuffer();
    const loading = pdfjs.getDocument({ data: new Uint8Array(buf) });
    task = loading;
    const doc = await loading.promise;
    const page = await doc.getPage(1);
    const unit = page.getViewport({ scale: 1 });
    // The long edge lands on the thumbnail budget, whichever edge that is —
    // a page is normally portrait but a scan of a receipt often is not.
    const long = Math.max(unit.width, unit.height);
    const canvas = await drawPage(doc, 1, (px / long) * unit.width);
    if (!canvas) return null;
    const thumb = canvas.toDataURL("image/jpeg", quality);
    if (!thumb.startsWith("data:image")) return null;
    return {
      thumb,
      width: Math.round(unit.width),
      height: Math.round(unit.height),
    };
  } catch {
    return null;
  } finally {
    // `destroy` lives on the loading task, not the document — it is what tears
    // the worker down. In a `finally`, because the interesting case is the page
    // that would not render: that is exactly when the worker is still up, and
    // leaking one per failed attach is how a session ends up with a dozen.
    void task?.destroy();
  }
}

/** One drawn page, as something an <img> can point at. */
export interface PdfPage {
  /** An object URL the caller owns, and must revoke when it is done with it. */
  url: string;
  /** The pixel size it was drawn at, so the layout can reserve its shape. */
  width: number;
  height: number;
}

/** The canvas as a JPEG blob. Null wherever `toBlob` is not implemented. */
function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  if (typeof canvas.toBlob !== "function") return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** How hard the pages are compressed. Text, so not far. */
const PAGE_QUALITY = 0.82;

/**
 * Every page of a document, drawn at `width` and handed over one at a time as
 * a compressed image.
 *
 * One at a time on purpose: the first page appears while the rest are still
 * being drawn, so opening a long document is not a blank screen with a wait on
 * it. `alive` is asked before and after each page, so closing the view stops
 * the work instead of drawing forty pages into a layer nobody is looking at.
 *
 * -- why an image and not the canvas --
 * A canvas holds four bytes per pixel for as long as it is in the document, and
 * a page drawn to fit a phone is about a megapixel — so forty of them is the
 * better part of half a gigabyte, held all at once, on the device least able to
 * spare it. The tab does not survive that. The same page as a JPEG is a couple
 * of hundred kilobytes, the canvas is collectable the moment this returns, and
 * the browser decodes an <img> only while it is near the screen and drops it
 * again afterwards — which is the whole trick, since a reader looks at one page
 * at a time no matter how many there are.
 *
 * -- why the bytes and not a URL --
 * This took a `blob:` URL and let pdf.js *fetch* it, which is the one thing in
 * this app that asked the network layer for bytes it was already holding — and
 * a fetch, even of a blob URL the page made itself, is a `connect-src` request.
 * The deployed Content-Security-Policy does not list `blob:` there, so on the
 * real site every document failed with "cannot draw this document" while its
 * thumbnail, drawn by `pdfThumb` from `{ data }`, came out perfectly. That
 * asymmetry was the bug, and handing the bytes over the way `pdfThumb` already
 * does is what removes it rather than papering over it: no request is made, so
 * no header can refuse it. The buffer is transferred to the worker rather than
 * copied into it, so this costs the document once, not twice.
 */
export async function drawPdf(
  file: Blob,
  width: number,
  max: number,
  alive: () => boolean,
  onPage: (page: PdfPage, n: number, of: number) => void,
): Promise<{ drawn: number; total: number }> {
  if (!canDraw()) throw new Error("no canvas");
  const pdfjs = await load();
  const buf = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
  // The load is awaited *inside* the `try`, as `pdfThumb` does it. Awaited
  // above it, a document pdf.js refused to open threw past the `finally`, and
  // the worker that task had already started was never destroyed — one leaked
  // worker for every broken PDF opened in the session.
  try {
    const doc = await task.promise;
    const total = doc.numPages;
    const pages = Math.min(total, max);
    let drawn = 0;
    for (let n = 1; n <= pages; n++) {
      if (!alive()) return { drawn, total };
      const canvas = await drawPage(doc, n, width);
      if (!canvas) continue;
      const shape = { width: canvas.width, height: canvas.height };
      const blob = await toJpeg(canvas, PAGE_QUALITY);
      // Release the pixels now rather than waiting for the collector to notice
      // — on a long document the next page is already being drawn. Read the
      // shape first: this is what makes the canvas stop holding any.
      canvas.width = 0;
      canvas.height = 0;
      if (!alive()) return { drawn, total };
      if (!blob) continue;
      drawn++;
      onPage({ url: URL.createObjectURL(blob), ...shape }, n, pages);
    }
    return { drawn, total };
  } finally {
    void task.destroy();
  }
}
