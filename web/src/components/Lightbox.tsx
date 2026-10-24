import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cycleTab } from "../lib/focusTrap";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import type { Attachment } from "../types";
import {
  animates,
  clipOfRect,
  ENTER,
  EXIT,
  finishOnce,
  FULL_CLIP,
  OPEN_MS,
  CLOSE_MS,
  reducedMotion,
  SETTLE_BACK_MS,
  SLIDE_IN_MS,
  SLIDE_OUT_MS,
  stopAnimations,
} from "../lib/motion";
import { usePrint } from "../lib/usePrint";
import { drawPdf, isPdf } from "../lib/pdf";
import { fetchFile, passingBytes } from "../store/attachments";
import { fileSize, isVideo } from "../lib/files";
import type { VideoSource } from "../lib/wall";
import { ViewerFilm, ViewerVideo } from "./ViewerVideo";
import {
  IconClear,
  IconCopy,
  IconDelete,
  IconDownload,
  IconOpenNote,
  IconOpenSite,
  IconShare,
  IconStepBack,
  IconStepOn,
} from "./Icons";
import { canCopyPicture, copyPicture, useCopiedWith } from "../lib/clipboard";
import { canShare, shareFile } from "../lib/share";
import { robotSays } from "../lib/mascotMoments";
import { passingUrl, saveHref } from "../lib/saveFile";
import { IconCover, IconRotate } from "./ViewerIcons";

/** Enough of a document to know what it is and read the part that matters. */
const MAX_PAGES = 40;
/** Never draw a page coarser than this, however narrow the window is. */
const PAGE_MIN = 700;
/** And never finer than this, however wide or however dense the screen. */
const PAGE_MAX = 1400;

/**
 * How many pixels wide to draw a page: what it will actually be shown at, in
 * this window, on this screen.
 *
 * It used to be a constant 1400, which on a phone is three times the pixels the
 * page can possibly display — paid for in drawing time and in memory, on the
 * device with least of both.
 */
function pageWidth(box: HTMLElement): number {
  const css = box.clientWidth || 900;
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.round(Math.min(PAGE_MAX, Math.max(PAGE_MIN, css * dpr)));
}

type Drawing =
  | { kind: "drawing" }
  | { kind: "done"; drawn: number; total: number }
  | { kind: "failed" };

/**
 * A document, page by page, inside the same layer a picture opens into.
 *
 * Drawn rather than handed to the browser's own PDF viewer in an iframe:
 * Chrome on Android has no such viewer, and this feature exists for moving
 * files between the desktop and the phone, so a version that works on one of
 * them is not a version. Pages arrive one at a time, so the first is on screen
 * while the rest are still being drawn.
 *
 * Each page arrives as a compressed image rather than as the canvas it was
 * drawn on — see `drawPdf`. Its pixel shape comes with it and goes straight on
 * to the element, so the document has its full height from the first page and
 * the scrollbar tells the truth while the rest are still arriving, instead of
 * growing under the reader's thumb.
 */
function PdfPages({ att }: { att: Attachment }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<Drawing>({ kind: "drawing" });
  // The bytes, not the object URL the row is drawn from: pdf.js given a URL
  // fetches it, and a fetch of a `blob:` URL is a `connect-src` request the
  // deployed CSP refuses — which is why every document failed on the real site
  // and none of them failed here. This asks the store the file is already in.
  const id = att.id;
  const path = att.path;

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    let alive = true;
    /** Every URL handed over, so every one of them is given back. */
    const made: string[] = [];
    box.replaceChildren();
    setState({ kind: "drawing" });

    void fetchFile(att)
      .then((file) => {
        // Not here and not on the server. The row above already says so; the
        // viewer has nothing to draw either way.
        if (!file) throw new Error("no bytes");
        if (!alive) return null;
        return drawPdf(file, pageWidth(box), MAX_PAGES, () => alive, (page, n) => {
          made.push(page.url);
          const img = document.createElement("img");
          img.className = "pdf-page";
          img.src = page.url;
          // The shape up front, so the page reserves its own space before it
          // has decoded and nothing below it jumps when it does.
          img.width = page.width;
          img.height = page.height;
          img.alt = `Page ${n}`;
          img.draggable = false;
          // Only the pages near the screen are ever decoded, and the browser is
          // free to drop them again once they are not. This is what keeps a
          // long document costing about one page of memory however long it is.
          img.loading = "lazy";
          img.decoding = "async";
          box.append(img);
        });
      })
      .then((got) => {
        if (alive && got) setState({ kind: "done", ...got });
      })
      .catch(() => alive && setState({ kind: "failed" }));

    return () => {
      alive = false;
      // The layer is going; the pages go with it. Without this every document
      // opened holds its pages in memory until the tab is closed.
      box.replaceChildren();
      for (const url of made) URL.revokeObjectURL(url);
    };
    // `att` is a snapshot held in the open note's state for the life of this
    // layer; what could ever make it a different file is its id, and what could
    // make the same file reachable a different way is its path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, path]);

  const say =
    state.kind === "drawing"
      ? "drawing…"
      : state.kind === "failed"
        ? "Can't show this here. Save it to open it elsewhere."
        : state.total > state.drawn
          ? `first ${state.drawn} of ${state.total} pages`
          : null;

  return (
    <div className="pdf">
      <div className="pdf-pages" ref={host} />
      {say && (
        <p className="pdf-note mono" data-failed={state.kind === "failed"}>
          {say}
        </p>
      )}
    </div>
  );
}

/** How far in a picture may be taken. Past this a phone photograph is grain. */
const ZOOM_MAX = 6;
/** Under this much travel a press is a tap, not a drag — a thumb is not still. */
const TAP_SLOP = 6;
/** Two taps closer together than this are one double tap: in, at the finger. */
const DOUBLE_TAP_MS = 260;
/** How far a double tap, or a key, takes the picture in. */
const DOUBLE_ZOOM = 2.5;
const KEY_ZOOM = 1.4;
/** How far a sideways drag must travel before it means the file beside this one. */
const STEP_MIN = 60;
/** How far the picture gives at the ends of the note, where there is nowhere to go. */
const STEP_EDGE = 0.12;
/** How long past `CLOSE_MS` a close whose animation never reports is ended anyway. */
const LATE_CLOSE_MS = 2000;

/** Clamp, spelled once. */
function hold(n: number, low: number, high: number): number {
  return n < low ? low : n > high ? high : n;
}

/**
 * The picture itself, and the two ways of getting closer to it.
 *
 * A photograph opened on a phone used to be the size of the screen and no
 * larger, whatever was written on the receipt in it. The browser's own pinch
 * could not rescue it either: the note sheet this layer sits inside declares
 * `touch-action: pan-y`, which by itself tells the browser a second finger is
 * not a zoom, and an installed PWA has no zoom of its own to fall back on. So
 * the viewer does it: **pinch** on a touch screen, **wheel** on a desktop,
 * drag to pan once there is more picture than screen.
 *
 * It is direct manipulation and not motion, so it is written the way the
 * canvas's pinch is written (`CanvasSheet.tsx`) — live pointers in a ref map,
 * the transform painted straight onto the element, no React state per frame
 * and no easing on anything a finger is holding. The one piece of state is
 * whether we are zoomed at all, which changes what a tap means and what the
 * cursor says, and changes at most twice a gesture.
 *
 * A tap is respent inside this screen: at fit it closes the viewer, as tapping
 * anything in this layer does; zoomed in it goes back to fit instead, so there
 * is always one gesture back out and it is never the one that loses your place
 * by accident.
 *
 * A sideways drag is respent the same way and under the same licence — a mode
 * may respend the gesture budget inside its own screen (`web/CLAUDE.md`), and
 * the note's own paging swipe is frozen for as long as this layer is up. At the
 * fit it walks to the file beside this one, damped at the ends of the note the
 * way the sheet is damped at the ends of the board; zoomed in the same finger
 * pans, because then there is more picture than frame and moving it is what the
 * drag is obviously for. Which of the two a touch is gets decided once, in its
 * first ten pixels, and stays decided.
 */
/**
 * What the layer around the picture may ask of it: the keys and the bar's
 * Rotate and Copy act on the picture on screen, whose zoom and turn live here
 * in refs, never in the layer's state.
 */
interface ShotControl {
  zoomBy: (factor: number) => void;
  reset: () => void;
  rotate: () => void;
  /** The element as it is drawn, and how far it is turned (quarter turns). */
  image: () => HTMLImageElement | null;
  turn: () => number;
}

function ZoomShot({
  src,
  file,
  alt,
  control,
  onDismiss,
  canPrev,
  canNext,
  onStep,
}: {
  src: string;
  /**
   * Which file this is. It is not drawn anywhere — it is what tells the reset
   * below that the picture *changed*, which `src` cannot always say: two files
   * neither of which has arrived yet are both drawn from the same empty string,
   * and a walk between them would otherwise leave the last one's swipe still
   * parked off the side of the screen.
   */
  file: string;
  alt: string;
  onDismiss: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** -1 for the file before this one, 1 for the one after. */
  onStep: (dir: -1 | 1) => void;
  control?: React.MutableRefObject<ShotControl | null>;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const shot = useRef<HTMLImageElement | null>(null);
  /** What is painted right now. Never in React state — a pinch writes it ~60×/s. */
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const pan = useRef<{ x: number; y: number; fromX: number; fromY: number } | null>(null);
  /** Where the one finger went down, so a drag is told from a tap even at fit,
      where there is no panning to measure it by. */
  const press = useRef<{ x: number; y: number } | null>(null);
  /** Set by any move that travelled, so the pointerup ending it is not a tap. */
  const travelled = useRef(false);
  /**
   * How far a sideways drag at the fit has carried the picture. Deliberately
   * not `view.x`: that one is the pan *inside* a picture bigger than its frame,
   * and `settle` pins it to zero whenever there is no more picture than frame —
   * which is exactly when this one is allowed to be anything but zero.
   */
  const drift = useRef(0);
  /** Which way this touch was decided to be going. Decided once, then kept. */
  const axis = useRef<"?" | "x" | "y">("?");
  /** Which side the arriving picture comes in from, set by the swipe that left. */
  const arriving = useRef(0);
  /** Calls off the fallback that commits a swipe a backgrounded tab never
   *  finished (`finishOnce`). */
  const late = useRef<(() => void) | null>(null);
  const [zoomed, setZoomed] = useState(false);
  /**
   * Quarter turns clockwise, for reading a photo taken sideways. The view's
   * own, never written to the file: it goes back upright on the next picture.
   */
  const turn = useRef(0);
  /** A tap at the fit waits `DOUBLE_TAP_MS` to close, in case it is the first of two. */
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const tapClose = useRef<number | null>(null);
  // A picture that arrives late comes up out of the dark, once per file.
  const { ref: printRef, onLoad: printLoad } = usePrint(file);
  const setShot = useCallback(
    (node: HTMLImageElement | null) => {
      shot.current = node;
      printRef(node);
    },
    [printRef],
  );

  useEffect(
    () => () => {
      late.current?.();
      if (tapClose.current !== null) window.clearTimeout(tapClose.current);
    },
    [],
  );

  /** The element's box as it stands on screen: a quarter turn swaps its sides. */
  function drawnSize(el: HTMLImageElement): { w: number; h: number } {
    return turn.current % 2 ? { w: el.offsetHeight, h: el.offsetWidth } : { w: el.offsetWidth, h: el.offsetHeight };
  }

  /** Keep the picture's edges out of the frame: there is never paper showing
      beside a picture bigger than its box. At fit this pins it dead centre. */
  const settle = useCallback(() => {
    const el = shot.current;
    const frame = box.current;
    if (!el || !frame) return;
    const v = view.current;
    const drawn = drawnSize(el);
    const spanX = Math.max(0, (drawn.w * v.scale - frame.clientWidth) / 2);
    const spanY = Math.max(0, (drawn.h * v.scale - frame.clientHeight) / 2);
    v.x = hold(v.x, -spanX, spanX);
    v.y = hold(v.y, -spanY, spanY);
  }, []);

  /**
   * The picture's size at the fit: as large as the frame allows, its own shape
   * kept — larger than its own pixels where it has to be. `max-width` alone
   * only ever shrinks, so a wall picture (stored 480px wide) or a thumbnail
   * standing in for bytes not yet here opened as a postage stamp in the middle
   * of the screen. The size goes on the element, not a scale on the transform:
   * `settle` and the pinch measure the element's own box, and the transform is
   * theirs. A picture with no intrinsic size (an SVG without one, or nothing
   * decoded yet) is left as the CSS draws it.
   */
  const fit = useCallback(() => {
    const el = shot.current;
    const frame = box.current;
    if (!el || !frame) return;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    // Turned a quarter, the picture's width runs up the screen.
    const [across, down] = turn.current % 2 ? [h, w] : [w, h];
    const k = w && h ? Math.min(frame.clientWidth / across, frame.clientHeight / down) : 0;
    if (!(k > 0) || !Number.isFinite(k)) {
      el.style.removeProperty("width");
      el.style.removeProperty("height");
      return;
    }
    el.style.width = `${Math.floor(w * k)}px`;
    el.style.height = `${Math.floor(h * k)}px`;
  }, []);

  const paint = useCallback(() => {
    const el = shot.current;
    if (!el) return;
    const v = view.current;
    el.style.transform = `translate3d(${v.x + drift.current}px, ${v.y}px, 0) scale(${v.scale}) rotate(${turn.current * 90}deg)`;
    setZoomed(v.scale > 1.01);
  }, []);

  /**
   * Scale to `next`, keeping whatever sits under (ax, ay) exactly where it is.
   * One formula for both the pinch's midpoint and the wheel's pointer, so the
   * two can never drift apart — the canvas's `worldFromClient` argument.
   */
  const scaleAbout = useCallback(
    (next: number, ax: number, ay: number) => {
      const frame = box.current;
      if (!frame) return;
      const rect = frame.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const v = view.current;
      const scale = hold(next, 1, ZOOM_MAX);
      const ux = (ax - cx - v.x) / v.scale;
      const uy = (ay - cy - v.y) / v.scale;
      v.scale = scale;
      v.x = ax - cx - ux * scale;
      v.y = ay - cy - uy * scale;
      settle();
      paint();
    },
    [settle, paint],
  );

  useEffect(() => {
    if (!control) return;
    const middle = () => {
      const rect = box.current?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
    };
    control.current = {
      zoomBy: (factor) => {
        const m = middle();
        scaleAbout(view.current.scale * factor, m.x, m.y);
      },
      reset: () => {
        view.current = { scale: 1, x: 0, y: 0 };
        paint();
      },
      rotate: () => {
        turn.current = (turn.current + 1) % 4;
        view.current = { scale: 1, x: 0, y: 0 };
        fit();
        settle();
        paint();
      },
      image: () => shot.current,
      turn: () => turn.current,
    };
    return () => {
      control.current = null;
    };
  }, [control, scaleAbout, paint, fit, settle]);

  /**
   * A new picture starts at fit, however far into the last one we were — and,
   * when a swipe is what brought it, it comes in from the side the last one
   * went out of, so the two are one movement rather than a cut.
   *
   * The cancel is not housekeeping: the picture that left is parked off-screen
   * under a filled animation, and this is the same element arriving back.
   */
  useLayoutEffect(() => {
    const el = shot.current;
    stopAnimations(el);
    view.current = { scale: 1, x: 0, y: 0 };
    drift.current = 0;
    turn.current = 0;
    if (el?.complete) fit();
    paint();
    const dir = arriving.current;
    arriving.current = 0;
    if (!dir || !animates(el)) return;
    const width = el.getBoundingClientRect().width || window.innerWidth || 1;
    el.animate(
      [
        { transform: `translate3d(${dir * width}px, 0, 0)`, opacity: 0 },
        { transform: "translate3d(0px, 0, 0)", opacity: 1 },
      ],
      { duration: SLIDE_IN_MS, easing: ENTER },
    );
    // Keyed on `file` alone, never on `src`. The same picture is handed a new
    // object URL whenever its bytes change hands — the upload finishing writes
    // `path`, and `useFileUrl` swaps the URL for it — and keyed on `src` that
    // snapped a pinch back to the fit in the middle of reading the receipt.
  }, [file, fit, paint]);

  /** The window turning, or a keyboard closing, changes what "fits" means. */
  useEffect(() => {
    function onResize() {
      fit();
      settle();
      paint();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit, settle, paint]);

  /** Wheel is bound by hand: React registers `wheel` passively at the root, so
      a handler passed as a prop cannot stop the page from doing its own thing
      with it. Bound here, non-passive, it can. */
  useEffect(() => {
    const frame = box.current;
    if (!frame) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      // A trackpad pinch arrives as a ctrl-wheel and is finer-grained than a
      // mouse notch; both end up as the same multiplier per unit of scroll.
      const step = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
      scaleAbout(view.current.scale * step, e.clientX, e.clientY);
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [scaleAbout]);

  function twoPoints(): [{ x: number; y: number }, { x: number; y: number }] | null {
    const points = Array.from(pointers.current.values()).slice(0, 2);
    return points.length < 2 ? null : [points[0], points[1]];
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // The sheet under this layer reads pointers of its own for the swipe to
    // the next note. Nothing that happens on the picture is its business.
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const two = twoPoints();
    if (two) {
      // A second finger always wins, exactly as on the canvas: the pan it
      // interrupts is dropped rather than left fighting the pinch.
      pan.current = null;
      travelled.current = true;
      pinch.current = {
        dist: Math.hypot(two[1].x - two[0].x, two[1].y - two[0].y) || 1,
        scale: view.current.scale,
      };
      return;
    }
    travelled.current = false;
    axis.current = "?";
    press.current = { x: e.clientX, y: e.clientY };
    // Captured whether this finger turns out to be panning or walking to the
    // next file: either way the drag must survive leaving the element, and a
    // mouse dragged off the edge of a picture is the ordinary case.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (view.current.scale <= 1.01) return;
    pan.current = { x: e.clientX, y: e.clientY, fromX: view.current.x, fromY: view.current.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const state = pinch.current;
    const two = twoPoints();
    if (state && two) {
      const dist = Math.hypot(two[1].x - two[0].x, two[1].y - two[0].y) || 1;
      scaleAbout(
        state.scale * (dist / state.dist),
        (two[0].x + two[1].x) / 2,
        (two[0].y + two[1].y) / 2,
      );
      return;
    }
    const from = press.current;
    if (from && (Math.abs(e.clientX - from.x) > TAP_SLOP || Math.abs(e.clientY - from.y) > TAP_SLOP)) {
      travelled.current = true;
    }
    const grip = pan.current;
    // The scale is asked as well as the grip: lift one finger out of a pinch
    // and there is no pan under way, but there is still more picture than
    // frame — and a drag there is looking around it, not leaving it.
    if (!grip && from && view.current.scale <= 1.01 && (canPrev || canNext)) {
      // At the fit there is nothing to pan, so a horizontal drag is the walk to
      // the file beside this one. The first ten pixels settle which it is.
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (axis.current === "?" && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        axis.current = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
      }
      if (axis.current === "x") {
        // Nothing that way: the picture barely gives, which is how a physical
        // thing says "this is the last one" without a message.
        const atEnd = (dx < 0 && !canNext) || (dx > 0 && !canPrev);
        drift.current = atEnd ? dx * STEP_EDGE : dx;
        paint();
      }
      return;
    }
    if (!grip) return;
    view.current.x = grip.fromX + (e.clientX - grip.x);
    view.current.y = grip.fromY + (e.clientY - grip.y);
    settle();
    paint();
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    // Asked rather than assumed: only the first finger down was captured, and
    // releasing a pointer that was not throws in a real browser.
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      const from = press.current;
      const walked = axis.current === "x" && from ? e.clientX - from.x : 0;
      pan.current = null;
      press.current = null;
      axis.current = "?";
      if (walked) land(walked);
    }
  }

  /**
   * The end of a sideways drag: the next file, thrown the rest of the way off,
   * or this one landing back where it was.
   *
   * The throw carries on from wherever the finger left the picture rather than
   * snapping back first — the drag and the departure are one movement, which is
   * the same rule the note sheet's own swipe is written to (`useNoteSwiping`).
   */
  function land(dx: number) {
    const el = shot.current;
    const goingNext = dx < 0;
    const reachable = goingNext ? canNext : canPrev;
    const held = el?.style.transform ?? "";
    if (Math.abs(dx) < STEP_MIN || !reachable) {
      drift.current = 0;
      paint();
      if (!animates(el)) return;
      el.animate([{ transform: held }, { transform: el.style.transform }], {
        duration: SETTLE_BACK_MS,
        easing: ENTER,
      });
      return;
    }
    const dir = goingNext ? -1 : 1;
    // It leaves to one side, so the next one comes in from the other.
    arriving.current = -dir;
    const step = () => onStep(goingNext ? 1 : -1);
    if (!animates(el)) {
      step();
      return;
    }
    const width = el.getBoundingClientRect().width || window.innerWidth || 1;
    const out = el.animate(
      [
        { transform: held, opacity: 1 },
        { transform: `translate3d(${dir * width}px, 0, 0)`, opacity: 0 },
      ],
      { duration: SLIDE_OUT_MS, easing: EXIT, fill: "forwards" },
    );
    // A tab switched away mid-animation never fires onfinish, and the picture
    // would then be left off-screen with nothing to bring the next one in.
    late.current = finishOnce(out, step, SLIDE_OUT_MS + 120);
  }

  function onClick(e: React.MouseEvent) {
    // Never the layer's tap-to-close: this element decides what a tap on the
    // picture means, and the answer depends on how far in we are.
    e.stopPropagation();
    if (travelled.current) return;
    const now = Date.now();
    const before = lastTap.current;
    const second =
      before !== null &&
      now - before.at < DOUBLE_TAP_MS &&
      Math.abs(e.clientX - before.x) < TAP_SLOP * 4 &&
      Math.abs(e.clientY - before.y) < TAP_SLOP * 4;
    if (tapClose.current !== null) {
      window.clearTimeout(tapClose.current);
      tapClose.current = null;
    }
    if (second) {
      // The second of two: in, at the finger — or, already in, back to fit.
      lastTap.current = null;
      if (view.current.scale > 1.01) {
        view.current = { scale: 1, x: 0, y: 0 };
        paint();
      } else {
        scaleAbout(DOUBLE_ZOOM, e.clientX, e.clientY);
      }
      return;
    }
    if (view.current.scale > 1.01) {
      // Zoomed, one tap is the way back to the fit, at once; it does not start
      // a double tap, or a quick second one would go straight back in.
      lastTap.current = null;
      view.current = { scale: 1, x: 0, y: 0 };
      paint();
      return;
    }
    lastTap.current = { at: now, x: e.clientX, y: e.clientY };
    // At the fit a tap closes — once it is sure no second tap is coming.
    tapClose.current = window.setTimeout(() => {
      tapClose.current = null;
      lastTap.current = null;
      onDismiss();
    }, DOUBLE_TAP_MS);
  }

  return (
    <div
      className="lightbox-frame"
      ref={box}
      data-zoomed={zoomed}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
    >
      <img
        className="lightbox-shot"
        ref={setShot}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => {
          printLoad(e);
          // Every new source lands here — the thumbnail, then the file's own
          // bytes, then the next file walked to — each with its own shape.
          fit();
          settle();
          paint();
        }}
      />
    </div>
  );
}

/**
 * A film the note carries, opened from the Inspiration wall: streamed from the
 * server (or played from this device's bytes), its frame standing until the
 * stream has one, and words — never a dead black box — where this browser
 * cannot play it. Clicks stay inside, so the controls do not close the layer.
 *
 * The box is `ViewerFilm`, the one a link's video plays in. Until the bytes
 * have an address the frame stands alone and says nothing — that is waiting,
 * not failing — and the element keeps its own menu, because this film, unlike
 * a link's stream, is the note's to save.
 */
function FileFilm({ src, poster, title }: { src: string; poster: string; title: string }) {
  const playable = src !== "" && !src.startsWith("data:");
  return (
    <ViewerFilm
      src={playable ? src : null}
      poster={poster}
      title={title}
      autoplay={!reducedMotion()}
      unplayable={null}
      failed="Won't play here. Save it to watch."
      holdClicks
    />
  );
}

/**
 * A link's picture, opened full screen from the Inspiration wall. The viewer
 * was written for a note's attachments; a tile on the wall is a note whose
 * picture is a *page's*, so it opens through here with the page's address (for
 * Open site) and, for a video, the source it may play.
 */
export interface ViewerLink {
  /** The note behind the tile — what "Open note" opens. */
  noteId: string;
  title: string;
  href: string;
  site: string;
  /** The stored picture; the poster of a video. */
  poster: string;
  video: VideoSource | null;
}

/**
 * A picture, at the size of the screen.
 *
 * The note shows the image inside the measure, which is the right size for
 * reading past it and the wrong size for looking at it. Tapping it should do
 * what tapping a card does — and so it is built the same way, and for the same
 * reason: the layer is full-screen from the first frame and animates its
 * *clip* out of the rect the image occupied. Nothing is scaled, so the picture
 * is never stretched on the way in or squashed on the way out.
 *
 * It is deliberately not a second history entry. Back closes the top thing on
 * screen and that is this, handled by the app's one entry — see
 * `useDismissOnBack` and `registerInner` in App.tsx.
 *
 * A note carrying several files is walked from inside the layer rather than by
 * closing it and finding the next row: **swipe** the picture, **arrow keys** on
 * a desktop, and a pair of chevrons drawn only where there is a pointer to use
 * them. The note owns the list and the position — this layer is handed where it
 * stands and says which way somebody asked to go, which is what keeps the walk
 * and the rows in the same order without either knowing about the other.
 */
interface Props {
  /** The file being looked at. Exactly one of `att` and `link` is given. */
  att?: Attachment;
  /** The link's picture being looked at (the Inspiration wall). */
  link?: ViewerLink;
  /** Opens the note behind what is on screen — drawn only when handed. */
  onOpenNote?: () => void;
  /** The real bytes if this device has them; the thumbnail is the fallback. */
  src: string;
  /** Where the image sat in the note, so it can grow out of exactly that. */
  origin: DOMRect | null;
  /**
   * Hands the closing gesture upward, so the phone's Back can play it rather
   * than cutting straight to the grid. Back must animate the way the tap does.
   */
  register: (close: (() => void) | null) => void;
  onClose: () => void;
  /** The actual file bytes URL for downloading. May be null if not fetched. */
  downloadUrl?: string | null;
  /** Where this file stands among the files this note carries that can be
   *  opened at all, and how many there are. `count` is 1 when it is alone. */
  at: number;
  count: number;
  /** Show the one at this index instead. The note owns the list, so it owns
   *  the walk too — this layer only says which way somebody asked to go. */
  onStep: (next: number) => void;
  /**
   * Makes this picture the note's first file — the one its card and its wall
   * tile wear. Drawn only when handed, and not on the picture already first.
   */
  onCover?: () => void;
  isCover?: boolean;
  /** What the picture is to a screen reader; its name when left out. */
  alt?: string;
  /**
   * Asks to take this file off its note — the note closes this layer and asks
   * first. Drawn only when handed: an open note's tile carries no × of its own
   * any more, so this is where a picture is removed; the wall hands nothing.
   */
  onRemove?: () => void;
}

export function Lightbox({
  att,
  link,
  onOpenNote,
  src,
  origin,
  register,
  onClose,
  downloadUrl,
  at,
  count,
  onStep,
  onCover,
  isCover = false,
  alt,
  onRemove,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const shotControl = useRef<ShotControl | null>(null);
  const [copied, copy] = useCopiedWith(copyPicture);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useRestoreFocus();
  const name = link?.title ?? att?.name ?? "";
  const key = link?.noteId ?? att?.id ?? "";
  const document_ = att ? isPdf(att.mime, att.name) : false;
  const canPrev = at > 0;
  const canNext = at < count - 1;
  /**
   * The rect this layer grew out of belongs to the file it was opened on. Walk
   * to the one beside it and there is no longer anything on screen to shrink
   * back into, so the way out becomes a fade — the same answer the app already
   * gives a note whose card it cannot find.
   */
  const opened = useRef(key);
  const from = key === opened.current ? origin : null;
  // Set once the close animation is running, so a second tap cannot start it
  // again and leave two animations fighting over the same clip.
  const leaving = useRef(false);
  /**
   * The fallback that closes a layer whose animation a backgrounded tab never
   * finished — held, so it can be called off.
   *
   * It was fired and forgotten, and an unowned timer holding `onClose` is a
   * loaded gun aimed at the *next* layer: close a picture and open another
   * attachment inside `CLOSE_MS + LATE_CLOSE_MS`, and the timer from the first one shuts
   * the second, which reads as a viewer that will not stay open. The animation
   * finishing is what makes it unnecessary, and unmounting is what makes it
   * meaningless, so both call it off.
   */
  const late = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      late.current?.();
    },
    [],
  );

  useLayoutEffect(() => {
    closeRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!animates(el)) return;
    const a = el.animate(
      origin
        ? [{ clipPath: clipOfRect(origin) }, { clipPath: FULL_CLIP }]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: OPEN_MS, easing: ENTER, fill: "both" },
    );
    return () => a.cancel();
  }, [origin]);

  const close = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    const el = ref.current;
    if (!animates(el)) {
      onClose();
      return;
    }
    const a = el.animate(
      from
        ? [{ clipPath: FULL_CLIP }, { clipPath: clipOfRect(from) }]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: CLOSE_MS, easing: EXIT, fill: "both" },
    );
    // A backgrounded tab never fires onfinish, and this must not be able to
    // strand itself over the note. Two seconds, not 140 ms past the close: it
    // is only for a tab nobody is looking at, and at 140 ms a busy machine cut
    // a close that was still running (the server's test run, 2026-10-09).
    late.current = finishOnce(a, onClose, CLOSE_MS + LATE_CLOSE_MS);
  }, [from, onClose]);

  /** One file along, in either direction, from wherever the ask came from. */
  const step = useCallback(
    (dir: -1 | 1) => {
      const next = at + dir;
      if (next < 0 || next >= count) return;
      onStep(next);
    },
    [at, count, onStep],
  );

  useEffect(() => {
    register(close);
    return () => register(null);
  }, [register, close]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        return;
      }
      // Closer, further, back to the whole picture, a quarter turn — only for
      // a picture (a document scrolls, a film has its own controls), and never
      // with a modifier, which is the browser's own zoom.
      const shotNow = shotControl.current;
      if (shotNow && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const act =
          e.key === "+"
            ? () => shotNow.zoomBy(KEY_ZOOM)
            : e.key === "-"
              ? () => shotNow.zoomBy(1 / KEY_ZOOM)
              : e.key === "0"
                ? () => shotNow.reset()
                : e.key === "r"
                  ? () => shotNow.rotate()
                  : null;
        if (act) {
          e.preventDefault();
          e.stopImmediatePropagation();
          act();
          return;
        }
      }
      // The desktop half of the swipe. Taken off the window and stopped dead
      // for the same reason Escape is: the grid's own arrow walk is listening
      // underneath, and the thing on screen is this one.
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (count < 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, step, count]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab") return;

    cycleTab(e, ref.current);
  }

  /**
   * The picture on screen as a PNG, drawn the way it is turned. Drawn from the
   * element rather than fetched: a fetch of a `blob:` or `data:` address is a
   * connection the deployed CSP refuses, and the element already holds the
   * decoded picture. PNG because it is the one picture type every browser's
   * clipboard takes.
   */
  async function pictureNow(): Promise<Blob | null> {
    const control = shotControl.current;
    const img = control?.image();
    if (!control || !img || !img.naturalWidth) return null;
    const odd = control.turn() % 2 === 1;
    const canvas = document.createElement("canvas");
    canvas.width = odd ? img.naturalHeight : img.naturalWidth;
    canvas.height = odd ? img.naturalWidth : img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((control.turn() * Math.PI) / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  const canCopy = canCopyPicture();
  const shares = canShare();
  const picture = Boolean(link ? !link.video : att && !document_ && !isVideo(att));

  async function onCopyPicture(e: React.MouseEvent) {
    e.stopPropagation();
    // The drawing is handed over still in progress — `copyPicture` says why.
    if (!(await copy(pictureNow()))) console.error("could not copy the picture");
  }

  /** This one file — the note's own bytes, or the picture as drawn — through the browser's share sheet. */
  async function sharePicture(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      let file: File | null = null;
      if (att) {
        const blob = await fetchFile(att);
        if (blob) file = new File([blob], att.name, { type: att.mime || blob.type });
      } else {
        const blob = await pictureNow();
        if (blob) file = new File([blob], `${(link?.title || "picture").slice(0, 60)}.png`, { type: "image/png" });
      }
      if (!file) return;
      if ((await shareFile(file, name)) === "failed") console.error("could not share the picture");
    } catch (error) {
      console.error("could not share the picture", error);
    }
  }

  async function save(e: React.MouseEvent) {
    e.stopPropagation();
    if (!att) return;
    // A streamed film has no address of this page's own to save from — the
    // stream is the server's, where `download` is ignored — so its bytes are
    // fetched for the save and handed over, never kept (audit BUG-6: on the
    // wall's viewer Save on a film did nothing at all).
    let href = downloadUrl ?? null;
    if (!href) {
      const blob = await passingBytes(att);
      if (!blob) {
        // Said by the creature, the app's voice for a notice with no button.
        robotSays("Uh-oh. Couldn't save that file. The server didn't answer.");
        return;
      }
      href = passingUrl(blob);
    }
    saveHref(href, att.name);
  }

  return (
    <div
      className="lightbox"
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={close}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      data-doc={document_}
    >
      <button
        ref={closeRef}
        type="button"
        className="iconbtn lightbox-close"
        aria-label="Close viewer"
        title="Close"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <IconClear />
      </button>
      <div className="lightbox-content">
        {link ? (
          // A video is played in place when its source is one we play; the
          // poster-only fallback is `ViewerVideo`'s own. Everything else is the
          // picture, zoomable like any photograph.
          link.video ? (
            <ViewerVideo
              key={link.noteId}
              video={link.video}
              poster={link.poster}
              title={link.title}
              autoplay={!reducedMotion()}
            />
          ) : (
            <ZoomShot
              src={src}
              file={link.noteId}
              alt={link.title}
              control={shotControl}
              onDismiss={close}
              canPrev={canPrev}
              canNext={canNext}
              onStep={step}
            />
          )
        ) : att && document_ ? (
          <PdfPages att={att} />
        ) : att && isVideo(att) ? (
          <FileFilm key={att.id} src={src} poster={att.thumb ?? ""} title={att.name} />
        ) : att ? (
          <ZoomShot
            src={src}
            file={att.id}
            alt={alt ?? att.name}
            control={shotControl}
            onDismiss={close}
            canPrev={canPrev}
            canNext={canNext}
            onStep={step}
          />
        ) : null}
      </div>
      {/* The pointer's way along, and it is drawn only where there is a pointer
          (see .lightbox-step): a touch screen has the swipe and a keyboard has
          the arrows, and two marks parked over the middle of every photograph
          is furniture in a room with one thing in it. */}
      {count > 1 && (
        <>
          <button
            type="button"
            className="iconbtn lightbox-step lightbox-step-back"
            aria-label="Previous file"
            title="Previous"
            disabled={!canPrev}
            onClick={(e) => {
              e.stopPropagation();
              step(-1);
            }}
          >
            <IconStepBack />
          </button>
          <button
            type="button"
            className="iconbtn lightbox-step lightbox-step-on"
            aria-label="Next file"
            title="Next"
            disabled={!canNext}
            onClick={(e) => {
              e.stopPropagation();
              step(1);
            }}
          >
            <IconStepOn />
          </button>
        </>
      )}
      <div className="lightbox-bar mono" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{name}</span>
        {att && <span className="lightbox-size">{fileSize(att.size)}</span>}
        {link && <span className="lightbox-size">{link.site}</span>}
        {/* Where you are in the note's files. It is the only thing that says
            there is anything to walk to, so it is drawn wherever it is true. */}
        {count > 1 && (
          <span className="lightbox-count">
            {at + 1} / {count}
          </span>
        )}
        <span className="spacer" />
        {link && (
          <a
            className="iconbtn"
            href={link.href}
            target="_blank"
            rel="noopener"
            aria-label={`Open site ${link.site}`}
            title="Open site"
            onClick={(e) => e.stopPropagation()}
          >
            <IconOpenSite />
          </a>
        )}
        {onOpenNote && (
          <button
            type="button"
            className="iconbtn"
            aria-label="Open note"
            title="Open note"
            onClick={(e) => {
              e.stopPropagation();
              onOpenNote();
            }}
          >
            <IconOpenNote />
          </button>
        )}
        {picture && (
          <button
            type="button"
            className="iconbtn"
            aria-label="Turn a quarter"
            title="Rotate (R)"
            onClick={(e) => {
              e.stopPropagation();
              shotControl.current?.rotate();
            }}
          >
            <IconRotate />
          </button>
        )}
        {picture && canCopy && (
          <button
            type="button"
            className="iconbtn"
            aria-label={copied ? "Copied" : "Copy picture"}
            title="Copy picture"
            onClick={(e) => void onCopyPicture(e)}
          >
            <IconCopy on={copied} />
          </button>
        )}
        {shares && (picture || att) && (
          <button
            type="button"
            className="iconbtn"
            aria-label={`Share ${name}`}
            title="Share"
            onClick={(e) => void sharePicture(e)}
          >
            <IconShare tier="inline" />
          </button>
        )}
        {onCover && !isCover && (
          <button
            type="button"
            className="iconbtn"
            aria-label="Use as the card's picture"
            title="Use as cover"
            onClick={(e) => {
              e.stopPropagation();
              onCover();
            }}
          >
            <IconCover />
          </button>
        )}
        {att && (
          <button
            type="button"
            className="iconbtn"
            aria-label={`Save ${att.name}`}
            title="Save"
            disabled={!downloadUrl && !att.path}
            onClick={(e) => void save(e)}
          >
            <IconDownload />
          </button>
        )}
        {att && onRemove && (
          <button
            type="button"
            className="iconbtn"
            aria-label={`Remove ${att.name}`}
            title="Remove from note"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <IconDelete tier="inline" />
          </button>
        )}
      </div>
    </div>
  );
}
