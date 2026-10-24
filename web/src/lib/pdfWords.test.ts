// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDF_TEXT_BYTES, PDF_TEXT_CHARS, pdfText } from "./pdfWords";

// The engine is stood in for, as in `pdf.test.ts`: what is under test is what
// this module makes of the pages it is handed, and what it says when it is
// handed none.
const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: (...args: unknown[]) => getDocument(...args),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.mjs" }));

type Item = { str: string; hasEOL: boolean } | { type: string };

/** A document of these pages, each a list of text runs. */
function document(pages: Item[][], destroy = vi.fn()) {
  getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({
        getTextContent: async () => ({ items: pages[n - 1] }),
        cleanup: () => true,
      }),
    }),
    destroy,
  });
  return destroy;
}

const run = (str: string, hasEOL = false) => ({ str, hasEOL });
const file = (size = 10) => new Blob([new Uint8Array(size)], { type: "application/pdf" });

afterEach(() => {
  getDocument.mockReset();
});

describe("pdfText", () => {
  it("reads the words of every page, line by line", async () => {
    const destroy = document([
      [run("Vuokra"), run("sopimus", true), run("Hämeenkatu 12")],
      [{ type: "beginMarkedContent" }, run("Tampere")],
    ]);
    const read = await pdfText(file());
    expect(read.outcome).toBe("text");
    // Runs are joined tight: a word set as two runs stays one word.
    expect(read.text).toBe("Vuokrasopimus\nHämeenkatu 12\nTampere");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("folds ligatures, so a query can find the word a typesetter joined", async () => {
    document([[run("the oﬃce")]]);
    expect((await pdfText(file())).text).toBe("the office");
  });

  it("says a scan has no words, rather than failing", async () => {
    document([[], [run("   ")]]);
    expect(await pdfText(file())).toEqual({ outcome: "none", text: "" });
  });

  it("keeps no more than the ceiling of a very long document", async () => {
    const page = [run("x".repeat(30_000))];
    document(Array.from({ length: 10 }, () => page));
    const read = await pdfText(file());
    expect(read.text.length).toBe(PDF_TEXT_CHARS);
  });

  it("answers a locked document as locked, and lets its worker go", async () => {
    const destroy = vi.fn();
    getDocument.mockReturnValue({
      promise: Promise.reject(Object.assign(new Error("No password given"), { name: "PasswordException" })),
      destroy,
    });
    expect(await pdfText(file())).toEqual({ outcome: "locked", text: "" });
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("answers a broken document as unreadable", async () => {
    getDocument.mockReturnValue({
      promise: Promise.reject(new Error("Invalid PDF structure")),
      destroy: () => {},
    });
    expect(await pdfText(file())).toEqual({ outcome: "unreadable", text: "" });
  });

  it("does not open a file past the size ceiling at all", async () => {
    // A Blob reports the size it was made with; nothing this big is allocated.
    const huge = { size: PDF_TEXT_BYTES + 1 } as Blob;
    expect(await pdfText(huge)).toEqual({ outcome: "large", text: "" });
    expect(getDocument).not.toHaveBeenCalled();
  });
});
