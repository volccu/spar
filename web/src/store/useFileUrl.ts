import { useEffect, useState } from "react";
import type { Attachment } from "../types";
import { fetchFile } from "./attachments";
import { getFile } from "./db";

/**
 * The real bytes of a file, as something an <img> or an <a> can point at.
 *
 * Two reaches, and the difference is the whole point:
 *
 * - `"local"` looks only in this device's own store. It is what the *grid* uses.
 *   A card that reached across the network would mean opening the board pulled
 *   down every full-size photo in it, which is the opposite of the 90% path.
 *   When the bytes are here — and on the machine the file came from they always
 *   are — the card draws the actual picture instead of the thumbnail, which is
 *   why a screenshot you just dropped looks like a screenshot and not like a
 *   screenshot of a screenshot.
 *
 * - `"any"` falls back to the server and caches what it gets. It is what the
 *   *open note* uses, because opening a file is asking for the file.
 *
 * - `"stream"` is `"any"` for a film or a sound: this device's bytes if it
 *   has them, else an address the player streams from (`streamFile`), which
 *   is handed over as it is and never cached.
 *
 * The thumbnail is never this hook's business: it is already in the note row,
 * so the caller shows it immediately and lets whatever this returns replace it.
 * Nothing waits on anything.
 */
export type FileReach = "local" | "card" | "any" | "stream";

export interface FileUrl {
  /** An object URL for the bytes, or null while they are not (yet) available. */
  url: string | null;
  /** Settled, and there is nothing to show — the other device still has it. */
  missing: boolean;
}

export function useFileUrl(att: Attachment | null, reach: FileReach): FileUrl {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const id = att?.id ?? null;
  // A path appearing means the upload landed; a path changing means the file
  // moved. Either way the previous answer is stale and worth asking again.
  const path = att?.path ?? null;

  useEffect(() => {
    if (!att) return;
    let dead = false;
    let made: string | null = null;
    setUrl(null);
    setMissing(false);

    const want: Promise<Blob | string | null | undefined> =
      reach === "any"
        ? fetchFile(att)
        : reach === "stream"
          ? // Its own chunk: only an open film or sound asks (`store/streamFile.ts`).
            import("./streamFile").then((m) => m.streamFile(att))
          : getFile(att.id);
    void want
      .then(async (blob) => {
        if (dead) return;
        if (!blob) {
          setMissing(true);
          return;
        }
        if (typeof blob === "string") {
          setUrl(blob);
          return;
        }
        if (reach === "card") {
          // Kept for the session by `cardCopy`, so never revoked here — or
          // a copy it made itself when the small one could not be, which is.
          const { cardCopy, keptCopy } = await import("./cardCopy");
          const url = await cardCopy(att.id, blob, att.width);
          if (!keptCopy(att.id)) made = url;
          if (dead) {
            if (made) URL.revokeObjectURL(made);
            return;
          }
          setUrl(url);
          return;
        }
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => {
        // A store that cannot be read is the same situation as a file that is
        // not here: show the thumbnail and the name, which never needed it.
        if (!dead) setMissing(true);
      });

    return () => {
      dead = true;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, path, reach]);

  return { url, missing };
}
