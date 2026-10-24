import { describe, expect, it } from "vitest";
import { stripJpegLocation, stripWebpLocation } from "./exifStrip";

/**
 * A JPEG put together by hand: SOI, an EXIF segment (little-endian TIFF, IFD0
 * holding Orientation = 6 and a pointer to a GPS block of a latitude reference
 * and a latitude of three rationals stored out of line), an XMP packet, then
 * the scan and EOI.
 */
function photo({ gps = true, xmp = true } = {}): Uint8Array {
  const tiff: number[] = [];
  const u16 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  // Header: II, 42, IFD0 at 8.
  tiff.push(0x49, 0x49);
  u16(42);
  u32(8);
  // IFD0 at 8: one or two entries, then next-IFD 0.
  const entries0 = gps ? 2 : 1;
  u16(entries0);
  u16(0x0112); u16(3); u32(1); u16(6); u16(0); // Orientation SHORT = 6
  const gpsAt = 8 + 2 + entries0 * 12 + 4;
  if (gps) {
    u16(0x8825); u16(4); u32(1); u32(gpsAt); // GPS pointer
  }
  u32(0);
  if (gps) {
    // GPS IFD: two entries, then next 0, then the latitude's 24 bytes.
    const latAt = gpsAt + 2 + 2 * 12 + 4;
    u16(2);
    u16(0x0001); u16(2); u32(2); tiff.push(0x4e, 0, 0, 0); // GPSLatitudeRef "N"
    u16(0x0002); u16(5); u32(3); u32(latAt); // GPSLatitude, 3 rationals
    u32(0);
    for (const [num, den] of [[60, 1], [10, 1], [3000, 100]]) {
      u32(num);
      u32(den);
    }
  }
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const seg = (marker: number, body: number[]) => {
    const len = body.length + 2;
    return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...body];
  };
  const xmpBody = Array.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta exif:GPSLatitude='60,10N'/>", (c) =>
    c.charCodeAt(0),
  );
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe1, exif),
    ...(xmp ? seg(0xe1, xmpBody) : []),
    ...seg(0xdb, [0, 1, 2, 3]),
    0xff, 0xda, 0, 4, 9, 9, 0x12, 0x34, 0x56, 0xff, 0x00, 0x78,
    0xff, 0xd9,
  ]);
}

function hasBytes(hay: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

describe("stripJpegLocation", () => {
  it("empties the GPS block and drops the XMP packet, keeping the orientation and the pixels", () => {
    const before = photo();
    const after = stripJpegLocation(before);
    expect(after).not.toBe(before);
    // The latitude's rationals (60/1) and the "N" are gone.
    expect(hasBytes(after, [60, 0, 0, 0, 1, 0, 0, 0])).toBe(false);
    expect(hasBytes(after, [0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e])).toBe(false);
    // The XMP packet is gone, coordinates and all.
    expect(new TextDecoder().decode(after).includes("GPSLatitude")).toBe(false);
    // Orientation 6 still there; scan data untouched.
    expect(hasBytes(after, [0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00])).toBe(true);
    expect(hasBytes(after, [0xff, 0xda, 0, 4, 9, 9, 0x12, 0x34, 0x56, 0xff, 0x00, 0x78, 0xff, 0xd9])).toBe(true);
    // The EXIF segment kept its length, so every offset in it is still true.
    expect([after[4], after[5]]).toEqual([before[4], before[5]]);
  });

  it("leaves the GPS pointer aiming at a valid, empty block", () => {
    const after = stripJpegLocation(photo({ xmp: false }));
    const tiff = 2 + 4 + 6; // SOI, segment head, "Exif\0\0"
    const view = new DataView(after.buffer, after.byteOffset + tiff);
    const gpsAt = view.getUint32(8 + 2 + 12 + 8, true);
    expect(view.getUint16(gpsAt, true)).toBe(0);
  });

  it("hands back the very same bytes when there is no place in them", () => {
    const clean = photo({ gps: false, xmp: false });
    expect(stripJpegLocation(clean)).toBe(clean);
  });

  it("hands back what it cannot read, rather than half an edit", () => {
    const broken = photo();
    broken[4] = 0xff; // a segment length running off the end
    broken[5] = 0xff;
    expect(stripJpegLocation(broken)).toBe(broken);
    const notJpeg = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(stripJpegLocation(notJpeg)).toBe(notJpeg);
  });
});

/** A WebP holding the same TIFF block as `photo`, with an XMP chunk if asked. */
function webp({ gps = true, xmp = true } = {}): Uint8Array {
  const jpeg = photo({ gps, xmp: false });
  const tiff = Array.from(jpeg.slice(12, 4 + ((jpeg[4] << 8) | jpeg[5])));
  const ascii = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
  const le32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
  const chunk = (id: string, body: number[]) => [
    ...ascii(id), ...le32(body.length), ...body, ...(body.length & 1 ? [0] : []),
  ];
  const flags = 0x08 | (xmp ? 0x04 : 0);
  const body = [
    ...ascii("WEBP"),
    ...chunk("VP8X", [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...chunk("VP8L", [0x2f, 1, 2, 3, 4]),
    ...chunk("EXIF", tiff),
    ...(xmp ? chunk("XMP ", ascii("<x:xmpmeta exif:GPSLatitude='60,10N'/>")) : []),
  ];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
}

describe("stripWebpLocation", () => {
  it("empties the GPS block and drops the XMP chunk, keeping the orientation and the pixels", () => {
    const after = stripWebpLocation(webp());
    expect(hasBytes(after, [60, 0, 0, 0, 1, 0, 0, 0])).toBe(false);
    expect(new TextDecoder().decode(after).includes("GPSLatitude")).toBe(false);
    expect(hasBytes(after, [0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00])).toBe(true);
    expect(hasBytes(after, [0x2f, 1, 2, 3, 4])).toBe(true);
    // The file says its own new length, and no longer claims an XMP chunk.
    expect(new DataView(after.buffer).getUint32(4, true)).toBe(after.length - 8);
    expect(after[20] & 0x04).toBe(0);
  });

  it("hands back the very same bytes when there is no place in them", () => {
    const clean = webp({ gps: false, xmp: false });
    expect(stripWebpLocation(clean)).toBe(clean);
  });

  it("hands back what it cannot read, rather than half an edit", () => {
    const broken = webp();
    broken[4] = 0xff; // a length that does not match the file
    expect(stripWebpLocation(broken)).toBe(broken);
    const notWebp = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(stripWebpLocation(notWebp)).toBe(notWebp);
  });
});
