/**
 * Where a photograph was taken, taken out of it — and nothing else touched.
 *
 * A phone writes the place into every photograph it takes (EXIF's GPS block),
 * and the app used to keep it: upload, share, Save and the export all handed
 * the original bytes on, so a photo shared out of a note told whoever got it
 * where the owner's kitchen is. This removes it on the way in, once, so no
 * door after that has to remember to.
 *
 * Surgical rather than a re-encode, because a re-encode costs quality and
 * throws away the orientation the browser turns the picture upright by. So the
 * GPS block is emptied **in place**: every byte of its values zeroed, its
 * entry count set to 0, the pointer to it left pointing at what is now a valid,
 * empty block — nothing moves, so every other offset in the file stays true.
 * An XMP packet (Adobe's metadata, which can carry the same coordinates as
 * text) is dropped whole; the browser never reads it for anything it draws.
 *
 * JPEG only — what a camera writes. A file this cannot read with complete
 * confidence comes back **unchanged** rather than half-edited: a photo that
 * still carries its place is the old behaviour, a photo that no longer opens
 * would be a new loss.
 */

const GPS_POINTER = 0x8825;
/** Bytes per value, by TIFF field type (1-based; 0 is not a type). */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  if (at + prefix.length > bytes.length) return false;
  return prefix.every((b, i) => bytes[at + i] === b);
}

function isXmp(bytes: Uint8Array, at: number, end: number): boolean {
  if (at + XMP_HEADER.length > end) return false;
  for (let i = 0; i < XMP_HEADER.length; i++) {
    if (bytes[at + i] !== XMP_HEADER.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Empties the GPS block of the TIFF structure inside one EXIF segment, in
 * place. False when the structure is not one this can vouch for.
 */
function emptyGps(seg: Uint8Array): boolean {
  if (seg.length < 8) return false;
  const little = seg[0] === 0x49 && seg[1] === 0x49;
  const big = seg[0] === 0x4d && seg[1] === 0x4d;
  if (!little && !big) return false;
  const view = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) return false;

  const ifd0 = u32(4);
  if (ifd0 + 2 > seg.length) return false;
  const count0 = u16(ifd0);
  if (ifd0 + 2 + count0 * 12 > seg.length) return false;
  let gps = -1;
  for (let i = 0; i < count0; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (u16(entry) === GPS_POINTER) gps = u32(entry + 8);
  }
  if (gps < 0) return true; // nothing to take out
  if (gps + 2 > seg.length) return false;
  const n = u16(gps);
  if (gps + 2 + n * 12 > seg.length) return false;

  // Every value first, while the entries that say where they are still exist.
  for (let i = 0; i < n; i++) {
    const entry = gps + 2 + i * 12;
    const type = u16(entry + 2);
    const size = (TYPE_SIZE[type] ?? 0) * u32(entry + 4);
    if (size > 4) {
      const at = u32(entry + 8);
      if (at + size > seg.length) return false;
      seg.fill(0, at, at + size);
    }
  }
  seg.fill(0, gps + 2, gps + 2 + n * 12);
  view.setUint16(gps, 0, little);
  return true;
}

/**
 * The JPEG's bytes with the place it was taken removed, or the bytes as they
 * came where there was no place in them or they could not be read safely.
 */
export function stripJpegLocation(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input;
  const bytes = input.slice();
  const keep: [number, number][] = [[0, 2]];
  let at = 2;
  let changed = false;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return input;
    const marker = bytes[at + 1];
    // Start of the picture data: the rest is pixels, kept as it is.
    if (marker === 0xda || marker === 0xd9) {
      keep.push([at, bytes.length]);
      break;
    }
    // A fill byte, or a marker with no length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push([at, at + 2]);
      at += 2;
      continue;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return input;
    const body = at + 4;
    if (marker === 0xe1 && startsWith(bytes, body, EXIF_HEADER)) {
      const tiff = bytes.subarray(body + EXIF_HEADER.length, end);
      const before = tiff.slice();
      if (!emptyGps(tiff)) return input;
      if (tiff.some((b, i) => b !== before[i])) changed = true;
      keep.push([at, end]);
    } else if (marker === 0xe1 && isXmp(bytes, body, end)) {
      changed = true; // dropped
    } else {
      keep.push([at, end]);
    }
    at = end;
  }
  if (!changed) return input;
  const size = keep.reduce((sum, [from, to]) => sum + (to - from), 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const [from, to] of keep) {
    out.set(bytes.subarray(from, to), o);
    o += to - from;
  }
  return out;
}

function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * The same for a WebP (bughunt 2026-10-15): a phone can save a photograph as
 * WebP, and one small enough to skip the redraw kept its place. Its EXIF chunk
 * is the same TIFF structure, emptied in place the same way; an XMP chunk is
 * dropped whole, its flag cleared and the file's length told. Anything this
 * cannot read with complete confidence comes back unchanged.
 */
export function stripWebpLocation(input: Uint8Array): Uint8Array {
  if (input.length < 12 || fourCC(input, 0) !== "RIFF" || fourCC(input, 8) !== "WEBP") return input;
  const bytes = input.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) return input;
  const keep: [number, number][] = [[0, 12]];
  let vp8x = -1;
  let changed = false;
  let at = 12;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return input;
    const id = fourCC(bytes, at);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size & 1);
    if (end > bytes.length) return input;
    if (id === "VP8X") vp8x = at + 8;
    if (id === "EXIF") {
      const body = at + 8;
      const skip = startsWith(bytes, body, EXIF_HEADER) ? EXIF_HEADER.length : 0;
      const tiff = bytes.subarray(body + skip, body + size);
      const before = tiff.slice();
      if (!emptyGps(tiff)) return input;
      if (tiff.some((b, i) => b !== before[i])) changed = true;
      keep.push([at, end]);
    } else if (id === "XMP ") {
      changed = true; // dropped
    } else {
      keep.push([at, end]);
    }
    at = end;
  }
  if (!changed) return input;
  if (vp8x >= 0) bytes[vp8x] &= ~0x04; // no XMP any more
  const total = keep.reduce((sum, [from, to]) => sum + (to - from), 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const [from, to] of keep) {
    out.set(bytes.subarray(from, to), o);
    o += to - from;
  }
  new DataView(out.buffer).setUint32(4, total - 8, true);
  return out;
}
