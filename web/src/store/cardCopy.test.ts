// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit BUG-3 (2026-10-10): opening a board decoded every local photograph at
 * once — a 12 MP photo is ~48 MB of bitmap on a phone — and two cards asking
 * for the same file decoded it twice, leaking the first copy's address.
 */
describe("cardCopy", () => {
  let running = 0;
  let most = 0;
  let decodes = 0;
  const releases: (() => void)[] = [];
  let made = 0;

  beforeEach(() => {
    vi.resetModules();
    running = 0;
    most = 0;
    decodes = 0;
    made = 0;
    releases.length = 0;
    vi.stubGlobal("createImageBitmap", async () => {
      decodes += 1;
      running += 1;
      most = Math.max(most, running);
      // Held until the test lets it go, so the overlap can be counted.
      await new Promise<void>((resolve) => releases.push(resolve));
      running -= 1;
      return { width: 800, height: 600, close() {} };
    });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return realCreate(tag);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage() {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
        }),
        toBlob: (done: (b: Blob | null) => void) => done(new Blob(["small"], { type: "image/webp" })),
      } as unknown as HTMLElement;
    });
    Object.assign(URL, {
      createObjectURL: () => `blob:copy-${++made}`,
      revokeObjectURL: () => {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Lets every decode that is waiting finish, until none is left. */
  async function drain() {
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 0));
      while (releases.length) releases.shift()!();
    }
  }

  it("decodes no more than two photographs at a time", async () => {
    const { cardCopy } = await import("./cardCopy");
    const big = new Blob(["x"], { type: "image/jpeg" });
    const asks = Array.from({ length: 6 }, (_, i) => cardCopy(`f${i}`, big, 4000));
    await drain();
    const urls = await Promise.all(asks);
    expect(new Set(urls).size).toBe(6);
    expect(decodes).toBe(6);
    expect(most).toBe(2);
  });

  it("decodes a file once however many cards ask for it at the same moment", async () => {
    const { cardCopy, keptCopy } = await import("./cardCopy");
    const big = new Blob(["x"], { type: "image/jpeg" });
    const asks = [cardCopy("same", big, 4000), cardCopy("same", big, 4000), cardCopy("same", big, 4000)];
    await drain();
    const urls = await Promise.all(asks);
    expect(decodes).toBe(1);
    expect(new Set(urls).size).toBe(1);
    // One address made, and it is the session's: no card revokes it.
    expect(made).toBe(1);
    expect(keptCopy("same")).toBe(true);
  });
});
