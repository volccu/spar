// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { attachment, note } from "../test/fixtures";
import type { Attachment } from "../types";
import {
  allImageText,
  deleteImageText,
  deleteNotes,
  putFile,
  putImageText,
  putNote,
  type ImageTextEntry,
} from "./db";
import {
  IMAGE_TEXT_VERSION,
  SESSION_READS,
  pruneOrphanImageText,
  readPendingImages,
  resetSession,
} from "./imageTextReader";
import { imageAttachments, imageBytesLanded, saveDataOn, useImageTexts } from "./imageText";

/**
 * The reader behind search's view into pictures (FX-A-07). The engine is a fake
 * — what is under test is the bookkeeping around it, which is the PDF reader's
 * bookkeeping: each file read once, every outcome remembered but the engine
 * failing to load, nothing read that is not on this device, nothing kept for a
 * file no note has, a cap per session, and nothing at all under Save-Data.
 */
const imageText = vi.fn();
const closeEngine = vi.fn(async () => {});
vi.mock("../lib/imageWords", () => ({
  imageText: (blob: Blob) => imageText(blob),
  closeEngine: () => closeEngine(),
}));

const picture = (id: string): Attachment => attachment({ id, name: `${id}.png`, mime: "image/png" });

const now = () => Promise.resolve();
const options = (onRead = vi.fn()) => ({ alive: () => true, pause: now, onRead });
const bytes = () => new Blob(["png"], { type: "image/png" });

beforeEach(async () => {
  imageText.mockReset();
  closeEngine.mockClear();
  resetSession();
  await deleteImageText([...(await allImageText()).keys()]);
});

afterEach(() => vi.unstubAllGlobals());

describe("readPendingImages", () => {
  it("reads a picture once, stores what it said, and never reads it again", async () => {
    await putFile("timetable", bytes());
    imageText.mockResolvedValue({ outcome: "text", text: "Ferry timetable" });
    const known = new Map<string, ImageTextEntry>();
    const onRead = vi.fn();

    await readPendingImages([picture("timetable")], known, new Set(), options(onRead));
    expect(onRead).toHaveBeenCalledWith("timetable", {
      v: IMAGE_TEXT_VERSION,
      outcome: "text",
      text: "Ferry timetable",
    });
    expect((await allImageText()).get("timetable")?.text).toBe("Ferry timetable");

    await readPendingImages([picture("timetable")], known, new Set(), options());
    expect(imageText).toHaveBeenCalledTimes(1);
  });

  it("remembers a picture with no writing in it, so it is not tried every session", async () => {
    await putFile("hillside", bytes());
    imageText.mockResolvedValue({ outcome: "none", text: "" });
    await readPendingImages([picture("hillside")], new Map(), new Set(), options());
    expect((await allImageText()).get("hillside")?.outcome).toBe("none");
  });

  it("leaves a picture whose bytes are on the other device, and never fetches it", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const absent = new Set<string>();
    await readPendingImages([picture("elsewhere")], new Map(), absent, options());
    expect(imageText).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
    expect(absent.has("elsewhere")).toBe(true);
    expect((await allImageText()).has("elsewhere")).toBe(false);
  });

  it("records nothing when the engine will not load, and stops there", async () => {
    await putFile("first", bytes());
    await putFile("second", bytes());
    imageText.mockRejectedValue(new Error("Failed to fetch /ocr/worker.min.js"));
    await readPendingImages([picture("first"), picture("second")], new Map(), new Set(), options());
    expect(imageText).toHaveBeenCalledTimes(1);
    expect((await allImageText()).size).toBe(0);
  });

  it("reads again what an older reader read", async () => {
    await putFile("old", bytes());
    imageText.mockResolvedValue({ outcome: "text", text: "better" });
    const known = new Map([["old", { v: IMAGE_TEXT_VERSION - 1, outcome: "none" as const, text: "" }]]);
    await readPendingImages([picture("old")], known, new Set(), options());
    expect(known.get("old")?.text).toBe("better");
  });

  it("stops when the pass is no longer wanted", async () => {
    await putFile("unwanted", bytes());
    await readPendingImages([picture("unwanted")], new Map(), new Set(), {
      ...options(),
      alive: () => false,
    });
    expect(imageText).not.toHaveBeenCalled();
  });

  it("lets the engine go at the end of a pass that used it, and not otherwise", async () => {
    await putFile("used", bytes());
    imageText.mockResolvedValue({ outcome: "none", text: "" });
    await readPendingImages([picture("used")], new Map(), new Set(), options());
    expect(closeEngine).toHaveBeenCalledTimes(1);
    closeEngine.mockClear();
    await readPendingImages([picture("not-here")], new Map(), new Set(), options());
    expect(closeEngine).not.toHaveBeenCalled();
  });

  it("reads no more than the session's share, however many are waiting", async () => {
    const many = Array.from({ length: SESSION_READS + 5 }, (_, i) => picture(`p${i}`));
    for (const att of many) await putFile(att.id, bytes());
    imageText.mockResolvedValue({ outcome: "none", text: "" });
    await readPendingImages(many, new Map(), new Set(), options());
    expect(imageText).toHaveBeenCalledTimes(SESSION_READS);
    // The next session carries on where this one stopped.
    resetSession();
    imageText.mockClear();
    await readPendingImages(many, await allImageText(), new Set(), options());
    expect(imageText).toHaveBeenCalledTimes(5);
  });
});

describe("pruneOrphanImageText", () => {
  it("drops the words of a picture no note carries, and keeps the rest", async () => {
    await putNote(note({ id: "keeps", attachments: [picture("kept")] }));
    await putNote(note({ id: "goes", attachments: [picture("held")] }));
    // Destroyed here, not yet confirmed by the server: the marker still holds
    // its files, and a refused delete brings the note back whole.
    await deleteNotes(["goes"]);
    const entry = { v: IMAGE_TEXT_VERSION, outcome: "text" as const, text: "x" };
    for (const id of ["kept", "held", "orphan"]) await putImageText(id, entry);

    const known = await allImageText();
    expect(await pruneOrphanImageText(known)).toBe(1);
    expect([...(await allImageText()).keys()].sort()).toEqual(["held", "kept"]);
    expect(known.has("orphan")).toBe(false);
  });
});

describe("imageAttachments", () => {
  it("lists the pictures of every note but the ones in the trash, and no documents", () => {
    const doc = attachment({ id: "doc", name: "lease.pdf", mime: "application/pdf" });
    const notes = [
      note({ id: "a", attachments: [picture("one"), doc] }),
      note({ id: "b", status: "archived", attachments: [picture("two")] }),
      note({ id: "c", status: "trashed", attachments: [picture("three")] }),
    ];
    expect(imageAttachments(notes).map((att) => att.id)).toEqual(["one", "two"]);
  });
});

describe("useImageTexts", () => {
  it("hands search what was read before, then what it reads now", async () => {
    await putImageText("before", { v: IMAGE_TEXT_VERSION, outcome: "text", text: "earlier words" });
    await putFile("now", bytes());
    imageText.mockResolvedValue({ outcome: "text", text: "fresh words" });
    const notes = [note({ id: "hook-a", attachments: [picture("before"), picture("now")] })];
    await putNote(notes[0]);

    const { result } = renderHook(() => useImageTexts(notes, { startAfterMs: 0 }));
    await waitFor(() => expect(result.current.get("now")).toBe("fresh words"));
    expect(result.current.get("before")).toBe("earlier words");
    expect(imageText).toHaveBeenCalledTimes(1);
  });

  it("reads a picture whose bytes arrive after it was first skipped", async () => {
    imageText.mockResolvedValue({ outcome: "text", text: "arrived" });
    const notes = [note({ id: "hook-b", attachments: [picture("later")] })];
    await putNote(notes[0]);
    const { result } = renderHook(() => useImageTexts(notes, { startAfterMs: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(imageText).not.toHaveBeenCalled();

    await putFile("later", bytes());
    act(() => imageBytesLanded());
    await waitFor(() => expect(result.current.get("later")).toBe("arrived"));
  });

  it("does nothing at all while the browser is asked to save data", async () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } });
    expect(saveDataOn()).toBe(true);
    await putFile("frugal", bytes());
    imageText.mockResolvedValue({ outcome: "text", text: "never" });
    const notes = [note({ id: "hook-c", attachments: [picture("frugal")] })];
    await putNote(notes[0]);
    const { result } = renderHook(() => useImageTexts(notes, { startAfterMs: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(imageText).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });
});
