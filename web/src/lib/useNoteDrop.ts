import { useState, type DragEvent } from "react";

/**
 * A file dragged onto the open note belongs to *this* note, wherever it lands
 * on the sheet (`onFiles` attaches it). Both handlers stop the event on the way
 * up, so the window-level drop in `useFileDrop` never sees it and never turns
 * the same file into a second note on the board — and, because it never sees
 * the drag either, the board's "Drop to keep" does not light up behind the note.
 * `over` is the note's own cue in its place: true while a file is over the sheet.
 */
export function useNoteDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragOver(e: DragEvent) {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      },
      // Fires between the sheet's own children too: only the pointer leaving
      // the sheet (or the window, `relatedTarget` null) ends the cue.
      onDragLeave(e: DragEvent) {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop(e: DragEvent) {
        setOver(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        onFiles(files);
      },
    },
  };
}
