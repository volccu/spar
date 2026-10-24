import { useEffect, useMemo, type ReactNode } from "react";
import { leftByHand } from "../lib/emptiedByHand";
import type { Note } from "../types";
import { useModeLayer } from "../lib/useModeLayer";
import { IconArchive, IconClear } from "./Icons";
import { parseBlocks, type ItemBlock } from "../lib/blocks";
import { tickItem } from "../lib/reorder";
import { answerTick } from "../lib/mascotMoments";
import { receipt } from "../lib/haptics";
import { useWakeLock } from "../lib/useWakeLock";
import { ListVerbs, type ListRewrite } from "./ListVerbs";
import { PileEdge } from "./PileEdge";
import { Pen, PEN_STYLE } from "./shared/Pen";

interface Props {
  /** The lists, snapshotted when the mode opened, in the Todos board's own
   *  order. A list finished here stays in it, so "3 of 12" holds still. */
  pile: Note[];
  /** Writes the note's text back — the same `update` every other edit in the
   *  app goes through, so a tick rides the outbox and the per-field clock. */
  onTick: (note: Note, body: string) => void;
  /**
   * Untick all or Clear done — the same `body` write as a tick, and offered
   * back through the ordinary undo, which is why it carries the words the
   * offer says. Undefined, and neither mark is drawn, where nothing may undo.
   */
  onRewrite?: (note: Note, body: string, message: string) => void;
  /** The one way a finished list leaves the board from in here. Archiving
   *  destroys nothing and an archived note stays fully searchable. */
  onArchive: (note: Note) => void;
  onClose: () => void;
  /** The rect of the line this was entered from — the shape it grows out of. */
  origin: DOMRect | null;
  /** Where the focus goes when it shuts. */
  restoreTo: React.RefObject<HTMLButtonElement | null>;
  /** The undo mark, while one is offered — a cell of the head band, beside the
   *  count, where it covers nothing (review 2026-10-01, UX-01). */
  undo?: ReactNode;
}

/**
 * The Ticker: one list at a time, and the boxes are the buttons.
 *
 * A checklist you can read but not tick is a screenshot of a checklist
 * (SPEC §12), and that was granted for the *open note* and only there. On the
 * Todos board every tick still cost three gestures and a return trip — open,
 * tap the box, come back — for a decision that took none, which is the same
 * arithmetic that left 237 notes unfiled and got the Sorter built. This is the
 * Sorter's shape said about ticking instead of filing.
 *
 * **The board itself is not the answer, and that is a decision.** A tick box
 * drawn on a card would have to be a button inside a button — a card is one
 * `.card[data-id]` and has been since the grid was built — which is invalid
 * markup before it is anything else, and it would make a card face into a
 * control surface, which is the one thing a card face may never be. A mode may
 * respend the gesture budget inside its own screen (SPEC §6), so the tick
 * targets live here, where nothing is competing for the tap.
 *
 * The pile is every list with something still open in it. A list with every box
 * ticked has nothing to do here and is not in it — the mode is for the work
 * that is left, and a finished list appearing in it would be a screen asking
 * you to admire your own tidiness.
 *
 * Nothing here is a session. Leaving mid-pile costs nothing, every tick is
 * already saved, and a list that still has open boxes comes round next time.
 */
export function Ticker({
  pile,
  onTick,
  onRewrite,
  onArchive,
  onClose,
  origin,
  restoreTo,
  undo,
}: Props) {
  const { at, layerRef, faceRef, close, advance, step, trapTab, onTouchStart, onTouchEnd } =
    useModeLayer({ count: pile.length, origin, onClose, restoreTo });

  // The screen stays on for as long as this is up. A list is worked through
  // with the phone in one hand, a minute or two between ticks, and a screen
  // that dims and locks between the milk and the bread has to be woken for
  // every aisle. Mounted only while the mode runs, so mounting is the whole
  // condition; see `lib/useWakeLock.ts` for the silence when it is refused.
  useWakeLock(true);
  // Ticked and archived down to nothing: the empty board shows when this closes.
  useEffect(() => () => leftByHand("mode"), []);

  const note = pile[at] ?? null;

  /**
   * The note's own text, in the pieces it is made of.
   *
   * Read straight off `note.body` on every render rather than held in a draft:
   * a tick writes immediately and the note comes back down through `pile`, so a
   * second copy of the text here would be a second answer to what the list says
   * — and the one on screen would be the stale one the moment a tick landed on
   * the other device.
   */
  const blocks = useMemo(() => parseBlocks(note?.body ?? ""), [note?.body]);
  const items = blocks.filter((b): b is ItemBlock => b.kind === "check");
  const left = items.filter((item) => !item.done).length;
  const ticked = items.length - left;

  /**
   * A tick, which never moves you on.
   *
   * The Sorter advances on every choice because filing a note is the whole of
   * what it asks; a list is several decisions and you are here for all of them.
   * Ticking the last box does not advance either — the settle puts it at the
   * foot of the list and the count says none left, which is the reward, and a
   * screen that vanished at that moment would take the receipt with it.
   */
  function tick(item: ItemBlock) {
    if (!note) return;
    const next = tickItem(note.body, item);
    onTick(note, next);
    receipt();
    answerTick(note.body, next);
  }

  /**
   * Untick all or Clear done. Like a tick it never moves the pile on: after
   * Untick all the list is all to do again and you are here to do it, and
   * after Clear done what is left is exactly the work that remains.
   */
  function rewriteList({ run, notice }: ListRewrite) {
    if (!note || !onRewrite) return;
    const next = run(note.body);
    if (next === note.body) return;
    onRewrite(note, next, notice(ticked));
  }

  function archive() {
    if (!note) return;
    onArchive(note);
    advance();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // This layer says `aria-modal`, and the page behind it is `inert` — except
    // the header, which holds the mascot and its `tabindex="0"`. So Tab off
    // the last control walked out of the mode onto a creature a screen reader
    // has been told is not there. Kept inside, the way every other layer in
    // the app keeps it.
    if (e.key === "Tab") {
      trapTab(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      step(-1);
    }
  }

  return (
    <div
      ref={layerRef}
      className="ticker"
      role="dialog"
      aria-modal="true"
      aria-label="Tick off the lists"
      // Focusable so the layer can hold the focus itself on open — see the
      // mount effect. Never in the tab order: Tab walks the boxes inside.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="ticker-head">
        <span className="ticker-at mono">{`${Math.min(at + 1, pile.length)} of ${pile.length}`}</span>
        {undo}
        {/* Next list. Navigation rather than a decision about this one, so it
            stands in the head band beside the count and not among the boxes —
            the same place, and the same argument, as the Sorter's Skip. */}
        <button type="button" className="ticker-skip mono" onClick={advance}>
          Next
        </button>
        <button
          type="button"
          className="ticker-done"
          aria-label="Stop ticking"
          title="Stop ticking"
          onClick={close}
        >
          <IconClear />
        </button>
      </div>

      {/* The list. Every line the note has, in the order it was written: the
          items as buttons, and everything else — a heading, a sentence above
          the list, a dash — as the words they are. A list is often written
          under a line saying what it is for, and dropping that would leave a
          screen of items with nothing to say which list they are. */}
      <div className="ticker-list" ref={faceRef}>
        {blocks.map((block, i) => {
          if (block.kind === "check") {
            return (
              <button
                key={i}
                type="button"
                className="ticker-item"
                role="checkbox"
                aria-checked={block.done}
                // Named by its words alone. The box is drawn as the characters
                // the note holds, and a reader that took the name from the
                // content said "[ ] oat milk" — the brackets read aloud, for a
                // state aria-checked already says (review UX-13).
                aria-label={block.words.trim()}
                data-done={block.done || undefined}
                onClick={() => tick(block)}
              >
                {/* The box is the characters the user typed, in the machine
                    face — "[ ]", "[x]", "☐", "☑", whichever of them this note
                    actually says. `markerOf` is the one definition of a marker
                    (web/CLAUDE.md) and the card face and the open note both
                    draw it this way; a square drawn here instead would be a
                    third rendering of one thing, and the only one that could
                    disagree with the text underneath it. */}
                <span className="ticker-box mono" aria-hidden>
                  {block.marker}
                </span>
                <span className="ticker-words">
                  <Pen>{block.words}</Pen>
                </span>
              </button>
            );
          }
          // The note's name (a `# ` line) is the open note's heading, as in
          // Tidy up: the hashes a muted mark, the words at the heavier stroke
          // (review 2026-10-04, UI-A-05).
          if (block.kind === "heading") {
            if (!block.words.trim()) return null;
            return (
              <p className="ticker-prose ticker-heading" key={i}>
                <span className="sorter-heading">
                  <span className="note-mark">{block.marker}</span>
                  {block.words.trim()}
                </span>
              </p>
            );
          }
          // Prose carries the newlines around it (blocks.ts's hard rule: the
          // pieces concatenate back to the note exactly), and here they would
          // be drawn as blank lines between every item. Nothing is rewritten —
          // this is one screen's rendering of the same string, and the note is
          // untouched.
          const words = (
            block.kind === "prose"
              ? block.text
              : // A run of code in a to-do note is rare and is still the user's
                // words: it is shown, plainly, rather than dropped. The fences
                // are not part of it (`blocks.ts` keeps them hidden in the open
                // note too), and this screen is for ticking, so it does not
                // set code the way `CodeView` does.
                block.kind === "code"
                ? block.code
                : block.words
          ).trim();
          if (!words) return null;
          return (
            <p className="ticker-prose" key={i}>
              {words}
            </p>
          );
        })}
      </div>
      <PileEdge after={pile.length - at - 1} />

      <div className="ticker-foot">
        {/* What is left, in the machine face, because it is a count. It is the
            reason to be here and the reason to leave. */}
        <span className="ticker-left mono">
          {left === 0 ? "all done" : `${left} left`}
        </span>
        {/* The whole list at once, beside the count they change: Untick all
            for the list used again every week, Clear done for the one that
            only ever grows. Named in words, on a row of their own above the
            count on a phone; drawn only while something is ticked, and both offered back by the ordinary undo. */}
        {onRewrite && ticked > 0 && (
          <div className="ticker-verbs">
            <ListVerbs done={ticked} className="ticker-verb" worded onRewrite={rewriteList} />
          </div>
        )}
        {/* The end of a finished list. Archiving destroys nothing, keeps the
            note searchable, and is the one thing that takes it off Todos —
            without it a list every box of which is ticked stays on the board
            for ever, which is the trip this mode exists to remove. */}
        <button
          type="button"
          className="ticker-archive"
          data-ready={left === 0 || undefined}
          style={PEN_STYLE}
          onClick={archive}
        >
          <IconArchive tier="inline" />
          <span>Archive</span>
        </button>
      </div>
    </div>
  );
}
