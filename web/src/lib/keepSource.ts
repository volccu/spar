import { bytesOf, openZip } from "./zip";

/* --- what the Keep import reads from -----------------------------------------
   A Google Takeout reaches the app in one of three shapes, and they all come
   down to one table of files by path before anything reads a note:

   - **The zip itself** (or several: Takeout splits a large export into
     numbered parts, and a note's photograph can land in a different part from
     the note). Read by its central directory (`openZip`), so a four-gigabyte
     Takeout costs the few kilobytes of Keep in it and not the rest.
   - **An unzipped folder, picked** — `<input webkitdirectory>`, where every
     `File` carries its path under the folder as `webkitRelativePath`.
   - **An unzipped folder, dropped** — which arrives as a directory *entry*
     and has to be walked, because a folder dropped on a page is not a list of
     files the way a picked one is.

   Nothing here decides what a note is. It answers "what files are there, how
   big is each, and what are its bytes", and `lib/keepImport.ts` asks the rest.
   Nothing here touches the network either: the whole import happens on the
   device the Takeout is on.
   -------------------------------------------------------------------------- */

/** One file the import can read, wherever it came from. */
export interface SourceFile {
  /** `/`-separated, as the archive or the folder names it. */
  path: string;
  /** Known before the bytes are read — which is what lets a file past the
   *  size limit be refused without unpacking it. */
  size: number;
  read(): Promise<Uint8Array>;
  /** The file as the browser handed it over, when it was a file on disk rather
   *  than an entry in a zip — carried into the note as it is, never copied. */
  file?: File;
}

export type SourceFiles = Map<string, SourceFile>;

/** A file handed over by a picker or a drop, and the path it stands at. */
export interface Handed {
  file: File;
  path: string;
}

function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

/** What a picker handed over — a zip, several, or every file under a folder. */
export function picked(files: ArrayLike<File>): Handed[] {
  return Array.from(files).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** The smallest shape of a dropped directory entry this walk needs. The DOM's
 *  own types name these, but the walk is written against the shape so a test
 *  can hand it a folder without a browser. */
interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (ok: (entries: DroppedEntry[]) => void, fail: (error: unknown) => void) => void;
  };
}

async function walk(entry: DroppedEntry, prefix: string, out: Handed[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
    out.push({ file, path });
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  // `readEntries` answers in batches (a hundred at a time in Chrome) and says
  // it is finished by answering with none; asked once, a Keep folder of a few
  // hundred notes came back a hundred files long.
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) break;
    for (const child of batch) await walk(child, path, out);
  }
}

/**
 * What a drop handed over, folders walked. **Must be called inside the drop
 * handler, before anything awaits**: the browser empties `dataTransfer` the
 * moment the handler returns, so the entries are taken synchronously here and
 * only walked afterwards.
 */
export function dropped(data: DataTransfer): Promise<Handed[]> {
  const entries: DroppedEntry[] = [];
  const loose: File[] = [];
  const items = Array.from(data.items ?? []);
  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.();
    if (entry) entries.push(entry as DroppedEntry);
    else {
      const file = item.getAsFile();
      if (file) loose.push(file);
    }
  }
  if (items.length === 0) loose.push(...Array.from(data.files ?? []));
  return (async () => {
    const out: Handed[] = loose.map((file) => ({ file, path: file.name }));
    for (const entry of entries) await walk(entry, "", out);
    return out;
  })();
}

/**
 * The one table of files, from whatever was handed over. A zip among them is
 * opened and its entries join the table under their own paths; everything
 * else is a file at the path it came with. Throws only when a zip cannot be
 * opened at all, with the zip reader's own words.
 */
export async function openSource(handed: Handed[]): Promise<SourceFiles> {
  const table: SourceFiles = new Map();
  for (const { file, path } of handed) {
    if (isZip(file)) {
      const zip = await openZip(file);
      for (const item of zip.items) {
        table.set(item.path, { path: item.path, size: item.size, read: () => zip.read(item) });
      }
      continue;
    }
    table.set(path, { path, size: file.size, read: () => bytesOf(file), file });
  }
  return table;
}
