import { memo, useRef, useState } from "react";
import type { Attachment } from "../types";
import { fileIconKey, fileKind, isImage } from "../lib/files";
import { useFileUrl } from "../store/useFileUrl";
import { IconFileType } from "./Icons";

const PICTURE_MIN_W = 60;

interface Props {
  att: Attachment;
  x: number;
  y: number;
  width: number;
  canvasId: string;
  origin: number;
  zoomRef: React.RefObject<number>;
  /** Move is in hand. Any other tool goes through the picture to the canvas. */
  movable: boolean;
  onMove: (canvasId: string, attachmentId: string, x: number, y: number) => void;
  onResize: (canvasId: string, attachmentId: string, width: number) => void;
  onMenu: (event: React.MouseEvent, att: Attachment) => void;
}

/**
 * A picture set straight onto the canvas — the thing you draw on. It sits
 * under the strokes, so a pen held over it marks it, and it answers the
 * pointer only while Move is in hand (`.canvas-picture` in the stylesheet):
 * every other tool goes through it to the canvas, as a pen goes through
 * paper. A drag and a resize are held here and written once, at the lift.
 */
export const CanvasPicture = memo(function CanvasPicture({
  att,
  x,
  y,
  width,
  canvasId,
  origin,
  zoomRef,
  movable,
  onMove,
  onResize,
  onMenu,
}: Props) {
  const { url: local } = useFileUrl(isImage(att) ? att : null, "local");
  // Bytes this browser cannot draw fall back to the thumbnail, and with none
  // to the file's mark — never a broken box (the same steps a note's picture takes).
  const [broken, setBroken] = useState<string | null>(null);
  const shot = (local !== broken ? local : null) ?? (broken === "thumb" ? null : att.thumb) ?? null;
  const [carried, setCarried] = useState<{ x: number; y: number } | null>(null);
  const [stretched, setStretched] = useState<number | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const resizeRef = useRef<{ startX: number; originWidth: number } | null>(null);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!movable || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (event.target instanceof Element && event.target.closest(".spatial-resize-handle")) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / zoomRef.current;
    const dy = (event.clientY - drag.startY) / zoomRef.current;
    drag.moved ||= Math.abs(dx) > 3 || Math.abs(dy) > 3;
    if (drag.moved) setCarried({ x: x + dx, y: y + dy });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag.moved && carried) onMove(canvasId, att.id, carried.x, carried.y);
    setCarried(null);
  }

  function onPointerCancel() {
    dragRef.current = null;
    setCarried(null);
  }

  function onResizePointerDown(event: React.PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { startX: event.clientX, originWidth: width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onResizePointerMove(event: React.PointerEvent) {
    const current = resizeRef.current;
    if (!current) return;
    const dx = (event.clientX - current.startX) / zoomRef.current;
    setStretched(Math.round(Math.max(PICTURE_MIN_W, current.originWidth + dx)));
  }

  function onResizePointerUp(event: React.PointerEvent) {
    const current = resizeRef.current;
    resizeRef.current = null;
    if (!current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (stretched !== null && stretched !== width) onResize(canvasId, att.id, stretched);
    setStretched(null);
  }

  const at = carried ?? { x, y };
  const w = stretched ?? width;

  return (
    <div
      className="canvas-picture"
      data-id={att.id}
      data-dragging={carried !== null}
      style={{ left: origin + at.x, top: origin + at.y, width: w }}
      role="img"
      aria-label={`Picture: ${att.name}`}
      // Focusable, so the keyboard's menu key reaches Remove picture.
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = null;
        onMenu(event, att);
      }}
    >
      {shot ? (
        <img
          className="canvas-picture-img"
          src={shot}
          alt=""
          draggable={false}
          onError={() => setBroken(shot === local ? local : "thumb")}
        />
      ) : (
        <div className="spatial-att-file">
          <IconFileType kind={fileIconKey(att.name, att.mime)} tier="inline" />
          <span className="card-file-kind mono">{fileKind(att.name, att.mime)}</span>
          <span className="card-file-name">{att.name}</span>
        </div>
      )}
      {movable && (
        <span
          className="spatial-resize-handle canvas-picture-resize"
          aria-hidden
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        />
      )}
    </div>
  );
});
