import { useEffect } from "react";

/**
 * useFilePaste — a picture or a file on the clipboard becomes a note.
 *
 * The twin of `useFileDrop`, for the machine where dragging is the wrong
 * gesture: a screenshot is *copied* far more often than it is saved to a
 * folder and dragged out of one, and Win+Shift+S puts it straight on the
 * clipboard with no file to drag anywhere. Ctrl+V is then the shortest path a
 * picture can take from this machine to the phone — copy, paste, done: no
 * picker, no dialogue, no filename to invent.
 *
 * It listens on the window rather than on any one element, because the paste
 * lands wherever the focus happens to be — the board with nothing focused at
 * all, most often — and a file is a note wherever it arrives from.
 *
 * Two things it deliberately does not do:
 *
 * - **It never touches a paste carrying no files.** Pasted text is the
 *   browser's own business, and a handler that reached for it would be
 *   rewriting what somebody typed.
 * - **It stands aside for anything that has already taken the paste**
 *   (`defaultPrevented`). The capture bar and the open note both handle their
 *   own — the bar to carry whatever is typed beside the file, the note to
 *   attach to *that* note rather than making a new one — and both run first,
 *   on the way up to here. Without this, a screenshot pasted into an open note
 *   would attach to it *and* land as a second note on the board.
 */
export function useFilePaste(takeFiles: (files: File[]) => void | Promise<unknown>): void {
  useEffect(() => {
    function paste(e: ClipboardEvent) {
      if (e.defaultPrevented) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      void takeFiles(files);
    }
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [takeFiles]);
}
