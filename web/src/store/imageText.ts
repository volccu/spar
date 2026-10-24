import { useEffect, useMemo, useRef, useState } from "react";
import type { Attachment, Note } from "../types";
import { isImage } from "../lib/files";
import type { FileTexts } from "../lib/search";
import type { ImageTextEntry } from "./db";

/**
 * The words inside screenshots and photographs, read once per device so search
 * can find them (FX-A-07). `store/pdfText.ts`'s sibling, and every rule there
 * holds here: nothing before `START_AFTER_MS` and an idle browser; the reader
 * and the engine are chunks of their own, fetched only when a picture is
 * waiting; one picture per idle moment; only bytes already on this device; each
 * outcome stored per attachment id and not retried, the engine failing to load
 * excepted.
 *
 * **The words are read on this device, by a program of this app's own
 * (`lib/imageWords.ts`).** Nothing about a picture leaves it, there is no
 * service to ask, and the text is derived, local and never synced. It is not
 * the AI layer CLAUDE.md withdrew.
 *
 * **A phone told to save data does not do it** (`navigator.connection.saveData`):
 * the first read downloads the engine and two language files, ten-odd
 * megabytes, which is exactly what that switch asks an app not to do.
 */

/** Later than the PDF reader: the engine is the heavier of the two. */
export const START_AFTER_MS = 8000;

/** Longest an idle wait may stretch before the work goes ahead anyway. */
const IDLE_TIMEOUT_MS = 5000;

const listeners = new Set<() => void>();

/** A picture's bytes were just stored on this device. Wakes the reader. */
export function imageBytesLanded(): void {
  for (const listener of listeners) listener();
}

/** Every picture carried by a note that is not in the trash. */
export function imageAttachments(notes: readonly Note[]): Attachment[] {
  const out: Attachment[] = [];
  for (const note of notes) {
    if (note.status === "trashed") continue;
    for (const att of note.attachments ?? []) if (isImage(att)) out.push(att);
  }
  return out;
}

/** Whether the browser has been asked to spend less data. */
export function saveDataOn(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 200);
  return () => window.clearTimeout(id);
}

const NONE: FileTexts = new Map();

/** The words inside every picture this device has read, by attachment id. */
export function useImageTexts(
  notes: readonly Note[],
  { startAfterMs = START_AFTER_MS }: { startAfterMs?: number } = {},
): FileTexts {
  const [texts, setTexts] = useState<FileTexts>(NONE);
  const [wake, setWake] = useState(0);
  const known = useRef<Promise<Map<string, ImageTextEntry> | null> | null>(null);
  const absent = useRef(new Set<string>());
  const started = useRef(false);

  const wanted = useMemo(() => imageAttachments(notes), [notes]);
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
    // Nothing to read, or told to spare the data: the chunk is not even fetched.
    if (wantedKey === "" || saveDataOn()) return;
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
      let reader: typeof import("./imageTextReader");
      try {
        reader = await import("./imageTextReader");
      } catch {
        return;
      }
      if (!known.current) {
        known.current = reader
          .readKnown()
          .then((held) => {
            const found = new Map<string, string>();
            for (const [id, entry] of held) if (entry.text) found.set(id, entry.text);
            if (found.size > 0) setTexts(found);
            void reader.pruneOrphanImageText(held).catch(() => {});
            return held;
          })
          .catch(() => {
            known.current = null;
            return null;
          });
      }
      const held = await known.current;
      if (!held || !alive) return;
      await reader.readPendingImages(wantedRef.current, held, absent.current, {
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
