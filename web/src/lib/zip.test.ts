import { describe, expect, it } from "vitest";
import { buildZip, crc32, openZip, ZipError } from "./zip";
import { makeZip } from "../test/zipFixture";

/** Reads a stored zip back by its central directory — enough to prove the writer. */
export async function readZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const endAt = buf.length - 22;
  expect(view.getUint32(endAt, true)).toBe(0x06054b50);
  const count = view.getUint16(endAt + 10, true);
  let at = view.getUint32(endAt + 16, true);
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    expect(view.getUint16(at + 8, true) & 0x0800).toBe(0x0800);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(buf.subarray(at + 46, at + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localName = view.getUint16(local + 26, true);
    const data = buf.subarray(local + 30 + localName, local + 30 + localName + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    at += 46 + nameLen;
  }
  return out;
}

describe("buildZip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes entries that read back byte for byte, with UTF-8 names", async () => {
    const enc = new TextEncoder();
    const blob = buildZip([
      { path: "spår/Kök/2026-09-17 bröd.md", data: enc.encode("# Bröd\n[ ] mjöl") },
      { path: "spår/empty.txt", data: new Uint8Array() },
      { path: "spår/bytes.bin", data: new Uint8Array([0, 255, 1, 254]) },
    ]);
    const files = await readZip(blob);
    expect([...files.keys()]).toEqual([
      "spår/Kök/2026-09-17 bröd.md",
      "spår/empty.txt",
      "spår/bytes.bin",
    ]);
    expect(new TextDecoder().decode(files.get("spår/Kök/2026-09-17 bröd.md"))).toBe("# Bröd\n[ ] mjöl");
    expect([...(files.get("spår/bytes.bin") ?? [])]).toEqual([0, 255, 1, 254]);
  });

  it("writes a valid empty archive", async () => {
    expect((await readZip(buildZip([]))).size).toBe(0);
  });
});

/** Every entry of an opened archive, read and decoded, by path. */
async function readAll(blob: Blob): Promise<Map<string, string>> {
  const zip = await openZip(blob);
  const out = new Map<string, string>();
  for (const item of zip.items) out.set(item.path, new TextDecoder().decode(await zip.read(item)));
  return out;
}

describe("openZip", () => {
  // The Keep import is handed zips it did not write, so the reader is proved
  // against the shapes other zippers make — deflated, stored, ZIP64 — and not
  // only against its own writer.
  const lines = "[ ] flour\n[x] rolled oats\n".repeat(40);

  it("reads a stored archive — the export's own — back byte for byte", async () => {
    const enc = new TextEncoder();
    const blob = buildZip([
      { path: "spår/Kök/list.md", data: enc.encode(lines) },
      { path: "spår/bytes.bin", data: new Uint8Array([0, 255, 1, 254]) },
    ]);
    const zip = await openZip(blob);
    expect(zip.items.map((item) => item.path)).toEqual(["spår/Kök/list.md", "spår/bytes.bin"]);
    expect(zip.items.every((item) => item.method === 0)).toBe(true);
    expect(new TextDecoder().decode(await zip.read(zip.items[0]))).toBe(lines);
    expect([...(await zip.read(zip.items[1]))]).toEqual([0, 255, 1, 254]);
  });

  it("inflates deflated entries, beside stored ones, and knows every size before reading", async () => {
    const blob = await makeZip([
      { path: "Takeout/Keep/a.json", data: lines, deflate: true },
      { path: "Takeout/Keep/b.txt", data: "stored as it is" },
    ]);
    const zip = await openZip(blob);
    const [deflated, stored] = zip.items;
    expect(deflated.method).toBe(8);
    expect(deflated.compressedSize).toBeLessThan(deflated.size);
    expect(deflated.size).toBe(new TextEncoder().encode(lines).length);
    expect(stored.method).toBe(0);
    const all = await readAll(blob);
    expect(all.get("Takeout/Keep/a.json")).toBe(lines);
    expect(all.get("Takeout/Keep/b.txt")).toBe("stored as it is");
  });

  it("reads ZIP64: the wide end record and the sizes in each entry's extra field", async () => {
    const blob = await makeZip(
      [
        { path: "one.txt", data: "first", deflate: true },
        { path: "two.txt", data: lines, deflate: true },
      ],
      { zip64: true },
    );
    const zip = await openZip(blob);
    expect(zip.items.map((item) => item.size)).toEqual([5, new TextEncoder().encode(lines).length]);
    const all = await readAll(blob);
    expect(all.get("one.txt")).toBe("first");
    expect(all.get("two.txt")).toBe(lines);
  });

  it("leaves directories out: they hold nothing to read", async () => {
    const zip = await openZip(await makeZip([{ path: "Takeout/" , data: "" }, { path: "Takeout/x", data: "x" }]));
    expect(zip.items.map((item) => item.path)).toEqual(["Takeout/x"]);
  });

  it("refuses something that is not a zip, in words", async () => {
    await expect(openZip(new Blob(["just some text"]))).rejects.toThrow(ZipError);
    await expect(openZip(new Blob(["just some text"]))).rejects.toThrow("This is not a zip file.");
  });

  it("refuses an entry whose bytes do not match its CRC — a damaged download says so", async () => {
    const blob = await makeZip([{ path: "note.json", data: '{"textContent":"hello"}' }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // The stored bytes start after the 30-byte header and the 9-byte name.
    bytes[30 + 9 + 3] ^= 0xff;
    const zip = await openZip(new Blob([bytes]));
    await expect(zip.read(zip.items[0])).rejects.toThrow("note.json is damaged in the zip.");
  });

  // bughunt 2026-10-15: an entry is unpacked no further than the size the zip
  // promised, so a crafted file cannot fill the memory before it is refused.
  it("stops unpacking an entry that grows past its stated size", async () => {
    const blob = await makeZip([{ path: "big.txt", data: "0".repeat(2_000_000), deflate: true }]);
    const zip = await openZip(blob);
    await expect(zip.read({ ...zip.items[0], size: 10 })).rejects.toThrow(
      "A file in the zip is damaged and could not be unpacked.",
    );
  });

  it("refuses an archive cut short before its directory", async () => {
    const blob = await makeZip([{ path: "a.txt", data: lines }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Keep the end record but lose the entries before it: the directory it
    // points at is no longer inside the file.
    const tail = bytes.slice(bytes.length - 22);
    await expect(openZip(new Blob([tail]))).rejects.toThrow(/incomplete/);
  });
});
