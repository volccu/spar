import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Block, CodeBlock, ItemBlock } from "../lib/blocks";
import { bestLine, markHits, singlesOut } from "../lib/face";
import { parseInline } from "../lib/inline";
import { lineAt, moveLine, tickItem } from "../lib/reorder";
import { answerTick } from "../lib/mascotMoments";
import { receipt } from "../lib/haptics";
import { useCopied } from "../lib/clipboard";
import { IconCopy, IconGrip } from "./Icons";
import { NoteInline } from "./shared/NoteInline";
import { Pen } from "./shared/Pen";
import { LIT_MS } from "../lib/motion";

/**
 * A run of code, on the note's own line grid: a panel drawn behind it, the
 * fences in muted as its first and last line, and Copy at its top right. Every
 * character is drawn where the textarea draws it, and the editor draws the
 * same panel (CodeBands), so tapping in moves nothing — see "one line grid"
 * in styles.css.
 *
 * The newline above the block is drawn *outside* it and the one below
 * *inside* it. A newline at the very end of a block draws no empty line, so
 * that pairing is what reproduces the textarea exactly: a line break is one
 * break, and a blank line above is still a blank line.
 */
function CodeView({ block }: { block: CodeBlock }) {
  const [copied, copy] = useCopied();
  // A line wider than the box scrolls it sideways, and a keyboard can only
  // scroll what it can focus (review UI-13): the box becomes a tab stop, with
  // a name, only while it overflows.
  const pre = useRef<HTMLPreElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = pre.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [block.code]);

  return (
    <>
      {block.lead}
    <div className="codeblock" data-fenced={block.open !== ""}>
      <span className="note-mark">{block.open}</span>
      <pre
        ref={pre}
        className="code"
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? "region" : undefined}
        aria-label={scrolls ? "Code, scrolls sideways" : undefined}
      >
        {block.code}
      </pre>
      <span className="note-mark">{block.close}</span>
      <span className="code-tail">{block.tail}</span>
      <button
        type="button"
        className="code-copy"
        data-copied={copied}
        aria-label={copied ? "Copied" : "Copy code"}
        title="Copy"
        onClick={(e) => {
          e.stopPropagation();
          void copy(block.code);
        }}
      >
        <IconCopy tier="inline" on={copied} />
      </button>
    </div>
    </>
  );
}

/** No search: one shared empty list, so the hits memo is not re-run for a
 *  fresh `[]` on every render. */
const NO_HITS: readonly string[] = [];

/** How long a search result takes to light up round its hits, handed to the
 *  stylesheet (`.reader[data-dim]`) so `lib/motion.ts` stays the one copy. */
const LIT_STYLE = { "--lit-ms": `${LIT_MS}ms` } as CSSProperties;

/**
 * The open note being read: every block drawn on the textarea's own line grid,
 * links live, boxes tickable, code copyable, and a list item draggable by its
 * grip. What it renders is the note character for character — `textContent`
 * equals the note — so a tap measured here lands the caret where the finger
 * was once the editor takes over.
 *
 * The text is the note's; the reader only asks for it to change. A tick and a
 * drop come back up through `onRewrite`, and a tap or a keyboard focus through
 * `onStartEditing` and `onFocusEdit`, because opening the editor is the note's.
 */
export function NoteReader({
  blocks,
  text,
  textRef,
  terms = NO_HITS,
  onRewrite,
  onStartEditing,
  onFocusEdit,
}: {
  /** The note's blocks, parsed from `text` (`parseBlocks`). */
  blocks: Block[];
  /**
   * What the search that opened this note matched on (`searchTerms`), or
   * nothing. The words it matched are held at full ink and the rest of the
   * note drops to muted — the card's own emphasis, said again in the note so
   * the eye lands where the card pointed. The note decides how long this
   * lasts; the reader only draws it.
   */
  terms?: readonly string[];
  /** The text on screen — the note's `draft`. */
  text: string;
  /** The same text, as of the latest write — what a drop is measured against. */
  textRef: { readonly current: string };
  /** A tick or a drop rewrote the note: set it and save it at once. */
  onRewrite: (next: string) => void;
  /** A click on the text — the caret goes where it landed. */
  onStartEditing: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Focus arrived from the keyboard: straight into editing. */
  onFocusEdit: () => void;
}) {
  const readerRef = useRef<HTMLDivElement | null>(null);
  /**
   * Whether the focus the reader is about to receive came from a press.
   *
   * A browser gives focus on the press — `mousedown`, or the one it emulates
   * after a touch — and the click comes after it. The reader opened the editor
   * on *any* focus, so a tap swapped the reader out before its own click ran,
   * `offsetAtPoint` never measured anything, and every tap put the caret at the
   * end of the note. So a press marks the focus it causes, `onFocus` stands
   * down for that one, and the click that follows places the caret. Focus
   * brought in by the keyboard carries no mark and still goes straight to
   * editing.
   *
   * Cleared by whichever comes first: the focus itself, any click inside the
   * reader (on the capture phase, since a tick box stops its own click), or a
   * press the browser took back for a scroll. Never on `pointerup` — on a
   * touch screen the focus arrives after it.
   */
  const pressed = useRef(false);
  /** The item in the air, where it would land, and how far the finger has come. */
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number } | null>(null);
  // The pointer handlers are not re-created between frames, so what they need
  // in order to finish a drag is held beside the state rather than inside it.
  const dragState = useRef(drag);
  dragState.current = drag;
  const dragRef = useRef<{
    from: number;
    /** Block indices of every item in this list. */
    run: number[];
    /** The vertical middle of each, measured once when the drag began. */
    mids: number[];
    startY: number;
  } | null>(null);

  /**
   * Each block's words split at the hits, or null for a block with nothing to
   * mark. Code is left alone: a fence's words are drawn raw in a `<pre>`, and
   * a snippet found by a search is found on the card that led here anyway.
   * `markHits` only splits segments, so every character still comes out once
   * and in order — the round trip `offsetAtPoint` depends on is untouched.
   */
  const marked = useMemo(() => {
    if (terms.length === 0) return null;
    const wanted = [...terms];
    // Several words: the first line holding the most of them is the one the
    // note opens on (NoteView scrolls to its first `data-best` hit), and its
    // hits are lit most strongly — the card's own ranking (`bestLine`,
    // review UI-A-11). Found as a character range in the text, because a prose
    // block can hold many lines and a line is what the card ranked.
    const lines = text.split("\n");
    const best = bestLine(lines, wanted);
    let from = -1;
    let to = -1;
    if (singlesOut(wanted, best.count)) {
      from = lines.slice(0, best.at).reduce((n, line) => n + line.length + 1, 0);
      to = from + lines[best.at].length;
    }
    // Every block's `text`, end to end, is the note (`parseBlocks`' hard
    // rule), so a running offset says where each block's words start.
    let at = 0;
    return blocks.map((block) => {
      const start = at;
      at += block.text.length;
      if (block.kind === "code") return null;
      const words = block.kind === "prose" ? block.text : block.words;
      const segs = markHits(parseInline(words), wanted);
      if (from < 0 || at <= from || start >= to) return segs;
      // The words' place in the block: after the newline, indent and marker
      // the block owns (an item's or a heading's), or at its start for prose.
      let offset =
        start +
        (block.kind === "prose"
          ? 0
          : block.text.indexOf(words, block.lead.length + block.prefix.length));
      return segs.map((seg) => {
        const segFrom = offset;
        offset += seg.text.length;
        return seg.hit && segFrom < to && offset > from ? { ...seg, best: true } : seg;
      });
    });
  }, [blocks, terms, text]);
  /**
   * Whether a hit is actually drawn — the card's rule (`data-dim` in
   * styles.css): the note is only stepped down the ramp when something stands
   * back up out of it. A match on a filename or inside a code block leaves
   * the note reading exactly as it always does.
   */
  const dim = marked?.some((segs) => segs?.some((seg) => seg.hit)) ?? false;
  /** A line was singled out, so the other hits step down (`data-ranked`). */
  const ranked = marked?.some((segs) => segs?.some((seg) => seg.best)) ?? false;
  const segsAt = (i: number) => marked?.[i] ?? undefined;

  /** A tick is a decision, not a keystroke — it saves at once. And it is one
   *  decision: the box changes and the run settles under it, both from
   *  `tickItem`, which the Ticker mode calls too so the two cannot drift. */
  function tick(block: ItemBlock) {
    const next = tickItem(text, block);
    onRewrite(next);
    receipt();
    answerTick(text, next);
  }

  /* --- dragging an item to a new place in its list --------------------------
     The order of a list is part of what it says, and until now changing it
     meant select, cut, find the gap, paste — four gestures on a desktop and an
     ordeal on a phone.

     The grip is in the *reading* view, because that is where the list exists as
     a list: editing is a plain textarea, which has no items in it to take hold
     of, only characters. A grip appears only on an item that has somewhere to
     go — a run of one is not a list — and it carries no text of its own, which
     is what keeps the reader's character-for-character round trip intact and
     the caret arithmetic honest.

     A drop rewrites the note and saves at once, like a tick: it is a decision,
     not a keystroke. -------------------------------------------------------- */

  /** The stretch of items this one belongs to, as indices into `blocks`. */
  function runOf(i: number): number[] {
    const isItem = (k: number) =>
      k >= 0 && k < blocks.length && (blocks[k].kind === "check" || blocks[k].kind === "list");
    if (!isItem(i)) return [];
    // A blank line ends a list, exactly as it does for `settleChecklist` and
    // `renumberLists`, which walk lines. It leaves no prose block behind to
    // stand between the items either side of it — its newline is claimed as
    // the lower item's `lead` — so adjacency alone joined two lists into one,
    // and a drag across them carried the blank line to the bottom of the note.
    // An item with a lead heads a run of its own.
    const joined = (k: number) => (blocks[k] as ItemBlock).lead === "";
    let a = i;
    while (isItem(a - 1) && joined(a)) a--;
    let b = i;
    while (isItem(b + 1) && joined(b + 1)) b++;
    const run: number[] = [];
    for (let k = a; k <= b; k++) run.push(k);
    return run;
  }

  function grab(e: React.PointerEvent<HTMLElement>, i: number) {
    const reader = readerRef.current;
    const run = runOf(i);
    // Nothing to reorder, so nothing to take hold of. The grip is not drawn in
    // this case either — this is the guard for the drag, not for the mark.
    if (!reader || run.length < 2) return;
    // The reader turns a click into a caret. A drag is not a click.
    e.stopPropagation();
    e.preventDefault();
    const mids = run.map((k) => {
      const el = reader.querySelector<HTMLElement>(`.item[data-i="${k}"]`);
      const r = el?.getBoundingClientRect();
      return r ? r.top + r.height / 2 : Number.POSITIVE_INFINITY;
    });
    dragRef.current = { from: i, run, mids, startY: e.clientY };
    // Keeps the move and the release coming to this element even when the
    // finger runs off it, which on a list of short items it always does.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ from: i, to: i, dy: 0 });
  }

  function dragTo(e: React.PointerEvent<HTMLElement>) {
    const d = dragRef.current;
    if (!d) return;
    // How many items the pointer has passed the middle of. That count is the
    // slot it would be dropped into; below its own slot it is one less, because
    // the item being dragged is not in the list while it is in the air.
    let slot = 0;
    while (slot < d.mids.length && e.clientY > d.mids[slot]) slot++;
    const here = d.run.indexOf(d.from);
    const landed = Math.max(0, Math.min(d.run.length - 1, slot > here ? slot - 1 : slot));
    setDrag({ from: d.from, to: d.run[landed], dy: e.clientY - d.startY });
  }

  function drop() {
    const d = dragRef.current;
    const at = dragRef.current ? dragState.current : null;
    dragRef.current = null;
    setDrag(null);
    if (!d || !at || at.to === at.from) return;
    const src = textRef.current;
    const from = blocks[d.from];
    const to = blocks[at.to];
    if (from.kind !== "check" && from.kind !== "list") return;
    if (to.kind !== "check" && to.kind !== "list") return;
    const next = moveLine(src, lineAt(src, from.markerAt), lineAt(src, to.markerAt));
    if (next === src) return;
    onRewrite(next);
  }

  return (
    <div
      className="reader"
      ref={readerRef}
      data-dim={dim || undefined}
      data-ranked={ranked || undefined}
      style={dim ? LIT_STYLE : undefined}
      aria-label="Note text"
      tabIndex={0}
      onPointerDown={() => {
        pressed.current = true;
      }}
      onPointerCancel={() => {
        pressed.current = false;
      }}
      onClickCapture={() => {
        pressed.current = false;
      }}
      onClick={onStartEditing}
      // Tab lands here and drops you straight into editing. Guarded on
      // the target: React's onFocus bubbles, so a click on a link would
      // otherwise swap in the editor mid-navigation. A focus given by a
      // press is left to the click that follows it — see `pressed`.
      onFocus={(e) => {
        const fromPress = pressed.current;
        pressed.current = false;
        if (e.target === e.currentTarget && !fromPress) onFocusEdit();
      }}
    >
      {blocks.map((block, i) => {
        if (block.kind === "code") return <CodeView key={i} block={block} />;

        // Headings and list items are blocks, on the note's own leading
        // and with nothing between them, so every character lands where
        // the textarea puts it (styles.css, "one line grid"). The newline
        // above is drawn outside the block and the one below inside it —
        // see CodeView for why that pair reproduces the textarea's line
        // breaks and blank lines exactly. The hashes are drawn, muted.
        if (block.kind === "heading") {
          return (
            <Fragment key={i}>
              {block.lead}
              <span className="heading">
                <span className="note-mark">
                  {block.prefix}
                  {block.marker}
                </span>
                <NoteInline text={block.words} segs={segsAt(i)} interactive />
                {block.tail}
              </span>
            </Fragment>
          );
        }

        if (block.kind === "check" || block.kind === "list") {
          const movable = runOf(i).length > 1;
          return (
            <Fragment key={i}>
            {block.lead}
            <span
              className="item"
              data-i={i}
              data-done={block.done}
              data-grip={movable}
              data-lift={drag?.from === i}
              data-drop={
                drag && drag.to === i && drag.to !== drag.from
                  ? drag.to < drag.from
                    ? "above"
                    : "below"
                  : undefined
              }
              style={
                drag?.from === i ? { transform: `translateY(${drag.dy}px)` } : undefined
              }
            >
              {/* Carries no text, so the rendered note still equals the
                  stored note character for character and every tap after
                  it still lands where it should. */}
              {movable && (
                <span
                  className="item-grip"
                  tabIndex={-1}
                  aria-hidden="true"
                  title="Drag to move"
                  onPointerDown={(e) => grab(e, i)}
                  onPointerMove={dragTo}
                  onPointerUp={drop}
                  onPointerCancel={drop}
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconGrip />
                </span>
              )}
              {block.prefix}
              {block.kind === "check" ? (
                <button
                  type="button"
                  className="check-hit"
                  aria-pressed={block.done}
                  aria-label={block.words.trim() || "Item"}
                  onClick={(e) => {
                    e.stopPropagation();
                    tick(block);
                  }}
                >
                  {block.marker}
                </button>
              ) : (
                // The marker as typed. A column for counted markers
                // lined up 1. and 10. and is gone: the textarea has no
                // columns, so tapping in re-broke the line.
                <span className="item-mark" data-num={block.numbered}>
                  {block.marker}
                </span>
              )}
              <Pen className="item-words">
                <NoteInline text={block.words} segs={segsAt(i)} interactive />
              </Pen>
              {block.tail}
            </span>
            </Fragment>
          );
        }

        return (
          <span key={i}>
            <NoteInline text={block.text} segs={segsAt(i)} interactive />
          </span>
        );
      })}
    </div>
  );
}
