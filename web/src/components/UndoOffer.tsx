import { useEffect, useState, type CSSProperties } from "react";
import { IconUndo } from "./Icons";
import { UNDO_MS, UNDO_WORD_MS, undoWord, undoable, type Undo } from "../store/useUndo";

/**
 * The countdown on the undo offer: its border, drawn on over the window.
 *
 * An SVG stroke rather than a painted gradient, because the border has to be
 * drawn at one speed. The first version swept a conic gradient round the
 * button, and a sweep is measured in *angle*: on a rectangle the same degree
 * covers a few pixels at the middle of an edge and a long run into a corner,
 * so the rule crawled, then raced, then crawled, and read as a glitch rather
 * than a clock. A stroke with `pathLength=1` is measured in *distance* along
 * the edge, so `stroke-dashoffset` going from 1 to 0 linearly is a pen moving
 * at one speed all the way round — the way a clock is expected to.
 *
 * The rectangle is sized by attributes in percent and the SVG is inset half a
 * pixel by the stylesheet, so a 1px stroke lands exactly inside the button's
 * own box whatever its width — the notice ("Copied 3") is as wide as its
 * words, the button is a square. Nothing here is a size; `.undo-clock` in
 * styles.css is.
 */
function UndoClock() {
  return (
    <svg className="undo-clock" aria-hidden focusable={false}>
      <rect width="100%" height="100%" pathLength={1} />
    </svg>
  );
}

/**
 * Where the offer is standing, which is always **in** something rather than
 * floating over it (review 2026-10-01, UX-01 and UX-02). A mark that floats
 * over the board's corner lands on whatever is there — a card's date, the
 * menu's Search row, the Sorter's ✕ — and a tap meant for that undoes the last
 * action instead. So each screen gives it a place of its own:
 *
 * - `bar`  a cell of the capture bar — the board, on a short screen only.
 *          Everywhere else on the board the header's creature says the offer
 *          in its speech bubble (`Speech.tsx`, 2026-10-16).
 * - `face` floated at the top of the Sorter's note, the words running round it.
 * - `head` in the Ticker's head band, which has the room the Sorter's lacks.
 * - `over` over the open note, above its +, for an offer made from inside the
 *          note (Untick all, Clear done) — the one that still floats, over a
 *          sheet that has nothing in that corner.
 */
export type UndoPlace = "bar" | "face" | "head" | "over";

interface Props {
  offer: Undo;
  place: UndoPlace;
  onUndo: () => void;
}

/**
 * The undo offer: a square carrying the undo mark with the countdown drawn
 * on as its own border — saying its verb for the first `UNDO_WORD_MS` — or,
 * for a notice with nothing to reverse, the words with the same clock.
 * `web/CLAUDE.md`, "Undo". Its one piece of state is when the word goes.
 */
export function UndoOffer({ offer, place, onUndo }: Props) {
  // The one word goes quiet after its first seconds. Kept as "the offer whose
  // word has gone" rather than a flag, so a fresh offer starts with its word
  // in the very first frame rather than after an effect has reset it.
  const [quiet, setQuiet] = useState<number | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setQuiet(offer.key), UNDO_WORD_MS);
    return () => window.clearTimeout(t);
  }, [offer.key]);
  const said = quiet !== offer.key;

  return (
    // Keyed on the offer so a second action restarts the clock from empty
    // rather than inheriting a border that is already half drawn. The
    // window is handed to CSS rather than written there twice.
    //
    // **This was a strip across the bottom of the screen and is now a
    // button.** The strip printed what had just happened — "Archived 3" —
    // with Undo beside it, and a rule draining along its top edge. The
    // words were the largest part of it and the one part nobody acts on:
    // you already know what you just did, and if you did not, the board in
    // front of you says so. What is left is the offer itself, at the size
    // of the thing you would tap, with the countdown drawn *on* it rather
    // than beside it. The message is not lost — it is what the live region
    // announces, and what a desktop hover reads back.
    //
    // It has the arrow and, for its first seconds, one word: the verb of
    // what it would undo ("Deleted"). A phone has no hover, so the arrow
    // alone read as "back" and said nothing of what it would reverse
    // (review 2026-10-01, UX-09). The word is small and then it goes, so the
    // mark never grows into the strip it replaced.
    //
    // Where it stands is the screen's business (`UndoPlace`); it never
    // floats over the board, because whatever was in that corner was what a
    // tap meant to reach.
    <div
      key={offer.key}
      className={`undo-slot undo-slot-${place}`}
      role="status"
      style={{ "--undo-ms": `${UNDO_MS}ms` } as CSSProperties}
    >
      {/* The words are **not** said here. This element is minted per offer
          (`key`), and a live region that arrives with its content already in
          it is the classic case assistive technology misses — TalkBack in
          particular. Since the words came off the strip, this was the only
          place "Archived 3" was ever said, so a miss meant the app archived
          three notes and reported nothing at all. It is announced from the
          permanently-mounted region in `App.tsx` instead, which is what a
          live region has to be to work. The `key` stays: it is what restarts
          the countdown drawing. */}
      {undoable(offer) ? (
        <button
          type="button"
          className="undo"
          // The words the strip used to print, kept where they cost no
          // screen: a hover on a desktop, and the label a reader hears
          // instead of a bare arrow.
          aria-label={`Undo: ${offer.message}`}
          title={`Undo: ${offer.message}`}
          data-said={said || undefined}
          onClick={onUndo}
        >
          {/* Hidden from the reader, who hears the whole message from the
              label and the header's live region instead. */}
          {said && (
            <span className="undo-word mono" aria-hidden>
              {undoWord(offer.message)}
            </span>
          )}
          <IconUndo />
          <UndoClock />
        </button>
      ) : (
        // A notice — "Copied 3" — has nothing of its own to reverse, and an
        // Undo beside it would quietly undo whatever came before the copy
        // (`undoable`). So it keeps its words and takes the same border
        // clock, as the one thing on screen that is telling rather than
        // offering.
        <span className="undo undo-notice mono">
          {offer.message}
          <UndoClock />
        </span>
      )}
    </div>
  );
}
