import { useEffect, useRef, useState, type RefObject } from "react";
import type { Note, UserBoard } from "../types";
import {
  allChoice,
  automaticBoardName,
  boardNameFor,
  boardsToMake,
  chooseAll,
  defaultChoices,
  makeBoards,
  offerImportUndo,
  planImport,
  resolveChoices,
  runImport,
  scanKeep,
  undoImport,
  type FileLeftBehind,
  type ImportBatch,
  type ImportChunk,
  type ImportResult,
  type ImportStore,
  type KeepPlan,
  type KeepScan,
  type LabelChoice,
} from "../lib/keepImport";
import { dropped, openSource, picked, type Handed } from "../lib/keepSource";
import { BOARD_NAME_MAX, INBOX_ALL, INBOX_ASK_MIN } from "../lib/boards";
import { TRASH_DAYS } from "../lib/trash";
import { useOnline } from "../lib/useOnline";
import { ZipError } from "../lib/zip";
import { useModeLayer } from "../lib/useModeLayer";
import { IconClear, IconImport } from "./Icons";

/* --- Import from Google Keep ------------------------------------------------------
   The way a person's Keep archive comes in, on their own device, in one
   sitting: pick the Takeout (or drop it), say where each label goes, and read
   what happened. All of the deciding is in `lib/keepImport.ts`; this is the
   screen it is said on.

   It is a layer of the About page's kind (`useModeLayer`, the `.about`
   column): full size, the capture bar off the screen, Back and Escape close
   it. It is set in the colophon's voices for the colophon's reason — it is
   read before it is worked — and it counts in the machine face, the way the
   Sorter's summary does: a report of what was done, never a celebration.

   Four screens, one after another, and nothing is written until the last:
   **pick** (what a Takeout is, and what does not come across), **labels**
   (what was found, and where each label goes), **writing** (a count, a chunk
   at a time), **done** (what happened, what was left behind, and the one Undo).
   -------------------------------------------------------------------------- */

interface Props {
  notes: Note[];
  folders: UserBoard[];
  /** Where the Inbox starts — the first-open question's answer — so the
   *  summary can say which of the notes it is keeping out. */
  inboxSince: string | null;
  /** The summary's "tidy up now" for a big unfiled batch: leaves the layer
   *  and opens Tidy up on the Inbox (review GAP-02). */
  onTidyNow: () => void;
  /** Its "start the Inbox today": the first-open question's other answer. */
  onLeaveThem: () => void;
  /**
   * This device has not yet heard from the server what it already holds. An
   * import now could make, a second time, notes a first import on the other
   * device already made — and the server refuses a second row under one Keep
   * id — so it waits.
   */
  waiting: boolean;
  /** The server is not answering (sync failed or offline), so the wait is a stall. */
  stalled?: boolean;
  onImport: (chunk: ImportChunk) => Promise<Note[]>;
  /** The store's verbs and the undo stack, for the import's one undo. */
  store: ImportStore;
  onClose: () => void;
  restoreTo: RefObject<HTMLButtonElement | null>;
}

type Stage =
  | { at: "pick"; problem: string | null }
  | { at: "reading"; done: number; total: number }
  | { at: "labels"; scan: KeepScan; plan: KeepPlan }
  | { at: "writing"; done: number; total: number }
  | {
      at: "done";
      scan: KeepScan;
      plan: KeepPlan;
      result: ImportResult;
      batch: ImportBatch;
      undone: number | null;
    };

/**
 * The import that is running, or has finished and not yet been read, held here
 * and not in the screen (review GAP-01). Closing the layer mid-way left
 * `write()` running with nobody to hear it, and the next open planned against
 * an archive holding only the chunks written so far — so the notes that were
 * still to come went in twice. Reopening now finds the same import and shows
 * its progress, then its summary; `read()` is refused while one is writing.
 */
let held: Extract<Stage, { at: "writing" | "done" }> | null = null;
/** The open screen's way to hear the held import, if there is one. */
let hear: ((stage: Stage) => void) | null = null;

/** For a test: forget any import held by an earlier render. */
export function forgetHeldImport(): void {
  held = null;
  hear = null;
}

const WHY: Record<FileLeftBehind["why"], string> = {
  "too large": "over 50 MB",
  "not in the Takeout": "not in the Takeout",
  unreadable: "damaged",
};

function notes(n: number): string {
  return `${n} ${n === 1 ? "note" : "notes"}`;
}

export function KeepImport({
  notes: archive,
  folders,
  inboxSince,
  onTidyNow,
  onLeaveThem,
  waiting,
  stalled = false,
  onImport,
  store,
  onClose,
  restoreTo,
}: Props) {
  const { layerRef, close: closeLayer, trapTab } = useModeLayer({ count: 1, origin: null, onClose, restoreTo });
  // The screen is told only that the server has not answered, not why; the
  // browser's own word for being offline is what it can add to that.
  const online = useOnline();
  const [stage, setStage] = useState<Stage>(() => held ?? { at: "pick", problem: null });
  /** A summary that has been read is spent: closing it lets the next open start
   *  from the top. Closed any other way, the import stays held. */
  const close = () => {
    if (stage.at === "done") held = null;
    closeLayer();
  };
  const [choices, setChoices] = useState<Record<string, LabelChoice>>({});
  const zipInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  // The archive as it is when the Takeout has been read, not as it was when
  // the screen opened: a sync landing in between is exactly the case the
  // not-twice rule is for.
  const archiveRef = useRef(archive);
  archiveRef.current = archive;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  useEffect(() => {
    alive.current = true;
    // A folder picker is an attribute React has no name for.
    folderInput.current?.setAttribute("webkitdirectory", "");
    hear = setStage;
    return () => {
      alive.current = false;
      if (hear === setStage) hear = null;
    };
  }, []);

  // Each stage change unmounts the button that was pressed, and focus falls to
  // the page, outside the layer, where Escape no longer reaches it (review
  // GAP-05, WCAG 2.4.3). The layer takes it back on every change of stage.
  const lastAt = useRef(stage.at);
  useEffect(() => {
    if (lastAt.current === stage.at) return;
    lastAt.current = stage.at;
    layerRef.current?.focus();
  }, [stage.at, layerRef]);

  const set = (next: Stage) => {
    if (alive.current) setStage(next);
  };
  /** The writing and the summary, which outlive the screen they began on. */
  const setHeld = (next: Extract<Stage, { at: "writing" | "done" }>) => {
    held = next;
    hear?.(next);
  };

  async function read(handed: Handed[] | Promise<Handed[]>) {
    if (waiting || stage.at !== "pick" || held) return;
    set({ at: "reading", done: 0, total: 0 });
    try {
      const files = await openSource(await handed);
      const scan = await scanKeep(files, (done, total) => set({ at: "reading", done, total }));
      if (scan.notes.length === 0 && scan.trashed === 0) {
        set({
          at: "pick",
          problem:
            "No Keep notes were found in that. Choose the zip Takeout made, or the Keep folder inside it.",
        });
        return;
      }
      const plan = planImport(scan, archiveRef.current);
      if (alive.current) setChoices(defaultChoices(plan.labels, foldersRef.current));
      set({ at: "labels", scan, plan });
    } catch (error) {
      console.error("the Keep import could not read what it was given", error);
      set({
        at: "pick",
        problem:
          error instanceof ZipError
            ? `That could not be read: ${error.message} Nothing was imported.`
            : "That could not be read. Choose the zip that Google Takeout made. Nothing was imported.",
      });
    }
  }

  async function write(scan: KeepScan, plan: KeepPlan) {
    if (held) return;
    const made = makeBoards(boardsToMake(choices, foldersRef.current), store);
    const target = resolveChoices(choices, [...foldersRef.current, ...made]);
    setHeld({ at: "writing", done: 0, total: plan.fresh.length });
    const result = await runImport(plan, target, onImport, {
      inboxSince,
      onProgress: (done, total) => setHeld({ at: "writing", done, total }),
      revive: store.bulkUpdate,
      notes: store.notes,
    });
    const batch: ImportBatch = { made: result.made, boards: made };
    // Offered whether or not the screen is still open: the notes are in, and
    // their undo belongs to the app's stack, not to this screen.
    offerImportUndo(batch, store);
    setHeld({ at: "done", scan, plan, result, batch, undone: null });
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

  // A drop anywhere on the screen is taken here and goes no further: the
  // window's own drop turns a file into a note, and a Takeout is not a note.
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
      aria-label="Import from Google Keep"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="about-head">
        <h2 className="about-mark">Import from Google Keep</h2>
        <button type="button" className="about-close" aria-label="Close" title="Close" onClick={close}>
          <IconClear />
        </button>
      </div>

      <div className="about-body">
        {(stage.at === "pick" || stage.at === "reading") && (
          <>
            <p>
              Your Keep notes come from a Google Takeout and are read here, on this device. Nothing
              is sent anywhere.
            </p>

            <h3 className="about-h">The Takeout</h3>
            <p>
              At takeout.google.com, choose Keep and export it. Then choose the zip Google sends, or
              the Keep folder inside it. You can also drop it on this page.
            </p>
            <div className="keep-actions">
              <button
                type="button"
                className="btn mono about-export"
                disabled={waiting || stage.at === "reading"}
                onClick={() => zipInput.current?.click()}
              >
                <IconImport />
                <span>Choose the zip</span>
              </button>
              <button
                type="button"
                className="btn mono about-export"
                disabled={waiting || stage.at === "reading"}
                onClick={() => folderInput.current?.click()}
              >
                <span>Choose the Keep folder</span>
              </button>
            </div>
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              multiple
              hidden
              data-testid="keep-zip"
              onChange={(e) => {
                const files = e.currentTarget.files;
                if (files && files.length > 0) void read(picked(files));
                e.currentTarget.value = "";
              }}
            />
            <input
              ref={folderInput}
              type="file"
              multiple
              hidden
              data-testid="keep-folder"
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
                  ? stage.total > 0
                    ? `Reading note ${stage.done} of ${stage.total}`
                    : "Opening the Takeout"
                  : ""}
            </p>
            {stage.at === "pick" && stage.problem && (
              <p className="about-error" role="alert">
                {stage.problem}
              </p>
            )}

            <h3 className="about-h">What comes across</h3>
            <p>
              Every note with its title, lists, links, pictures, drawings, recordings and dates.
              Archived notes go to the Archive, and pinned ones are marked important. Keep's trash
              stays behind.
            </p>
            <h3 className="about-h">What does not</h3>
            <p>
              Colours, because spår has none. Reminders, because Takeout does not include them. Who a
              note was shared with, because a note here has one reader.
            </p>
          </>
        )}

        {stage.at === "labels" && (
          <Labels
            scan={stage.scan}
            plan={stage.plan}
            folders={folders}
            choices={choices}
            onChoose={(label, choice) => setChoices((now) => ({ ...now, [label]: choice }))}
            onChooseAll={setChoices}
            onImport={() => void write(stage.scan, stage.plan)}
            onClose={close}
          />
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
              const moved = undoImport(stage.batch, store);
              setHeld({ ...stage, undone: moved });
            }}
            inboxSince={inboxSince}
            onTidyNow={() => {
              held = null;
              onTidyNow();
            }}
            onLeaveThem={onLeaveThem}
            onClose={close}
          />
        )}
      </div>
    </div>
  );
}

function Found({ scan, plan }: { scan: KeepScan; plan: KeepPlan }) {
  return (
    <dl className="about-data mono">
      <div>
        <dt>To import</dt>
        <dd>{plan.fresh.length}</dd>
      </div>
      {plan.revive.length > 0 && (
        <div>
          <dt>In the trash here</dt>
          <dd>{plan.revive.length}</dd>
        </div>
      )}
      {plan.already > 0 && (
        <div>
          <dt>Already here</dt>
          <dd>{plan.already}</dd>
        </div>
      )}
      {plan.empty > 0 && (
        <div>
          <dt>Empty, left behind</dt>
          <dd>{plan.empty}</dd>
        </div>
      )}
      {scan.trashed > 0 && (
        <div>
          <dt>In Keep's trash, left behind</dt>
          <dd>{scan.trashed}</dd>
        </div>
      )}
      {scan.unreadable.length > 0 && (
        <div>
          <dt>Could not be read</dt>
          <dd>{scan.unreadable.length}</dd>
        </div>
      )}
    </dl>
  );
}

function Labels({
  scan,
  plan,
  folders,
  choices,
  onChoose,
  onChooseAll,
  onImport,
  onClose,
}: {
  scan: KeepScan;
  plan: KeepPlan;
  folders: UserBoard[];
  choices: Record<string, LabelChoice>;
  onChoose: (label: string, choice: LabelChoice) => void;
  /** The switch above the rows, which sets every row at once. */
  onChooseAll: (choices: Record<string, LabelChoice>) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const every = allChoice(plan.labels, folders, choices);
  const making = boardsToMake(choices, folders).length;
  const coming = plan.fresh.length + plan.revive.length;
  return (
    <>
      <h3 className="about-h">What was found</h3>
      <Found scan={scan} plan={plan} />
      <Unreadable paths={scan.unreadable} />

      {coming === 0 ? (
        <>
          <p className="keep-lead">
            {plan.already > 0
              ? "Every note in this Takeout that has anything in it is already here, so there is nothing to import."
              : "There is nothing in this Takeout to import."}
          </p>
          <div className="keep-actions">
            <button type="button" className="btn mono about-export" onClick={onClose}>
              <span>Close</span>
            </button>
          </div>
        </>
      ) : (
        <>
          {plan.revive.length > 0 && (
            <p className="keep-lead">
              {`${notes(plan.revive.length)} from an earlier import ${plan.revive.length === 1 ? "is" : "are"} in the trash here. Importing brings ${plan.revive.length === 1 ? "it" : "them"} back, under the choices below, rather than making ${plan.revive.length === 1 ? "it" : "them"} twice.`}
            </p>
          )}
          {plan.labels.length > 0 && (
            <>
              <h3 className="about-h">Labels</h3>
              <p>
                Each label can become a board, go into a board you have, or stay in the Inbox. A
                label on one or two notes starts in the Inbox. A note goes into one board only, the
                first of its labels that became one. Its other labels are kept on its last line, as{" "}
                <span className="keep-example">Keep labels: work, ideas</span>.
              </p>
              {/* One switch for all of them, and what the choices below add
                  up to (review UX-21): a Keep account with thirty labels made
                  thirty boards, and changing that was one chooser per label. */}
              <div className="keep-label keep-label-all">
                <div className="keep-label-head">
                  <span>Every label</span>
                  <span className="mono" role="status">
                    {making === 0
                      ? "No new boards"
                      : `${making} new ${making === 1 ? "board" : "boards"}`}
                  </span>
                </div>
                <select
                  aria-label="Where every label goes"
                  value={every}
                  onChange={(e) => {
                    const to = e.currentTarget.value;
                    if (to === "new" || to === "inbox") onChooseAll(chooseAll(plan.labels, folders, to));
                  }}
                >
                  {every === "mixed" && (
                    <option value="mixed" disabled>
                      As chosen below
                    </option>
                  )}
                  <option value="new">A board of its own</option>
                  <option value="inbox">The Inbox</option>
                </select>
              </div>
              <div className="keep-labels">
                {plan.labels.map(({ name, count }) => (
                  <LabelRow
                    key={name}
                    name={name}
                    count={count}
                    folders={folders}
                    choice={choices[name] ?? { to: "inbox" }}
                    onChoose={(choice) => onChoose(name, choice)}
                  />
                ))}
              </div>
            </>
          )}
          <div className="keep-actions">
            <button type="button" className="btn mono about-export" onClick={onImport}>
              <IconImport />
              <span>{`Import ${notes(coming)}`}</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}

function LabelRow({
  name,
  count,
  folders,
  choice,
  onChoose,
}: {
  name: string;
  count: number;
  folders: UserBoard[];
  choice: LabelChoice;
  onChoose: (choice: LabelChoice) => void;
}) {
  const value = choice.to === "board" ? `board:${choice.id}` : choice.to;
  const typed = choice.to === "new" ? choice.name.trim() || boardNameFor(name) : "";
  // A new board named like one already on the shelf files into that one (review
  // GAP-04), and one named like an automatic board still makes its own: each
  // says so in a line, before the import rather than after.
  const into = choice.to === "new" ? folders.find((b) => sameBoardName(b.name, typed)) : undefined;
  const lookalike = choice.to === "new" && !into ? automaticBoardName(typed) : null;
  return (
    <div className="keep-label">
      <div className="keep-label-head">
        <span>{name}</span>
        <span className="mono">{count}</span>
      </div>
      <select
        aria-label={`Where the notes labelled ${name} go`}
        value={value}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next === "new") onChoose({ to: "new", name: boardNameFor(name) });
          else if (next === "inbox") onChoose({ to: "inbox" });
          else onChoose({ to: "board", id: next.slice("board:".length) });
        }}
      >
        <option value="new">A new board</option>
        {folders.map((board) => (
          <option key={board.id} value={`board:${board.id}`}>
            {board.name}
          </option>
        ))}
        <option value="inbox">The Inbox</option>
      </select>
      {choice.to === "new" && (
        <input
          type="text"
          aria-label={`Name of the new board for ${name}`}
          value={choice.name}
          placeholder={boardNameFor(name)}
          maxLength={BOARD_NAME_MAX}
          onChange={(e) => onChoose({ to: "new", name: e.currentTarget.value })}
        />
      )}
      {into && (
        <p className="keep-label-note" role="status">
          {`You already have a board called ${into.name}, so these notes go into it.`}
        </p>
      )}
      {lookalike && (
        <p className="keep-label-note" role="status">
          {`This name looks like the ${lookalike} board. A board of its own is still made, so you will have both.`}
        </p>
      )}
    </div>
  );
}

function sameBoardName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

function Unreadable({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  return (
    <ul className="keep-left" aria-label="Notes that could not be read">
      {paths.map((path) => (
        <li key={path}>{path}</li>
      ))}
    </ul>
  );
}

function Summary({
  stage,
  inboxSince,
  onTidyNow,
  onLeaveThem,
  onUndo,
  onClose,
}: {
  stage: Extract<Stage, { at: "done" }>;
  inboxSince: string | null;
  onTidyNow: () => void;
  onLeaveThem: () => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const { result, plan, scan, undone } = stage;
  const [left, setLeft] = useState(false);
  // The first-open question's two answers, offered where its bill has just
  // arrived: an import is how a Keep user's Inbox gets to hundreds, and the
  // empty first open answered the question silently (review GAP-02). Only
  // while the Inbox still starts at the beginning, and until it is answered.
  const askable =
    undone === null &&
    result.inInbox >= INBOX_ASK_MIN &&
    (inboxSince === null || inboxSince === INBOX_ALL);
  const rows: [string, number][] = [
    ["Imported", result.imported],
    ["Brought back from the trash", result.revived],
    ["Into the Archive", result.archived],
    ["Into boards", result.filed],
    ["Marked important", result.important],
    ["Files", result.files],
    ["Already here, skipped", plan.already],
    ["In Keep's trash, left behind", scan.trashed],
    ["Empty, left behind", result.empty],
  ];
  return (
    <>
      <h3 className="about-h">Imported</h3>
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

      {result.stopped && (
        <p className="about-error" role="alert">
          {`${result.stopped} The import stopped after ${notes(result.imported)}; they are in. Free some space and import the same Takeout again to bring in the rest. Nothing already here is imported twice.`}
        </p>
      )}

      {askable && !left && (
        <>
          <p className="keep-lead">
            {`${notes(result.inInbox)} ${result.inInbox === 1 ? "is" : "are"} in your Inbox now. Tidy ${result.inInbox === 1 ? "it" : "them"} up one at a time, or start the Inbox empty today and leave ${result.inInbox === 1 ? "it" : "them"} where ${result.inInbox === 1 ? "it is" : "they are"}. You can change this from the menu.`}
          </p>
          <div className="keep-actions">
            <button type="button" className="btn mono about-export" onClick={onTidyNow}>
              <span>Tidy them up</span>
            </button>
            <button
              type="button"
              className="btn mono about-export"
              onClick={() => {
                onLeaveThem();
                setLeft(true);
              }}
            >
              <span>Start the Inbox today</span>
            </button>
          </div>
        </>
      )}
      {askable && left && (
        <p className="keep-lead" role="status">
          {`The Inbox starts today. ${notes(result.inInbox)} stay on All; Bring in the old notes, in the menu, brings ${result.inInbox === 1 ? "it" : "them"} in.`}
        </p>
      )}

      {result.beforeInboxLine > 0 && (
        <p className="keep-lead">
          {`${notes(result.beforeInboxLine)} ${result.beforeInboxLine === 1 ? "was" : "were"} written before your Inbox starts, so ${result.beforeInboxLine === 1 ? "it is" : "they are"} on All rather than in the Inbox. Bring in the old notes, in the menu, brings ${result.beforeInboxLine === 1 ? "it" : "them"} in.`}
        </p>
      )}

      {result.leftBehind.length > 0 && (
        <>
          <h3 className="about-h">Files that did not come across</h3>
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
      <Unreadable paths={scan.unreadable} />

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
