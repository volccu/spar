// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { looksLikeHeic, pastedName, prepareFile, prepareFiles } from "./photoPrep";

const noon = new Date(2026, 9, 9, 13, 4);

/** A JPEG whose EXIF holds nothing but a GPS block with one inline entry. */
function jpegWithPlace(): Uint8Array {
  const tiff = [
    0x49, 0x49, 42, 0, 8, 0, 0, 0,
    1, 0, 0x25, 0x88, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 1, 0, 2, 0, 2, 0, 0, 0, 0x4e, 0, 0, 0, 0, 0, 0, 0,
  ];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...body, 0xff, 0xda, 0, 2, 1, 2, 0xff, 0xd9]);
}

describe("pastedName", () => {
  it("names a browser's pasted picture by the day and the minute", () => {
    expect(pastedName("image.png", noon)).toBe("Image 2026-10-09 13.04.png");
    expect(pastedName("IMAGE.JPEG", noon)).toBe("Image 2026-10-09 13.04.jpeg");
  });

  it("leaves every other name alone", () => {
    expect(pastedName("holiday.png", noon)).toBe("holiday.png");
    expect(pastedName("image (1).png", noon)).toBe("image (1).png");
  });
});

describe("looksLikeHeic", () => {
  it("knows one by its type, its name, or its own bytes", async () => {
    expect(await looksLikeHeic(new File(["x"], "a.bin", { type: "image/heic" }))).toBe(true);
    expect(await looksLikeHeic(new File(["x"], "IMG_0001.HEIC"))).toBe(true);
    const box = new Uint8Array([0, 0, 0, 24, ...Array.from("ftypheic", (c) => c.charCodeAt(0))]);
    expect(await looksLikeHeic(new File([box], "shared"))).toBe(true);
  });

  it("does not take an AVIF or a JPEG for one", async () => {
    const avif = new Uint8Array([0, 0, 0, 24, ...Array.from("ftypavif", (c) => c.charCodeAt(0))]);
    expect(await looksLikeHeic(new File([avif], "x.avif", { type: "image/avif" }))).toBe(false);
    expect(await looksLikeHeic(new File([jpegWithPlace() as BlobPart], "x.jpg", { type: "image/jpeg" }))).toBe(false);
  });
});

describe("prepareFile", () => {
  it("takes the place out of a photograph and keeps its name", async () => {
    const before = jpegWithPlace();
    const out = await prepareFile(new File([before as BlobPart], "IMG_1.jpg", { type: "image/jpeg" }), noon);
    expect(out.name).toBe("IMG_1.jpg");
    expect(out.type).toBe("image/jpeg");
    const after = new Uint8Array(await out.arrayBuffer());
    expect(after.length).toBe(before.length);
    expect(Array.from(after).includes(0x4e)).toBe(false);
  });

  it("names a pasted picture and otherwise hands back the same bytes", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "image.png", { type: "image/png" });
    const out = await prepareFile(png, noon);
    expect(out.name).toBe("Image 2026-10-09 13.04.png");
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("hands back a file that is not a picture untouched", async () => {
    const doc = new File(["words"], "notes.txt", { type: "text/plain" });
    expect(await prepareFile(doc, noon)).toBe(doc);
  });

  it("answers in the order given", async () => {
    const a = new File(["a"], "a.txt");
    const b = new File(["b"], "b.txt");
    const c = new File(["c"], "c.txt");
    expect(await prepareFiles([a, b, c], noon)).toEqual([a, b, c]);
  });
});

describe("a see-through photograph made smaller (audit BUG-1)", () => {
  it("is laid on white before it becomes a JPEG, never on black", async () => {
    const ops: string[] = [];
    const ctx = {
      globalCompositeOperation: "source-over",
      fillStyle: "#000000",
      drawImage: () => ops.push("draw"),
      fillRect: () => ops.push(`fill ${ctx.fillStyle} ${ctx.globalCompositeOperation}`),
      // Half see-through, everywhere.
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(128),
      }),
    };
    const realCreate = document.createElement.bind(document);
    const create = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return realCreate(tag);
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toBlob: (done: (b: Blob | null) => void) => {
          ops.push(`encode ${ctx.globalCompositeOperation}`);
          done(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
        },
      } as unknown as HTMLElement;
    });
    vi.stubGlobal("createImageBitmap", async () => ({ width: 5000, height: 2500, close() {} }));
    try {
      const big = new File([new Uint8Array(2_000_000)], "sticker.webp", { type: "image/webp" });
      const out = await prepareFile(big, noon);
      expect(out.type).toBe("image/jpeg");
      expect(ops).toContain("fill white destination-over");
      expect(ops.indexOf("fill white destination-over")).toBeLessThan(ops.indexOf("encode source-over"));
    } finally {
      create.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("a film (audit BUG-8)", () => {
  it("has the place it was filmed taken out, and keeps its name and type", async () => {
    const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
    const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const box = (kind: string, ...parts: number[][]): number[] => {
      const body = parts.flat();
      return [...be32(body.length + 8), ...enc(kind), ...body];
    };
    const place = "+60.1699+024.9384/";
    const bytes = new Uint8Array([
      ...box("ftyp", enc("isom"), be32(0)),
      ...box("mdat", [1, 2, 3, 4]),
      ...box("moov", box("udta", box("\u00a9xyz", [0, 18, 0, 0], enc(place)))),
    ]);
    const out = await prepareFile(new File([bytes as BlobPart], "VID_1.mp4", { type: "video/mp4" }), noon);
    expect(out.name).toBe("VID_1.mp4");
    expect(out.type).toBe("video/mp4");
    const after = String.fromCharCode(...new Uint8Array(await out.arrayBuffer()));
    expect(after.length).toBe(bytes.length);
    expect(after.includes(place)).toBe(false);
  });
});
