import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CLOSE_MS, ENTER, EXIT, OPEN_MS, animates, reducedMotion } from "../lib/motion";
import { onSettingsChange } from "../lib/settings";

/**
 * What the header's creature says: one short sentence in a speech bubble
 * beside it, with at most one thing to do about it (2026-10-16, owner
 * approved — option B of the mockups: what happened, and the verb beside it).
 *
 * It stands where the wordmark stood. The undo offer moved here from the
 * capture bar, and with it every short notice the header and the bar used to
 * carry in words of their own: "Saved to Inbox · Go", "Couldn't sync ·
 * Details", "A new version is ready · Reload", the connection coming and
 * going, and the creature's answer to a poke. What is said is decided in
 * `lib/useSpeech.ts`; this only draws it.
 *
 * The bubble belongs to the drawing, so it is drawn in the creature's own
 * tones (`--mascot-*`) with the same boiling line, as one outline with its
 * tail (`bubblePath`), and its corners are the drawing's curves rather than a
 * radius on a box. The words in it are not:
 * they are the app's reading face, flat and still, because a sentence somebody
 * has to read is never allowed to wobble.
 *
 * It arrives out of the creature's mouth by clip, and goes back the same way —
 * a container changes its clip, never its scale.
 *
 * It is not a live region. A region minted with its words already in it is
 * the one assistive technology misses, so the header's permanently mounted
 * regions say everything this says (`HeaderWords.tsx`).
 */
export interface Said {
  /** A new key is a new sentence: it arrives afresh rather than being edited in place. */
  key: string;
  words: string;
  /** The one thing to do about it. */
  act?: {
    verb: string;
    /** The button's whole name, for a reader and the hover. */
    label: string;
    run: () => void;
    /** A key hint drawn inside the button, where a keyboard exists. */
    hint?: ReactNode;
  };
  /** A countdown drawn under the words for this long — the undo window. */
  clockMs?: number;
  /** The creature is asking, not telling: an undo offer. */
  ask?: boolean;
  /** Words in the line set in bold, by weight alone: a weather line's facts. */
  strong?: readonly string[];
  /** Waiting on an answer: the closing "…" is drawn as dots that count up and back. */
  busy?: boolean;
}

/** Where the bubble grows from: the tail, at the creature's mouth. */
const SHUT = "circle(0% at 0% 50%)";
const OPEN = "circle(200% at 0% 50%)";

/** Half the line's width: the outline is drawn inside the box, never clipped. */
const HALF_LINE = 1.5;
/** How far the tail stands out to the left of the bubble's body. */
const TAIL = 10;
/** Half the tail's height where it meets the body. */
const TAIL_HALF = 6;
/** The body's corners — the drawing's own curve, as the creature's shell has one. */
const CORNER = 10;

/**
 * The bubble and its tail as **one** outline, so the line runs unbroken round
 * both (drawn as two shapes, the tail read as a separate arrow stuck on, with
 * a seam where they met). Clockwise from the top-left corner, which is also
 * where the countdown starts drawing it on. Without a tail (a short screen,
 * where nothing stands beside it) it is the body alone.
 */
export function bubblePath(w: number, h: number, tail: boolean): string {
  const s = HALF_LINE;
  const r = Math.max(0, Math.min(CORNER, (h - 2 * s) / 2));
  const x0 = tail ? TAIL + s : s;
  const x1 = Math.max(x0 + 2 * r, w - s);
  const y0 = s;
  const y1 = Math.max(y0 + 2 * r, h - s);
  const cy = h / 2;
  const n = (v: number) => Number(v.toFixed(2));
  const left = tail
    ? `V${n(cy + TAIL_HALF)} L${n(s)},${n(cy)} L${n(x0)},${n(cy - TAIL_HALF)} `
    : "";
  return (
    `M${n(x0 + r)},${n(y0)} H${n(x1 - r)} A${r},${r} 0 0 1 ${n(x1)},${n(y0 + r)} ` +
    `V${n(y1 - r)} A${r},${r} 0 0 1 ${n(x1 - r)},${n(y1)} H${n(x0 + r)} ` +
    `A${r},${r} 0 0 1 ${n(x0)},${n(y1 - r)} ${left}V${n(y0 + r)} A${r},${r} 0 0 1 ${n(x0 + r)},${n(y0)} Z`
  );
}

export function Speech({ said, tail = true }: { said: Said | null; tail?: boolean }) {
  const el = useRef<HTMLDivElement | null>(null);
  // The outline is drawn to the bubble's own size, measured, so its corners
  // keep their curve whatever the words make the width (a stretched drawing
  // would squash them). Before the first measurement it has a nominal size.
  const [box, setBox] = useState({ w: 160, h: 50 });
  // The last thing said is kept while it goes, so it can leave in its own
  // words rather than vanishing the frame the reason for it ends.
  const last = useRef<Said | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  if (said) last.current = said;
  const shown = said ?? (last.current && last.current.key !== gone ? last.current : null);
  const leaving = !said && shown !== null;
  const key = shown?.key;

  useLayoutEffect(() => {
    const node = el.current;
    if (!key || !node) return;
    if (!animates(node)) {
      if (leaving) setGone(key);
      return;
    }
    if (leaving) {
      const out = node.animate([{ clipPath: OPEN }, { clipPath: SHUT }], {
        duration: CLOSE_MS,
        easing: EXIT,
        fill: "forwards",
      });
      out.onfinish = () => setGone(key);
      return () => out.cancel();
    }
    // A sentence said again after it went (the update offer, back after an
    // undo stood over it) must be able to leave again in its own words.
    setGone(null);
    const arrive = node.animate([{ clipPath: SHUT }, { clipPath: OPEN }], { duration: OPEN_MS, easing: ENTER });
    return () => arrive.cancel();
  }, [key, leaving]);

  useLayoutEffect(() => {
    const node = el.current;
    if (!key || !node) return;
    const measure = () => {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (w > 0 && h > 0) setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, [key]);

  if (!shown) return null;
  const d = bubblePath(box.w, box.h, tail);
  return (
    <div
      ref={el}
      key={shown.key}
      className="speech"
      data-tail={tail || undefined}
      data-leaving={leaving || undefined}
      style={shown.clockMs ? ({ "--undo-ms": `${shown.clockMs}ms` } as CSSProperties) : undefined}
    >
      <svg className="speech-shape" width={box.w} height={box.h} aria-hidden focusable={false}>
        <g filter="url(#speech-boil)">
          <path className="speech-edge" d={d} />
          {/* The undo window: the same outline drawn on in ink, at one speed. */}
          {shown.clockMs ? <path className="speech-clock" d={d} pathLength={1} /> : null}
        </g>
      </svg>
      <span className="speech-words">
        <span>
          <SpokenWords words={shown.words} strong={shown.strong} busy={shown.busy} />
        </span>
      </span>
      {shown.act && (
        <button
          type="button"
          className="speech-act"
          aria-label={shown.act.label}
          title={shown.act.label}
          // A tap on the words is never an answer, and a press that lands as
          // the bubble goes would answer something no longer asked.
          disabled={leaving}
          onMouseDown={(e) => e.preventDefault()}
          onClick={shown.act.run}
        >
          <span className="speech-verb">{shown.act.verb}</span>
          {shown.act.hint}
        </button>
      )}
      <BoilFilter />
    </div>
  );
}

/**
 * The words as said. A `strong` fact is set in the bold cut (weight only); a
 * `busy` line's closing ellipsis becomes three dots that go . .. ... .. and
 * round again (`.speech-dots`), each dot always in the line so the bubble never
 * changes width, and simply all three under reduced motion. The text a reader
 * gets is the words unchanged.
 */
function SpokenWords({ words, strong, busy }: { words: string; strong?: readonly string[]; busy?: boolean }) {
  const dotted = busy === true && words.endsWith("…");
  const text = dotted ? words.slice(0, -1) : words;
  const facts = (strong ?? []).filter((f) => f.length > 0 && text.includes(f));
  const runs: ReactNode[] = [];
  let rest = text;
  while (facts.length > 0) {
    let first = -1;
    let fact = "";
    for (const f of facts) {
      const at = rest.indexOf(f);
      if (at >= 0 && (first < 0 || at < first)) [first, fact] = [at, f];
    }
    if (first < 0) break;
    if (first > 0) runs.push(rest.slice(0, first));
    runs.push(<b key={runs.length}>{fact}</b>);
    rest = rest.slice(first + fact.length);
    facts.splice(facts.indexOf(fact), 1);
  }
  if (rest) runs.push(rest);
  return (
    <>
      {runs}
      {dotted ? (
        <span className="speech-dots" aria-label="…">
          <span aria-hidden>.</span>
          <span aria-hidden>.</span>
          <span aria-hidden>.</span>
        </span>
      ) : null}
    </>
  );
}

/**
 * The creature's boiling line, for the bubble. The creature's own filter lives
 * in its shadow root, where nothing outside can reach it, so the bubble carries
 * a copy — the same numbers — for as long as it is on screen, and stands it
 * still where motion is turned down.
 */
function BoilFilter() {
  // A bubble that stays up (a failed sync, a waiting version) must not keep
  // the filter boiling in a hidden tab, or once motion is turned down: the
  // same pause the creature's own filters get (`refreshMotion`).
  const svg = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const refresh = () => {
      const el = svg.current;
      if (!el || typeof el.pauseAnimations !== "function") return;
      if (document.hidden || reducedMotion()) el.pauseAnimations();
      else el.unpauseAnimations();
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    const stop = onSettingsChange(() => queueMicrotask(refresh));
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      stop();
    };
  }, []);
  return (
    <svg ref={svg} className="speech-defs" width="0" height="0" aria-hidden focusable={false}>
      <filter id="speech-boil">
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" result="n">
          <animate attributeName="seed" values="1;2;3;4" dur="0.4s" repeatCount="indefinite" calcMode="discrete" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
