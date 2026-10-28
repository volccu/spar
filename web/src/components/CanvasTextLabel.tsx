import { memo, useEffect, useRef, useState } from "react";
import type { CanvasText, CanvasTool } from "../types";
import { useHasKeyboard } from "../lib/hotkeys";
import { TEXT_MAX_W, TEXT_MIN_W } from "../lib/canvas";

/** A label made before labels had a width is as wide as its words, up to this. */
const TEXT_LEGACY_MAX_W = 300;

type TextChanges = Partial<Pick<CanvasText, "text" | "x" | "y" | "width">>;

interface Props {
  text: CanvasText;
  canvasId: string;
  origin: number;
  tool: CanvasTool;
  zoomRef: React.RefObject<number>;
  onEditText: (canvasId: string, textId: string, changes: TextChanges) => void;
  onRemoveText: (canvasId: string, textId: string) => void;
  onMenu: (event: React.MouseEvent, text: CanvasText) => void;
  /**
   * Set only on the label the Text tool (or the menu's Add text) has just set
   * down. It is an editor and nothing else until it holds words: committing it
   * blank leaves nothing behind, in the store or in the outbox.
   */
  draft?: boolean;
  onCreateText?: (canvasId: string, text: CanvasText) => void;
  onFinishDraft?: () => void;
  /** The menu's Edit text: opens the editor once, then says so. */
  editNow?: boolean;
  onEditStarted?: () => void;
}

/**
 * A label of the user's words on a canvas. Memoized for the reason
 * `NoteCapsule` is: a pinch must not re-render every label because the zoom
 * changed. A drag and a resize are held here and written once, at the lift,
 * so a label carried across the canvas is one write and not one per frame.
 */
export const CanvasTextLabel = memo(function CanvasTextLabel({
  text,
  canvasId,
  origin,
  tool,
  zoomRef,
  onEditText,
  onRemoveText,
  onMenu,
  draft = false,
  onCreateText,
  onFinishDraft,
  editNow = false,
  onEditStarted,
}: Props) {
  const [editing, setEditing] = useState(draft);
  const [words, setWords] = useState(text.text);
  /** Where a drag has the label right now, before it is written. */
  const [carried, setCarried] = useState<{ x: number; y: number } | null>(null);
  /** The width a resize has reached, before it is written. */
  const [stretched, setStretched] = useState<number | null>(null);
  /** An old label being edited is held at the width it had, so nothing reflows. */
  const [heldWidth, setHeldWidth] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ startX: number; originWidth: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** When this label was set down: a draft blurred straight away was not left by the user. */
  const madeAt = useRef(Date.now());
  const keyboard = useHasKeyboard();

  useEffect(() => {
    if (!editing) return;
    // A tick late on purpose: the press that set this label down is still
    // being answered, and the browser moving the focus for it afterwards
    // would blur the field the moment it was focused — and a blank label
    // that blurs is gone.
    const t = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => window.clearTimeout(t);
  }, [editing]);

  useEffect(() => {
    if (!editNow) return;
    beginEdit();
    onEditStarted?.();
    // Asked once per request; the request is cleared by `onEditStarted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editNow]);

  function beginEdit() {
    if (text.width === undefined && boxRef.current) {
      setHeldWidth(Math.max(TEXT_MIN_W * 2, boxRef.current.offsetWidth));
    }
    setWords(text.text);
    setEditing(true);
  }

  function commit() {
    if (!editing) return;
    // A touch browser can move the focus for the very tap that set this label
    // down, after the field has taken it. That is not the user leaving a blank
    // label, so the field takes the focus back rather than vanishing.
    if (draft && !words.trim() && Date.now() - madeAt.current < 600) {
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
      return;
    }
    setEditing(false);
    setHeldWidth(null);
    if (draft) {
      if (words.trim()) onCreateText?.(canvasId, { ...text, text: words });
      onFinishDraft?.();
      return;
    }
    if (!words.trim()) onRemoveText(canvasId, text.id);
    else if (words !== text.text) onEditText(canvasId, text.id, { text: words });
  }

  function cancel() {
    setWords(text.text);
    setEditing(false);
    setHeldWidth(null);
    if (draft) onFinishDraft?.();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (editing || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (tool === "text") {
      event.preventDefault();
      event.stopPropagation();
      beginEdit();
      return;
    }
    if (tool !== "move") return;
    event.stopPropagation();
    dragRef.current = { startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    // Screen pixels in, world pixels out: further in, the same travel moves less.
    const dx = (event.clientX - drag.startX) / zoomRef.current;
    const dy = (event.clientY - drag.startY) / zoomRef.current;
    drag.moved ||= Math.abs(dx) > 3 || Math.abs(dy) > 3;
    if (drag.moved) setCarried({ x: text.x + dx, y: text.y + dy });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag.moved && carried) onEditText(canvasId, text.id, carried);
    setCarried(null);
  }

  /** The browser took the press away: the label goes back where it was. */
  function handlePointerCancel() {
    dragRef.current = null;
    setCarried(null);
  }

  function handleLabelKeyDown(event: React.KeyboardEvent) {
    if (event.target !== event.currentTarget || editing) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      onRemoveText(canvasId, text.id);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    beginEdit();
  }

  function onResizePointerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const now = text.width ?? boxRef.current?.offsetWidth ?? TEXT_LEGACY_MAX_W;
    resizeRef.current = { startX: event.clientX, originWidth: now };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onResizePointerMove(event: React.PointerEvent) {
    const current = resizeRef.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / zoomRef.current;
    setStretched(Math.round(Math.min(TEXT_MAX_W, Math.max(TEXT_MIN_W, current.originWidth + dx))));
  }

  function onResizePointerUp(event: React.PointerEvent) {
    const current = resizeRef.current;
    resizeRef.current = null;
    if (!current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (stretched !== null && stretched !== text.width) onEditText(canvasId, text.id, { width: stretched });
    setStretched(null);
  }

  const at = carried ?? text;
  const width = stretched ?? text.width ?? heldWidth ?? undefined;

  return (
    <div
      ref={boxRef}
      className="canvas-text"
      data-id={text.id}
      data-editing={editing}
      style={{
        left: origin + at.x,
        top: origin + at.y,
        width,
        maxWidth: width === undefined ? TEXT_LEGACY_MAX_W : undefined,
      }}
      // A button while it is a label; the field inside carries its own name.
      role={editing ? undefined : "button"}
      tabIndex={editing ? undefined : 0}
      aria-label={editing ? undefined : text.text}
      onKeyDown={handleLabelKeyDown}
      onDoubleClick={(event) => {
        if (editing) return;
        event.stopPropagation();
        beginEdit();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => {
        // The field's own menu (spelling, paste) while it is being typed in.
        if (editing) return;
        event.preventDefault();
        event.stopPropagation();
        onMenu(event, text);
      }}
    >
      {editing ? (
        <textarea
          ref={inputRef}
          className="canvas-text-input"
          aria-label="Text on the idea"
          placeholder={keyboard ? "Type here" : "Write here"}
          value={words}
          onChange={(event) => setWords(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Taken here, so neither the canvas nor the app closes on it.
              event.preventDefault();
              event.stopPropagation();
              cancel();
            } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          rows={Math.max(1, words.split("\n").length)}
        />
      ) : (
        <>
          <span className="canvas-text-label">{text.text}</span>
          {tool === "move" && (
            <span
              className="spatial-resize-handle canvas-text-resize"
              aria-hidden
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={onResizePointerUp}
              onPointerCancel={onResizePointerUp}
            />
          )}
        </>
      )}
    </div>
  );
});
