import type { Attachment } from "../types";
import { pdfText } from "../lib/pdfWords";
import {
  allNotes,
  allPdfText,
  allTombstones,
  deletePdfText,
  getFile,
  putPdfText,
  type PdfTextEntry,
} from "./db";

/**
 * The half of `store/pdfText.ts` that does the work, in a chunk of its own.
 *
 * Everything here runs at idle, seconds after the app has opened, and only
 * the hook that schedules it sits on the first paint. Split off because the
 * first paint has a measured ceiling (`lib/buildInvariants.test.ts`) and a
 * reader that runs once per document per device has no business spending it.
 */

/** Bump when the reader changes enough that old entries should be read again. */
export const PDF_TEXT_VERSION = 1;

/** Everything this device has read before, by attachment id. */
export const readKnown = allPdfText;

/** An entry this reader would not read again. */
function settled(entry: PdfTextEntry | undefined): boolean {
  return entry !== undefined && entry.v >= PDF_TEXT_VERSION;
}

/** Files being read right now, across every pass, so two never read one. */
const reading = new Set<string>();

export interface ReadOptions {
  /** Whether the pass is still wanted. Asked before each file. */
  alive: () => boolean;
  /** Waits for the next moment the reader may work. */
  pause: () => Promise<void>;
  /** A file was read; its entry is stored already. */
  onRead: (id: string, entry: PdfTextEntry) => void;
}

/**
 * Reads the documents in `wanted` that have no settled entry in `known`, one
 * per `pause`, storing each outcome and writing it into `known`.
 *
 * `absent` collects the files whose bytes are not on this device, so a pass
 * does not ask the store for them again; the caller empties it when bytes
 * arrive. A reader whose engine will not load stops the pass there — every
 * file after it would fail the same way, and none of those failures is the
 * file's.
 */
export async function readPendingPdfs(
  wanted: readonly Attachment[],
  known: Map<string, PdfTextEntry>,
  absent: Set<string>,
  { alive, pause, onRead }: ReadOptions,
): Promise<void> {
  for (const att of wanted) {
    if (settled(known.get(att.id)) || absent.has(att.id) || reading.has(att.id)) continue;
    await pause();
    if (!alive()) return;
    if (settled(known.get(att.id)) || reading.has(att.id)) continue;
    reading.add(att.id);
    try {
      let blob: Blob | undefined;
      try {
        blob = await getFile(att.id);
      } catch {
        blob = undefined;
      }
      if (!blob) {
        absent.add(att.id);
        continue;
      }
      let read: Awaited<ReturnType<typeof pdfText>>;
      try {
        read = await pdfText(blob);
      } catch {
        // The engine did not load — a dropped connection, most likely.
        // Nothing is recorded, so the next pass asks again.
        return;
      }
      const entry: PdfTextEntry = { v: PDF_TEXT_VERSION, ...read };
      known.set(att.id, entry);
      try {
        await putPdfText(att.id, entry);
      } catch {
        // Not kept, so it is read again next session. Search has it now.
      }
      onRead(att.id, entry);
    } finally {
      reading.delete(att.id);
    }
  }
}

/**
 * Drops what was read from documents no note carries any more — a note
 * destroyed, a file taken off its note. Asked of the store rather than of what
 * is on screen: the list React holds is empty for a moment on every open, and
 * pruning against that would throw every document away. A marker still
 * waiting on the server keeps its files' words, because a refused delete
 * brings the note back whole (`Tombstone.attachments`).
 */
export async function pruneOrphanPdfText(known: Map<string, PdfTextEntry>): Promise<number> {
  const [notes, tombstones] = await Promise.all([allNotes(), allTombstones()]);
  const held = new Set<string>();
  for (const note of notes) for (const att of note.attachments ?? []) held.add(att.id);
  for (const tombstone of tombstones) {
    for (const att of tombstone.attachments ?? []) held.add(att.id);
  }
  const gone = [...known.keys()].filter((id) => !held.has(id));
  if (gone.length === 0) return 0;
  await deletePdfText(gone);
  for (const id of gone) known.delete(id);
  return gone.length;
}
