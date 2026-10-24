import { describe, expect, it } from "vitest";
import { stripFilmLocation } from "./filmStrip";

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
/** One box: [size][type][contents]. */
const box = (kind: string, ...parts: number[][]): number[] => {
  const body = parts.flat();
  return [...be32(body.length + 8), ...enc(kind), ...body];
};
const PLACE = "+60.1699+024.9384/";
const film = (...moovParts: number[][]) =>
  new Uint8Array([
    ...box("ftyp", enc("isom"), be32(0), enc("isommp41")),
    ...box("mdat", Array.from({ length: 64 }, (_, i) => i)),
    ...box("moov", ...moovParts),
  ]);
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const has = (bytes: Uint8Array, s: string) => {
  const needle = enc(s);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

describe("stripFilmLocation (audit BUG-8)", () => {
  it("takes an Android film's ©xyz out without moving a byte of the frames", async () => {
    const before = film(box("mvhd", be32(0)), box("udta", box("©xyz", [0, PLACE.length, 0x15, 0xc7], enc(PLACE))));
    const out = await stripFilmLocation(new Blob([before as BlobPart], { type: "video/mp4" }));
    expect(out).not.toBeNull();
    const after = await bytesOf(out!);
    expect(after.length).toBe(before.length);
    expect(has(after, PLACE)).toBe(false);
    expect(has(after, "free")).toBe(true);
    // Everything up to the index — the frames included — is untouched.
    const moovAt = 24 + 72; // ftyp, then the frames
    expect(Array.from(after.subarray(0, moovAt))).toEqual(Array.from(before.subarray(0, moovAt)));
    expect(out!.type).toBe("video/mp4");
  });

  it("takes an iPhone's keyed place out, and leaves the other keys", async () => {
    const key = (name: string) => box("mdta", enc(name));
    const value = (n: number, text: string) => box(String.fromCharCode(...be32(n)), box("data", be32(1), be32(0), enc(text)));
    const before = film(
      box(
        "meta",
        box("hdlr", be32(0), be32(0), enc("mdta"), be32(0), be32(0), be32(0), [0]),
        box("keys", be32(0), be32(2), key("com.apple.quicktime.make"), key("com.apple.quicktime.location.ISO6709")),
        box("ilst", value(1, "Apple"), value(2, PLACE)),
      ),
    );
    const out = await stripFilmLocation(new Blob([before as BlobPart], { type: "video/quicktime" }));
    const after = await bytesOf(out!);
    expect(after.length).toBe(before.length);
    expect(has(after, PLACE)).toBe(false);
    expect(has(after, "location")).toBe(false);
    expect(has(after, "Apple")).toBe(true);
    expect(has(after, "com.apple.quicktime.make")).toBe(true);
  });

  it("hands back the same file when there is no place in it", async () => {
    const file = new Blob([film(box("mvhd", be32(0))) as BlobPart], { type: "video/mp4" });
    expect(await stripFilmLocation(file)).toBe(file);
  });

  it("leaves alone what it cannot read with confidence", async () => {
    // Not a film at all.
    expect(await stripFilmLocation(new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])]))).toBeNull();
    // A box inside the index that runs past its parent.
    const broken = film(box("udta", [...be32(400), ...enc("©xyz")]));
    expect(await stripFilmLocation(new Blob([broken as BlobPart]))).toBeNull();
    // A film whose last box claims more bytes than the file has.
    const short = film(box("udta")).subarray(0, -1);
    expect(await stripFilmLocation(new Blob([short as BlobPart]))).toBeNull();
  });

  it("leaves a film with a telemetry track alone: the place is in its samples", async () => {
    const gopro = film(
      box("udta", box("©xyz", [0, PLACE.length, 0, 0], enc(PLACE))),
      box("trak", box("mdia", box("minf", box("stbl", box("stsd", be32(0), be32(1), box("gpmd", be32(0))))))),
    );
    expect(await stripFilmLocation(new Blob([gopro as BlobPart]))).toBeNull();
  });
});
