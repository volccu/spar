/**
 * A zip file, written by hand, stored rather than compressed — and read back.
 *
 * The export (`lib/exportArchive.ts`) is the only writer, and it needs exactly
 * one thing from a zip: a single file a person can download that every
 * operating system opens without installing anything. So this is the smallest
 * honest writer of the format — local headers, the bytes, a central directory,
 * the end record — and no library.
 *
 * The reader (`openZip`, below the writer) is the Keep import's
 * (`lib/keepSource.ts`): a Google Takeout arrives as a zip, deflated, and can
 * be several gigabytes when the person ticked more than Keep. So it reads by
 * the central directory and slices the file for one entry at a time, never
 * holding the archive in memory, and inflates with the browser's own
 * `DecompressionStream` — no dependency here either.
 *
 * **Stored, not deflated, on purpose.** The archive is a few hundred small
 * text files and a handful of photographs and PDFs, and photographs and PDFs
 * are already compressed: deflate would buy a few kilobytes of text at the cost
 * of a compressor in the bundle. It also keeps a damaged download partly
 * readable, which matters more for a file whose whole job is to outlive the app.
 *
 * Names are UTF-8 and say so (general purpose bit 11), because a folder called
 * *Kök* is the ordinary case here, not an edge. No zip64: the format's 4 GB
 * ceiling is far above anything this archive holds, and a write that would
 * cross it throws rather than producing a file that opens wrong.
 */

export interface ZipEntry {
  /** A path inside the archive, `/`-separated, never starting with `/`. */
  path: string;
  data: Uint8Array;
  /** Stamped on the entry; defaults to the moment of writing. */
  modified?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS time and date, which is what a zip entry carries — local time, two-second grain. */
function dosStamp(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const LIMIT = 0xffffffff;
const UTF8_NAMES = 0x0800;

/**
 * Builds the archive. Every entry is handed over as bytes, so the whole
 * archive is in memory once — fine for a personal archive, and the reason the
 * export reads one file at a time before calling this rather than holding a
 * second copy of each.
 */
export function buildZip(entries: ZipEntry[], now = new Date()): Blob {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const { time, date } = dosStamp(entry.modified ?? now);
    if (size >= LIMIT || offset >= LIMIT) {
      throw new Error("The archive is too large to write as one zip file.");
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, entry.data as Uint8Array<ArrayBuffer>);

    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true); // version made by
    head.setUint16(6, 20, true);
    head.setUint16(8, UTF8_NAMES, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, time, true);
    head.setUint16(14, date, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, size, true);
    head.setUint32(24, size, true);
    head.setUint16(28, name.length, true);
    head.setUint16(30, 0, true); // extra
    head.setUint16(32, 0, true); // comment
    head.setUint16(34, 0, true); // disk
    head.setUint16(36, 0, true); // internal attributes
    head.setUint32(38, 0, true); // external attributes
    head.setUint32(42, offset, true);
    const record = new Uint8Array(46 + name.length);
    record.set(new Uint8Array(head.buffer), 0);
    record.set(name, 46);
    central.push(record);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((n, r) => n + r.length, 0);
  if (entries.length > 0xffff || offset + centralSize >= LIMIT) {
    throw new Error("The archive is too large to write as one zip file.");
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob([...parts, ...(central as Uint8Array<ArrayBuffer>[]), end.buffer], {
    type: "application/zip",
  });
}

/* --- reading ----------------------------------------------------------------
   Enough of the format to take files *out* of an archive somebody else made:
   the end record, the central directory, and each entry's local header, read
   by slicing the `Blob` rather than by loading it. Two methods, because a zip
   holds nothing else in practice: stored (0), which is what `buildZip` writes,
   and deflate (8), which is what Takeout and every desktop zipper write. ZIP64
   is read too — its records are only wider numbers in known places, and a
   Takeout that includes Photos crosses 4 GB as a matter of course — so an
   archive of any size opens, and only the entries asked for are ever read.

   Every entry read is checked against its CRC: a download cut short or a zip
   damaged on the way is refused by name rather than handed on as a picture
   that is half grey.
   -------------------------------------------------------------------------- */

/** One file inside an archive, as its central directory describes it. */
export interface ZipItem {
  /** `/`-separated, as written in the archive. */
  path: string;
  /** Bytes once inflated — known before a byte of it is read. */
  size: number;
  compressedSize: number;
  /** 0 stored, 8 deflated; anything else cannot be read here. */
  method: number;
  crc: number;
  /** Where the entry's local header starts. */
  offset: number;
  /** Bit 0 of the flags: the entry is encrypted, and cannot be read here. */
  encrypted: boolean;
}

export interface ZipArchive {
  /** Every file in the archive — directories are left out, they hold nothing. */
  items: ZipItem[];
  /** The entry's own bytes, inflated and checked. Throws on anything damaged. */
  read(item: ZipItem): Promise<Uint8Array>;
}

const END = 0x06054b50;
const END64 = 0x06064b50;
const END64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * A slice of the file as bytes. `Blob.arrayBuffer` where the platform has it,
 * and `FileReader` where it does not — the one place this code meets a
 * browser's own objects, so the one place a missing method would matter.
 */
export async function bytesOf(blob: Blob, start = 0, end = blob.size): Promise<Uint8Array> {
  const part = blob.slice(start, end);
  if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsArrayBuffer(part);
  });
}

/** A 64-bit little-endian number as a JS number — exact up to 2^53, which is
 *  eight petabytes of archive. */
function u64(view: DataView, at: number): number {
  return Number(view.getBigUint64(at, true));
}

/** Not a zip, or a zip this reader cannot open — said in words a person can act on. */
export class ZipError extends Error {}

/**
 * Opens an archive by its central directory. Reads the tail of the file and
 * the directory, and nothing else; `read` fetches one entry when asked.
 */
export async function openZip(blob: Blob): Promise<ZipArchive> {
  // The end record is 22 bytes plus a comment of up to 65535, so it is in the
  // last 65557 bytes of any zip, and it is found by walking back from the end.
  const tailStart = Math.max(0, blob.size - (22 + 0xffff));
  const tail = await bytesOf(blob, tailStart, blob.size);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let endAt = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === END) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) throw new ZipError("This is not a zip file.");

  let count = tailView.getUint16(endAt + 10, true);
  let dirSize = tailView.getUint32(endAt + 12, true);
  let dirAt = tailView.getUint32(endAt + 16, true);

  // A ZIP64 archive says so by filling the ordinary fields with their maximum
  // and leaving a locator 20 bytes before the end record, pointing at the wide
  // one. Read only when the narrow fields are full, as the format intends.
  if (count === 0xffff || dirSize === LIMIT || dirAt === LIMIT) {
    const locatorAt = endAt - 20;
    if (locatorAt < 0 || tailView.getUint32(locatorAt, true) !== END64_LOCATOR) {
      throw new ZipError("This zip file is damaged: its directory could not be found.");
    }
    const end64At = u64(tailView, locatorAt + 8);
    const end64 = await bytesOf(blob, end64At, end64At + 56);
    const view64 = new DataView(end64.buffer, end64.byteOffset, end64.byteLength);
    if (end64.length < 56 || view64.getUint32(0, true) !== END64) {
      throw new ZipError("This zip file is damaged: its directory could not be found.");
    }
    count = u64(view64, 32);
    dirSize = u64(view64, 40);
    dirAt = u64(view64, 48);
  }
  if (dirAt + dirSize > blob.size) {
    throw new ZipError("This zip file is incomplete. The download may have been cut short.");
  }

  const dir = await bytesOf(blob, dirAt, dirAt + dirSize);
  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const utf8 = new TextDecoder();
  const items: ZipItem[] = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > dir.length || view.getUint32(at, true) !== CENTRAL) {
      throw new ZipError("This zip file is damaged: its directory ends early.");
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    let compressedSize = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    let offset = view.getUint32(at + 42, true);
    // Names are read as UTF-8 whether or not bit 11 says so: every zipper in
    // use today writes UTF-8, and the alternative the format names (code page
    // 437) would turn every å in a Nordic archive into a box-drawing mark.
    const path = utf8.decode(dir.subarray(at + 46, at + 46 + nameLen));

    // The ZIP64 extra field holds the wide values, in this order, for exactly
    // the narrow fields that were filled with their maximum.
    let extra = at + 46 + nameLen;
    const extraEnd = extra + extraLen;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const len = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === LIMIT) {
          size = u64(view, field);
          field += 8;
        }
        if (compressedSize === LIMIT) {
          compressedSize = u64(view, field);
          field += 8;
        }
        if (offset === LIMIT) offset = u64(view, field);
        break;
      }
      extra += 4 + len;
    }

    if (!path.endsWith("/")) {
      items.push({ path, size, compressedSize, method, crc, offset, encrypted: (flags & 1) === 1 });
    }
    at = extraEnd + commentLen;
  }

  return {
    items,
    async read(item: ZipItem): Promise<Uint8Array> {
      if (item.encrypted) throw new ZipError(`${item.path} is encrypted.`);
      if (item.method !== 0 && item.method !== 8) {
        throw new ZipError(`${item.path} is packed in a way this app cannot read.`);
      }
      // The local header repeats the name and carries its own extra field,
      // which may differ in length from the central directory's — so the
      // bytes start where *this* header says, not where the directory's would.
      const head = await bytesOf(blob, item.offset, item.offset + 30);
      const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
      if (head.length < 30 || headView.getUint32(0, true) !== LOCAL) {
        throw new ZipError(`${item.path} is damaged in the zip.`);
      }
      const start = item.offset + 30 + headView.getUint16(26, true) + headView.getUint16(28, true);
      const packed = await bytesOf(blob, start, start + item.compressedSize);
      if (packed.length < item.compressedSize) {
        throw new ZipError(`${item.path} is cut short. The download may be incomplete.`);
      }
      const data = item.method === 0 ? packed : await inflate(packed, item.size);
      if (data.length !== item.size || crc32(data) !== item.crc) {
        throw new ZipError(`${item.path} is damaged in the zip.`);
      }
      return data;
    },
  };
}

/**
 * Raw deflate, through the browser's own decompressor. The writer's promise is
 * caught on its own so a stream that fails does not also surface as an
 * unhandled rejection; the reader's is where the failure is reported.
 */
async function inflate(packed: Uint8Array, size: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new ZipError("This browser cannot unpack a zip. Unzip it first and choose the Keep folder.");
  }
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const written = writer
    .write(packed as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
      // An entry that grows past the size the zip promised is damaged, or a
      // bomb: stop here instead of unpacking it into all the memory there is
      // (bughunt 2026-10-15).
      if (length > size) throw new ZipError("too big");
    }
  } catch {
    void reader.cancel().catch(() => {});
    throw new ZipError("A file in the zip is damaged and could not be unpacked.");
  }
  await written;
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
