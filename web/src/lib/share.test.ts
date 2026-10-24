// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canShare, shareFile, shareNote } from "./share";

function giveShare(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
}

afterEach(() => giveShare(undefined));

describe("shareNote", () => {
  it("is absent where the browser has no sheet", () => {
    expect(canShare()).toBe(false);
  });

  it("hands the words to the sheet as plain text, with no files to give", async () => {
    const share = vi.fn(async () => {});
    giveShare(share);
    expect(canShare()).toBe(true);
    expect(await shareNote("hei", [])).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "hei" });
  });

  /**
   * Closing the sheet is the user changing their mind. The browser says it
   * with an AbortError; the row says nothing at all.
   */
  it("tells a dismissed sheet from a broken one", async () => {
    giveShare(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    expect(await shareNote("hei", [])).toBe("dismissed");

    giveShare(async () => {
      throw new Error("no");
    });
    expect(await shareNote("hei", [])).toBe("failed");
  });
});

describe("shareNote with files", () => {
  afterEach(() =>
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true }),
  );

  it("sends the files where the browser takes them", async () => {
    const share = vi.fn(async () => {});
    giveShare(share);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    const photo = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    expect(await shareNote("", [photo])).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [photo] });
  });

  it("falls back to the words where files are refused, and fails with neither", async () => {
    const share = vi.fn(async () => {});
    giveShare(share);
    Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true });
    const photo = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    expect(await shareNote("hei", [photo])).toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "hei" });
    expect(await shareNote("", [photo])).toBe("failed");
  });
});

/** One file — the viewer's — through the sheet, with its name as the title. */
describe("shareFile", () => {
  afterEach(() =>
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true }),
  );
  const photo = new File(["x"], "photo.jpg", { type: "image/jpeg" });

  it("hands the file and its title to the sheet", async () => {
    const share = vi.fn(async () => {});
    giveShare(share);
    expect(await shareFile(photo, "photo.jpg")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [photo], title: "photo.jpg" });
  });

  it("does not open the sheet for a file the browser says it cannot take", async () => {
    const share = vi.fn(async () => {});
    giveShare(share);
    Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true });
    expect(await shareFile(photo, "photo.jpg")).toBe("failed");
    expect(share).not.toHaveBeenCalled();
  });

  it("fails where there is no sheet, and tells a dismissed sheet from a broken one", async () => {
    expect(await shareFile(photo, "photo.jpg")).toBe("failed");
    giveShare(async () => {
      throw new DOMException("cancelled", "AbortError");
    });
    expect(await shareFile(photo, "photo.jpg")).toBe("dismissed");
    giveShare(async () => {
      throw new Error("no");
    });
    expect(await shareFile(photo, "photo.jpg")).toBe("failed");
  });
});
