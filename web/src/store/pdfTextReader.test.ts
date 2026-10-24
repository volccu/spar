// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { attachment, note } from "../test/fixtures";
import type { Attachment } from "../types";
import {
  allPdfText,
  deleteNotes,
  deletePdfText,
  putFile,
  putNote,
  putPdfText,
  type PdfTextEntry,
} from "./db";
import { PDF_TEXT_VERSION, pruneOrphanPdfText, readPendingPdfs } from "./pdfTextReader";
import { pdfAttachments, pdfBytesLanded, usePdfTexts } from "./pdfText";

/**
 * The reader behind search's view into documents. The engine is stood in for
 * — what is under test is the bookkeeping around it: each file read once,
 * every outcome remembered but the one that is the network's fault, nothing
 * read that is not on this device, and nothing kept for a file no note has.
 */
const pdfText = vi.fn();
vi.mock("../lib/pdfWords", () => ({ pdfText: (blob: Blob) => pdfText(blob) }));

const pdf = (id: string): Attachment =>
  attachment({ id, name: `${id}.pdf`, mime: "application/pdf" });

const now = () => Promise.resolve();
const options = (onRead = vi.fn()) => ({ alive: () => true, pause: now, onRead });

beforeEach(async () => {
  pdfText.mockReset();
  await deletePdfText([...(await allPdfText()).keys()]);
});

describe("readPendingPdfs", () => {
  it("reads a document once, stores what it said, and never reads it again", async () => {
    await putFile("lease", new Blob(["%PDF"]));
    pdfText.mockResolvedValue({ outcome: "text", text: "Tampere" });
    const known = new Map<string, PdfTextEntry>();
    const onRead = vi.fn();

    await readPendingPdfs([pdf("lease")], known, new Set(), options(onRead));
    expect(onRead).toHaveBeenCalledWith("lease", {
      v: PDF_TEXT_VERSION,
      outcome: "text",
      text: "Tampere",
    });
    expect((await allPdfText()).get("lease")?.text).toBe("Tampere");

    await readPendingPdfs([pdf("lease")], known, new Set(), options());
    expect(pdfText).toHaveBeenCalledTimes(1);
  });

  it("remembers a locked document, so it is not tried every session", async () => {
    await putFile("locked", new Blob(["%PDF"]));
    pdfText.mockResolvedValue({ outcome: "locked", text: "" });
    await readPendingPdfs([pdf("locked")], new Map(), new Set(), options());
    expect((await allPdfText()).get("locked")?.outcome).toBe("locked");
  });

  it("reads again what an older reader read", async () => {
    await putFile("old", new Blob(["%PDF"]));
    pdfText.mockResolvedValue({ outcome: "text", text: "better" });
    const known = new Map([["old", { v: PDF_TEXT_VERSION - 1, outcome: "none" as const, text: "" }]]);
    await readPendingPdfs([pdf("old")], known, new Set(), options());
    expect(known.get("old")?.text).toBe("better");
  });

  it("leaves a document whose bytes are on the other device, and says so", async () => {
    const absent = new Set<string>();
    await readPendingPdfs([pdf("elsewhere")], new Map(), absent, options());
    expect(pdfText).not.toHaveBeenCalled();
    expect(absent.has("elsewhere")).toBe(true);
    expect((await allPdfText()).has("elsewhere")).toBe(false);
  });

  it("records nothing when the engine will not load, and stops there", async () => {
    await putFile("first", new Blob(["%PDF"]));
    await putFile("second", new Blob(["%PDF"]));
    pdfText.mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    await readPendingPdfs([pdf("first"), pdf("second")], new Map(), new Set(), options());
    expect(pdfText).toHaveBeenCalledTimes(1);
    expect((await allPdfText()).size).toBe(0);
  });

  it("stops when the pass is no longer wanted", async () => {
    await putFile("unwanted", new Blob(["%PDF"]));
    await readPendingPdfs([pdf("unwanted")], new Map(), new Set(), {
      ...options(),
      alive: () => false,
    });
    expect(pdfText).not.toHaveBeenCalled();
  });
});

describe("pruneOrphanPdfText", () => {
  it("drops the words of a document no note carries, and keeps the rest", async () => {
    await putNote(note({ id: "keeps", attachments: [pdf("kept")] }));
    await putNote(note({ id: "goes", attachments: [pdf("held")] }));
    // Destroyed here, not yet confirmed by the server: the marker still holds
    // its files, and a refused delete brings the note back whole.
    await deleteNotes(["goes"]);
    const entry = { v: PDF_TEXT_VERSION, outcome: "text" as const, text: "x" };
    for (const id of ["kept", "held", "orphan"]) await putPdfText(id, entry);

    const known = await allPdfText();
    expect(await pruneOrphanPdfText(known)).toBe(1);
    expect([...(await allPdfText()).keys()].sort()).toEqual(["held", "kept"]);
    expect(known.has("orphan")).toBe(false);
  });
});

describe("pdfAttachments", () => {
  it("lists the PDFs of every note but the ones in the trash", () => {
    const picture = attachment({ id: "photo", name: "photo.jpg", mime: "image/jpeg" });
    const notes = [
      note({ id: "a", attachments: [pdf("one"), picture] }),
      note({ id: "b", status: "archived", attachments: [pdf("two")] }),
      note({ id: "c", status: "trashed", attachments: [pdf("three")] }),
    ];
    expect(pdfAttachments(notes).map((att) => att.id)).toEqual(["one", "two"]);
  });
});

describe("usePdfTexts", () => {
  it("hands search what was read before, then what it reads now", async () => {
    await putPdfText("before", { v: PDF_TEXT_VERSION, outcome: "text", text: "earlier words" });
    await putFile("now", new Blob(["%PDF"]));
    pdfText.mockResolvedValue({ outcome: "text", text: "fresh words" });
    const notes = [note({ id: "hook-a", attachments: [pdf("before"), pdf("now")] })];
    // In the store as well, or the orphan sweep would rightly take "before".
    await putNote(notes[0]);

    const { result } = renderHook(() => usePdfTexts(notes, { startAfterMs: 0 }));
    await waitFor(() => expect(result.current.get("now")).toBe("fresh words"));
    expect(result.current.get("before")).toBe("earlier words");
    // Read before, so not read again.
    expect(pdfText).toHaveBeenCalledTimes(1);
  });

  it("reads a document whose bytes arrive after it was first skipped", async () => {
    pdfText.mockResolvedValue({ outcome: "text", text: "arrived" });
    const notes = [note({ id: "hook-b", attachments: [pdf("later")] })];
    await putNote(notes[0]);
    const { result } = renderHook(() => usePdfTexts(notes, { startAfterMs: 0 }));
    // Wait for the pass that finds nothing to read.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(pdfText).not.toHaveBeenCalled();

    await putFile("later", new Blob(["%PDF"]));
    act(() => pdfBytesLanded());
    await waitFor(() => expect(result.current.get("later")).toBe("arrived"));
  });
});
