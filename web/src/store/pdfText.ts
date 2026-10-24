import { useEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Note } from "../types";
import { isPdf } from "../lib/pdf";
import type { FileTexts } from "../lib/search";
import type { PdfTextEntry } from "./db";

/**
 * The words inside the PDFs, read once per device so search can find them.
 *
 * A receipt, a lease, a boarding pass: the note carrying one is usually
 * nothing *but* the file, so its own words are the filename and search could
 * only find it by that. The text layer is what the document actually says,
 * and it is sitting in the bytes this device already holds.
 *
 * **Everything here is off the 90% path, and has to stay there.** Nothing is
 * read before `START_AFTER_MS` has passed and the browser says it is idle; the
 * reader itself (`store/pdfTextReader.ts`) is a chunk of its own, fetched then;
 * one document is read per idle moment, never several at once; the engine is
 * pdf.js behind `lib/pdf.ts`'s dynamic import, so a device with nothing left
 * to read never downloads it; and the parsing runs in pdf.js's own worker.
 * Opening, scanning, capturing and typing a query never wait on any of it —
 * search simply finds more once a document has been read.
 *
 * **Only bytes already here.** A PDF attached on the other device is read the
 * first time it is opened on this one (`fetchFile` keeps what it downloads and
 * calls `pdfBytesLanded`). Reaching across the network for a search index
 * would pull down every document in the archive, which is what `useFileUrl`'s
 * `"local"` refuses to do for the grid, for the same reason.
 *
 * **Once per device, and remembered either way.** What came of each file is
 * stored under its attachment id (`pdfText` in `db.ts`) — text, no text (a
 * scan), locked, unreadable or too large — so a file is never read twice.
 * The one thing not remembered is the engine failing to *load*, which is the
 * network's fault and not the file's; the next pass tries again.
 */

/**
 * How long after the app opens before the reader starts. The first seconds
 * belong to the first paint, the pull and the capture bar; a search that sees
 * inside documents a few seconds late costs nobody anything.
 */
export const START_AFTER_MS = 4000;

/** Longest an idle wait may stretch before the work goes ahead anyway. */
const IDLE_TIMEOUT_MS = 5000;

/** Something to call when a document's bytes may have just arrived here. */
const listeners = new Set<() => void>();

/**
 * A document's bytes were just stored on this device — a PDF opened here for
 * the first time, downloaded from the server. Wakes the reader, which had
 * skipped that file for having nothing to read.
 */
export function pdfBytesLanded(): void {
  for (const listener of listeners) listener();
}

/**
 * The PDFs search could ever be asked about: every one carried by a note that
 * is not in the trash. Search never reads the trash, so a document on its way
 * out is not worth reading.
 */
export function pdfAttachments(notes: readonly Note[]): Attachment[] {
  const out: Attachment[] = [];
  for (const note of notes) {
    if (note.status === "trashed") continue;
    for (const att of note.attachments ?? []) if (isPdf(att.mime, att.name)) out.push(att);
  }
  return out;
}

/** An idle moment, or the nearest thing this browser has to one. */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 200);
  return () => window.clearTimeout(id);
}

const NONE: FileTexts = new Map();

/**
 * The words inside every PDF this device has read, by attachment id — what
 * `searchNotes` is handed as `files`.
 *
 * `notes` should be the board's deferred copy (`gridNotes`), so typing into an
 * open note does not ask this anything per keystroke; what is derived from it
 * is only the list of PDF ids, and the reader wakes only when that changes (or
 * when a document's bytes arrive).
 */
export function usePdfTexts(
  notes: readonly Note[],
  { startAfterMs = START_AFTER_MS }: { startAfterMs?: number } = {},
): FileTexts {
  const [texts, setTexts] = useState<FileTexts>(NONE);
  const [wake, setWake] = useState(0);
  const known = useRef<Promise<Map<string, PdfTextEntry> | null> | null>(null);
  const absent = useRef(new Set<string>());
  const started = useRef(false);

  const wanted = useMemo(() => pdfAttachments(notes), [notes]);
  // What the reader keys on: the ids, not the list, which is a new array on
  // every note change.
  const wantedKey = useMemo(() => wanted.map((att) => att.id).join(" "), [wanted]);
  const wantedRef = useRef(wanted);
  wantedRef.current = wanted;

  useEffect(() => {
    const wakeUp = () => {
      absent.current.clear();
      setWake((n) => n + 1);
    };
    listeners.add(wakeUp);
    return () => {
      listeners.delete(wakeUp);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const cancels: (() => void)[] = [];
    const pause = () =>
      new Promise<void>((resolve) => {
        cancels.push(whenIdle(resolve));
      });
    const settle = () =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(resolve, started.current ? 0 : startAfterMs);
        cancels.push(() => window.clearTimeout(id));
      });

    void (async () => {
      await settle();
      await pause();
      if (!alive) return;
      started.current = true;
      // A reader that will not load (offline, and not yet cached) or a store
      // that will not open is a search that does not see inside documents —
      // never an error anybody is shown. The next wake tries again.
      let reader: typeof import("./pdfTextReader");
      try {
        reader = await import("./pdfTextReader");
      } catch {
        return;
      }
      if (!known.current) {
        // Read once per mount, and shared by every pass after it.
        known.current = reader
          .readKnown()
          .then((held) => {
            const found = new Map<string, string>();
            for (const [id, entry] of held) if (entry.text) found.set(id, entry.text);
            if (found.size > 0) setTexts(found);
            void reader.pruneOrphanPdfText(held).catch(() => {});
            return held;
          })
          .catch(() => {
            known.current = null;
            return null;
          });
      }
      const held = await known.current;
      if (!held || !alive) return;
      await reader.readPendingPdfs(wantedRef.current, held, absent.current, {
        alive: () => alive,
        pause,
        onRead: (id, entry) => {
          if (!entry.text) return;
          setTexts((prev) => new Map(prev).set(id, entry.text));
        },
      });
    })();

    return () => {
      alive = false;
      for (const cancel of cancels) cancel();
    };
  }, [wantedKey, wake, startAfterMs]);

  return texts;
}
