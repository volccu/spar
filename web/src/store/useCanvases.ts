import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasImage, CanvasText, DrawingStroke, Note, Canvas } from "../types";
import type { CanvasItem } from "../types";
import {
  addCanvasImages,
  addCanvasText,
  addCanvasItem,
  addStroke,
  buildCanvas,
  moveCanvasImage,
  moveCanvasItem,
  removeCanvasImage,
  removeCanvasText,
  removeCanvasItem,
  removeStroke,
  resizeCanvasItem,
  setCanvasImageWidth,
  updateCanvasText,
} from "../lib/canvas";
import { allCanvases, putCanvasSynced, putCanvasLocalOnly, putCanvasesLocalOnly } from "./db";

/**
 * Local-first persistence for the spatial folder surface.
 *
 * Every arrangement gesture goes through `mutate`, which is the only place that
 * writes to the outbox. That matters more than the tidiness: the difference
 * between a folder that syncs and one that must not is a single call, and eight
 * hand-copied versions of it would have drifted the first time one was edited.
 */
export function useCanvases() {
  const [folders, setFolders] = useState<Canvas[]>([]);
  /**
   * The authoritative copy, updated synchronously.
   *
   * Dragging a note writes many times a second, well inside one render, so
   * reading the last arrangement from React state would repeatedly build the
   * next one from a position two or three moves stale.
   */
  const canvasesRef = useRef<Canvas[]>([]);
  /** Bumped by anything that needs uploading, so sync can push it promptly. */
  const [version, setVersion] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(null);
  /**
   * Writes IndexedDB refused, newest per canvas, with how each was meant to
   * travel — the notes' `failedWrites` said again, because a canvas that
   * fails to write was otherwise lost with no word: the screen kept the
   * arrangement, the store did not, and an unhandled rejection was the only
   * trace. `synced` matters on the retry: an invented layout must not enter
   * the outbox on its second attempt any more than on its first.
   */
  const failedWrites = useRef(new Map<string, { canvas: Canvas; synced: boolean }>());

  const commit = useCallback((next: Canvas[]) => {
    canvasesRef.current = next;
    setFolders(next);
  }, []);

  const persist = useCallback(async (canvas: Canvas, synced: boolean) => {
    const attempt = { canvas, synced };
    failedWrites.current.set(canvas.id, attempt);
    try {
      await (synced ? putCanvasSynced(canvas) : putCanvasLocalOnly(canvas));
      if (failedWrites.current.get(canvas.id) === attempt) failedWrites.current.delete(canvas.id);
      if (failedWrites.current.size === 0) setStorageError(null);
    } catch {
      // A newer write took this canvas's place (and may already have been
      // saved), so this older refusal must not bring its stale copy back.
      if (failedWrites.current.get(canvas.id) !== attempt) return;
      setStorageError("This arrangement is visible, but it is not saved on this device yet.");
    }
  }, []);

  const retryStorage = useCallback(async () => {
    if (failedWrites.current.size === 0) {
      setStorageError(null);
      return;
    }
    await Promise.all(
      [...failedWrites.current.values()].map(({ canvas, synced }) => persist(canvas, synced)),
    );
  }, [persist]);

  /** Newest wins per id, with `incoming` taking precedence. */
  const absorb = useCallback(
    (incoming: Canvas[]) => {
      const byId = new Map(canvasesRef.current.map((folder) => [folder.id, folder]));
      for (const folder of incoming) byId.set(folder.id, folder);
      commit([...byId.values()]);
    },
    [commit],
  );

  useEffect(() => {
    let cancelled = false;
    allCanvases().then(
      (loaded) => {
        if (cancelled) return;
        // Anything already in hand was made since this read started, so it is
        // newer than the stored copy and keeps its place.
        const byId = new Map(loaded.map((folder) => [folder.id, folder]));
        for (const folder of canvasesRef.current) byId.set(folder.id, folder);
        commit([...byId.values()]);
      },
      // A canvas is reconstructible from the notes it arranges, and the same
      // store's failure to open is already reported on the notes' path.
      (error: unknown) => console.error("canvases failed to load", error),
    );
    return () => {
      cancelled = true;
    };
  }, [commit]);

  /**
   * The default layout, invented the first time an idea is opened on this
   * device. Written but deliberately *not* queued for upload — see
   * `putCanvasLocalOnly`. Nobody asked for this arrangement, and uploading it would
   * let merely opening an idea on the phone overwrite the laptop's canvas.
   */
  const ensureForIdea = useCallback(
    (idea: Note, notes: Note[]): Canvas => {
      const existing = canvasesRef.current.find((folder) => folder.idea_id === idea.id);
      if (existing) return existing;

      const folder = buildCanvas(idea, notes, new Date());
      commit([...canvasesRef.current, folder]);
      void persist(folder, false);
      return folder;
    },
    [commit, persist],
  );

  /** An arrangement the user made: stored, and queued for the other device. */
  const mutate = useCallback(
    (canvasId: string, change: (folder: Canvas) => Canvas) => {
      const current = canvasesRef.current.find((folder) => folder.id === canvasId);
      if (!current) return;
      const next = change(current);
      commit(
        canvasesRef.current.map((folder) => (folder.id === canvasId ? next : folder)),
      );
      void persist(next, true);
      setVersion((n) => n + 1);
    },
    [commit, persist],
  );

  /**
   * Canvases that arrived from the server. Not queued — pushing back what was
   * just pulled is how a sync loop starts talking to itself.
   */
  const applyRemote = useCallback(
    (incoming: Canvas[]) => {
      if (incoming.length === 0) return;
      absorb(incoming);
      putCanvasesLocalOnly(incoming).catch(() => {
        // Held for the retry one by one, local-only as they arrived.
        for (const canvas of incoming) failedWrites.current.set(canvas.id, { canvas, synced: false });
        setStorageError("This arrangement is visible, but it is not saved on this device yet.");
      });
    },
    [absorb],
  );

  /**
   * Canvases brought back by a spår download (`lib/sparImport.ts`), for ideas
   * that came back with them. Only ones this device has no canvas for — by id
   * or by idea — so a canvas arranged here is never replaced by an older
   * download. Queued like an arrangement the user made: the other devices
   * have never seen these either.
   */
  const importCanvases = useCallback(
    (incoming: Canvas[]): number => {
      const ids = new Set(canvasesRef.current.map((c) => c.id));
      const ideas = new Set(canvasesRef.current.map((c) => c.idea_id));
      const fresh = incoming.filter((c) => !ids.has(c.id) && !ideas.has(c.idea_id));
      if (fresh.length === 0) return 0;
      commit([...canvasesRef.current, ...fresh]);
      for (const canvas of fresh) void persist(canvas, true);
      setVersion((n) => n + 1);
      return fresh.length;
    },
    [commit, persist],
  );

  const moveItem = useCallback(
    (canvasId: string, noteId: string, x: number, y: number) =>
      mutate(canvasId, (folder) => moveCanvasItem(folder, noteId, x, y)),
    [mutate],
  );

  /**
   * Where a note stands on this canvas, read before it is taken off it — the
   * one thing releasing a note actually destroys, and therefore the one thing
   * undoing a release has to be handed.
   */
  const itemAt = useCallback((canvasId: string, noteId: string) => {
    const folder = canvasesRef.current.find((candidate) => candidate.id === canvasId);
    return folder?.items.find((item) => item.note_id === noteId) ?? null;
  }, []);

  /** Taking a note back out of an idea. An arrangement, so it travels. */
  const removeItem = useCallback(
    (canvasId: string, noteId: string) =>
      mutate(canvasId, (folder) => removeCanvasItem(folder, noteId)),
    [mutate],
  );

  /** Putting one back where it stood. */
  const restoreItem = useCallback(
    (canvasId: string, item: CanvasItem) =>
      mutate(canvasId, (folder) => addCanvasItem(folder, item)),
    [mutate],
  );

  const addStrokeToFolder = useCallback(
    (canvasId: string, stroke: DrawingStroke) =>
      mutate(canvasId, (folder) => addStroke(folder, stroke)),
    [mutate],
  );

  const removeStrokeFromFolder = useCallback(
    (canvasId: string, strokeId: string) =>
      mutate(canvasId, (folder) => removeStroke(folder, strokeId)),
    [mutate],
  );

  const resizeItem = useCallback(
    (canvasId: string, noteId: string, width: number) =>
      mutate(canvasId, (folder) => resizeCanvasItem(folder, noteId, width)),
    [mutate],
  );

  const setImageWidth = useCallback(
    (canvasId: string, attachmentId: string, width: number) =>
      mutate(canvasId, (folder) => setCanvasImageWidth(folder, attachmentId, width)),
    [mutate],
  );

  /** The canvas as it stands this instant, ahead of the render that will show it. */
  const canvasNow = useCallback(
    (canvasId: string) => canvasesRef.current.find((folder) => folder.id === canvasId),
    [],
  );

  const addImages = useCallback(
    (canvasId: string, images: CanvasImage[]) =>
      mutate(canvasId, (folder) => addCanvasImages(folder, images)),
    [mutate],
  );

  const moveImage = useCallback(
    (canvasId: string, attachmentId: string, x: number, y: number) =>
      mutate(canvasId, (folder) => moveCanvasImage(folder, attachmentId, x, y)),
    [mutate],
  );

  const removeImage = useCallback(
    (canvasId: string, attachmentId: string) =>
      mutate(canvasId, (folder) => removeCanvasImage(folder, attachmentId)),
    [mutate],
  );

  const addText = useCallback(
    (canvasId: string, text: CanvasText) =>
      mutate(canvasId, (folder) => addCanvasText(folder, text)),
    [mutate],
  );

  const editText = useCallback(
    (
      canvasId: string,
      textId: string,
      changes: Partial<Pick<CanvasText, "text" | "x" | "y" | "width">>,
    ) => mutate(canvasId, (folder) => updateCanvasText(folder, textId, changes)),
    [mutate],
  );

  const removeText = useCallback(
    (canvasId: string, textId: string) =>
      mutate(canvasId, (folder) => removeCanvasText(folder, textId)),
    [mutate],
  );

  return {
    folders,
    canvasVersion: version,
    storageError,
    retryStorage,
    applyRemoteCanvases: applyRemote,
    ensureForIdea,
    importCanvases,
    moveItem,
    itemAt,
    removeItem,
    restoreItem,
    /** Any change to one canvas, as one queued write: a canvas's Undo, Redo and Select. */
    changeCanvas: mutate,
    addStroke: addStrokeToFolder,
    removeStroke: removeStrokeFromFolder,
    resizeItem,
    setImageWidth,
    canvasNow,
    addImages,
    moveImage,
    removeImage,
    addText,
    editText,
    removeText,
  };
}
