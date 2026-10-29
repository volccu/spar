import { useEffect, useState } from "react";
import { hasContent } from "./files";

/**
 * useFileDrop — a file dragged anywhere over the window becomes a note.
 *
 * On a desktop this is the whole gesture: drag a screenshot out of the folder
 * and onto the app, and it is on the phone by the time you have picked the
 * phone up. A file is a note, not a new kind of thing (web/CLAUDE.md), so what
 * happens on drop is the caller's ordinary capture path — this hook only knows
 * about the dragging.
 *
 * Returns whether something is currently over the window and would be taken if
 * released, which is what the board draws its one-word invitation from.
 *
 * All three handlers are needed and none is optional:
 *
 * - `dragover` must call `preventDefault`, or the browser takes the drop itself
 *   and navigates away from the app to display the file — losing the note, the
 *   board, and anything unsaved with it.
 * - `dragleave` fires constantly while the pointer crosses between elements
 *   *inside* the window, so it only counts when `relatedTarget` is null, which
 *   is the browser's way of saying the pointer has actually left.
 * - `drop` has to clear the state even when it takes nothing, or a drag that
 *   turns out to hold no files leaves the invitation on screen for good.
 */
export function useFileDrop(takeFiles: (files: File[]) => void | Promise<unknown>): boolean {
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    function over(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropping(true);
    }
    function leave(e: DragEvent) {
      if (e.relatedTarget === null) setDropping(false);
    }
    function drop(e: DragEvent) {
      // Out first, whoever takes the files: a drop taken on the way up (below)
      // still ends the drag, and no dragleave follows it to do this instead.
      setDropping(false);
      // The open note takes its own drop — a file dropped onto an open note
      // attaches to *that* note rather than becoming a new one — and it runs
      // first, on the way up to here. Without this, a file dropped on an open
      // note would attach to it *and* land as a new note on the board. An
      // idea's canvas takes a dropped picture the same way.
      if (e.defaultPrevented) return;
      // A **folder** dropped on the window arrives in `dataTransfer.files` on
      // Chromium as a `File` with no type and no readable bytes, and it made a
      // note named after the folder that would never open, never upload, and
      // sit in the outbox for good. There is no way to tell a directory from a
      // genuinely empty file through this API, and an empty file is not worth
      // a note either — so both are refused, and the invitation simply says
      // nothing was taken rather than making something unusable.
      const files = Array.from(e.dataTransfer?.files ?? []).filter(hasContent);
      if (files.length === 0) return;
      e.preventDefault();
      void takeFiles(files);
    }
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [takeFiles]);

  return dropping;
}
