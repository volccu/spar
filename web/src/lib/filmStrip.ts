/**
 * Where a film was made, taken out of it (audit BUG-8, 2026-10-10, owner
 * approved: "if it can be done safely; leave the file untouched when unsure").
 *
 * A phone writes the place into an MP4 or a QuickTime film in one of two
 * spots, both inside the film's index (`moov`), never in the pictures:
 *
 * - **`©xyz`** — "+60.1699+024.9384/" in a `udta` box (Android, older
 *   iPhones), or as an item of an `ilst` list. `loci` is the 3GPP cousin.
 * - **`com.apple.quicktime.location.*`** — an iPhone's keyed metadata: a
 *   `keys` box names each key, and the `ilst` beside it holds the values by
 *   number.
 *
 * Nothing is removed and nothing moves. A box's *type* is rewritten to `free`
 * — the type every reader is required to skip — and its contents zeroed; a
 * keyed value has its bytes zeroed and its key renamed. Every box keeps its
 * size, so every offset in the film (the `stco` tables that say where each
 * frame is) stays true, and only the index is ever read into memory: the
 * frames themselves are carried across as slices of the original file.
 *
 * Leave-it-if-unsure, as `exifStrip.ts` does: anything that does not read as
 * a well-formed film — a box that overruns its parent, no `ftyp` first, an
 * index too big to be an index — hands back null, and the caller keeps the
 * file exactly as it came. So does a film that carries a **telemetry track**
 * (`gpmd`, GoPro; `camm`, camera motion), where the place is in the samples
 * themselves and cannot be taken out without rewriting the film.
 */

/** An index larger than this is not one this code will hold in memory. */
const MOOV_MAX = 16 * 1024 * 1024;
/** Top-level boxes walked before giving up on a file as not a film. */
const TOP_MAX = 64;

const FREE = [0x66, 0x72, 0x65, 0x65];

class Unsure extends Error {}

function type(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
}

interface Box {
  type: string;
  /** Where the box starts (its size field). */
  at: number;
  /** Where its contents start, past the header. */
  body: number;
  end: number;
}

/** The boxes directly inside `[from, to)`. Throws `Unsure` on anything malformed. */
function children(bytes: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    if (to - at < 8) throw new Unsure();
    let size = u32(bytes, at);
    let body = at + 8;
    if (size === 1) {
      if (to - at < 16) throw new Unsure();
      const high = u32(bytes, at + 8);
      if (high !== 0) throw new Unsure();
      size = u32(bytes, at + 12);
      body = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < body - at || at + size > to) throw new Unsure();
    out.push({ type: type(bytes, at + 4), at, body, end: at + size });
    at += size;
  }
  return out;
}

/** Retypes a box as `free` and zeroes what it held. */
function free(bytes: Uint8Array, box: Box): void {
  bytes.set(FREE, box.at + 4);
  bytes.fill(0, box.body, box.end);
}

/** Where a `meta` box's children start: QuickTime's has no version field, ISO's has four bytes. */
function metaStart(bytes: Uint8Array, box: Box): number {
  if (box.end - box.body >= 8 && type(bytes, box.body + 4) === "hdlr") return box.body;
  if (box.end - box.body >= 12 && type(bytes, box.body + 8) === "hdlr") return box.body + 4;
  // No handler where either kind keeps it: read as ISO when the version word is zero.
  return u32(bytes, box.body) === 0 ? box.body + 4 : box.body;
}

const PLACE_TYPES = new Set(["©xyz", "loci"]);
const PLACE_KEY = "com.apple.quicktime.location";

/** Takes the place out of a `meta` box. True when anything changed. */
function stripMeta(bytes: Uint8Array, meta: Box): boolean {
  const inside = children(bytes, metaStart(bytes, meta), meta.end);
  let changed = false;
  /** The 1-based numbers the `keys` box gives the place's keys. */
  const placeKeys = new Set<number>();
  const keys = inside.find((b) => b.type === "keys");
  if (keys) {
    // version/flags, then the count, then each key as [size][namespace][name].
    if (keys.end - keys.body < 8) throw new Unsure();
    const count = u32(bytes, keys.body + 4);
    let at = keys.body + 8;
    for (let n = 1; n <= count; n++) {
      if (keys.end - at < 8) throw new Unsure();
      const size = u32(bytes, at);
      if (size < 8 || at + size > keys.end) throw new Unsure();
      const name = String.fromCharCode(...bytes.subarray(at + 8, at + size));
      if (name.startsWith(PLACE_KEY)) {
        placeKeys.add(n);
        // Renamed, same length, so no reader takes it for a place any more.
        for (let i = at + 8 + "com.apple.quicktime.".length; i < at + size; i++) bytes[i] = 0x78;
        changed = true;
      }
      at += size;
    }
  }
  const list = inside.find((b) => b.type === "ilst");
  if (list) {
    for (const item of children(bytes, list.body, list.end)) {
      if (PLACE_TYPES.has(item.type)) {
        free(bytes, item);
        changed = true;
        continue;
      }
      if (!placeKeys.has(u32(bytes, item.at + 4))) continue;
      // The value's `data` box: [size]['data'][type][locale][value]. Only the
      // value is zeroed, so the list still reads as a list.
      for (const data of children(bytes, item.body, item.end)) {
        if (data.type !== "data" || data.end - data.body < 8) continue;
        bytes.fill(0, data.body + 8, data.end);
        changed = true;
      }
    }
  }
  return changed;
}

/** Walks the index for the boxes that hold the place. True when anything changed. */
function stripIndex(bytes: Uint8Array, from: number, to: number): boolean {
  let changed = false;
  for (const box of children(bytes, from, to)) {
    if (PLACE_TYPES.has(box.type)) {
      free(bytes, box);
      changed = true;
    } else if (box.type === "meta") {
      changed = stripMeta(bytes, box) || changed;
    } else if (box.type === "trak" || box.type === "udta") {
      changed = stripIndex(bytes, box.body, box.end) || changed;
    }
  }
  return changed;
}

/** A telemetry track keeps the place in its samples, which this cannot reach. */
function hasTelemetry(bytes: Uint8Array): boolean {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    const t = type(bytes, i);
    if (t === "gpmd" || t === "camm") return true;
  }
  return false;
}

async function read(file: Blob, from: number, to: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(from, to).arrayBuffer());
}

/**
 * The film with its place taken out; the same `file` when it carries none;
 * null when it cannot be read with confidence (the caller then keeps it as it
 * came). Never throws.
 */
export async function stripFilmLocation(file: Blob): Promise<Blob | null> {
  try {
    let at = 0;
    let first = true;
    let moov: { at: number; end: number; body: number } | null = null;
    for (let n = 0; n < TOP_MAX && at < file.size; n++) {
      const head = await read(file, at, Math.min(file.size, at + 16));
      if (head.length < 8) return null;
      const kind = type(head, 4);
      if (first && kind !== "ftyp") return null;
      first = false;
      let size = u32(head, 0);
      let header = 8;
      if (size === 1) {
        if (head.length < 16 || u32(head, 8) !== 0) return null;
        size = u32(head, 12);
        header = 16;
      } else if (size === 0) {
        size = file.size - at;
      }
      if (size < header || at + size > file.size) return null;
      if (kind === "moov") {
        if (moov) return null;
        moov = { at, end: at + size, body: at + header };
      }
      at += size;
    }
    if (at !== file.size || !moov) return null;
    if (moov.end - moov.at > MOOV_MAX) return null;

    const bytes = await read(file, moov.at, moov.end);
    if (hasTelemetry(bytes)) return null;
    const changed = stripIndex(bytes, moov.body - moov.at, bytes.length);
    if (!changed) return file;
    return new Blob([file.slice(0, moov.at), bytes as BlobPart, file.slice(moov.end)], { type: file.type });
  } catch {
    return null;
  }
}
