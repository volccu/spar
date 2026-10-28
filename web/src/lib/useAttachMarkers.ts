import { createContext, useCallback, useMemo, useRef } from "react";
import type { Attachment } from "../types";
import { findMarked, markerOf, refsFor, wantsMarkers, withMarkers, type AttachKind } from "./attachRefs";

/**
 * The open note's side of the `[image 2]` markers (`lib/attachRefs.ts`; owner,
 * 2026-10-26): writing them in when a file is added mid-sentence, and opening
 * the file one points at. Kept out of `NoteView.tsx`, which is at its line
 * ceiling (`sourceCeilings.test.ts`).
 */

/** What a marker in the reader asks of its note: is the file still here, and open it. */
export interface AttachRefs {
  find: (kind: AttachKind, n: number) => Attachment | undefined;
  open: (id: string) => void;
}

/** Only the open note's reader provides it; a card has none and draws a marker as text. */
export const AttachRefsContext = createContext<AttachRefs | null>(null);

interface Options {
  attachments: readonly Attachment[];
  /** The sheet's body, which holds the file squares a marker opens. */
  root: { readonly current: HTMLElement | null };
  /** Adds the files to the note, each under the number its marker was written with. */
  attach: (files: File[], refs: number[]) => void;
  /** The note as the field counts it (`fieldText` in NoteView). */
  text: () => string;
  /** Writes the new text: through the editor's undoable path when it is open. */
  write: (next: { value: string; caret: number }) => void;
}

export function useAttachMarkers({ attachments, root, attach, text, write }: Options) {
  const atts = useRef(attachments);
  atts.current = attachments;

  const refs = useMemo<AttachRefs>(
    () => ({
      find: (kind, n) => findMarked(atts.current, kind, n),
      // The square is the file's one way open — a picture or a document into
      // the viewer, from where it is drawn — so the marker presses it. A file
      // with no square (a sound, an archive) is a row: brought into view.
      open: (id) => {
        const el = root.current?.querySelector<HTMLElement>(`[data-att="${id}"]`);
        if (!el) return;
        if (el instanceof HTMLButtonElement) el.click();
        else el.scrollIntoView?.({ block: "nearest" });
      },
    }),
    [root],
  );

  // Where the caret was when the file picker was opened: the dialog takes the
  // focus, and the editor lets go of its caret, before the files come back.
  const held = useRef<number | null>(null);
  const remember = useCallback((at: number | null) => {
    held.current = at;
  }, []);

  // The highest numbers handed out this sitting: two files added before the
  // first has landed in the note must not be given the same number.
  const given = useRef<Attachment[]>([]);

  /**
   * Numbers the files now, writes their markers at `at` (the remembered caret
   * when none is given, else the end) — only into a note that has words of its
   * own (`wantsMarkers`), so a picture added to an empty note is still a
   * picture note — and then adds them under those numbers. The markers go in
   * at once, while the caret is still where the file was added: written after
   * the files had been read, they moved the caret under somebody still typing.
   */
  const attachAt = useCallback(
    (files: File[], at?: number) => {
      const spot = at ?? held.current;
      held.current = null;
      const refs = refsFor([...atts.current, ...given.current], files);
      given.current = [...given.current, ...files.map((f, i) => ({ mime: f.type, name: f.name, ref: refs[i] }) as Attachment)];
      const value = text();
      if (wantsMarkers(value)) {
        const where = spot !== null && spot <= value.length ? spot : value.length;
        write(withMarkers(value, where, files.map((f, i) => markerOf(f, refs[i]))));
      }
      attach(files, refs);
    },
    [attach, text, write],
  );

  return { refs, attachAt, remember };
}
