import { useEffect, useRef, useState, type RefObject } from "react";
import type { Canvas, Note, UserBoard } from "../types";
import { offerImportUndo, undoImport, type ImportBatch, type ImportChunk, type ImportStore } from "../lib/keepImport";
import { dropped, openSource, picked, type Handed, type SourceFiles } from "../lib/keepSource";
import {
  filePaths,
  findSparJson,
  mergeFolders,
  planSparImport,
  readSparExport,
  rootOf,
  runSparImport,
  type SparExport,
  type SparLeftBehind,
  type SparPlan,
  type SparResult,
} from "../lib/sparImport";
import { TRASH_DAYS } from "../lib/trash";
import { useOnline } from "../lib/useOnline";
import { ZipError } from "../lib/zip";
import { useModeLayer } from "../lib/useModeLayer";
import { allTombstones } from "../store/db";
import { IconClear, IconImport } from "./Icons";

/* --- Import a spår download ----------------------------------------------------
   The way back from About's "Download everything" (audit 2026-10-10, DATA-4 /
   UX-3): choose the zip, read what it holds and what is already here, import,
   and read what happened — with the one Undo the Keep import has. The deciding
   is in `lib/sparImport.ts`; this is the screen it is said on, in the Keep
   import's own layer, voices and furniture (`KeepImport.tsx`), opened from the
   menu row beside it.
   -------------------------------------------------------------------------- */

interface Props {
  notes: Note[];
  folders: UserBoard[];
  /** This shelf's Inspiration, if it has one. */
  inspiration: string | null;
  canvases: Canvas[];
  /** Not yet heard from the server: an import now could make again what it holds. */
  waiting: boolean;
  /** The server is not answering (sync failed or offline), so the wait is a stall. */
  stalled?: boolean;
  onImport: (chunk: ImportChunk) => Promise<Note[]>;
  onCanvases: (canvases: Canvas[]) => number;
  store: ImportStore;
  onClose: () => void;
  restoreTo: RefObject<HTMLButtonElement | null>;
}

type Stage =
  | { at: "pick"; problem: string | null }
  | { at: "reading" }
  | { at: "found"; data: SparExport; unreadable: number; source: SourceFiles; root: string; plan: SparPlan }
  | { at: "writing"; done: number; total: number }
  | {
      at: "done";
      plan: SparPlan;
      unreadable: number;
      result: SparResult;
      canvases: number;
      batch: ImportBatch;
      undone: number | null;
    };

/** An import still writing, which a second one must not start beside. */
let running = false;

const WHY: Record<SparLeftBehind["why"], string> = {
  "not in the download": "not in the download in full",
  "too large": "over 50 MB",
  damaged: "damaged",
};

function notes(n: number): string {
  return `${n} ${n === 1 ? "note" : "notes"}`;
}

export function SparImport({
  notes: archive,
  folders,
  inspiration,
  canvases,
  waiting,
  stalled = false,
  onImport,
  onCanvases,
  store,
  onClose,
  restoreTo,
}: Props) {
  const { layerRef, close, trapTab } = useModeLayer({ count: 1, origin: null, onClose, restoreTo });
  // The screen is told only that the server has not answered, not why; the
  // browser's own word for being offline is what it can add to that.
  const online = useOnline();
  const [stage, setStage] = useState<Stage>({ at: "pick", problem: null });
  const zipInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  // As they are when the zip has been read, not when the screen opened.
  const now = useRef({ archive, folders, inspiration, canvases });
  now.current = { archive, folders, inspiration, canvases };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Each stage unmounts the button that was pressed; the layer takes focus back.
  const lastAt = useRef(stage.at);
  useEffect(() => {
    if (lastAt.current === stage.at) return;
    lastAt.current = stage.at;
    layerRef.current?.focus();
  }, [stage.at, layerRef]);

  const set = (next: Stage) => {
    if (alive.current) setStage(next);
  };

  async function read(handed: Handed[] | Promise<Handed[]>) {
    if (waiting || stage.at !== "pick" || running) return;
    set({ at: "reading" });
    try {
      const source = await openSource(await handed);
      const file = findSparJson(source);
      if (!file) {
        set({
          at: "pick",
          problem: "No spår.json was found in that. Choose the zip that Download everything made.",
        });
        return;
      }
      const json: unknown = JSON.parse(new TextDecoder().decode(await file.read()));
      const read = readSparExport(json);
      if (typeof read === "string") {
        set({ at: "pick", problem: read });
        return;
      }
      const tombstones = new Set((await allTombstones()).map((t) => t.id));
      const here = now.current;
      const plan = planSparImport(read.data, {
        notes: here.archive,
        tombstones,
        folders: here.folders,
        inspiration: here.inspiration,
        canvases: here.canvases,
      });
      set({ at: "found", data: read.data, unreadable: read.unreadable, source, root: rootOf(file.path), plan });
    } catch (error) {
      console.error("the spår import could not read what it was given", error);
      set({
        at: "pick",
        problem:
          error instanceof ZipError
            ? `That could not be read: ${error.message} Nothing was imported.`
            : "That could not be read. Choose the zip that Download everything made. Nothing was imported.",
      });
    }
  }

  async function write(found: Extract<Stage, { at: "found" }>) {
    if (running) return;
    running = true;
    try {
      const { data, plan, source, root, unreadable } = found;
      // The folders first, so a note lands filed. Merged against the shelf as
      // it is at this moment, not as it was when the zip was read.
      let added: UserBoard[] = [];
      store.editBoards((list) => {
        const next = mergeFolders(list, data.folders, plan.skipFolders);
        const had = new Set(list.map((f) => f.id));
        added = next.filter((f) => !had.has(f.id));
        return next;
      });
      set({ at: "writing", done: 0, total: plan.fresh.length });
      const result = await runSparImport(plan, source, filePaths(data, root), onImport, (done, total) =>
        set({ at: "writing", done, total }),
      );
      const made = new Set(result.made.map((m) => m.id));
      const shown = onCanvases(plan.canvases.filter((c) => made.has(c.idea_id)));
      const batch: ImportBatch = { made: result.made, boards: added };
      offerImportUndo(batch, store, "a spår download");
      set({ at: "done", plan, unreadable, result, canvases: shown, batch, undone: null });
    } finally {
      running = false;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") {
      trapTab(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  // A drop is the zip, never a note: taken here and no further.
  function onDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    void read(dropped(e.dataTransfer));
  }

  return (
    <div
      ref={layerRef}
      className="about keep-import"
      role="dialog"
      aria-modal="true"
      aria-label="Import a spår download"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="about-head">
        <h2 className="about-mark">Import a spår download</h2>
        <button type="button" className="about-close" aria-label="Close" title="Close" onClick={close}>
          <IconClear />
        </button>
      </div>

      <div className="about-body">
        {(stage.at === "pick" || stage.at === "reading") && (
          <>
            <p>
              Brings back the notes, files, boards and ideas that Download everything saved. The
              download is read here, on this device.
            </p>
            <p>
              Notes already here, or deleted for good, are skipped, so importing the same download
              twice is safe.
            </p>
            <div className="keep-actions">
              <button
                type="button"
                className="btn mono about-export"
                disabled={waiting || stage.at === "reading"}
                onClick={() => zipInput.current?.click()}
              >
                <IconImport />
                <span>Choose the download</span>
              </button>
            </div>
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              hidden
              data-testid="spar-zip"
              onChange={(e) => {
                const files = e.currentTarget.files;
                if (files && files.length > 0) void read(picked(files));
                e.currentTarget.value = "";
              }}
            />
            <p className="about-status" role="status">
              {waiting
                ? online && !stalled
                  ? "Waiting for this device to hear from your server first, so that nothing is imported twice."
                  : "Your server has not answered yet. Check the connection. The import opens as soon as it does."
                : stage.at === "reading"
                  ? "Opening the download"
                  : ""}
            </p>
            {stage.at === "pick" && stage.problem && (
              <p className="about-error" role="alert">
                {stage.problem}
              </p>
            )}
          </>
        )}

        {stage.at === "found" && (
          <>
            <h3 className="about-h">What was found</h3>
            <Counts
              rows={[
                ["To import", stage.plan.fresh.length],
                ["Files with them", stage.plan.files],
                ["New boards", stage.plan.newFolders.length],
                ["Already here, skipped", stage.plan.already],
                ["Deleted here, skipped", stage.plan.deleted],
                ["Same Keep note already here, skipped", stage.plan.keepTwin],
                ["In the download's trash, left behind", stage.plan.trashed],
                ["Could not be read", stage.unreadable],
              ]}
            />
            <div className="keep-actions">
              {stage.plan.fresh.length > 0 ? (
                <button type="button" className="btn mono about-export" onClick={() => void write(stage)}>
                  <IconImport />
                  <span>{`Import ${notes(stage.plan.fresh.length)}`}</span>
                </button>
              ) : (
                <>
                  <p className="keep-lead">Everything in this download is already here, so there is nothing to import.</p>
                  <button type="button" className="btn mono about-export" onClick={close}>
                    <span>Close</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {stage.at === "writing" && (
          <>
            <h3 className="about-h">Importing</h3>
            <p className="about-status" role="status">
              {`Note ${stage.done} of ${stage.total}`}
            </p>
          </>
        )}

        {stage.at === "done" && (
          <Summary
            stage={stage}
            onUndo={() => {
              if (stage.undone !== null) return;
              set({ ...stage, undone: undoImport(stage.batch, store) });
            }}
            onClose={close}
          />
        )}
      </div>
    </div>
  );
}

function Counts({ rows }: { rows: [string, number][] }) {
  return (
    <dl className="about-data mono">
      {rows
        .filter(([, n], i) => i === 0 || n > 0)
        .map(([what, n]) => (
          <div key={what}>
            <dt>{what}</dt>
            <dd>{n}</dd>
          </div>
        ))}
    </dl>
  );
}

function Summary({
  stage,
  onUndo,
  onClose,
}: {
  stage: Extract<Stage, { at: "done" }>;
  onUndo: () => void;
  onClose: () => void;
}) {
  const { result, plan, undone } = stage;
  return (
    <>
      <h3 className="about-h">Imported</h3>
      <Counts
        rows={[
          ["Imported", result.imported],
          ["Into the Archive", result.archived],
          ["Into boards", result.filed],
          ["Files", result.files],
          ["Ideas", stage.canvases],
          ["New boards", stage.batch.boards.length],
          ["Already here, skipped", plan.already],
          ["Deleted here, skipped", plan.deleted],
          ["In the download's trash, left behind", plan.trashed],
        ]}
      />

      {result.stopped && (
        <p className="about-error" role="alert">
          {`${result.stopped} The import stopped after ${notes(result.imported)}; they are in. Free some space and import the same download again to bring in the rest. Nothing already here is imported twice.`}
        </p>
      )}

      {result.leftBehind.length > 0 && (
        <>
          <h3 className="about-h">Files that did not come back</h3>
          <p>Each keeps its place in its note, and its small preview where it had one.</p>
          <ul className="keep-left">
            {result.leftBehind.map((file, i) => (
              <li key={`${file.name}-${i}`}>
                <span className="keep-left-name">{file.name}</span>
                {`: ${WHY[file.why]}, from “${file.note}”`}
              </li>
            ))}
          </ul>
        </>
      )}

      {undone === null ? (
        <div className="keep-actions">
          <button type="button" className="btn mono about-export" onClick={onClose}>
            <span>Done</span>
          </button>
          {result.imported > 0 && (
            <button type="button" className="btn mono about-export" onClick={onUndo}>
              <span>Undo this import</span>
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="keep-lead" role="status">
            {`Moved ${notes(undone)} to the trash, where ${undone === 1 ? "it waits" : "they wait"} ${TRASH_DAYS} days. Put back, on the Trash board, brings any of them back.`}
          </p>
          <div className="keep-actions">
            <button type="button" className="btn mono about-export" onClick={onClose}>
              <span>Done</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
