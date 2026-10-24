import { crc32 } from "../lib/zip";

/**
 * Zips built in a test, the shapes somebody else's zipper writes.
 *
 * `buildZip` writes stored entries only, which is right for the export and
 * says nothing about the archives the Keep import has to open: Takeout
 * deflates, and a Takeout that includes Photos is ZIP64. This writes both, so
 * the reader is proved against what it will actually be handed rather than
 * against its own writer. Not a test file, so `tsc -b` checks it; nothing in
 * the app imports it, so it is never bundled.
 */

export interface FixtureEntry {
  path: string;
  data: Uint8Array | string;
  /** Deflate this entry (method 8) instead of storing it. */
  deflate?: boolean;
}

/** Raw deflate, through the same platform stream the reader inflates with. */
export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const out = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  return out;
}

/**
 * A zip of the entries given. With `zip64`, every size and offset is written
 * into the ZIP64 extra field and the end record is the ZIP64 pair, exactly as
 * an archive past 4 GB would be — the narrow fields carry only their maximum.
 */
export async function makeZip(
  entries: FixtureEntry[],
  { zip64 = false }: { zip64?: boolean } = {},
): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const FULL = 0xffffffff;

  for (const entry of entries) {
    const raw = typeof entry.data === "string" ? enc.encode(entry.data) : entry.data;
    const packed = entry.deflate ? await deflateRaw(raw) : raw;
    const name = enc.encode(entry.path);
    const crc = crc32(raw);
    const method = entry.deflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, zip64 ? FULL : packed.length, true);
    local.setUint32(22, zip64 ? FULL : raw.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, packed);

    const extra = zip64 ? new DataView(new ArrayBuffer(4 + 24)) : null;
    if (extra) {
      extra.setUint16(0, 0x0001, true);
      extra.setUint16(2, 24, true);
      extra.setBigUint64(4, BigInt(raw.length), true);
      extra.setBigUint64(12, BigInt(packed.length), true);
      extra.setBigUint64(20, BigInt(offset), true);
    }
    const extraLen = extra ? extra.byteLength : 0;
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 45, true);
    head.setUint16(6, 45, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, method, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, zip64 ? FULL : packed.length, true);
    head.setUint32(24, zip64 ? FULL : raw.length, true);
    head.setUint16(28, name.length, true);
    head.setUint16(30, extraLen, true);
    head.setUint32(42, zip64 ? FULL : offset, true);
    const record = new Uint8Array(46 + name.length + extraLen);
    record.set(new Uint8Array(head.buffer), 0);
    record.set(name, 46);
    if (extra) record.set(new Uint8Array(extra.buffer), 46 + name.length);
    central.push(record);
    offset += 30 + name.length + packed.length;
  }

  const dirSize = central.reduce((n, r) => n + r.length, 0);
  const tail: Uint8Array[] = [];
  if (zip64) {
    const end64 = new DataView(new ArrayBuffer(56));
    end64.setUint32(0, 0x06064b50, true);
    end64.setBigUint64(4, 44n, true);
    end64.setUint16(12, 45, true);
    end64.setUint16(14, 45, true);
    end64.setBigUint64(24, BigInt(entries.length), true);
    end64.setBigUint64(32, BigInt(entries.length), true);
    end64.setBigUint64(40, BigInt(dirSize), true);
    end64.setBigUint64(48, BigInt(offset), true);
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, 0x07064b50, true);
    locator.setBigUint64(8, BigInt(offset + dirSize), true);
    locator.setUint32(16, 1, true);
    tail.push(new Uint8Array(end64.buffer), new Uint8Array(locator.buffer));
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, zip64 ? 0xffff : entries.length, true);
  end.setUint16(10, zip64 ? 0xffff : entries.length, true);
  end.setUint32(12, zip64 ? FULL : dirSize, true);
  end.setUint32(16, zip64 ? FULL : offset, true);
  tail.push(new Uint8Array(end.buffer));

  return new Blob([...parts, ...central, ...tail] as Uint8Array<ArrayBuffer>[], {
    type: "application/zip",
  });
}
