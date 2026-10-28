import { useCallback, useRef } from "react";
import type { Attachment, CanvasImage } from "../types";

/** How far each picture of one paste or drop steps from the one before it. */
const STEP = 32;

interface Deps {
  /** The capture path's own gate: made ready to keep, and held to the size limit. */
  keptWithin: (files: File[]) => Promise<{ files: File[]; from: number[] }>;
  attachTo: (noteId: string, files: File[]) => Promise<Attachment[]>;
  detach: (noteId: string, attachmentId: string) => void;
  addImages: (canvasId: string, images: CanvasImage[]) => void;
  removeImage: (canvasId: string, attachmentId: string) => void;
}

/**
 * Pictures set straight onto an idea's canvas. A picture is a file on the
 * idea note itself — the same bytes, upload, export and limit as any file on
 * any note (a file is a note) — and the canvas only remembers where it stands.
 * A canvas's id is its idea's id, so the note to attach to is the canvas.
 */
export function useCanvasImages({ keptWithin, attachTo, detach, addImages, removeImage }: Deps) {
  /** Canvases with pictures still being made ready: not empty, whatever they hold yet. */
  const arriving = useRef(new Map<string, number>());
  const add = useCallback(
    async (canvasId: string, files: File[], [x, y]: [number, number]) => {
      const held = arriving.current;
      held.set(canvasId, (held.get(canvasId) ?? 0) + 1);
      let added: Attachment[] = [];
      try {
        const { files: ok } = await keptWithin(files);
        if (ok.length > 0) added = await attachTo(canvasId, ok);
      } finally {
        const left = (held.get(canvasId) ?? 1) - 1;
        if (left > 0) held.set(canvasId, left);
        else held.delete(canvasId);
      }
      if (added.length === 0) return;
      // Placed in the same turn the files land, so none is ever drawn first
      // in the column a picture with no placement stands in (`picturesOf`).
      addImages(
        canvasId,
        added.map((att, i) => ({ attachment_id: att.id, x: x + i * STEP, y: y + i * STEP })),
      );
    },
    [keptWithin, attachTo, addImages],
  );

  /** The placement and the file both go; the canvas asked first. */
  const remove = useCallback(
    (canvasId: string, attachmentId: string) => {
      removeImage(canvasId, attachmentId);
      detach(canvasId, attachmentId);
    },
    [removeImage, detach],
  );

  const busy = useCallback((canvasId: string) => arriving.current.has(canvasId), []);

  return { add, remove, busy };
}

/**
 * Words still being typed into a canvas label are written now, by letting go
 * of the field. Asked before a canvas closes, so the empty-sketch sweep sees
 * a label that was only ever in the editor.
 */
export function finishCanvasTyping() {
  const typing = document.activeElement;
  if (typing instanceof HTMLElement && typing.classList.contains("canvas-text-input")) typing.blur();
}
