import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fileIconKey } from "../lib/files";
import { CLOSE_MS, EXIT, animates } from "../lib/motion";
import { IconFileType } from "./Icons";

/**
 * One line the capture bar says about a note, with one thing to do about it.
 *
 * Two things speak here, both information and neither a question: the bar
 * noticing that an address in its field is already in another note ("Saved
 * 3 days ago · Open"), and the receipt for a capture that landed somewhere
 * not on screen ("In Inbox · Go"). web/CLAUDE.md has both, under "The capture
 * bar: what it paints" and "Gestures, and what the app says back". A third
 * waits under them: a share carrying files, held for one tap ("2 pictures
 * shared · Save · Discard", `heldLine` in lib/useCapture.ts, audit SEC-1).
 *
 * It rides on the bar's own top edge, over the foot of the board, so its
 * arriving and going moves nothing — the grid is never pushed up by it, and
 * the bar keeps its one shape. It blocks nothing either: Save is where it
 * was, Enter still saves, and ignoring the line is always an answer.
 */
export interface BarLine {
  /** A new key is a new line, drawn afresh rather than edited in place. */
  key: string;
  said: string;
  /** The board a capture's receipt names, for the creature to say it whole
   *  ("Saved to Inbox"); a receipt with no offer is said there, not here. */
  place?: string;
  verb: string;
  act: () => void;
  /** Files the line is about, drawn as small squares ahead of the words. */
  files?: File[];
  /** A second, optional verb for the same note — the share's Inspiration offer. */
  also?: { verb: string; act: () => void };
  /** Its time is up: it fades, then `onGone` takes it off. */
  leaving?: boolean;
  onGone?: () => void;
}

/**
 * The one line that has nothing to offer: files are being made ready ("Adding
 * 3 files"), said so the bar is not silent while a HEIC takes seconds. It is
 * information only, so it has no verb; it goes the moment the work does.
 */
export interface BusyLine {
  key: string;
  said: string;
  busy: true;
}

export function CaptureLine({ line }: { line: BarLine | BusyLine }) {
  const el = useRef<HTMLDivElement | null>(null);
  const leaving = "busy" in line ? undefined : line.leaving;
  const onGone = "busy" in line ? undefined : line.onGone;
  useLayoutEffect(() => {
    if (!leaving) return;
    const node = el.current;
    if (!animates(node)) {
      onGone?.();
      return;
    }
    const out = node.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: CLOSE_MS,
      easing: EXIT,
      fill: "forwards",
    });
    out.onfinish = () => onGone?.();
    return () => out.cancel();
  }, [leaving, onGone]);

  return (
    <div ref={el} className="capture-line">
      {"files" in line && line.files && line.files.length > 0 && <FileSquares files={line.files} />}
      <span className="capture-line-said mono">{line.said}</span>
      {"busy" in line ? null : <CaptureLineVerbs line={line} />}
    </div>
  );
}

function CaptureLineVerbs({ line }: { line: BarLine }) {
  return (
    <>
      {/* A button of its own, so the words are never the target: the line is
          read far more often than it is acted on. Mousedown is swallowed so a
          caret in the field stays where it was. */}
      <button
        type="button"
        className="capture-line-verb mono"
        aria-label={`${line.verb}: ${line.said}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={line.act}
      >
        {line.verb}
      </button>
      {line.also && (
        <button
          type="button"
          className="capture-line-verb mono"
          aria-label={`${line.also.verb}: ${line.said}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={line.also.act}
        >
          {line.also.verb}
        </button>
      )}
    </>
  );
}

/** At most this many squares; the words beside them still count every file. */
const SQUARES = 4;

/**
 * The files waiting on the line, seen before they are saved (owner,
 * 2026-10-19): a picture as a small square of itself, anything else (or a
 * picture the browser cannot draw) as its family's mark. Never a name or a ✕ —
 * Remove beside them drops them all, as it always has.
 */
function FileSquares({ files }: { files: File[] }) {
  return (
    <span className="capture-line-files" aria-hidden>
      {files.slice(0, SQUARES).map((file, i) => (
        <FileSquare key={`${i}:${file.name}:${file.size}`} file={file} />
      ))}
    </span>
  );
}

function FileSquare({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (!file.type.startsWith("image/") || typeof URL.createObjectURL !== "function") return;
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  return (
    <span className="capture-line-file">
      {url && !broken ? (
        <img src={url} alt="" draggable={false} onError={() => setBroken(true)} />
      ) : (
        <IconFileType kind={fileIconKey(file.name, file.type)} tier="data" />
      )}
    </span>
  );
}
