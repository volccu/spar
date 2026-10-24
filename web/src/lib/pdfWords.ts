/**
 * A PDF, read for its words.
 *
 * `lib/pdf.ts` draws documents; this reads them, so search can match what a
 * receipt or a lease actually says rather than only its filename. Reached only
 * from `store/pdfTextReader.ts`, which the app loads by dynamic import at idle
 * — so, like the engine it uses, nothing here is on the first paint.
 */
import { load } from "./pdf";

/**
 * How much of a document's text layer search keeps, per file.
 *
 * A hundred thousand characters is forty-odd pages of dense prose — every
 * receipt, lease, manual and boarding pass the Files board actually holds, and
 * the opening of the rare book-length one. Search reads this on every
 * keystroke (bounded by `REPEAT_MAX` in `lib/search.ts`, so a hit costs a
 * handful of `indexOf`s), and it sits in IndexedDB beside the file, so the
 * ceiling is what keeps one scanned-to-text textbook from being the slowest
 * thing about typing a query.
 */
export const PDF_TEXT_CHARS = 100_000;
/** Pages read before giving up on reaching the character ceiling. */
export const PDF_TEXT_PAGES = 300;
/**
 * Past this, the file is not opened for its words at all. The whole document
 * is handed to the worker in memory, and a 200 MB scan on the phone is how a
 * tab gets killed in the background for a search nobody has typed yet.
 */
export const PDF_TEXT_BYTES = 40 * 1024 * 1024;

/**
 * What reading a document's words came to.
 *
 * Every outcome but a failed *library* load is final for that file on this
 * device, and is stored as such so it is never tried again: a locked document
 * stays locked, a scan has no text layer to find, and a file pdf.js refuses
 * today it will refuse tomorrow. Only `text` carries anything search can use.
 */
export type PdfTextOutcome = "text" | "none" | "locked" | "unreadable" | "large";

export interface PdfText {
  outcome: PdfTextOutcome;
  /** Empty unless `outcome` is "text". At most `PDF_TEXT_CHARS` long. */
  text: string;
}

/**
 * The words on the pages, for search to match against.
 *
 * Needs no canvas: the text layer is read, not drawn, so this works wherever
 * the library loads. Runs one page at a time, and the parsing itself happens
 * in pdf.js's worker, so the main thread only ever joins strings.
 *
 * **Runs are joined with nothing between them.** pdf.js already hands over
 * the spaces a page has as text of their own, and a line break as `hasEOL`;
 * what it does not mark is the seam where one word was set as two runs (a
 * kerned pair, a change of font mid-word). A space put there would cut
 * "Tampere" into two words and lose it to every query. Joining tight can at
 * worst run two words together, and search matches inside a word anyway.
 *
 * **NFKC, not NFC.** A PDF's text layer is full of presentation forms — the
 * `ﬁ` and `ﬂ` ligatures above all — which are one character on the page and
 * two in anybody's query. Folded once here, on the way in, a search for
 * "office" finds the "oﬃce" a typesetter wrote.
 *
 * **Throws only when the library itself could not be loaded** — half a
 * megabyte over the network, lost to a lift as `load()` says. That is the one
 * failure worth another try, so the caller must not record it; every other
 * failure is answered as an outcome.
 */
export async function pdfText(file: Blob): Promise<PdfText> {
  if (file.size > PDF_TEXT_BYTES) return { outcome: "large", text: "" };
  const pdfjs = await load();
  let task: { destroy: () => unknown } | null = null;
  try {
    const buf = await file.arrayBuffer();
    const loading = pdfjs.getDocument({ data: new Uint8Array(buf) });
    task = loading;
    let doc: Awaited<typeof loading.promise>;
    try {
      doc = await loading.promise;
    } catch (err) {
      // A password is asked for by throwing, under this name. There is no way
      // to hand one over here and no reason to ask the user for it: a locked
      // file is simply a file whose words search does not see.
      return (err as { name?: string } | null)?.name === "PasswordException"
        ? { outcome: "locked", text: "" }
        : { outcome: "unreadable", text: "" };
    }
    const pages = Math.min(doc.numPages, PDF_TEXT_PAGES);
    let text = "";
    for (let n = 1; n <= pages && text.length < PDF_TEXT_CHARS; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      for (const item of content.items) {
        // Marked-content boundaries come through the same list with no
        // `str`; they carry structure, not words.
        if (!("str" in item)) continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
      }
      text += "\n";
      page.cleanup();
    }
    text = text
      .normalize("NFKC")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ ?\n\s*/g, "\n")
      .trim()
      .slice(0, PDF_TEXT_CHARS);
    return text === "" ? { outcome: "none", text: "" } : { outcome: "text", text };
  } catch {
    // A page that would not give up its text, or a document that fell apart
    // half way through. Whatever was read is not trusted to be whole.
    return { outcome: "unreadable", text: "" };
  } finally {
    void task?.destroy();
  }
}
