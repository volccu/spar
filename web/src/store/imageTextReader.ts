import type { Attachment } from "../types";
import { closeEngine, imageText } from "../lib/imageWords";
import {
  allImageText,
  allNotes,
  allTombstones,
  deleteImageText,
  getFile,
  putImageText,
  type ImageTextEntry,
} from "./db";

/**
 * The half of `store/imageText.ts` that does the work, in a chunk of its own,
 * the sibling of `store/pdfTextReader.ts` and under the same rules (FX-A-07).
 *
 * Reading is the heaviest thing the app ever does on its own, so on top of the
 * PDF reader's bookkeeping it is bounded per session: `SESSION_READS` pictures
 * and no more until the app is opened again, however many are waiting.
 */

/** Bump when the reader changes enough that old entries should be read again. */
export const IMAGE_TEXT_VERSION = 1;

/**
 * Pictures read in one session, across every pass. Each is a few seconds of a
 * phone's processor; a thousand-photo archive is read over a fortnight of
 * opens, not in an afternoon with the fan on.
 */
export const SESSION_READS = 40;

let readThisSession = 0;

/** For tests: a new session. */
export function resetSession(): void {
  readThisSession = 0;
}

/** Everything this device has read before, by attachment id. */
export const readKnown = allImageText;

function settled(entry: ImageTextEntry | undefined): boolean {
  return entry !== undefined && entry.v >= IMAGE_TEXT_VERSION;
}

/** Files being read right now, across every pass, so two never read one. */
const reading = new Set<string>();

export interface ReadOptions {
  /** Whether the pass is still wanted. Asked before each file. */
  alive: () => boolean;
  /** Waits for the next moment the reader may work. */
  pause: () => Promise<void>;
  /** A file was read; its entry is stored already. */
  onRead: (id: string, entry: ImageTextEntry) => void;
}

/**
 * Reads the pictures in `wanted` that have no settled entry in `known`, one
 * per `pause`, storing each outcome and writing it into `known`. Same contract
 * as `readPendingPdfs`: `absent` collects files whose bytes are not here (never
 * fetched; only bytes already on the device are read), and an engine that will
 * not load stops the pass with nothing recorded. The engine is let go when the
 * pass ends.
 */
export async function readPendingImages(
  wanted: readonly Attachment[],
  known: Map<string, ImageTextEntry>,
  absent: Set<string>,
  { alive, pause, onRead }: ReadOptions,
): Promise<void> {
  let started = false;
  try {
    for (const att of wanted) {
      if (settled(known.get(att.id)) || absent.has(att.id) || reading.has(att.id)) continue;
      if (readThisSession >= SESSION_READS) return;
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
        started = true;
        let read: Awaited<ReturnType<typeof imageText>>;
        try {
          read = await imageText(blob);
        } catch {
          // The engine did not load. Nothing is recorded, so the next pass asks
          // again.
          return;
        }
        readThisSession++;
        const entry: ImageTextEntry = { v: IMAGE_TEXT_VERSION, ...read };
        known.set(att.id, entry);
        try {
          await putImageText(att.id, entry);
        } catch {
          // Not kept, so it is read again next session. Search has it now.
        }
        onRead(att.id, entry);
      } finally {
        reading.delete(att.id);
      }
    }
  } finally {
    if (started) await closeEngine();
  }
}

/**
 * Drops what was read from pictures no note carries any more. Asked of the
 * store, never of what is on screen, and a marker still waiting on the server
 * keeps its files' words, exactly as `pruneOrphanPdfText` does.
 */
export async function pruneOrphanImageText(known: Map<string, ImageTextEntry>): Promise<number> {
  const [notes, tombstones] = await Promise.all([allNotes(), allTombstones()]);
  const held = new Set<string>();
  for (const note of notes) for (const att of note.attachments ?? []) held.add(att.id);
  for (const tombstone of tombstones) {
    for (const att of tombstone.attachments ?? []) held.add(att.id);
  }
  const gone = [...known.keys()].filter((id) => !held.has(id));
  if (gone.length === 0) return 0;
  await deleteImageText(gone);
  for (const id of gone) known.delete(id);
  return gone.length;
}
