// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawPdf, isPdf, pdfThumb } from "./pdf";

// The engine itself is never loaded for real here — it is half a megabyte and
// wants a GPU. What is stood in for it is the one call whose *shape* this bug
// was about: what `getDocument` is asked for.
const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: unknown[]) => getDocument(...args),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.mjs" }));

/**
 * The PDF engine itself is half a megabyte behind a dynamic import and needs a
 * real canvas to do anything at all, so it is not what is tested here. What is:
 * that deciding *whether* something is a PDF costs nothing, and that a place
 * which cannot draw one says so quietly instead of failing an attach.
 */

describe("isPdf", () => {
  it("takes the type when the file has one", () => {
    expect(isPdf("application/pdf", "receipt")).toBe(true);
    expect(isPdf("image/jpeg", "photo.jpg")).toBe(false);
  });

  it("falls back to the name, whatever case it was written in", () => {
    // A file dropped from some folders arrives with an empty type, and a
    // scanner that names its output in capitals is not naming something else.
    expect(isPdf("", "lease.pdf")).toBe(true);
    expect(isPdf("", "LEASE.PDF")).toBe(true);
    expect(isPdf("application/octet-stream", "boarding-pass.Pdf")).toBe(true);
  });

  it("is not fooled by the four letters appearing anywhere else", () => {
    expect(isPdf("", "pdf-notes.txt")).toBe(false);
    expect(isPdf("", "how-to-pdf")).toBe(false);
  });
});

describe("a PDF that cannot be drawn", () => {
  it("gives back nothing rather than failing the attach", async () => {
    // jsdom has no canvas, which is the same situation as a browser that will
    // not render this particular document: the file is still a perfectly good
    // file to carry, and it simply shows its four letters as it always did.
    const file = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    });
    await expect(pdfThumb(file, 320, 0.62)).resolves.toBeNull();
  });
});

describe("drawPdf", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getDocument.mockReset();
  });

  it("hands the engine the bytes, and never a URL for it to fetch", async () => {
    // The regression. This used to pass pdf.js the `blob:` object URL the note
    // row was already drawn from, and pdf.js *fetches* what it is given a URL
    // for. A fetch of a blob URL — one the page made itself, pointing at bytes
    // the page is holding — is still a `connect-src` request, and the deployed
    // Content-Security-Policy does not list `blob:` there. So every document on
    // the real site failed while every thumbnail succeeded, because `pdfThumb`
    // had always passed `{ data }`. Nothing must ever be fetched here again.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D,
    );
    getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 0 }),
      destroy: () => {},
    });

    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const file = new Blob([bytes], { type: "application/pdf" });
    await drawPdf(file, 700, 40, () => true, () => {});

    expect(getDocument).toHaveBeenCalledTimes(1);
    const asked = getDocument.mock.calls[0][0] as Record<string, unknown>;
    expect(asked.url).toBeUndefined();
    expect(asked.data).toEqual(bytes);
  });

  it("destroys the loading task when the document will not open", async () => {
    // The load was awaited above the `try`, so a refused document threw past
    // the `finally` and left the worker that task had started running.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D,
    );
    const destroy = vi.fn();
    getDocument.mockImplementation(() => ({
      promise: Promise.reject(new Error("Invalid PDF structure")),
      destroy,
    }));

    const file = new Blob([new Uint8Array([0x25, 0x50])], { type: "application/pdf" });
    await expect(drawPdf(file, 700, 40, () => true, () => {})).rejects.toThrow("Invalid PDF structure");
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
