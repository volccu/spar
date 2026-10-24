import { useCallback, useEffect, useMemo, useState } from "react";
import type { Note } from "../types";
import { viewerEntries } from "../lib/wall";
import { useFileUrl } from "../store/useFileUrl";
import { isVideo } from "../lib/files";
import { Lightbox } from "./Lightbox";

/**
 * The Inspiration board's full-screen viewer: the note viewer's own `Lightbox`
 * walking **every picture tile on the board**, text-only tiles skipped (a tap on
 * one of those opens the note, as anywhere else).
 *
 * The board owns the list and the viewer owns only which note it is on — **by
 * id, never by position**, for the reason `NoteView` keeps `lightbox.id`: a sync
 * that adds or removes a tile ahead of this one moves every position after it,
 * and the picture on screen was silently swapped for its neighbour. When the
 * note being shown leaves the board (trashed, filed elsewhere, archived — here
 * or on the other device) there is nothing left to show, and the layer closes.
 */
interface Props {
  /** The whole board, in the order it draws it. */
  notes: Note[];
  /** The note the layer opened on. */
  startId: string;
  /** The tile's rect, for the clip the layer grows out of and shrinks back into. */
  origin: DOMRect | null;
  register: (close: (() => void) | null) => void;
  onClose: () => void;
  /** Close the layer and open this note. */
  onOpenNote: (noteId: string) => void;
}

export function WallViewer({ notes, startId, origin, register, onClose, onOpenNote }: Props) {
  const entries = useMemo(() => viewerEntries(notes), [notes]);
  const [id, setId] = useState(startId);
  const at = entries.findIndex((e) => e.noteId === id);
  const found = at >= 0 ? entries[at] : null;
  // A link entry with no link to draw is no entry: nothing to show, so it goes
  // the way a note that left the board goes.
  const entry = found && (found.kind === "file" ? found.att : found.link) ? found : null;
  // Opening a file is asking for the file: the same reach the note viewer makes.
  // A film is streamed rather than fetched whole (`"stream"`).
  const film = entry?.kind === "file" && entry.att ? isVideo(entry.att) : false;
  const { url } = useFileUrl(entry?.kind === "file" ? (entry.att ?? null) : null, film ? "stream" : "any");

  useEffect(() => {
    if (!entry) onClose();
  }, [entry, onClose]);

  const onStep = useCallback(
    (next: number) => {
      const to = entries[next];
      if (to) setId(to.noteId);
    },
    [entries],
  );

  if (!entry) return null;
  const thumb = entry.att?.thumb ?? "";
  return (
    <Lightbox
      att={entry.kind === "file" ? entry.att : undefined}
      link={
        entry.kind === "link" && entry.link
          ? {
              noteId: entry.noteId,
              title: entry.title,
              href: entry.link.href,
              site: entry.link.domain,
              poster: entry.link.image ?? "",
              video: entry.link.video ?? null,
            }
          : undefined
      }
      // A film is never handed its frame as the source to play.
      src={entry.kind === "file" ? (url ?? (film ? "" : thumb)) : (entry.link?.image ?? "")}
      // A streaming address is the server's, where `download` is ignored.
      downloadUrl={entry.kind === "file" && url && !url.startsWith("http") ? url : null}
      origin={origin}
      register={register}
      onClose={onClose}
      at={at}
      count={entries.length}
      onStep={onStep}
      onOpenNote={() => onOpenNote(entry.noteId)}
    />
  );
}
