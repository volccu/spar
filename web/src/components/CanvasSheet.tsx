import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cycleTab } from "../lib/focusTrap";
import { shownRows, walkRows } from "../lib/rowKeys";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { DUPLICATE_KEY, hotkeyTitle, isTypingTarget, REDO_KEY, UNDO_KEY, useHasKeyboard } from "../lib/hotkeys";
import { useIsPhone } from "../lib/breakpoint";
import { ERASE_REACH, pathBetween, strokeHit } from "../lib/strokeErase";
import type { CSSProperties } from "react";
import type { Attachment, Canvas, CanvasItem, CanvasText, CanvasTool, DrawingStroke, Note, ShapeKind } from "../types";
import { cardLines } from "../lib/face";
import { anchorScroll, clampZoom, DEFAULT_W, IMG_W, picturesOf, TEXT_W, worldFromClient } from "../lib/canvas";
import { fitView, fitWhole } from "../lib/canvasFit";
import { strokePath } from "../lib/strokePath";
import { constrainShape, isClosedShape, shapePoints, shapeStroke, tooSmall } from "../lib/shapes";
import { recogniseShape, SNAP_HOLD_MS, SNAP_STILL_PX } from "../lib/shapeSnap";
import {
  pictureChanged,
  redoStep,
  strokeAdded,
  strokeChanged,
  strokeRemoved,
  textAdded,
  textChanged,
  textRemoved,
  undoStep,
  UNDO_DEPTH,
  type Change,
  type Step,
} from "../lib/canvasSteps";
import {
  boxBetween,
  carryPicture,
  carryStroke,
  carryText,
  isEmptySelection,
  pick,
  selectionBounds,
  STILL,
  stretchScale,
  type Box,
  type Carry,
  type Placed,
  type Selection,
} from "../lib/canvasSelection";
import { useSetting } from "../lib/settings";
import { noteName } from "../lib/name";
import { previewsFor } from "../lib/links";
import { useTimeMark } from "../lib/clock";
import { editedAt } from "../lib/versions";
import { fileIconKey, fileKind, isImage } from "../lib/files";
import { useEdgeFade } from "../lib/useEdgeFade";
import { useFileUrl } from "../store/useFileUrl";
import {
  IconBack,
  IconDelete,
  IconDownload,
  IconDuplicate,
  IconEraser,
  IconFit,
  IconFile,
  IconFileType,
  IconHand,
  IconHighlighter,
  IconLasso,
  IconLink,
  IconMerge,
  IconPencil,
  IconPicture,
  IconPriority,
  IconRedo,
  IconRelease,
  IconShape,
  IconShapes,
  IconText,
  IconUndo,
  IconUnmerge,
} from "./Icons";
import { isUnmergeable, unmergeSources } from "../lib/merge";
import { CardBody } from "./shared/CardBody";
import { CANVAS_COLOURS, CANVAS_WIDTHS, HIGHLIGHT_WIDTHS } from "../lib/canvasPalette";
import { CanvasTextLabel } from "./CanvasTextLabel";
import { CanvasPicture } from "./CanvasPicture";
import { Dialog } from "./Dialog";

const WORLD_SIZE = 100_000;
const WORLD_ORIGIN = WORLD_SIZE / 2;
const INITIAL_EDGE = 48;
const NOTE_MIN_W = 160;
const NOTE_MAX_W = 600;
const IMG_MIN_W = 60;
/**
 * The default widths come from `lib/canvas.ts`, which is where the layout that
 * *measures* them lives. Declared here as well, they were one edit away from
 * the canvas drawing notes at a width the snapshot did not use — and the
 * snapshot is what an idea card shows for the canvas.
 */
const NOTE_DEFAULT_W = DEFAULT_W;
const IMG_DEFAULT_W = IMG_W;

type Tool = CanvasTool;

/** A stroke and the place it held in the list, so taking it back puts it where it was. */
interface StrokeEntry {
  stroke: DrawingStroke;
  index: number;
}

/**
 * Strokes taken off, as one step. Highest place first, so Undo — which walks a step
 * backwards — sets them back lowest first, and each lands where it stood.
 */
function removals(entries: StrokeEntry[]): Step {
  return [...entries].sort((a, b) => b.index - a.index).map((e) => strokeRemoved(e.stroke, e.index));
}

/** The shapes the Shapes tool offers, in the order its picker lists them. */
const SHAPES: readonly { kind: ShapeKind; label: string }[] = [
  { kind: "rect", label: "Rectangle" },
  { kind: "ellipse", label: "Ellipse" },
  { kind: "line", label: "Line" },
  { kind: "arrow", label: "Arrow" },
];

/** How far a copy stands from what it copies, so it is seen arriving. */
const COPY_STEP = 24;

interface Props {
  folder: Canvas;
  /** The note the canvas belongs to. It is what carries the idea's name. */
  idea: Note | null;
  notes: Note[];
  onClose: () => void;
  onRename: (ideaId: string, name: string) => void;
  /** One note out of the idea and back onto the board. */
  onRelease: (ideaId: string, noteId: string) => void;
  /**
   * Every note out, back where it was, and the idea itself to the archive —
   * the merge taken back, keeping whatever was written into the idea since.
   * Only a composed idea offers it (`isUnmergeable`); a sketch has nothing to
   * be un-merged back into.
   */
  onUnmerge?: (ideaId: string) => void;
  /** Every note out, and the idea itself to the trash. */
  onDissolve: (ideaId: string) => void;
  /** One note straight to the trash, whether or not it belongs to an idea. */
  onTrashNote: (noteId: string) => void;
  /**
   * Moves a note's position on the canvas. Named for the drag, not "move",
   * because App.tsx also has a Move that files a note into a folder — two
   * unrelated actions that both read as "move a note".
   */
  onDragNoteTo: (canvasId: string, noteId: string, x: number, y: number) => void;
  onOpenNote: (note: Note, from: DOMRect) => void;
  onAddStroke: (canvasId: string, stroke: DrawingStroke) => void;
  onClearStrokes: (canvasId: string) => void;
  /** One stroke off the drawing — the eraser, and the way back from a stroke drawn. */
  onRemoveStroke: (canvasId: string, strokeId: string) => void;
  /**
   * Any change to the drawing, as one write: Undo and Redo, and everything the Select tool
   * does. `useCanvases.changeCanvas` — the same queued write every other edit is.
   */
  onChangeCanvas: (canvasId: string, change: (canvas: Canvas) => Canvas) => void;
  onResizeNote: (canvasId: string, noteId: string, width: number) => void;
  onResizeImage: (canvasId: string, attachmentId: string, width: number) => void;
  onAddText: (canvasId: string, text: CanvasText) => void;
  onEditText: (canvasId: string, textId: string, changes: Partial<Pick<CanvasText, "text" | "x" | "y" | "width">>) => void;
  onRemoveText: (canvasId: string, textId: string) => void;
  /**
   * Pictures pasted, dropped or picked onto the canvas, to stand at `at` (world
   * coordinates). They become ordinary attachments of the idea note; without
   * this the canvas takes no pictures and leaves a paste or a drop to the app.
   */
  onAddImages?: (canvasId: string, files: File[], at: [number, number]) => void;
  onMoveImage?: (canvasId: string, attachmentId: string, x: number, y: number) => void;
  /** Takes the picture off the canvas and destroys its file. Asked first, here. */
  onRemoveImage?: (canvasId: string, attachmentId: string) => void;
  /**
   * The tool the sheet opens holding. A sketch opens with the pen already in
   * hand — drawing is what it is for — while a composed idea keeps opening in
   * Move. Safe as initial state only because the sheet is keyed on the canvas
   * id and remounts per open; it never changes tools on a mounted sheet.
   */
  initialTool?: Tool;
  /**
   * The canvas was made by a merge a moment ago. It then opens zoomed to show
   * every note at once, with one line saying what happened and how to take
   * it back (review 2026-10-01, UX-26). Read once, at opening, like
   * `initialTool`.
   */
  justMerged?: boolean;
  /** The board the idea is on, named in the merge's line ("in Inbox"). */
  where?: string;
}

/** Air left round a merge's notes when it opens fitted to the screen. */
const FIT_EDGE = 16;
/** ...and above them, clear of the line that hangs under the bar. */
const FIT_TOP = 72;
/** ...and never smaller than this: below it a card's text is too small to read. */
const FIT_FLOOR = 0.75;
/** How long the line about a fresh merge stays if nothing is touched. */
const MERGED_LINE_MS = 6000;

interface DragState {
  noteId: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
  /** A middle-button pan works through any tool; an ordinary pan belongs to Move. */
  middle: boolean;
}

interface ResizeState {
  noteId: string;
  startX: number;
  originWidth: number;
}

interface ImageResizeState {
  attachmentId: string;
  startX: number;
  originWidth: number;
}

const SpatialAttachment = memo(function SpatialAttachment({
  att,
  width,
  zoomRef,
  onResize,
}: {
  att: Attachment;
  width: number;
  zoomRef: React.RefObject<number>;
  onResize: (width: number) => void;
}) {
  const { url: local } = useFileUrl(isImage(att) ? att : null, "local");
  // Bytes this browser cannot draw (an iPhone's HEIC in Chrome) fall back to
  // the thumbnail, and with none, to the file's mark below — never a broken box.
  const [broken, setBroken] = useState<string | null>(null);
  const shot = (local !== broken ? local : null) ?? (broken === "thumb" ? null : att.thumb) ?? null;
  const resizeRef = useRef<ImageResizeState | null>(null);

  function onResizePointerDown(event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      attachmentId: att.id,
      startX: event.clientX,
      originWidth: width,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onResizePointerMove(event: React.PointerEvent) {
    if (!resizeRef.current) return;
    // The pointer moves in screen pixels; the width it is dragging is a world
    // measurement, so the same finger travel must buy fewer world pixels the
    // further in the canvas is zoomed. Read from the ref, not a prop, so a
    // pinch in progress elsewhere never has to re-render this attachment.
    const dx = (event.clientX - resizeRef.current.startX) / zoomRef.current;
    const next = Math.max(IMG_MIN_W, resizeRef.current.originWidth + dx);
    onResize(next);
  }

  function onResizePointerUp(event: React.PointerEvent) {
    resizeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  if (!isImage(att) || !shot) {
    return (
      <div className="spatial-att-file" style={{ width }}>
        <IconFileType kind={fileIconKey(att.name, att.mime)} tier="inline" />
        {/* The shared helper, not a split on the name — a dotless file used to
            show its whole name here as its "type". One definition, everywhere. */}
        <span className="card-file-kind mono">{fileKind(att.name, att.mime)}</span>
        <span className="card-file-name">{att.name}</span>
      </div>
    );
  }

  return (
    <div className="spatial-att-image" style={{ width }}>
      <img
        className="spatial-att-img"
        src={shot}
        alt=""
        draggable={false}
        onError={() => setBroken(shot === local ? local : "thumb")}
      />
      <span
        className="spatial-resize-handle spatial-resize-handle--img"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />
    </div>
  );
});

/**
 * Memoized, and reads the live zoom off a ref rather than a prop
 * (`zoomRef`) — a canvas can hold dozens of these, and a pinch used to set
 * `zoom` in React state on every single pointermove, which re-rendered every
 * note on the board for every frame of the gesture and was the actual
 * jankiness a pinch felt like on a phone. Nothing here draws differently at
 * a different zoom — only the resize handle's own drag math needs the
 * current value, and only at the moment a finger is on it — so a ref is
 * exactly enough and a prop was paying for a re-render that bought nothing.
 * `imageWidths` must stay a stable reference from the caller for the same
 * reason (see `Canvas`'s own `useMemo` for it).
 */
const NoteCapsule = memo(function NoteCapsule({
  note,
  item,
  dragging,
  imageWidths,
  zoomRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onOpen,
  onContextMenu,
  onResizeNote,
  onResizeImage,
  canvasId,
}: {
  note: Note;
  item: CanvasItem;
  dragging: boolean;
  imageWidths: Record<string, number>;
  zoomRef: React.RefObject<number>;
  onPointerDown: (event: React.PointerEvent<HTMLElement>, item: CanvasItem) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  /** Not `onPointerUp` again: a cancelled press neither opens nor commits. */
  onPointerCancel: () => void;
  onOpen: (note: Note, from: DOMRect) => void;
  onContextMenu: (event: React.MouseEvent, note: Note) => void;
  onResizeNote: (canvasId: string, noteId: string, width: number) => void;
  onResizeImage: (canvasId: string, attachmentId: string, width: number) => void;
  canvasId: string;
}) {
  const stamp = useTimeMark(editedAt(note));
  const body = note.body.trim() || (note.attachments?.length ? "Attachment" : "Empty note");
  const lines = useMemo(() => cardLines(note.body), [note.body]);
  const linkCount = useMemo(() => previewsFor(note.body).length, [note.body]);
  const fileCount = note.attachments?.length ?? 0;
  const noteWidth = item.width ?? NOTE_DEFAULT_W;
  const resizeRef = useRef<ResizeState | null>(null);

  function onResizePointerDown(event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      noteId: note.id,
      startX: event.clientX,
      originWidth: noteWidth,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onResizePointerMove(event: React.PointerEvent) {
    if (!resizeRef.current) return;
    // Same reasoning as the image handle: the drag is screen pixels, the
    // width it is setting is a world measurement.
    const dx = (event.clientX - resizeRef.current.startX) / zoomRef.current;
    const next = Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, resizeRef.current.originWidth + dx));
    onResizeNote(canvasId, note.id, next);
  }

  function onResizePointerUp(event: React.PointerEvent) {
    resizeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  return (
    <article
      className="spatial-note"
      data-id={note.id}
      data-dragging={dragging}
      data-priority={note.priority}
      style={{
        left: WORLD_ORIGIN + item.x,
        top: WORLD_ORIGIN + item.y,
        width: noteWidth,
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open note: ${body.slice(0, 80)}`}
      onPointerDown={(event) => onPointerDown(event, item)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => onContextMenu(event, note)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpen(note, event.currentTarget.getBoundingClientRect());
      }}
    >
      {/* A canvas note carries no footer row, so here the mark stays in the
          corner it has always been in — the same drawing the board's footer
          uses, in the one place this card has for it. */}
      {note.priority > 0 && (
        <span className="spatial-priority" title="Marked important">
          <IconPriority on tier="data" />
        </span>
      )}
      {/* The card's own body, so code and a tag line read here as they do
          on the board. Never cut: the canvas note is `height: auto`, and
          seeing the whole of it is the point of laying notes out by hand. */}
      <CardBody lines={lines} cut={false} className="spatial-card-body">
        {fileCount > 0 ? null : body}
      </CardBody>
      {note.attachments && note.attachments.length > 0 && (
        <div className="spatial-attachments">
          {note.attachments.map((att) => (
            <SpatialAttachment
              key={att.id}
              att={att}
              width={imageWidths[att.id] ?? IMG_DEFAULT_W}
              zoomRef={zoomRef}
              onResize={(w) => onResizeImage(canvasId, att.id, w)}
            />
          ))}
        </div>
      )}
      <div className="card-foot mono">
        {fileCount > 0 && (
          <span className="card-link">
            <IconFile tier="data" />
            {fileCount > 1 && <span className="link-n">{fileCount}</span>}
          </span>
        )}
        {linkCount > 0 && (
          <span className="card-link">
            <IconLink />
            {linkCount > 1 && <span className="link-n">{linkCount}</span>}
          </span>
        )}
        <span className="card-time">{stamp}</span>
      </div>
      <span
        className="spatial-resize-handle"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
      />
    </article>
  );
});

const CTX_ROWS = '[role^="menuitem"]:not(:disabled)';

/**
 * What the canvas takes: pictures, and only when everything that arrived is
 * one. A paste or drop that also carries another kind of file is the app's,
 * whole, as before — never half taken here and half lost.
 */
function picturesOnly(list: FileList | File[] | null | undefined): File[] {
  const files = Array.from(list ?? []);
  // An iPhone photograph can arrive with no type at all; its name still says.
  const picture = (file: File) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
  return files.length > 0 && files.every(picture) ? files : [];
}

/**
 * A right-click menu as every other panel is one (`MenuPanel`): a menu of
 * menu items, the first row takes the focus on open, the arrows walk the
 * rows, and the focus goes back to where it was when the menu closes. Escape
 * is the canvas sheet's own (`onKeyDown` there), which closes it before the
 * canvas.
 */
function CtxMenu({
  x,
  y,
  above = false,
  className = "",
  label,
  children,
}: {
  x: number;
  y: number;
  /** Fixed distance from the viewport's bottom rather than from its top. */
  above?: boolean;
  className?: string;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useRestoreFocus();
  useLayoutEffect(() => {
    if (ref.current) shownRows(ref.current, CTX_ROWS)[0]?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      className={`ctx-menu${className ? ` ${className}` : ""}`}
      role="menu"
      aria-label={label}
      style={above ? { left: x, bottom: y } : { left: x, top: y }}
      onKeyDown={(e) => walkRows(e, CTX_ROWS)}
    >
      {children}
    </div>
  );
}

/**
 * The idea's name, in the bar, editable in place.
 *
 * A place is named where you are standing in it, not in a settings sheet
 * somewhere else — so the title *is* the control. Unnamed it reads "Idea",
 * which is the app's own word for one and is what it has always said there;
 * the difference is that the word is now a button, and what it opens is the
 * one field.
 *
 * The name is written into the idea note's text as a `# ` heading — see
 * `withNoteName`. Nothing here knows that; it hands up a string.
 */
function CanvasName({
  idea,
  count,
  onRename,
}: {
  idea: Note | null;
  count: number;
  onRename: (ideaId: string, name: string) => void;
}) {
  const name = idea ? noteName(idea.body) : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function open() {
    if (!idea) return;
    setDraft(name ?? "");
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (!idea) return;
    if (draft.trim() === (name ?? "")) return;
    onRename(idea.id, draft);
  }

  return (
    <div className="canvas-name">
      <IconMerge tier="inline" />
      {/* The count stands before the name, beside the mark it counts. After
          it, it rode on the name's width, and opening the name field (a
          fixed 22ch where the button is as wide as its word) threw it ~110px
          right; while typing it crept along with every letter. Nothing now
          follows the one thing in this row whose width changes. */}
      <span className="canvas-count mono">{count}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="canvas-title canvas-title-input"
          value={draft}
          placeholder="Name this idea"
          aria-label="Idea name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setDraft(name ?? "");
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="canvas-title"
          // The name is the whole label; "Idea" standing in for one that has
          // not been given is not something to announce as the name.
          aria-label={name ? `Idea: ${name}. Rename` : "Name this idea"}
          title="Rename"
          onClick={open}
          data-unnamed={name === null}
        >
          {name ?? (count > 0 ? (count === 1 ? "note" : "notes") : "Idea")}
        </button>
      )}
    </div>
  );
}

/**
 * What the drawn notes cover, in the scroll-space-at-zoom-1 coordinates
 * `fitView` takes — read off the page rather than off the items, because a
 * note is as tall as its words and only the drawing knows that. Asked at 100%,
 * where a rect's distance from the world's own corner is a world distance.
 */
function drawnBox(canvas: HTMLElement): { x: number; y: number; w: number; h: number } {
  const world = canvas.querySelector(".canvas-world");
  const notes = canvas.querySelectorAll(".spatial-note");
  if (!world || notes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const origin = world.getBoundingClientRect();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of notes) {
    const r = el.getBoundingClientRect();
    left = Math.min(left, r.left - origin.left);
    top = Math.min(top, r.top - origin.top);
    right = Math.max(right, r.right - origin.left);
    bottom = Math.max(bottom, r.bottom - origin.top);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function CanvasSheet({
  folder,
  idea,
  notes,
  onClose,
  onRename,
  onRelease,
  onUnmerge,
  onDissolve,
  onTrashNote,
  onDragNoteTo,
  onOpenNote,
  onAddStroke,
  onClearStrokes,
  onRemoveStroke,
  onChangeCanvas,
  onResizeNote,
  onResizeImage,
  onAddText,
  onEditText,
  onRemoveText,
  onAddImages,
  onMoveImage,
  onRemoveImage,
  initialTool,
  justMerged = false,
  where,
}: Props) {
  const [items, setItems] = useState(folder.items);
  const [tool, setTool] = useState<Tool>(initialTool ?? "move");
  const [color, setColor] = useState(CANVAS_COLOURS[0].value);
  const [width, setWidth] = useState<number>(CANVAS_WIDTHS[1]);
  const [highlightWidth, setHighlightWidth] = useState<number>(HIGHLIGHT_WIDTHS[1]);
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [shapeFill, setShapeFill] = useState(false);
  /** The pen tidies a rough circle, box or line held still at its end (Settings can turn it off). */
  const tidyShapes = useSetting("tidyShapes") === "on";
  const [optionMenu, setOptionMenu] = useState<{ kind: "color" | "width" | "shape"; x: number; y: number; above: boolean } | null>(null);
  const [liveStroke, setLiveStroke] = useState<DrawingStroke | null>(null);
  /** The stroke being drawn, read at the lift. Beside the state, which only paints. */
  const liveRef = useRef<DrawingStroke | null>(null);
  /**
   * What Undo would take back, newest last. The ref is the truth, written at
   * once, so two quick presses never take back the same step; the state is only
   * there so the button knows whether it has anything to do.
   */
  const stepsRef = useRef<Step[]>([]);
  const [stepCount, setStepCount] = useState(0);
  /** What Redo would do again: the steps Undo took back, emptied by anything new. */
  const redoRef = useRef<Step[]>([]);
  const [redoCount, setRedoCount] = useState(0);
  /** The pen held still: where it rests, the wait, and the rough stroke a snap replaced. */
  const snap = useRef<{ x: number; y: number; timer: number | null; rough: DrawingStroke | null }>({
    x: 0,
    y: 0,
    timer: null,
    rough: null,
  });
  /** The shape being dragged out: the corner it started from. */
  const shaping = useRef<[number, number] | null>(null);
  /** What the Select tool holds, and the loop or box being drawn round it. */
  const [selection, setSelection] = useState<Selection | null>(null);
  const [region, setRegion] = useState<{ loop: [number, number][] } | { box: Box } | null>(null);
  /** The selection being carried or stretched, drawn live and written once at the lift. */
  const [carry, setCarry] = useState<Carry>(STILL);
  const selecting = useRef<{
    mode: "loop" | "box" | "move" | "stretch";
    start: [number, number];
    loop: [number, number][];
    bounds: Box | null;
    /** Labels as measured at the press: while they are stretched the page measures the stretch. */
    texts: Placed[];
  } | null>(null);
  /** The carry as the last move left it, read at the lift: the state may not have painted yet. */
  const carryRef = useRef<Carry>(STILL);
  /** A line for a moment at the foot of the canvas: a picture that could not be made. */
  const [notice, setNotice] = useState<string | null>(null);
  /** The rub in progress: where the finger last was, the list it began on, and what it has taken. */
  const erasing = useRef<{ last: [number, number] | null; start: DrawingStroke[]; gone: Map<string, StrokeEntry> } | null>(null);
  const strokesRef = useRef(folder.strokes);
  strokesRef.current = folder.strokes;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  /**
   * The menu for one note on the canvas, opened by right-clicking it.
   *
   * A note on a canvas is still an ordinary note that lives on the board, and
   * until now there was no way back: an idea made by an accidental drag kept
   * everything inside it, and the only exit was the eight seconds of undo that
   * followed the merge. Right-click is where a desktop already looks for "and
   * what else can I do with this one", and it is the sibling of the long press
   * the grid answers with.
   */
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; note: Note } | null>(null);
  /** A label's own menu, and a placed picture's, both opened by right-clicking it. */
  const [textMenu, setTextMenu] = useState<{ x: number; y: number; text: CanvasText } | null>(null);
  const [pictureMenu, setPictureMenu] = useState<{ x: number; y: number; att: Attachment } | null>(null);
  /** Removing a picture destroys its file, so it asks first, as the open note does. */
  const [removing, setRemoving] = useState<Attachment[] | null>(null);
  /** The label just set down and not yet written: an editor until it holds words. */
  const [draftText, setDraftText] = useState<CanvasText | null>(null);
  /** The label the menu's Edit text asked to open. */
  const [editTextId, setEditTextId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  /** Where a picked picture should land: the menu's spot, else the middle of the view. */
  const pickAt = useRef<[number, number] | null>(null);
  /** Pictures set down this sitting, so a second one lands beside the first, not on it. */
  const placedCount = useRef(0);
  /**
   * How far this canvas is zoomed, on this device, right now. Not a fact
   * about the arrangement — two people never agree on it, and a canvas made
   * on a laptop still has to be seen whole on a phone — so it lives only
   * here, resets to 1 every time the canvas opens, and is never read by
   * `Canvas` the type, never migrated, never synced.
   */
  const [zoom, setZoom] = useState(1);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  /**
   * The desktop toolbar, which can still be narrower than its controls in a
   * window just wider than a phone. It scrolls, and its cut edge fades open
   * (the tab strip's own answer, `useEdgeFade`). A phone has no such bar: its
   * tools stand at the foot of the screen and wrap, never scroll. The deps are
   * what changes how much there is to fit.
   */
  const tools = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const pan = useRef<PanState | null>(null);
  const drawing = useRef(false);
  const movedItems = useRef(items);
  movedItems.current = items;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** Live pointers on the canvas, keyed by pointerId. A second one joining
      the map is the entire signal that a pinch has begun. */
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  /** The pinch in progress, if any: the distance and zoom it started at, and
      the content point (in "scroll-space at zoom 1" coordinates —
      `worldFromClient` called with `origin: 0`) that has to stay under the
      fingers for as long as the gesture runs. */
  const pinch = useRef<{ startDist: number; startZoom: number; contentX: number; contentY: number } | null>(null);
  /** Where a pinch or a trackpad zoom wants the scroll set once the new
      zoom's transform has painted. Read and cleared by the layout effect
      below so the two land in the same frame — set it in a plain effect and
      the world would visibly swim for one frame before catching up. */
  const pendingAnchor = useRef<{ left: number; top: number; zoom: number } | null>(null);

  useEdgeFade(tools, [tool, zoom !== 1, folder.strokes.length > 0, stepCount > 0]);

  /**
   * An anchor carries the zoom it was worked out for, and lands only on that
   * zoom. A pinch held at the clamp keeps asking for the zoom it already has,
   * which React skips — so this effect never ran, and the anchor sat here
   * until the next zoom change of any kind picked it up: opening another
   * canvas, which resets to 100% and sets its own scroll, was thrown back to
   * wherever the fingers had last been on the one before. Stale anchors are
   * now dropped by whichever zoom change comes next, instead of obeyed.
   */
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = null;
    if (!canvas || !anchor || anchor.zoom !== zoom) return;
    canvas.scrollLeft = anchor.left;
    canvas.scrollTop = anchor.top;
  }, [zoom]);

  useEffect(() => {
    setItems(folder.items);
  }, [folder.id, folder.updated_at, folder.items]);

  // Before paint, so a fresh merge is never drawn at 100% for a frame and
  // then jumps to its fitted view.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // A canvas is one arrangement shared by two devices; how far a phone has
    // pinched into it is not part of that arrangement. Opening it starts
    // fresh at 100%, the same as any other note opening un-scrolled.
    setZoom(1);
    canvas.scrollLeft = WORLD_ORIGIN - INITIAL_EDGE;
    canvas.scrollTop = WORLD_ORIGIN - INITIAL_EDGE;
    // ...except a merge made a moment ago, which opens showing all of its
    // notes (`fitView`). Measured off the drawn notes at 100%, the zoom
    // every opening starts from, so a rect is a world distance as it stands.
    if (!justMerged) return;
    const fit = fitView(drawnBox(canvas), { w: canvas.clientWidth, h: canvas.clientHeight }, FIT_EDGE, FIT_TOP, FIT_FLOOR);
    if (!fit) return;
    pendingAnchor.current = { left: fit.left, top: fit.top, zoom: fit.zoom };
    setZoom(fit.zoom);
    // Opening is the one moment this reads; the flag is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder.id]);

  /**
   * The line a fresh merge opens with: what just happened, and the way back.
   * Un-merge lives in the canvas's own menu, which a person who has only just
   * met the canvas has no reason to know about. It goes at the first touch of
   * the canvas, or by itself after a few seconds; it is never shown again.
   */
  const keyboard = useHasKeyboard();
  const [mergedLine, setMergedLine] = useState(justMerged);
  useEffect(() => {
    if (!mergedLine) return;
    const t = window.setTimeout(() => setMergedLine(false), MERGED_LINE_MS);
    return () => window.clearTimeout(t);
  }, [mergedLine]);
  const canUnmerge = Boolean(
    onUnmerge && idea && isUnmergeable(idea) && unmergeSources(idea, notes).length > 0,
  );

  // A trackpad pinch arrives as a `wheel` event with `ctrlKey` set. React
  // registers `onWheel` passively, so `preventDefault` inside it does
  // nothing and the page would zoom instead of the canvas — the listener has
  // to be added by hand with `{ passive: false }`.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const [contentX, contentY] = worldFromClient({
        scrollLeft: canvas!.scrollLeft,
        scrollTop: canvas!.scrollTop,
        rectLeft: rect.left,
        rectTop: rect.top,
        clientX: event.clientX,
        clientY: event.clientY,
        zoom: zoomRef.current,
        origin: 0,
      });
      const nextZoom = clampZoom(zoomRef.current * Math.exp(-event.deltaY * 0.01));
      pendingAnchor.current = {
        ...anchorScroll({
          contentX,
          contentY,
          zoom: nextZoom,
          pointX: event.clientX - rect.left,
          pointY: event.clientY - rect.top,
        }),
        zoom: nextZoom,
      };
      setZoom(nextZoom);
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  // A note trashed on the other device is still in `folder.items` here until
  // this device rearranges the canvas — the layout is the one thing that
  // does not sync on its own. Skipping it is what makes the disappearance
  // show up on the next sync rather than waiting for a local edit.
  const children = items
    .map((item) => ({ item, note: noteById.get(item.note_id) }))
    .filter(
      (child): child is { item: CanvasItem; note: Note } =>
        Boolean(child.note) && child.note?.status !== "trashed",
    );

  // Memoized so a note that never resizes an image gets the same empty
  // object back every render — `folder.image_widths ?? {}` alone hands
  // `NoteCapsule` a fresh object on every render (including every pinch
  // frame), which would defeat its memo just as surely as passing `zoom`
  // itself did.
  const imageWidths = useMemo(() => folder.image_widths ?? {}, [folder.image_widths]);

  /** Pictures set on the canvas itself: the idea note's own files, where each stands. */
  const pictures = useMemo(() => picturesOf(idea, folder), [idea, folder]);
  const moveImage = useCallback(
    (canvasId: string, attachmentId: string, x: number, y: number) => onMoveImage?.(canvasId, attachmentId, x, y),
    [onMoveImage],
  );

  const updateItem = useCallback((noteId: string, x: number, y: number) => {
    setItems((current) => {
      const next = current.map((item) =>
        item.note_id === noteId ? { ...item, x, y } : item,
      );
      movedItems.current = next;
      return next;
    });
  }, []);

  function toWorldCoords(clientX: number, clientY: number): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return worldFromClient({
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
      rectLeft: rect.left,
      rectTop: rect.top,
      clientX,
      clientY,
      zoom,
      origin: WORLD_ORIGIN,
    });
  }

  function startPan(event: React.PointerEvent<HTMLDivElement>, middle = false) {
    // Used to bail on anything but a mouse, because native touch scrolling
    // was doing the panning for a finger. `.canvas-surface` now takes
    // `touch-action: none` so a second finger can be seen for a pinch — which
    // means a touch pointer has nothing left to pan it but this handler.
    if (!middle && event.target instanceof Element && event.target.closest(".spatial-note, .spatial-resize-handle")) return;
    if (!middle && tool !== "move") return;
    if (event.pointerType === "mouse" && event.button !== (middle ? 1 : 0)) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    pan.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: canvas.scrollLeft,
      originTop: canvas.scrollTop,
      middle,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  /** Middle-click is always a pan, never the tool in hand. Capture runs before
   * a note or label can claim the press, and stops it reaching them at all. */
  function startMiddlePan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 1) return;
    event.stopPropagation();
    startPan(event, true);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const current = pan.current;
    const canvas = canvasRef.current;
    if (!current || !canvas) return;
    canvas.scrollLeft = current.originLeft - (event.clientX - current.startX);
    canvas.scrollTop = current.originTop - (event.clientY - current.startY);
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (pan.current?.pointerId !== event.pointerId) return;
    pan.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  /** The pen and the highlighter: the same hand, a different line. */
  const drawsLine = tool === "draw" || tool === "highlight";

  function startDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawsLine) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".spatial-note, .spatial-resize-handle")) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "touch" && event.pointerType !== "pen") return;
    event.preventDefault();
    drawing.current = true;
    const [wx, wy] = toWorldCoords(event.clientX, event.clientY);
    liveRef.current =
      tool === "highlight"
        ? { id: crypto.randomUUID(), points: [[wx, wy]], color, width: highlightWidth, highlight: true }
        : { id: crypto.randomUUID(), points: [[wx, wy]], color, width };
    setLiveStroke(liveRef.current);
    restSnap(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawing.current || !liveRef.current) return;
    // Tidied: the shape stands as it was snapped until the lift.
    if (snap.current.rough) return;
    const [wx, wy] = toWorldCoords(event.clientX, event.clientY);
    liveRef.current = { ...liveRef.current, points: [...liveRef.current.points, [wx, wy]] };
    setLiveStroke(liveRef.current);
    if (Math.hypot(event.clientX - snap.current.x, event.clientY - snap.current.y) > SNAP_STILL_PX) {
      restSnap(event.clientX, event.clientY);
    }
  }

  /**
   * The pen came to rest at `x, y` (screen pixels): wait, and if it is still there when the
   * wait is over, see whether what it drew was a line, a ring or a box, and tidy it. Only the
   * pen, never the highlighter, and nothing at all when Settings says no.
   */
  function restSnap(x: number, y: number) {
    stopSnapWait();
    snap.current.x = x;
    snap.current.y = y;
    if (tool !== "draw" || !tidyShapes) return;
    snap.current.timer = window.setTimeout(() => {
      snap.current.timer = null;
      const live = liveRef.current;
      if (!drawing.current || !live || snap.current.rough) return;
      const found = recogniseShape(live.points);
      if (!found) return;
      snap.current.rough = live;
      liveRef.current = { ...live, points: shapePoints(found.kind, found.from, found.to, live.width), shape: found.kind };
      setLiveStroke(liveRef.current);
    }, SNAP_HOLD_MS);
  }

  function stopSnapWait() {
    if (snap.current.timer !== null) window.clearTimeout(snap.current.timer);
    snap.current.timer = null;
  }

  useEffect(() => stopSnapWait, []);

  function endDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    stopSnapWait();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const done = liveRef.current;
    const rough = snap.current.rough;
    snap.current.rough = null;
    liveRef.current = null;
    setLiveStroke(null);
    if (!done || done.points.length < 2) return;
    const index = strokesRef.current.length;
    onAddStroke(folder.id, done);
    if (rough) {
      // Two steps: the stroke as drawn, then its tidying — so one Undo gives the rough
      // line back, which is the way out of a snap nobody wanted.
      pushStep([strokeAdded(rough, index)]);
      pushStep([strokeChanged(rough, done, index)]);
    } else {
      pushStep([strokeAdded(done, index)]);
    }
  }

  /* --- shapes ------------------------------------------------------------- */

  function startShape(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    shaping.current = toWorldCoords(event.clientX, event.clientY);
    liveRef.current = null;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveShape(event: React.PointerEvent<HTMLDivElement>) {
    const from = shaping.current;
    if (!from) return;
    const to = constrainShape(shapeKind, from, toWorldCoords(event.clientX, event.clientY), event.shiftKey);
    if (tooSmall(from, to, zoomRef.current)) return;
    liveRef.current = shapeStroke(liveRef.current?.id ?? crypto.randomUUID(), shapeKind, from, to, {
      color,
      width,
      fill: shapeFill,
    });
    setLiveStroke(liveRef.current);
  }

  function endShape(event: React.PointerEvent<HTMLDivElement>) {
    if (!shaping.current) return;
    shaping.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const done = liveRef.current;
    liveRef.current = null;
    setLiveStroke(null);
    if (!done) return;
    const index = strokesRef.current.length;
    onAddStroke(folder.id, done);
    pushStep([strokeAdded(done, index)]);
  }

  /* --- undo and redo ------------------------------------------------------ */

  /** Records a step Undo can take back. Anything new ends what Redo could do again. */
  function pushStep(step: Step) {
    if (step.length === 0) return;
    stepsRef.current = [...stepsRef.current, step].slice(-UNDO_DEPTH);
    setStepCount(stepsRef.current.length);
    redoRef.current = [];
    setRedoCount(0);
  }

  /** Does a step for the first time — what the Select tool changes — and records it. */
  function doStep(step: Step) {
    if (step.length === 0) return;
    onChangeCanvas(folder.id, (canvas) => redoStep(canvas, step));
    pushStep(step);
  }

  /**
   * Takes back the last thing done to the drawing in this sitting. Answers whether there was
   * anything, which is what the key needs to know.
   */
  function undoStroke(): boolean {
    const last = stepsRef.current[stepsRef.current.length - 1];
    if (!last) return false;
    stepsRef.current = stepsRef.current.slice(0, -1);
    setStepCount(stepsRef.current.length);
    redoRef.current = [...redoRef.current, last];
    setRedoCount(redoRef.current.length);
    onChangeCanvas(folder.id, (canvas) => undoStep(canvas, last));
    return true;
  }

  /** Does again what Undo just took back. */
  function redoStroke(): boolean {
    const last = redoRef.current[redoRef.current.length - 1];
    if (!last) return false;
    redoRef.current = redoRef.current.slice(0, -1);
    setRedoCount(redoRef.current.length);
    stepsRef.current = [...stepsRef.current, last].slice(-UNDO_DEPTH);
    setStepCount(stepsRef.current.length);
    onChangeCanvas(folder.id, (canvas) => redoStep(canvas, last));
    return true;
  }

  function clearStrokes() {
    const entries = folder.strokes.map((stroke, index) => ({ stroke, index }));
    if (entries.length === 0) return;
    onClearStrokes(folder.id);
    pushStep(removals(entries));
  }

  /**
   * The eraser takes a whole stroke at a touch, not a pixel of one: nothing to
   * aim, nothing half-gone. It goes the moment the finger reaches it, and a
   * drag is one step to take back however many it crossed.
   */
  function startErase(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== "erase") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".spatial-note, .spatial-resize-handle")) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "touch" && event.pointerType !== "pen") return;
    event.preventDefault();
    erasing.current = { last: null, start: strokesRef.current, gone: new Map() };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    rub(event);
  }

  function rub(event: React.PointerEvent<HTMLDivElement>) {
    const state = erasing.current;
    if (!state) return;
    const here = toWorldCoords(event.clientX, event.clientY);
    // The reach is a fingertip's, in screen pixels: further in, fewer world units.
    const reach = ERASE_REACH / zoomRef.current;
    const path = pathBetween(state.last, here, reach);
    state.last = here;
    for (const stroke of strokesRef.current) {
      if (state.gone.has(stroke.id)) continue;
      if (!path.some(([x, y]) => strokeHit(stroke, x, y, reach))) continue;
      const was = state.start.findIndex((s) => s.id === stroke.id);
      state.gone.set(stroke.id, { stroke, index: was === -1 ? state.start.length : was });
      onRemoveStroke(folder.id, stroke.id);
    }
  }

  function endErase(event?: React.PointerEvent<HTMLDivElement>) {
    const state = erasing.current;
    if (!state) return;
    erasing.current = null;
    event?.currentTarget.releasePointerCapture?.(event.pointerId);
    if (state.gone.size > 0) pushStep(removals([...state.gone.values()]));
  }

  /* --- select ------------------------------------------------------------- */

  /**
   * Labels and pictures as the page draws them, in world units: their place from the
   * canvas, their size from the page (a label is as tall as its words), with a stand-in
   * where nothing is laid out yet.
   */
  function placed(): { texts: Placed[]; images: Placed[] } {
    const world = canvasRef.current?.querySelector(".canvas-world");
    const sized = (selector: string, id: string) =>
      world?.querySelector<HTMLElement>(`${selector}[data-id="${CSS.escape(id)}"]`) ?? null;
    const texts = (folder.text_elements ?? []).map((t) => {
      const el = sized(".canvas-text", t.id);
      const w = el?.offsetWidth || t.width || TEXT_W;
      return { id: t.id, box: { x: t.x, y: t.y, w, h: el?.offsetHeight || 32 } };
    });
    const images = pictures.map(({ att, x, y }) => {
      const el = sized(".canvas-picture", att.id);
      const w = imageWidths[att.id] ?? IMG_DEFAULT_W;
      return { id: att.id, box: { x, y, w, h: el?.offsetHeight || Math.round(w * 0.75) } };
    });
    return { texts, images };
  }

  /** The box round what is selected — carried, if it is being moved — or null with nothing left. */
  function selectedBox(withCarry: boolean): Box | null {
    if (!selection || isEmptySelection(selection)) return null;
    // Being carried, the page already shows the carry: the box is the one measured at the press.
    const held = selecting.current?.bounds;
    if (withCarry && carry !== STILL && held) {
      const [ax, ay] = carry.anchor;
      return {
        x: ax + (held.x - ax) * carry.scale + carry.dx,
        y: ay + (held.y - ay) * carry.scale + carry.dy,
        w: held.w * carry.scale,
        h: held.h * carry.scale,
      };
    }
    const { texts, images } = placed();
    const box = selectionBounds(selection, folder.strokes ?? [], texts, images);
    if (!box || !withCarry || carry === STILL) return box;
    const [ax, ay] = carry.anchor;
    return {
      x: ax + (box.x - ax) * carry.scale + carry.dx,
      y: ay + (box.y - ay) * carry.scale + carry.dy,
      w: box.w * carry.scale,
      h: box.h * carry.scale,
    };
  }

  /**
   * The Select tool. Inside the box the press carries what is selected, on its corner it
   * stretches it; anywhere else it draws round something new — a loop for a finger or a pen,
   * a box for a mouse, the way each is used to.
   */
  function startSelect(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const at = toWorldCoords(event.clientX, event.clientY);
    const bounds = selectedBox(false);
    const onHandle = event.target instanceof Element && event.target.closest(".canvas-selection-handle");
    // A finger is wider than a hairline: a press a little outside the box still counts.
    const slack = 12 / zoomRef.current;
    const inside =
      bounds !== null &&
      at[0] >= bounds.x - slack &&
      at[0] <= bounds.x + bounds.w + slack &&
      at[1] >= bounds.y - slack &&
      at[1] <= bounds.y + bounds.h + slack;
    const mode = bounds && onHandle ? "stretch" : inside ? "move" : event.pointerType === "mouse" ? "box" : "loop";
    selecting.current = { mode, start: at, loop: [at], bounds, texts: placed().texts };
    carryRef.current = STILL;
    // The old selection stands until the lift decides: a second finger may yet make this a pinch.
    if (mode === "loop" || mode === "box") setRegion(mode === "loop" ? { loop: [at] } : { box: boxBetween(at, at) });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveSelect(event: React.PointerEvent<HTMLDivElement>) {
    const state = selecting.current;
    if (!state) return;
    const at = toWorldCoords(event.clientX, event.clientY);
    if (state.mode === "loop") {
      state.loop = [...state.loop, at];
      setRegion({ loop: state.loop });
    } else if (state.mode === "box") {
      setRegion({ box: boxBetween(state.start, at) });
    } else if (state.mode === "move") {
      carryRef.current = { dx: at[0] - state.start[0], dy: at[1] - state.start[1], scale: 1, anchor: [0, 0] };
      setCarry(carryRef.current);
    } else if (state.bounds) {
      const scale = stretchScale(state.bounds, at[0] - state.start[0], at[1] - state.start[1]);
      carryRef.current = { dx: 0, dy: 0, scale, anchor: [state.bounds.x, state.bounds.y] };
      setCarry(carryRef.current);
    }
  }

  function endSelect(event: React.PointerEvent<HTMLDivElement>) {
    const state = selecting.current;
    if (!state) return;
    selecting.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (state.mode === "loop" || state.mode === "box") {
      setRegion(null);
      const { texts, images } = placed();
      let picked: Selection | null = null;
      if (state.mode === "loop" && state.loop.length > 2) {
        picked = pick({ loop: state.loop }, folder.strokes ?? [], texts, images);
      } else if (state.mode === "box") {
        const box = boxBetween(state.start, toWorldCoords(event.clientX, event.clientY));
        // A click, not a drag: it lets go of what was selected and takes nothing new.
        if ((box.w + box.h) * zoomRef.current > 6) picked = pick({ box }, folder.strokes ?? [], texts, images);
      }
      setSelection(picked && !isEmptySelection(picked) ? picked : null);
      return;
    }
    const done = carryRef.current;
    carryRef.current = STILL;
    setCarry(STILL);
    if (done.dx === 0 && done.dy === 0 && done.scale === 1) return;
    // A picture never moved has no place of its own yet, only the one it is drawn at. It is given
    // that place first, so the step finds it there — a step never touches a picture that is gone.
    const placedIds = new Set((folder.images ?? []).map((i) => i.attachment_id));
    const unplaced = pictures
      .filter(({ att }) => selection?.images.includes(att.id) && !placedIds.has(att.id))
      .map(({ att, x, y }) => ({ attachment_id: att.id, x, y }));
    if (unplaced.length > 0) onChangeCanvas(folder.id, (canvas) => ({ ...canvas, images: [...(canvas.images ?? []), ...unplaced] }));
    doStep(carried(done, state.texts));
  }

  /** What carrying the selection by `how` changes, item by item, as one step. `texts` as measured at the press. */
  function carried(how: Carry, texts: Placed[]): Step {
    if (!selection) return [];
    const step: Change[] = [];
    const strokeIds = new Set(selection.strokes);
    (folder.strokes ?? []).forEach((s, i) => {
      if (strokeIds.has(s.id)) step.push(strokeChanged(s, carryStroke(s, how), i));
    });
    const textIds = new Set(selection.texts);
    (folder.text_elements ?? []).forEach((t, i) => {
      if (!textIds.has(t.id)) return;
      const w = texts.find((p) => p.id === t.id)?.box.w ?? t.width ?? TEXT_W;
      step.push(textChanged(t, carryText(t, how, w), i));
    });
    const imageIds = new Set(selection.images);
    const placedImages = folder.images ?? [];
    for (const { att, x, y } of pictures) {
      if (!imageIds.has(att.id)) continue;
      const width = imageWidths[att.id] ?? IMG_DEFAULT_W;
      const was = placedImages.findIndex((i) => i.attachment_id === att.id);
      step.push(
        pictureChanged(
          { attachment_id: att.id, x, y, width },
          { attachment_id: att.id, ...carryPicture({ x, y, width }, how, IMG_MIN_W) },
          was === -1 ? placedImages.length : was,
        ),
      );
    }
    return step;
  }

  /** The selected strokes take the colour picked. */
  function recolourSelection(next: string) {
    if (!selection) return;
    const ids = new Set(selection.strokes);
    const step: Step = [];
    (folder.strokes ?? []).forEach((s, i) => {
      if (ids.has(s.id) && s.color !== next) step.push(strokeChanged(s, { ...s, color: next }, i));
    });
    doStep(step);
  }

  /** A copy of the selection beside it, which becomes the selection. Pictures are files, and stay single. */
  function duplicateSelection() {
    if (!selection) return;
    const step: Step = [];
    const strokeIds = new Set(selection.strokes);
    const textIds = new Set(selection.texts);
    const copies: Selection = { strokes: [], texts: [], images: [] };
    let strokeAt = (folder.strokes ?? []).length;
    for (const s of folder.strokes ?? []) {
      if (!strokeIds.has(s.id)) continue;
      const copy = carryStroke({ ...s, id: crypto.randomUUID() }, { ...STILL, dx: COPY_STEP, dy: COPY_STEP });
      step.push(strokeAdded(copy, strokeAt++));
      copies.strokes.push(copy.id);
    }
    let textAt = (folder.text_elements ?? []).length;
    for (const t of folder.text_elements ?? []) {
      if (!textIds.has(t.id)) continue;
      const copy = { ...t, id: crypto.randomUUID(), x: t.x + COPY_STEP, y: t.y + COPY_STEP };
      step.push(textAdded(copy, textAt++));
      copies.texts.push(copy.id);
    }
    if (step.length === 0) return;
    doStep(step);
    setSelection(copies);
  }

  /**
   * The selection off the canvas. Strokes and labels go as one step Undo sets back; a
   * picture's file is destroyed with it, so pictures are asked about first, as Remove is.
   */
  function deleteSelection() {
    if (!selection) return;
    const strokeIds = new Set(selection.strokes);
    const textIds = new Set(selection.texts);
    const strokes = (folder.strokes ?? []).flatMap((stroke, index) => (strokeIds.has(stroke.id) ? [{ stroke, index }] : []));
    const texts = (folder.text_elements ?? []).flatMap((t, i) => (textIds.has(t.id) ? [textRemoved(t, i)] : []));
    doStep([...removals(strokes), ...texts.reverse()]);
    const going = pictures.filter(({ att }) => selection.images.includes(att.id)).map(({ att }) => att);
    if (going.length > 0) setRemoving(going);
    setSelection(null);
  }

  // Ctrl+Z, while there is something to take back. Caught before the board's own
  // (useKeyboardUndo), which is the same key one layer down: the stroke you just
  // drew is the thing the key means here. With nothing left it falls through, so
  // it still undoes a merge. A field being typed in keeps its own, and so does a
  // note open over the idea. Redo, Duplicate and Delete answer only while they have
  // something to do, and the board has none of them, so nothing else is shadowed.
  const keysRef = useRef({ undo: undoStroke, redo: redoStroke, duplicate: duplicateSelection, remove: deleteSelection, selected: false });
  keysRef.current = {
    undo: undoStroke,
    redo: redoStroke,
    duplicate: duplicateSelection,
    remove: deleteSelection,
    selected: !isEmptySelection(selection),
  };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || document.querySelector(".sheet, .dialog-scrim")) return;
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      const letter = e.key.toLowerCase();
      const keys = keysRef.current;
      let done = false;
      if (mod && !e.shiftKey && letter === UNDO_KEY) {
        done = keys.undo();
      } else if (mod && ((e.shiftKey && letter === UNDO_KEY) || (!e.shiftKey && letter === REDO_KEY))) {
        done = keys.redo();
      } else if (mod && !e.shiftKey && letter === DUPLICATE_KEY && keys.selected) {
        keys.duplicate();
        done = true;
      } else if (!mod && !e.shiftKey && (e.key === "Delete" || e.key === "Backspace") && keys.selected) {
        keys.remove();
        done = true;
      }
      if (!done) return;
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /* --- fit and save ------------------------------------------------------- */

  /**
   * What the drawing covers, in world units: strokes from their points, and labels,
   * pictures and notes from the page, which alone knows how tall each is.
   */
  function contentBox(): Box | null {
    const world = canvasRef.current?.querySelector(".canvas-world");
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const s of folder.strokes ?? []) {
      for (const [x, y] of s.points) {
        left = Math.min(left, x - s.width / 2);
        top = Math.min(top, y - s.width / 2);
        right = Math.max(right, x + s.width / 2);
        bottom = Math.max(bottom, y + s.width / 2);
      }
    }
    if (world) {
      const origin = world.getBoundingClientRect();
      const z = zoomRef.current;
      for (const el of world.querySelectorAll(".spatial-note, .canvas-text, .canvas-picture")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        left = Math.min(left, (r.left - origin.left) / z - WORLD_ORIGIN);
        top = Math.min(top, (r.top - origin.top) / z - WORLD_ORIGIN);
        right = Math.max(right, (r.right - origin.left) / z - WORLD_ORIGIN);
        bottom = Math.max(bottom, (r.bottom - origin.top) / z - WORLD_ORIGIN);
      }
    }
    return left === Infinity ? null : { x: left, y: top, w: right - left, h: bottom - top };
  }

  const hasContent =
    (folder.strokes ?? []).length > 0 ||
    (folder.text_elements ?? []).length > 0 ||
    pictures.length > 0 ||
    children.length > 0;

  /** Everything on the canvas in view at once: further out for a big drawing, never past 100% for a small one. */
  function fitAll() {
    const canvas = canvasRef.current;
    const box = contentBox();
    if (!canvas || !box) return;
    const fit = fitWhole(
      { ...box, x: box.x + WORLD_ORIGIN, y: box.y + WORLD_ORIGIN },
      { w: canvas.clientWidth, h: canvas.clientHeight },
      FIT_EDGE * 2,
    );
    if (fit.zoom === zoomRef.current) {
      canvas.scrollLeft = fit.left;
      canvas.scrollTop = fit.top;
      return;
    }
    pendingAnchor.current = fit;
    setZoom(fit.zoom);
  }

  /** The drawing as a PNG: shared on a phone, downloaded on a desktop. */
  async function savePictureOfCanvas() {
    const box = contentBox();
    const world = canvasRef.current?.querySelector(".canvas-world");
    if (!box || !world || !sheetRef.current) return;
    let exporter: typeof import("../lib/canvasExport");
    try {
      exporter = await import("../lib/canvasExport");
    } catch {
      setNotice("The picture maker did not load. Check the connection and try again.");
      return;
    }
    const { renderCanvasPicture, savePicture, pictureName } = exporter;
    const look = getComputedStyle(sheetRef.current);
    const probe = document.createElement("span");
    sheetRef.current.appendChild(probe);
    const colour = (token: string) => {
      probe.style.color = token;
      return getComputedStyle(probe).color;
    };
    const sample = world.querySelector(".canvas-text-label, .canvas-text");
    const type = getComputedStyle(sample ?? sheetRef.current);
    const pad = 24;
    const scene = {
      box: { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 },
      strokes: folder.strokes ?? [],
      labels: placed().texts.flatMap(({ id, box: b }) => {
        const t = (folder.text_elements ?? []).find((candidate) => candidate.id === id);
        return t ? [{ x: b.x, y: b.y, width: b.w, text: t.text }] : [];
      }),
      pictures: pictures.flatMap(({ att, x, y }) => {
        const el = world.querySelector<HTMLElement>(`.canvas-picture[data-id="${CSS.escape(att.id)}"]`);
        const img = el?.querySelector("img");
        if (!el || !img || !img.complete || img.naturalWidth === 0) return [];
        return [{ img, x, y, w: el.offsetWidth, h: el.offsetHeight }];
      }),
      notes: children.flatMap(({ note, item }) => {
        const el = world.querySelector<HTMLElement>(`.spatial-note[data-id="${CSS.escape(note.id)}"]`);
        const w = el?.offsetWidth || item.width || NOTE_DEFAULT_W;
        return [{ x: item.x, y: item.y, w, h: el?.offsetHeight || 160, text: note.body }];
      }),
    };
    const blob = await renderCanvasPicture(scene, {
      paper: colour("var(--paper)"),
      ink: colour("var(--ink)"),
      rule: colour("var(--rule)"),
      colour,
      font: type.font || `16px "Libre Baskerville"`,
      lineHeight: parseFloat(type.lineHeight) || 24,
      highlightOpacity: parseFloat(look.getPropertyValue("--highlight-opacity")) || 0.35,
    });
    probe.remove();
    if (!blob) {
      setNotice("This browser could not make a picture of the drawing.");
      return;
    }
    await savePicture(blob, pictureName(idea ? noteName(idea.body) : null), !keyboard);
  }

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), MERGED_LINE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  /**
   * A second finger landing on the canvas always wins: whatever the first
   * pointer was doing — panning, dragging a note, drawing a stroke — stops
   * here rather than fighting the pinch for the same pointer math. Cancelling
   * `drag`/`pan`/`drawing` and the live stroke is exactly what a released
   * pointer capture on those gestures would otherwise leave half-finished.
   */
  function beginPinch() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const points = Array.from(activePointers.current.values()).slice(0, 2);
    if (points.length < 2) return;
    drag.current = null;
    pan.current = null;
    drawing.current = false;
    stopSnapWait();
    snap.current.rough = null;
    shaping.current = null;
    selecting.current = null;
    setRegion(null);
    carryRef.current = STILL;
    setCarry(STILL);
    liveRef.current = null;
    setLiveStroke(null);
    endErase();
    const [a, b] = points;
    const rect = canvas.getBoundingClientRect();
    const [contentX, contentY] = worldFromClient({
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
      rectLeft: rect.left,
      rectTop: rect.top,
      clientX: (a.x + b.x) / 2,
      clientY: (a.y + b.y) / 2,
      zoom,
      origin: 0,
    });
    pinch.current = {
      startDist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      startZoom: zoom,
      contentX,
      contentY,
    };
  }

  /** Re-scales from the pinch's own starting distance and re-anchors the
      scroll so the content under the fingers' midpoint never drifts. */
  function continuePinch() {
    const canvas = canvasRef.current;
    const state = pinch.current;
    if (!canvas || !state) return;
    const points = Array.from(activePointers.current.values()).slice(0, 2);
    if (points.length < 2) return;
    const [a, b] = points;
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nextZoom = clampZoom(state.startZoom * (dist / state.startDist));
    const rect = canvas.getBoundingClientRect();
    pendingAnchor.current = {
      ...anchorScroll({
        contentX: state.contentX,
        contentY: state.contentY,
        zoom: nextZoom,
        pointX: (a.x + b.x) / 2 - rect.left,
        pointY: (a.y + b.y) / 2 - rect.top,
      }),
      zoom: nextZoom,
    };
    setZoom(nextZoom);
  }

  /**
   * Back to 100%, around the middle of the view.
   *
   * The readout used to set the zoom and nothing else, and the scroll offset
   * that had been right for 250% was left standing at 100% — two and a half
   * times too far along, over empty world with the notes somewhere off the
   * edge. It goes through the pinch's own two formulas, anchored on the centre
   * of the canvas, so what was in the middle of the screen stays there.
   */
  function resetZoom() {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const [contentX, contentY] = worldFromClient({
        scrollLeft: canvas.scrollLeft,
        scrollTop: canvas.scrollTop,
        rectLeft: rect.left,
        rectTop: rect.top,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        zoom: zoomRef.current,
        origin: 0,
      });
      pendingAnchor.current = {
        ...anchorScroll({ contentX, contentY, zoom: 1, pointX: rect.width / 2, pointY: rect.height / 2 }),
        zoom: 1,
      };
    }
    setZoom(1);
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    setMergedLine(false);
    // The capture-phase middle-pan handler stops that press before it gets
    // here. Every other non-primary mouse button is a menu or no action at
    // all, never the active drawing tool.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.current.size >= 2) {
      beginPinch();
      return;
    }
    if (drawsLine) {
      startDraw(event);
    } else if (tool === "shape") {
      startShape(event);
    } else if (tool === "select") {
      startSelect(event);
    } else if (tool === "erase") {
      startErase(event);
    } else if (tool === "text") {
      startText(event);
    } else {
      startPan(event);
    }
  }

  /**
   * The Text tool: a press on the canvas sets a label down there and opens it
   * for typing. A press while a label is being typed in only finishes that one
   * — the second click is how a person says "done", not "another".
   */
  function startText(event: React.PointerEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest(".spatial-note, .canvas-text, .spatial-resize-handle")) return;
    event.preventDefault();
    const typing = document.activeElement;
    if (typing instanceof HTMLElement && typing.classList.contains("canvas-text-input")) {
      typing.blur();
      return;
    }
    if (draftText) return;
    const [x, y] = toWorldCoords(event.clientX, event.clientY);
    // The press marks where the words start: the first line's middle, not the box's corner.
    setDraftText({ id: crypto.randomUUID(), x: x - 9, y: y - 16, text: "", width: TEXT_W });
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pan.current?.middle && pan.current.pointerId === event.pointerId) {
      movePan(event);
      return;
    }
    if (activePointers.current.has(event.pointerId)) {
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch.current && activePointers.current.size >= 2) {
      continuePinch();
      return;
    }
    if (drawsLine) {
      moveDraw(event);
    } else if (tool === "shape") {
      moveShape(event);
    } else if (tool === "select") {
      moveSelect(event);
    } else if (tool === "erase") {
      rub(event);
    } else {
      movePan(event);
    }
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (pan.current?.middle && pan.current.pointerId === event.pointerId) {
      endPan(event);
      return;
    }
    activePointers.current.delete(event.pointerId);
    // Fewer than two pointers left and the pinch is over — the next move
    // (if any) belongs to whatever tool is in hand.
    if (activePointers.current.size < 2) pinch.current = null;
    if (drawsLine) {
      endDraw(event);
    } else if (tool === "shape") {
      endShape(event);
    } else if (tool === "select") {
      endSelect(event);
    } else if (tool === "erase") {
      endErase(event);
    } else {
      endPan(event);
    }
  }

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.target instanceof Element && event.target.closest(".spatial-note, .canvas-text, .canvas-picture")) return;
    const [worldX, worldY] = toWorldCoords(event.clientX, event.clientY);
    setNoteMenu(null);
    setTextMenu(null);
    setPictureMenu(null);
    setContextMenu({ x: event.clientX, y: event.clientY, worldX, worldY });
  }

  /** Right-click on a note: what can be done to this one, here. Stable via
      `useCallback` — it is handed to a memoized `NoteCapsule`, which a fresh
      closure every render would leave with nothing memoized to skip. */
  const handleNoteContextMenu = useCallback((event: React.MouseEvent, note: Note) => {
    event.preventDefault();
    event.stopPropagation();
    // A drag that was still in the air when the menu opened would otherwise
    // finish on the release *behind* it and drop the note somewhere else.
    drag.current = null;
    setContextMenu(null);
    setNoteMenu({ x: event.clientX, y: event.clientY, note });
  }, []);

  /** The menu's Add text: the same unsaved editor the Text tool sets down. */
  function handleAddText() {
    if (!contextMenu) return;
    setDraftText({ id: crypto.randomUUID(), x: contextMenu.worldX, y: contextMenu.worldY, text: "", width: TEXT_W });
    setContextMenu(null);
  }

  // A label's words are its own (`CanvasTextLabel`); taking one off goes
  // through here so Undo can set it back. Stable, for the labels' memo.
  const textsRef = useRef(folder.text_elements);
  textsRef.current = folder.text_elements;
  const removeLabel = useCallback(
    (canvasId: string, textId: string) => {
      const index = (textsRef.current ?? []).findIndex((t) => t.id === textId);
      const text = (textsRef.current ?? [])[index];
      onRemoveText(canvasId, textId);
      if (!text) return;
      stepsRef.current = [...stepsRef.current, [textRemoved(text, index)]].slice(-UNDO_DEPTH);
      setStepCount(stepsRef.current.length);
      redoRef.current = [];
      setRedoCount(0);
    },
    [onRemoveText],
  );
  const finishDraft = useCallback(() => setDraftText(null), []);
  const doneEditRequest = useCallback(() => setEditTextId(null), []);

  const handleTextMenu = useCallback((event: React.MouseEvent, text: CanvasText) => {
    setContextMenu(null);
    setNoteMenu(null);
    setPictureMenu(null);
    setTextMenu({ x: event.clientX, y: event.clientY, text });
  }, []);

  const handlePictureMenu = useCallback((event: React.MouseEvent, att: Attachment) => {
    setContextMenu(null);
    setNoteMenu(null);
    setTextMenu(null);
    setPictureMenu({ x: event.clientX, y: event.clientY, att });
  }, []);

  /* --- pictures ----------------------------------------------------------- */

  /** The middle of what is on screen, in world coordinates. */
  function viewMiddle(): [number, number] {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    return toWorldCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /**
   * Sets pictures down with `point` as the middle of the first one. Each one
   * set down this sitting steps a little down and right of the last, so a
   * second paste is seen arriving rather than hidden under the first.
   */
  function addPictures(files: File[], point: [number, number]) {
    if (!onAddImages) return;
    const step = (placedCount.current % 8) * 24;
    placedCount.current += files.length;
    onAddImages(folder.id, files, [point[0] - IMG_DEFAULT_W / 2 + step, point[1] - 80 + step]);
  }

  // A pasted picture belongs to the canvas, not to a new note on the board
  // behind it: caught on the way down, before the app's own paste
  // (`useFilePaste`) can see it. Words pasted into a label are the label's.
  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  pasteRef.current = (e: ClipboardEvent) => {
    if (!onAddImages || e.defaultPrevented) return;
    // A note opened over the idea, or a question asked over it, takes its own.
    if (document.querySelector(".sheet, .dialog-scrim")) return;
    const files = picturesOnly(e.clipboardData?.files);
    if (files.length === 0) return;
    if (isTypingTarget(e.target) && Array.from(e.clipboardData?.types ?? []).includes("text/plain")) {
      // The words go into the label; the picture riding with them (a caption
      // copied with its image) must not become a note on the board behind.
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    addPictures(files, viewMiddle());
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => pasteRef.current(e);
    window.addEventListener("paste", paste, true);
    return () => window.removeEventListener("paste", paste, true);
  }, []);

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!onAddImages || !Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  /** A picture dropped lands where it was let go. Anything else is the app's, as before. */
  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!onAddImages) return;
    const files = picturesOnly(event.dataTransfer?.files);
    if (files.length === 0) return;
    event.preventDefault();
    addPictures(files, toWorldCoords(event.clientX, event.clientY));
  }

  function pickPictures(at: [number, number] | null) {
    pickAt.current = at;
    pickerRef.current?.click();
  }

  function handlePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const files = picturesOnly(event.target.files);
    // Emptied, so picking the same file twice still says something changed.
    event.target.value = "";
    if (files.length > 0) addPictures(files, pickAt.current ?? viewMiddle());
    pickAt.current = null;
  }

  function handleSetTool(next: Tool) {
    setTool(next);
    if (next !== "select") {
      setSelection(null);
      setRegion(null);
    }
    setContextMenu(null);
    setOptionMenu(null);
    setTextMenu(null);
    setPictureMenu(null);
  }

  // The next three are `useCallback`-stable for the same reason
  // `handleNoteContextMenu` is: they are handed straight to every
  // `NoteCapsule` on the board, and a memoized component re-rendered by a
  // fresh handler prop every time is not memoized at all.
  const startNoteDrag = useCallback((event: React.PointerEvent<HTMLElement>, item: CanvasItem) => {
    if (tool !== "move") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".spatial-resize-handle")) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = {
      noteId: item.note_id,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.x,
      originY: item.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [tool]);

  const moveNoteDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    // The pointer travels in screen pixels; the note's position is a world
    // one, so the same finger travel has to move the note less the further
    // in the canvas is zoomed. Read off the ref, not the `zoom` state, so
    // this callback's identity survives a pinch instead of being torn down
    // and rebuilt on every frame of it.
    const dx = (event.clientX - current.startX) / zoomRef.current;
    const dy = (event.clientY - current.startY) / zoomRef.current;
    current.moved ||= Math.abs(dx) > 4 || Math.abs(dy) > 4;
    updateItem(current.noteId, current.originX + dx, current.originY + dy);
  }, [updateItem]);

  const endNoteDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const current = drag.current;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!current) return;
    const item = movedItems.current.find((candidate) => candidate.note_id === current.noteId);
    const note = noteById.get(current.noteId);
    if (!item || !note) return;
    if (current.moved) {
      onDragNoteTo(folder.id, current.noteId, item.x, item.y);
      return;
    }
    onOpenNote(note, event.currentTarget.getBoundingClientRect());
  }, [noteById, folder.id, onDragNoteTo, onOpenNote]);

  /**
   * The browser took the gesture away, which is the one ending that may
   * neither open nor commit — the board's `.card` learned the same thing
   * (`onPointerCancel` in `NoteCard.tsx`). This was `endNoteDrag`, so a press
   * the browser cancelled before anything moved opened the note, and one it
   * cancelled mid-drag wrote a position the user never let go at. The note goes
   * back where it started, since a place on screen that is not in the canvas
   * would be a lie until the next rearrangement made it true.
   *
   * No `releasePointerCapture`: the capture is released as part of firing
   * `pointercancel`, and asking for it back then throws.
   */
  const cancelNoteDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (current?.moved) updateItem(current.noteId, current.originX, current.originY);
  }, [updateItem]);

  /** The layer itself, so Tab can be kept inside it. */
  const sheetRef = useRef<HTMLElement | null>(null);
  const allStrokes = useMemo(() => {
    const saved = folder.strokes ?? [];
    return liveStroke ? [...saved, liveStroke] : saved;
  }, [folder.strokes, liveStroke]);

  const phone = useIsPhone();

  /**
   * The drawing controls, built once and set down in one of two places: in the
   * bar at the top on a desktop, where there is room for all of them in a row,
   * and at the foot on a phone, where the thumb is — the tools on one row, what
   * they do (Undo, Redo, a picture, Fit) on the next, the tool's own choices
   * under that. One set of buttons, never both bars at once (the same reason the
   * shelf branches in JavaScript and not in CSS: two copies are two of
   * everything to a reader).
   */
  const toolButton = (name: Tool, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className="canvas-tool-btn"
      data-on={tool === name}
      aria-pressed={tool === name}
      aria-label={label}
      title={label}
      onClick={() => handleSetTool(name)}
    >
      {icon}
    </button>
  );
  const toolButtons = (
    <>
      {toolButton("move", "Move", <IconHand />)}
      {toolButton("select", "Select", <IconLasso />)}
      {toolButton("draw", "Draw", <IconPencil />)}
      {toolButton("highlight", "Highlighter", <IconHighlighter />)}
      {toolButton("shape", "Shapes", <IconShapes />)}
      {toolButton("text", "Text", <IconText />)}
      {toolButton("erase", "Eraser", <IconEraser />)}
    </>
  );
  const actionButtons = (
    <>
      {/* Disabled, not hidden, so nothing beside them moves when the first stroke
          is drawn or the last is taken back. */}
      <button
        type="button"
        className="canvas-tool-btn"
        aria-label="Undo"
        title={keyboard ? `Undo, ${hotkeyTitle(UNDO_KEY)}` : "Undo"}
        disabled={stepCount === 0}
        onClick={() => undoStroke()}
      >
        <IconUndo />
      </button>
      <button
        type="button"
        className="canvas-tool-btn"
        aria-label="Redo"
        title={keyboard ? `Redo, ${hotkeyTitle(REDO_KEY)}` : "Redo"}
        disabled={redoCount === 0}
        onClick={() => redoStroke()}
      >
        <IconRedo />
      </button>
      {/* Actions, not tools: they leave the tool in hand as it was. */}
      {onAddImages && (
        <button
          type="button"
          className="canvas-tool-btn"
          aria-label="Add picture"
          title="Add picture"
          onClick={() => pickPictures(null)}
        >
          <IconPicture />
        </button>
      )}
      <button
        type="button"
        className="canvas-tool-btn"
        aria-label="Show everything"
        title="Show everything"
        disabled={!hasContent}
        onClick={fitAll}
      >
        <IconFit />
      </button>
    </>
  );
  const currentColour = CANVAS_COLOURS.find((candidate) => candidate.value === color) ?? CANVAS_COLOURS[0];
  const selected = selection && !isEmptySelection(selection) ? selection : null;
  /** The colour the picker marks: the pen's, or with strokes selected, theirs when they share one. */
  const selectedColours = selected
    ? new Set((folder.strokes ?? []).filter((s) => selected.strokes.includes(s.id)).map((s) => s.color))
    : null;
  const shownColour =
    selectedColours && selectedColours.size === 1
      ? (CANVAS_COLOURS.find((c) => selectedColours.has(c.value)) ?? currentColour)
      : currentColour;
  const recolours = tool === "select" && selected !== null && selected.strokes.length > 0;

  function openOptionMenu(event: React.MouseEvent<HTMLButtonElement>, kind: "color" | "width" | "shape") {
    const rect = event.currentTarget.getBoundingClientRect();
    // On a phone it stands above the whole dock, never over the tools' own row.
    const dockTop = event.currentTarget.closest(".canvas-dock")?.getBoundingClientRect().top ?? rect.top;
    setContextMenu(null);
    setNoteMenu(null);
    setOptionMenu({
      kind,
      x: phone ? 8 : Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
      y: phone ? window.innerHeight - dockTop + 4 : rect.bottom + 4,
      above: phone,
    });
  }

  const colourWord = recolours ? "Colour of the selection" : "Pen colour";
  const colorTool = (
    <button
      type="button"
      className="canvas-color-btn"
      data-on={optionMenu?.kind === "color"}
      aria-label={`${colourWord}: ${shownColour.label}`}
      aria-haspopup="menu"
      aria-expanded={optionMenu?.kind === "color"}
      title={`${colourWord}: ${shownColour.label}`}
      style={{ "--pen": shownColour.value } as CSSProperties}
      onClick={(event) => openOptionMenu(event, "color")}
    />
  );

  const shownWidth = tool === "highlight" ? highlightWidth : width;
  const widthTool = (
    <button
      type="button"
      className="canvas-width-btn"
      data-on={optionMenu?.kind === "width"}
      aria-label={`Line thickness: ${shownWidth}`}
      aria-haspopup="menu"
      aria-expanded={optionMenu?.kind === "width"}
      title={`Line thickness: ${shownWidth}`}
      onClick={(event) => openOptionMenu(event, "width")}
    >
      {/* The control is the stroke: a rule at the weight it draws, not a circle
          standing in for one. Nothing is rounded. A highlighter's is drawn at a
          third of its weight, or the bar would have to grow round it. */}
      <span className="canvas-width-rule" style={{ height: tool === "highlight" ? shownWidth / 3 : shownWidth }} />
    </button>
  );

  const currentShape = SHAPES.find((s) => s.kind === shapeKind) ?? SHAPES[0];
  const shapeTool = (
    <button
      type="button"
      className="canvas-tool-btn"
      data-on={optionMenu?.kind === "shape"}
      aria-label={`Shape: ${currentShape.label}`}
      aria-haspopup="menu"
      aria-expanded={optionMenu?.kind === "shape"}
      title={`Shape: ${currentShape.label}`}
      onClick={(event) => openOptionMenu(event, "shape")}
    >
      <IconShape kind={shapeKind} />
    </button>
  );

  // Fill is offered only for a shape that closes: a line has no inside.
  const fillTool = isClosedShape(shapeKind) ? (
    <button
      type="button"
      className="canvas-tool-btn"
      data-on={shapeFill}
      aria-pressed={shapeFill}
      aria-label="Fill"
      title="Fill"
      onClick={() => setShapeFill((on) => !on)}
    >
      <IconShape kind={shapeKind} filled />
    </button>
  ) : null;

  /** What the selection can be told to do, while there is one. */
  const selectionTools = selected ? (
    <>
      <button
        type="button"
        className="canvas-tool-btn"
        aria-label="Duplicate"
        title={keyboard ? `Duplicate, ${hotkeyTitle(DUPLICATE_KEY)}` : "Duplicate"}
        disabled={selected.strokes.length + selected.texts.length === 0}
        onClick={duplicateSelection}
      >
        <IconDuplicate />
      </button>
      <button
        type="button"
        className="canvas-tool-btn"
        aria-label="Delete selection"
        title={keyboard ? "Delete selection, Delete" : "Delete selection"}
        onClick={deleteSelection}
      >
        <IconDelete tier="inline" />
      </button>
    </>
  ) : null;

  /** The tool's own choices, beside it on a desktop and on their own row on a phone. */
  const separated = (parts: (React.ReactNode | null)[]) =>
    parts
      .filter((part) => part !== null && part !== false)
      .map((part, i) => (
        <span className="canvas-tool-group" key={i}>
          {i > 0 && <span className="canvas-tool-sep" aria-hidden />}
          {part}
        </span>
      ));
  const optionTools =
    tool === "draw"
      ? separated([colorTool, widthTool])
      : tool === "highlight"
        ? separated([colorTool, widthTool])
        : tool === "shape"
          ? separated([shapeTool, fillTool, colorTool, widthTool])
          : selected
            ? separated([recolours ? colorTool : null, selectionTools])
            : [];

  // Clear goes with the pen and the eraser, not the hand; Undo now takes it back.
  const clearTool =
    (tool === "draw" || tool === "erase") && folder.strokes.length > 0 ? (
      <button
        type="button"
        className="canvas-tool-btn"
        aria-label="Clear drawings"
        title="Clear drawings"
        onClick={clearStrokes}
      >
        <IconDelete tier="inline" />
      </button>
    ) : null;

  // A pinch you cannot undo strands you. Shown only away from 100%, so it never
  // sits there as an idle control on a canvas nobody has touched.
  const zoomTool =
    zoom !== 1 ? (
      <button
        type="button"
        className="canvas-zoom-btn mono"
        aria-label={`Zoomed to ${Math.round(zoom * 100)} percent. Reset to 100%`}
        title="Reset zoom to 100%"
        onClick={resetZoom}
      >
        {Math.round(zoom * 100)}%
      </button>
    ) : null;

  /** Strokes as drawn this instant: a selection being carried is drawn where it is going. */
  const carriedIds = carry !== STILL && selected ? new Set(selected.strokes) : null;
  const shownStrokes = carriedIds ? allStrokes.map((s) => (carriedIds.has(s.id) ? carryStroke(s, carry) : s)) : allStrokes;
  const strokeMark = (stroke: DrawingStroke) => (
    <path
      key={stroke.id}
      className={stroke.highlight ? "canvas-highlight" : undefined}
      d={strokePath(stroke, WORLD_ORIGIN)}
      fill={stroke.fill ? stroke.color : "none"}
      stroke={stroke.color}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  const shownBox = selectedBox(true);

  return (
    <section
      className="canvas-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Idea canvas"
      ref={sheetRef}
      // It says `aria-modal`, and the board behind it is `inert` — but the
      // header is not, and the mascot puts `tabindex="0"` on itself, so Tab
      // off the last tool walked out of the canvas onto a creature a screen
      // reader has been told is not there. A field being typed into keeps its
      // own Tab: a canvas label is text, and Tab in text is text's.
      onKeyDown={(e) => {
        // Escape closes the layer on top: a right-click menu before the canvas
        // (review UX-A-05). The app's own Escape listener closes the canvas
        // and stands down for a key already taken here.
        if (e.key === "Escape" && (contextMenu || noteMenu || optionMenu || textMenu || pictureMenu) && !isTypingTarget(e.target)) {
          e.preventDefault();
          setContextMenu(null);
          setNoteMenu(null);
          setOptionMenu(null);
          setTextMenu(null);
          setPictureMenu(null);
          return;
        }
        // ...and a selection before the canvas: Escape lets go of it.
        if (e.key === "Escape" && selection && !isTypingTarget(e.target)) {
          e.preventDefault();
          setSelection(null);
          return;
        }
        if (e.key !== "Tab" || isTypingTarget(e.target)) return;
        cycleTab(e, sheetRef.current);
      }}
    >
      <header className="canvas-bar">
        {/* Hangs under the bar, over the top of the canvas, so its arriving
            and going moves nothing (`.canvas-merged`). */}
        {mergedLine && (
          <p className="canvas-merged advice" role="status">
            {/* What happened and where the notes went, in plain words (review
                UX-05); the sources are archived, so the board's count drops. */}
            {`Joined ${children.length} notes. They are now one idea${where ? ` in ${where}` : ""}.`}
            {canUnmerge && (
              <>
                {/* One line on a desktop; on a phone the way back takes a
                    line of its own rather than breaking mid-word. */}
                <span className="canvas-merged-sep"> </span>
                <span className="canvas-merged-how">
                  {keyboard ? "Right-click an empty spot to separate them." : "Hold an empty spot to separate them."}
                </span>
              </>
            )}
          </p>
        )}
        <button type="button" className="iconbtn" aria-label="Close idea" title="Back" onClick={onClose}>
          <IconBack />
        </button>
        {/* A folder is a place, and the app names places one way: the display
            face in tracked capitals with the count beside it in the machine
            face. This is a board tab that happens to be full screen — and now
            it is a board tab you can name, because five canvases all called
            "Idea" is five canvases you have to open to tell apart. */}
        <CanvasName idea={idea} count={children.length} onRename={onRename} />

        {!phone && (
          <div className="canvas-tools" ref={tools}>
            {toolButtons}
            <span className="canvas-tool-sep" aria-hidden />
            {actionButtons}
            {optionTools.length > 0 && (
              <>
                <span className="canvas-tool-sep" aria-hidden />
                {optionTools}
              </>
            )}
            {clearTool && (
              <>
                <span className="canvas-tool-sep" aria-hidden />
                {clearTool}
              </>
            )}
            {zoomTool && (
              <>
                <span className="canvas-tool-sep" aria-hidden />
                {zoomTool}
              </>
            )}
          </div>
        )}
        {/* The drawing leaves as a picture: shared on a phone, saved on a desktop. */}
        <button
          type="button"
          className="iconbtn canvas-save"
          aria-label="Save as picture"
          title="Save as picture"
          disabled={!hasContent}
          onClick={() => void savePictureOfCanvas()}
        >
          <IconDownload tier="nav" />
        </button>
      </header>
      <div
        ref={canvasRef}
        className="canvas-surface"
        data-tool={tool}
        onPointerDownCapture={startMiddlePan}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onContextMenu={handleContextMenu}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* The scaling wrapper: a transform repaints the world at `zoom`
            without ever changing its own layout size, so something has to
            give the scroller a real extent to scroll across. This div is
            that something — sized to `WORLD_SIZE * zoom` in actual layout
            pixels — while `.canvas-world` inside it stays at `WORLD_SIZE`
            and is scaled visually to match. */}
        <div
          className="canvas-zoom"
          style={{ width: WORLD_SIZE * zoom, height: WORLD_SIZE * zoom }}
        >
          <div
            className="canvas-world"
            style={{ width: WORLD_SIZE, height: WORLD_SIZE, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {/* Under the strokes, so what is drawn over a picture is seen on it. */}
            {pictures.map(({ att, x, y }) => {
              const width = imageWidths[att.id] ?? IMG_DEFAULT_W;
              const at =
                carry !== STILL && selected?.images.includes(att.id)
                  ? carryPicture({ x, y, width }, carry, IMG_MIN_W)
                  : { x, y, width };
              return (
              <CanvasPicture
                key={att.id}
                att={att}
                x={at.x}
                y={at.y}
                width={at.width}
                canvasId={folder.id}
                origin={WORLD_ORIGIN}
                zoomRef={zoomRef}
                movable={tool === "move"}
                onMove={moveImage}
                onResize={onResizeImage}
                onMenu={handlePictureMenu}
              />
              );
            })}
            <svg
              className="canvas-svg"
              width={WORLD_SIZE}
              height={WORLD_SIZE}
              aria-hidden
            >
              {/* Highlights first, so a highlighter marks under the ink rather than over it. */}
              {shownStrokes.filter((s) => s.highlight).map(strokeMark)}
              {shownStrokes.filter((s) => !s.highlight).map(strokeMark)}
              {region &&
                ("loop" in region ? (
                  <polyline
                    className="canvas-region"
                    points={region.loop.map(([x, y]) => `${WORLD_ORIGIN + x},${WORLD_ORIGIN + y}`).join(" ")}
                  />
                ) : (
                  <rect
                    className="canvas-region"
                    x={WORLD_ORIGIN + region.box.x}
                    y={WORLD_ORIGIN + region.box.y}
                    width={region.box.w}
                    height={region.box.h}
                  />
                ))}
            </svg>
            {(folder.text_elements ?? []).map((t) => (
              <CanvasTextLabel
                key={t.id}
                text={
                  carry !== STILL && selected?.texts.includes(t.id)
                    ? carryText(t, carry, selecting.current?.texts.find((p) => p.id === t.id)?.box.w ?? t.width ?? TEXT_W)
                    : t
                }
                canvasId={folder.id}
                origin={WORLD_ORIGIN}
                tool={tool}
                zoomRef={zoomRef}
                onEditText={onEditText}
                onRemoveText={removeLabel}
                onMenu={handleTextMenu}
                editNow={editTextId === t.id}
                onEditStarted={doneEditRequest}
              />
            ))}
            {draftText && (
              <CanvasTextLabel
                key={draftText.id}
                text={draftText}
                canvasId={folder.id}
                origin={WORLD_ORIGIN}
                tool={tool}
                zoomRef={zoomRef}
                onEditText={onEditText}
                onRemoveText={removeLabel}
                onMenu={handleTextMenu}
                draft
                onCreateText={onAddText}
                onFinishDraft={finishDraft}
              />
            )}
            {children.map(({ note, item }) => (
              <NoteCapsule
                key={note.id}
                note={note}
                item={item}
                dragging={drag.current?.noteId === note.id && drag.current.moved}
                imageWidths={imageWidths}
                zoomRef={zoomRef}
                canvasId={folder.id}
                onPointerDown={startNoteDrag}
                onPointerMove={moveNoteDrag}
                onPointerUp={endNoteDrag}
                onPointerCancel={cancelNoteDrag}
                onOpen={onOpenNote}
                onContextMenu={handleNoteContextMenu}
                onResizeNote={onResizeNote}
                onResizeImage={onResizeImage}
              />
            ))}
            {tool === "select" && shownBox && !region && (
              // A hairline round what is held, and one square at its corner to stretch it
              // by, both drawn at screen size whatever the zoom (`--canvas-unzoom`).
              <div
                className="canvas-selection"
                aria-hidden
                style={
                  {
                    left: WORLD_ORIGIN + shownBox.x,
                    top: WORLD_ORIGIN + shownBox.y,
                    width: shownBox.w,
                    height: shownBox.h,
                    "--canvas-unzoom": 1 / zoom,
                  } as CSSProperties
                }
              >
                <span className="canvas-selection-handle" />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* A sketch nobody has marked yet: one quiet line, gone with the first stroke. */}
      {tool === "draw" && children.length === 0 && allStrokes.length === 0 && (folder.text_elements ?? []).length === 0 && pictures.length === 0 && (
        <p className="canvas-hint">{keyboard ? "Draw here" : "Draw with your finger"}</p>
      )}
      {tool === "text" && !draftText && (folder.text_elements ?? []).length === 0 && (
        <p className="canvas-hint">{keyboard ? "Click to write" : "Tap to write"}</p>
      )}
      {tool === "select" && !selected && !region && hasContent && !notice && (
        <p className="canvas-hint">{keyboard ? "Drag a box round what to move" : "Draw a loop round what to move"}</p>
      )}
      {notice && (
        <p className="canvas-hint" role="status">
          {notice}
        </p>
      )}
      {onAddImages && (
        <input
          ref={pickerRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={handlePicked}
        />
      )}
      {phone && (
        // The foot of the screen, where the thumb rests (the open note keeps its
        // marks there too). The surface above it ends where this begins, so no
        // touch meant for the drawing ever lands on a control.
        <footer className="canvas-dock" aria-label="Drawing tools">
          <div className="canvas-dock-row">{toolButtons}</div>
          <div className="canvas-dock-row">
            {actionButtons}
            <span className="canvas-dock-end">
              {clearTool}
              {zoomTool}
            </span>
          </div>
          {optionTools.length > 0 && <div className="canvas-dock-row">{optionTools}</div>}
        </footer>
      )}
      {optionMenu && (
        <>
          <div className="ctx-dismiss" onClick={() => setOptionMenu(null)} />
          <CtxMenu
            x={optionMenu.x}
            y={optionMenu.y}
            above={optionMenu.above}
            className="canvas-option-menu"
            label={optionMenu.kind === "color" ? colourWord : optionMenu.kind === "shape" ? "Shape" : "Line thickness"}
          >
            {optionMenu.kind === "shape" ? (
              SHAPES.map((candidate) => (
                <button
                  key={candidate.kind}
                  type="button"
                  role="menuitemradio"
                  className="ctx-item"
                  data-on={shapeKind === candidate.kind}
                  aria-checked={shapeKind === candidate.kind}
                  onClick={() => {
                    setShapeKind(candidate.kind);
                    setOptionMenu(null);
                  }}
                >
                  <IconShape kind={candidate.kind} />
                  {candidate.label}
                </button>
              ))
            ) : optionMenu.kind === "color" ? (
              <div className="canvas-palette">
                {CANVAS_COLOURS.map((candidate) => (
                  <button
                    key={candidate.key}
                    type="button"
                    role="menuitemradio"
                    className="canvas-color-btn canvas-palette-item"
                    data-on={shownColour.value === candidate.value}
                    aria-checked={shownColour.value === candidate.value}
                    aria-label={candidate.label}
                    title={candidate.label}
                    style={{ "--pen": candidate.value } as CSSProperties}
                    onClick={() => {
                      // With strokes selected the colour is theirs; the pen keeps its own.
                      if (recolours) recolourSelection(candidate.value);
                      else setColor(candidate.value);
                      setOptionMenu(null);
                    }}
                  />
                ))}
              </div>
            ) : (
              (tool === "highlight" ? HIGHLIGHT_WIDTHS : CANVAS_WIDTHS).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="menuitemradio"
                  className="ctx-item canvas-width-option"
                  data-on={shownWidth === candidate}
                  aria-checked={shownWidth === candidate}
                  onClick={() => {
                    if (tool === "highlight") setHighlightWidth(candidate);
                    else setWidth(candidate);
                    setOptionMenu(null);
                  }}
                >
                  <span
                    className="canvas-width-rule"
                    style={{ height: tool === "highlight" ? candidate / 3 : candidate }}
                    aria-hidden
                  />
                  {candidate} px
                </button>
              ))
            )}
          </CtxMenu>
        </>
      )}
      {contextMenu && (
        <>
          <div className="ctx-dismiss" onClick={() => setContextMenu(null)} />
          {/* Both tools are here, not just the one the toolbar happens not to
              be showing. Reaching the pencil meant crossing the whole screen to
              a corner and back to where the hand already was. */}
          <CtxMenu x={contextMenu.x} y={contextMenu.y} label="Canvas menu">
            <button type="button" role="menuitem" className="ctx-item" onClick={handleAddText}>
              <IconText />
              Add text
            </button>
            {onAddImages && (
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const at: [number, number] = [contextMenu.worldX, contextMenu.worldY];
                  setContextMenu(null);
                  pickPictures(at);
                }}
              >
                <IconPicture />
                Add picture
              </button>
            )}
            <button
              type="button"
              role="menuitemradio"
              className="ctx-item"
              data-on={tool === "move"}
              aria-checked={tool === "move"}
              onClick={() => handleSetTool("move")}
            >
              <IconHand />
              Move
            </button>
            <button
              type="button"
              role="menuitemradio"
              className="ctx-item"
              data-on={tool === "draw"}
              aria-checked={tool === "draw"}
              onClick={() => handleSetTool("draw")}
            >
              <IconPencil />
              Draw
            </button>
            <button
              type="button"
              role="menuitemradio"
              className="ctx-item"
              data-on={tool === "text"}
              aria-checked={tool === "text"}
              onClick={() => handleSetTool("text")}
            >
              <IconText />
              Text
            </button>
            <button
              type="button"
              role="menuitemradio"
              className="ctx-item"
              data-on={tool === "erase"}
              aria-checked={tool === "erase"}
              onClick={() => handleSetTool("erase")}
            >
              <IconEraser />
              Eraser
            </button>
            {(
              [
                ["select", "Select", <IconLasso key="i" />],
                ["highlight", "Highlighter", <IconHighlighter key="i" />],
                ["shape", "Shapes", <IconShapes key="i" />],
              ] as const
            ).map(([name, label, icon]) => (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                className="ctx-item"
                data-on={tool === name}
                aria-checked={tool === name}
                onClick={() => handleSetTool(name)}
              >
                {icon}
                {label}
              </button>
            ))}
            {hasContent && (
              <>
                <span className="ctx-sep" aria-hidden />
                <button
                  type="button"
                  role="menuitem"
                  className="ctx-item"
                  onClick={() => {
                    setContextMenu(null);
                    fitAll();
                  }}
                >
                  <IconFit />
                  Show everything
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ctx-item"
                  onClick={() => {
                    setContextMenu(null);
                    void savePictureOfCanvas();
                  }}
                >
                  <IconDownload />
                  Save as picture
                </button>
              </>
            )}
            {/* The way out of an idea nobody meant to make. Last in the menu
                and separated from the tools above it, because it is the only
                row here that changes anything but the pointer. It asks first
                — the App draws the dialog — and it is undoable after that. */}
            {idea && (
              <>
                <span className="ctx-sep" aria-hidden />
                {/* The merge taken back: the notes go home and the idea goes
                    to the archive with its text and its canvas intact. Above
                    Dissolve, which throws the idea away and so asks first —
                    this one keeps everything and does not need to. */}
                {onUnmerge && isUnmergeable(idea) && unmergeSources(idea, notes).length > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    className="ctx-item"
                    onClick={() => {
                      setContextMenu(null);
                      onUnmerge(idea.id);
                    }}
                  >
                    <IconUnmerge />
                    Separate
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="ctx-item"
                  onClick={() => {
                    setContextMenu(null);
                    onDissolve(idea.id);
                  }}
                >
                  <IconDelete tier="inline" />
                  Dissolve idea
                </button>
              </>
            )}
          </CtxMenu>
        </>
      )}

      {noteMenu && (
        <>
          <div className="ctx-dismiss" onClick={() => setNoteMenu(null)} />
          <CtxMenu x={noteMenu.x} y={noteMenu.y} label="Note menu">
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={(event) => {
                const note = noteMenu.note;
                setNoteMenu(null);
                const el = event.currentTarget.closest(".ctx-menu");
                onOpenNote(note, (el ?? event.currentTarget).getBoundingClientRect());
              }}
            >
              <IconBack tier="inline" />
              Open note
            </button>
            {idea && (
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const note = noteMenu.note;
                  setNoteMenu(null);
                  onRelease(idea.id, note.id);
                }}
              >
                <IconRelease />
                Take out of idea
              </button>
            )}
            {/* A move to the trash, and it is undoable like every other one —
                so unlike Dissolve idea it does not ask first. Last in the
                menu because it is the destructive row. */}
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => {
                const note = noteMenu.note;
                setNoteMenu(null);
                onTrashNote(note.id);
              }}
            >
              <IconDelete tier="inline" />
              Delete
            </button>
          </CtxMenu>
        </>
      )}

      {textMenu && (
        <>
          <div className="ctx-dismiss" onClick={() => setTextMenu(null)} />
          <CtxMenu x={textMenu.x} y={textMenu.y} label="Text menu">
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => {
                setEditTextId(textMenu.text.id);
                setTextMenu(null);
              }}
            >
              <IconText />
              Edit text
            </button>
            {/* Undo sets it back, so it does not ask. */}
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => {
                const text = textMenu.text;
                setTextMenu(null);
                removeLabel(folder.id, text.id);
              }}
            >
              <IconDelete tier="inline" />
              Delete text
            </button>
          </CtxMenu>
        </>
      )}

      {pictureMenu && (
        <>
          <div className="ctx-dismiss" onClick={() => setPictureMenu(null)} />
          <CtxMenu x={pictureMenu.x} y={pictureMenu.y} label="Picture menu">
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => {
                const att = pictureMenu.att;
                setPictureMenu(null);
                setRemoving([att]);
              }}
            >
              <IconDelete tier="inline" />
              Remove picture
            </button>
          </CtxMenu>
        </>
      )}

      {removing && onRemoveImage && (
        <Dialog
          title={removing.length === 1 ? "Remove picture?" : `Remove ${removing.length} pictures?`}
          message={
            removing.length === 1
              ? `Remove ${removing[0].name} from this idea? The file is deleted, and anything drawn over it stays.`
              : `Remove ${removing.length} pictures from this idea? Their files are deleted, and anything drawn over them stays.`
          }
          confirmLabel={removing.length === 1 ? "Remove picture" : "Remove pictures"}
          destructive
          onConfirm={() => {
            const going = removing;
            setRemoving(null);
            for (const att of going) onRemoveImage(folder.id, att.id);
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}
