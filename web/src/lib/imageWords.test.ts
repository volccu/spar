// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngine, imageText, IMAGE_MIN_CONFIDENCE, IMAGE_TEXT_BYTES, IMAGE_TEXT_CHARS } from "./imageWords";

/**
 * What reading a picture comes to, with a fake engine in place of tesseract.js.
 * Under test: what is trusted, what is folded, what is capped, which failure is
 * an outcome and which one throws so the caller does not record it.
 */
const recognize = vi.fn();
const terminate = vi.fn(async () => {});
const createWorker = vi.fn();
vi.mock("tesseract.js", () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: (...args: unknown[]) => createWorker(...args),
}));

const png = () => new Blob(["png"], { type: "image/png" });
const says = (text: string, confidence = 90) => recognize.mockResolvedValue({ data: { text, confidence } });

beforeEach(async () => {
  await closeEngine();
  recognize.mockReset();
  terminate.mockClear();
  createWorker.mockReset();
  createWorker.mockResolvedValue({ recognize, terminate });
});

describe("imageText", () => {
  it("returns the words, folded to one line spacing and composed", async () => {
    says("Ferry   timetable\n\n  Hämeenkatu 12 ﬁnal");
    expect(await imageText(png())).toEqual({
      outcome: "text",
      text: "Ferry timetable\nHämeenkatu 12 final",
    });
  });

  it("reads English and Finnish from this app's own files, never a CDN", async () => {
    says("hello world");
    await imageText(png());
    const [langs, , options] = createWorker.mock.calls[0];
    expect(langs).toEqual(["eng", "fin"]);
    for (const key of ["workerPath", "corePath", "langPath"]) {
      expect(options[key]).toMatch(/^\/ocr/);
    }
    expect(options.cacheMethod).toBe("none");
  });

  it("starts the engine once for any number of pictures", async () => {
    says("hello world");
    await imageText(png());
    await imageText(png());
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it("answers 'none' for a result too unsure to trust, or with hardly any letters", async () => {
    says("lkj asd", IMAGE_MIN_CONFIDENCE - 1);
    expect(await imageText(png())).toEqual({ outcome: "none", text: "" });
    says("| . ,", 95);
    expect(await imageText(png())).toEqual({ outcome: "none", text: "" });
  });

  it("caps what it keeps", async () => {
    says("word ".repeat(10_000));
    expect((await imageText(png())).text.length).toBeLessThanOrEqual(IMAGE_TEXT_CHARS);
  });

  it("does not open a file past the byte ceiling", async () => {
    const huge = { size: IMAGE_TEXT_BYTES + 1 } as Blob;
    expect(await imageText(huge)).toEqual({ outcome: "large", text: "" });
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("answers 'unreadable' when the engine chokes on the file", async () => {
    recognize.mockRejectedValue(new Error("bad image"));
    expect(await imageText(png())).toEqual({ outcome: "unreadable", text: "" });
  });

  it("throws, and forgets the half-started engine, when it cannot be loaded", async () => {
    createWorker.mockRejectedValueOnce(new Error("Failed to fetch"));
    await expect(imageText(png())).rejects.toThrow("Failed to fetch");
    says("hello world");
    expect((await imageText(png())).outcome).toBe("text");
  });

  it("lets the worker go when asked", async () => {
    says("hello world");
    await imageText(png());
    await closeEngine();
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
