import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cycleTab } from "../lib/focusTrap";
import { shownRows, walkRows } from "../lib/rowKeys";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { hotkeyTitle, isTypingTarget, UNDO_KEY, useHasKeyboard } from "../lib/hotkeys";
import { useIsPhone } from "../lib/breakpoint";
import { ERASE_REACH, pathBetween, strokeHit } from "../lib/strokeErase";
import type { CSSProperties } from "react";
import type { Attachment, Canvas, CanvasItem, CanvasText, DrawingStroke, Note } from "../types";
import { cardLines } from "../lib/face";
import { anchorScroll, clampZoom, DEFAULT_W, IMG_W, worldFromClient } from "../lib/canvas";
import { fitView } from "../lib/canvasFit";
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
  IconEraser,
  IconFile,
  IconFileType,
  IconHand,
  IconLink,
  IconMerge,
  IconPencil,
  IconPriority,
  IconRelease,
  IconText,
  IconUndo,
  IconUnmerge,
} from "./Icons";
import { isUnmergeable, unmergeSources } from "../lib/merge";
import { CardBody } from "./shared/CardBody";

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

/**
 * A pencil has a weight, not a hue. `--signal` was in this list and it is the
 * one thing the app singles out — it means a live address and nothing else, so
 * a stroke drawn in it was the app saying "link" about a scribble. What is left
 * is the same tonal scale the rules are built from, which is what lets a
 * drawing sit on the page as annotation rather than as decoration.
 *
 * The quiet pencil is `--rule` and not `--rule-soft`. On the old light canvas a
 * soft rule was a perfectly good faint pencil; against the near-black one it is
 * 1.3:1 and you would draw a stroke and not be able to find it. A pencil you
 * cannot see is not a quiet pencil, it is a broken one.
 */
const DRAW_COLORS = [
  { label: "Ink", value: "var(--ink)" },
  { label: "Muted", value: "var(--muted)" },
  { label: "Faint", value: "var(--rule)" },
];
const DRAW_WIDTHS = [2, 4, 8];

type Tool = "move" | "draw" | "erase";

/** A stroke and the place it held in the list, so taking it back puts it where it was. */
interface StrokeEntry {
  stroke: DrawingStroke;
  index: number;
}

/**
 * One thing done to the drawing in this open session, and how to take it back.
 * Kept here and never stored or synced: the way back is for the sitting you are
 * in, the same as zoom.
 */
type StrokeStep = { kind: "drew"; id: string } | { kind: "rubbed"; entries: StrokeEntry[] };

/** How many steps back Undo goes. A sitting's worth, not a history. */
const UNDO_DEPTH = 100;

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
  /** Strokes back where they stood — the way back from the eraser and from Clear. */
  onRestoreStrokes: (canvasId: string, entries: StrokeEntry[]) => void;
  onResizeNote: (canvasId: string, noteId: string, width: number) => void;
  onResizeImage: (canvasId: string, attachmentId: string, width: number) => void;
  onAddText: (canvasId: string, text: CanvasText) => void;
  onEditText: (canvasId: string, textId: string, changes: Partial<Pick<CanvasText, "text" | "x" | "y">>) => void;
  onRemoveText: (canvasId: string, textId: string) => void;
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
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
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

function strokePath(points: [number, number][], origin: number): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  let d = `M ${origin + first[0]} ${origin + first[1]}`;
  if (rest.length === 0) return d;
  if (rest.length === 1) {
    const [p] = rest;
    d += ` L ${origin + p[0]} ${origin + p[1]}`;
    return d;
  }
  for (let i = 0; i < rest.length - 1; i++) {
    const cp = rest[i];
    const end = rest[i + 1];
    const mx = (origin + cp[0] + origin + end[0]) / 2;
    const my = (origin + cp[1] + origin + end[1]) / 2;
    d += ` Q ${origin + cp[0]} ${origin + cp[1]} ${mx} ${my}`;
  }
  const last = rest[rest.length - 1];
  d += ` L ${origin + last[0]} ${origin + last[1]}`;
  return d;
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

/** Memoized for the same reason `NoteCapsule` is — see its comment. */
const CanvasTextLabel = memo(function CanvasTextLabel({
  text,
  canvasId,
  zoomRef,
  onEditText,
  onRemoveText,
}: {
  text: CanvasText;
  canvasId: string;
  zoomRef: React.RefObject<number>;
  onEditText: (canvasId: string, textId: string, changes: Partial<Pick<CanvasText, "text" | "x" | "y">>) => void;
  onRemoveText: (canvasId: string, textId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text.text);
  const [dragState, setDragState] = useState<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const keyboard = useHasKeyboard();

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function handleDoubleClick(event: React.MouseEvent) {
    event.stopPropagation();
    setDraft(text.text);
    setEditing(true);
  }

  function handleBlur() {
    setEditing(false);
    if (draft.trim()) {
      onEditText(canvasId, text.id, { text: draft });
    } else {
      onRemoveText(canvasId, text.id);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      (event.target as HTMLTextAreaElement).blur();
    }
    if (event.key === "Escape") {
      setEditing(false);
      setDraft(text.text);
    }
  }

  function handlePointerDown(event: React.PointerEvent) {
    if (editing) return;
    event.stopPropagation();
    setDragState({
      startX: event.clientX,
      startY: event.clientY,
      originX: text.x,
      originY: text.y,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!dragState) return;
    // Same reasoning as a note's own drag: the pointer moves in screen
    // pixels, the label's position is a world one.
    const dx = (event.clientX - dragState.startX) / zoomRef.current;
    const dy = (event.clientY - dragState.startY) / zoomRef.current;
    onEditText(canvasId, text.id, { x: dragState.originX + dx, y: dragState.originY + dy });
  }

  function handlePointerUp(event: React.PointerEvent) {
    setDragState(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleContextMenu(event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    onRemoveText(canvasId, text.id);
  }

  /** Enter on the label itself starts the edit, as a double-click does. A key
   *  from the field inside bubbles here too and is the field's own. */
  function handleLabelKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "Enter" || event.target !== event.currentTarget || editing) return;
    event.preventDefault();
    setDraft(text.text);
    setEditing(true);
  }

  return (
    <div
      className="canvas-text"
      data-id={text.id}
      style={{ left: WORLD_ORIGIN + text.x, top: WORLD_ORIGIN + text.y }}
      // A button while it is a label; the field inside carries its own name.
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      aria-label={editing ? undefined : text.text || "Empty text"}
      onKeyDown={handleLabelKeyDown}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
    >
      {editing ? (
        <textarea
          ref={inputRef}
          className="canvas-text-input"
          aria-label="Text on the idea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          rows={1}
        />
      ) : (
        <span className="canvas-text-label">
          {text.text || (keyboard ? "Double-click to edit" : "Tap twice to edit")}
        </span>
      )}
    </div>
  );
});

const CTX_ROWS = '[role^="menuitem"]:not(:disabled)';

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
  label,
  children,
}: {
  x: number;
  y: number;
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
      className="ctx-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
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
          {name ?? "Idea"}
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
  onRestoreStrokes,
  onResizeNote,
  onResizeImage,
  onAddText,
  onEditText,
  onRemoveText,
  initialTool,
  justMerged = false,
}: Props) {
  const [items, setItems] = useState(folder.items);
  const [tool, setTool] = useState<Tool>(initialTool ?? "move");
  const [color, setColor] = useState(DRAW_COLORS[0].value);
  const [width, setWidth] = useState(DRAW_WIDTHS[1]);
  const [liveStroke, setLiveStroke] = useState<DrawingStroke | null>(null);
  /** The stroke being drawn, read at the lift. Beside the state, which only paints. */
  const liveRef = useRef<DrawingStroke | null>(null);
  /**
   * What Undo would take back, newest last. The ref is the truth, written at
   * once, so two quick presses never take back the same step; the state is only
   * there so the button knows whether it has anything to do.
   */
  const stepsRef = useRef<StrokeStep[]>([]);
  const [stepCount, setStepCount] = useState(0);
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

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    // Used to bail on anything but a mouse, because native touch scrolling
    // was doing the panning for a finger. `.canvas-surface` now takes
    // `touch-action: none` so a second finger can be seen for a pinch — which
    // means a touch pointer has nothing left to pan it but this handler.
    if (event.target instanceof Element && event.target.closest(".spatial-note, .spatial-resize-handle")) return;
    if (tool !== "move") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    pan.current = {
      startX: event.clientX,
      startY: event.clientY,
      originLeft: canvas.scrollLeft,
      originTop: canvas.scrollTop,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const current = pan.current;
    const canvas = canvasRef.current;
    if (!current || !canvas) return;
    canvas.scrollLeft = current.originLeft - (event.clientX - current.startX);
    canvas.scrollTop = current.originTop - (event.clientY - current.startY);
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    pan.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function startDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== "draw") return;
    if (event.target instanceof Element && event.target.closest(".spatial-note, .spatial-resize-handle")) return;
    if (event.pointerType !== "mouse" && event.pointerType !== "touch" && event.pointerType !== "pen") return;
    event.preventDefault();
    drawing.current = true;
    const [wx, wy] = toWorldCoords(event.clientX, event.clientY);
    liveRef.current = {
      id: crypto.randomUUID(),
      points: [[wx, wy]],
      color,
      width,
    };
    setLiveStroke(liveRef.current);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawing.current || !liveRef.current) return;
    const [wx, wy] = toWorldCoords(event.clientX, event.clientY);
    liveRef.current = { ...liveRef.current, points: [...liveRef.current.points, [wx, wy]] };
    setLiveStroke(liveRef.current);
  }

  function endDraw(event: React.PointerEvent<HTMLDivElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const done = liveRef.current;
    liveRef.current = null;
    setLiveStroke(null);
    if (done && done.points.length > 1) {
      onAddStroke(folder.id, done);
      pushStep({ kind: "drew", id: done.id });
    }
  }

  /** Records a step Undo can take back. */
  function pushStep(step: StrokeStep) {
    stepsRef.current = [...stepsRef.current, step].slice(-UNDO_DEPTH);
    setStepCount(stepsRef.current.length);
  }

  /**
   * Takes back the last thing done to the drawing in this sitting: a stroke
   * drawn goes, strokes rubbed out or cleared come back where they stood.
   * Answers whether there was anything, which is what the key needs to know.
   */
  function undoStroke(): boolean {
    const last = stepsRef.current[stepsRef.current.length - 1];
    if (!last) return false;
    stepsRef.current = stepsRef.current.slice(0, -1);
    setStepCount(stepsRef.current.length);
    if (last.kind === "drew") onRemoveStroke(folder.id, last.id);
    else onRestoreStrokes(folder.id, last.entries);
    return true;
  }

  function clearStrokes() {
    const entries = folder.strokes.map((stroke, index) => ({ stroke, index }));
    if (entries.length === 0) return;
    onClearStrokes(folder.id);
    pushStep({ kind: "rubbed", entries });
  }

  /**
   * The eraser takes a whole stroke at a touch, not a pixel of one: nothing to
   * aim, nothing half-gone. It goes the moment the finger reaches it, and a
   * drag is one step to take back however many it crossed.
   */
  function startErase(event: React.PointerEvent<HTMLDivElement>) {
    if (tool !== "erase") return;
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
    if (state.gone.size > 0) pushStep({ kind: "rubbed", entries: [...state.gone.values()] });
  }

  // Ctrl+Z, while there is something to take back. Caught before the board's own
  // (useKeyboardUndo), which is the same key one layer down: the stroke you just
  // drew is the thing the key means here. With nothing left it falls through, so
  // it still undoes a merge. A field being typed in keeps its own, and so does a
  // note open over the idea.
  const undoRef = useRef(undoStroke);
  undoRef.current = undoStroke;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== UNDO_KEY) return;
      if (isTypingTarget(e.target) || document.querySelector(".sheet")) return;
      if (stepsRef.current.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      undoRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

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
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.current.size >= 2) {
      beginPinch();
      return;
    }
    if (tool === "draw") {
      startDraw(event);
    } else if (tool === "erase") {
      startErase(event);
    } else {
      startPan(event);
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointers.current.has(event.pointerId)) {
      activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch.current && activePointers.current.size >= 2) {
      continuePinch();
      return;
    }
    if (tool === "draw") {
      moveDraw(event);
    } else if (tool === "erase") {
      rub(event);
    } else {
      movePan(event);
    }
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    activePointers.current.delete(event.pointerId);
    // Fewer than two pointers left and the pinch is over — the next move
    // (if any) belongs to whatever tool is in hand.
    if (activePointers.current.size < 2) pinch.current = null;
    if (tool === "draw") {
      endDraw(event);
    } else if (tool === "erase") {
      endErase(event);
    } else {
      endPan(event);
    }
  }

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.target instanceof Element && event.target.closest(".spatial-note, .canvas-text")) return;
    const [worldX, worldY] = toWorldCoords(event.clientX, event.clientY);
    setNoteMenu(null);
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

  function handleAddText() {
    if (!contextMenu) return;
    const text: CanvasText = {
      id: crypto.randomUUID(),
      x: contextMenu.worldX,
      y: contextMenu.worldY,
      text: "",
    };
    onAddText(folder.id, text);
    setContextMenu(null);
  }

  function handleSetTool(next: Tool) {
    setTool(next);
    setContextMenu(null);
  }

  // The next three are `useCallback`-stable for the same reason
  // `handleNoteContextMenu` is: they are handed straight to every
  // `NoteCapsule` on the board, and a memoized component re-rendered by a
  // fresh handler prop every time is not memoized at all.
  const startNoteDrag = useCallback((event: React.PointerEvent<HTMLElement>, item: CanvasItem) => {
    if (tool !== "move") return;
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
   * and in a bar at the foot on a phone, where the thumb is and where the row
   * would otherwise run off the edge with Clear and the zoom past it. One set
   * of buttons, never both bars at once (the same reason the shelf branches in
   * JavaScript and not in CSS: two copies are two of everything to a reader).
   */
  const mainTools = (
    <>
      <button
        type="button"
        className="canvas-tool-btn"
        data-on={tool === "move"}
        aria-pressed={tool === "move"}
        aria-label="Move"
        title="Move"
        onClick={() => setTool("move")}
      >
        <IconHand />
      </button>
      <button
        type="button"
        className="canvas-tool-btn"
        data-on={tool === "draw"}
        aria-pressed={tool === "draw"}
        aria-label="Draw"
        title="Draw"
        onClick={() => setTool("draw")}
      >
        <IconPencil />
      </button>
      <button
        type="button"
        className="canvas-tool-btn"
        data-on={tool === "erase"}
        aria-pressed={tool === "erase"}
        aria-label="Eraser"
        title="Eraser"
        onClick={() => setTool("erase")}
      >
        <IconEraser />
      </button>
      {/* Disabled, not hidden, so nothing beside it moves when the first stroke
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
    </>
  );
  const colorTools = DRAW_COLORS.map((c) => (
    <button
      key={c.value}
      type="button"
      className="canvas-color-btn"
      data-on={color === c.value}
      // `aria-pressed`, like the tools and the three weights beside it. Every
      // control in this bar says whether it is on and this one said it only in
      // `data-on`, a CSS hook, so the one row where the state *is* the whole
      // message was silent to a reader.
      aria-pressed={color === c.value}
      aria-label={c.label}
      title={c.label}
      // The tone rides in as a custom property rather than as the button's own
      // fill: the button is a thumb's worth tall and the swatch is still the
      // 22px sample, drawn by `.canvas-color-btn::after`.
      style={{ "--pen": c.value } as CSSProperties}
      onClick={() => setColor(c.value)}
    />
  ));

  const widthTools = DRAW_WIDTHS.map((w) => (
    <button
      key={w}
      type="button"
      className="canvas-width-btn"
      data-on={width === w}
      aria-pressed={width === w}
      aria-label={`Stroke width ${w}`}
      title={`Width ${w}`}
      onClick={() => setWidth(w)}
    >
      {/* The control is the stroke: a rule at the weight it draws, not a circle
          standing in for one. Nothing is rounded. */}
      <span className="canvas-width-rule" style={{ height: w }} />
    </button>
  ));

  // Clear goes with the pen and the eraser, not the hand; Undo now takes it back.
  const clearTool =
    tool !== "move" && folder.strokes.length > 0 ? (
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
        if (e.key === "Escape" && (contextMenu || noteMenu) && !isTypingTarget(e.target)) {
          e.preventDefault();
          setContextMenu(null);
          setNoteMenu(null);
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
          <p className="canvas-merged mono" role="status">
            Merged into an idea
            {canUnmerge && (
              <>
                {/* One line on a desktop; on a phone the way back takes a
                    line of its own rather than breaking mid-word. */}
                <span className="canvas-merged-sep"> · </span>
                <span className="canvas-merged-how">
                  {keyboard ? "Right-click an empty spot to un-merge" : "Hold an empty spot to un-merge"}
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
            {mainTools}
            {tool === "draw" && (
              <>
                <span className="canvas-tool-sep" aria-hidden />
                {colorTools}
                <span className="canvas-tool-sep" aria-hidden />
                {widthTools}
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
      </header>
      <div
        ref={canvasRef}
        className="canvas-surface"
        data-tool={tool}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onContextMenu={handleContextMenu}
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
            <svg
              className="canvas-svg"
              width={WORLD_SIZE}
              height={WORLD_SIZE}
              aria-hidden
            >
              {allStrokes.map((stroke) => (
                <path
                  key={stroke.id}
                  d={strokePath(stroke.points, WORLD_ORIGIN)}
                  fill="none"
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
            {(folder.text_elements ?? []).map((t) => (
              <CanvasTextLabel
                key={t.id}
                text={t}
                canvasId={folder.id}
                zoomRef={zoomRef}
                onEditText={onEditText}
                onRemoveText={onRemoveText}
              />
            ))}
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
          </div>
        </div>
      </div>
      {/* A sketch nobody has marked yet: one quiet line, gone with the first stroke. */}
      {tool === "draw" && children.length === 0 && allStrokes.length === 0 && (folder.text_elements ?? []).length === 0 && (
        <p className="canvas-hint">{keyboard ? "Draw here" : "Draw with your finger"}</p>
      )}
      {phone && (
        // The foot of the screen, where the thumb rests (the open note keeps its
        // marks there too). The surface above it ends where this begins, so no
        // touch meant for the drawing ever lands on a control.
        <footer className="canvas-dock" aria-label="Drawing tools">
          <div className="canvas-dock-row">
            {mainTools}
            <span className="canvas-dock-end">
              {clearTool}
              {zoomTool}
            </span>
          </div>
          {tool === "draw" && (
            <div className="canvas-dock-row">
              {colorTools}
              <span className="canvas-tool-sep" aria-hidden />
              {widthTools}
            </div>
          )}
        </footer>
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
              data-on={tool === "erase"}
              aria-checked={tool === "erase"}
              onClick={() => handleSetTool("erase")}
            >
              <IconEraser />
              Eraser
            </button>
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
                    Un-merge
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
    </section>
  );
}
