import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Note } from "../types";
import { leftByHand } from "../lib/emptiedByHand";

/**
 * useUndo — the stack Ctrl+Z walks back through, and the offer the strip shows.
 *
 * Pulled out of `App.tsx`, which had grown to hold twenty-six pieces of state
 * across five unrelated jobs. This is the first of them, and the cleanest: the
 * stack, its expiry, and the rule for what a reversal is allowed to touch are
 * one idea, and the only things they need from the screen are the notes as they
 * are *right now* and a way to write to them.
 *
 * What deliberately stayed behind in `App.tsx` is what a reversal *looks* like —
 * which mark the cards shrink into, which note traces itself, which layer
 * closes. Those are the board's business, not the stack's, and they arrive here
 * as callbacks. The split is what stops this file from needing to know that
 * there is such a thing as an open note.
 */

/**
 * How long the offer stands on screen. A threshold rather than motion — like
 * PEEK_WAIT_MS, it is a length of time the user is given, not a move — which is
 * why it does not live in lib/motion.ts. The countdown rule in the strip is
 * drawn from it, so the two can never disagree; that is why it is exported
 * rather than being a second 8000 written into the stylesheet.
 */
export const UNDO_MS = 8000;

/**
 * How long the offer says its one word before settling to the bare arrow. A
 * phone has no hover, so the arrow alone read as "back" rather than "undo",
 * and said nothing about *what* it would undo (review 2026-10-01, UX-09). The
 * word is there for the first glance and gone before it is furniture.
 */
export const UNDO_WORD_MS = 2500;

/**
 * The one short word the offer shows beside its arrow: the verb of what just
 * happened, taken off the front of the message ("Archived 3" → "Archived").
 * The handful of messages whose verb is not one word are said whole. The full
 * message is still the button's label and hover title.
 */
export function undoWord(message: string): string {
  const [first = "", second = ""] = message.trim().split(/\s+/);
  if (second === "back") return `${first} back`; // "Put back 3"
  if (first === "Took") return "Took out"; // "Took 1 out"
  return first;
}

/**
 * What the undo mark says after a flag goes on or off — Important or To-do,
 * from the selection panel or Tidy up. One sentence for both places, built
 * from the verb the toggle performed: "Marked important 3", "Unmarked 3". It
 * read "Important off 1" and, shown as its first word, said IMPORTANT for an
 * un-flagging (review 2026-10-04, CD-02).
 */
export function markedWords(mark: "important" | "to-do", on: boolean, n: number): string {
  return on ? `Marked ${mark} ${n}` : `Unmarked ${n}`;
}

/**
 * How many actions Ctrl+Z can walk back through. Shallow on purpose: every step
 * further back is a step more likely to be undoing something you have since
 * built on. The per-note guard is what keeps them *safe*; this is what keeps
 * them *comprehensible*.
 */
const UNDO_DEPTH = 10;

/**
 * One note's reversal, and the state it expects to find before it touches
 * anything.
 *
 * The guard is what makes an undo stack safe on a synced app. Undo cannot
 * rewind — the change already reached the other device — so it can only send
 * the opposite, which then travels too. If the phone has since moved that note
 * on, sending the opposite would silently overwrite the phone. So a step only
 * fires while the note still holds what the action put there; anything else
 * has been overtaken and is left alone. It is the same rule the outbox runs on:
 * act on a version, not on a name.
 */
export interface UndoStep {
  id: string;
  expect: Partial<Note>;
  revert: Partial<Note>;
}

export interface Undo {
  /** Identity, so a fresh offer restarts the countdown rather than inheriting. */
  key: number;
  message: string;
  steps: UndoStep[];
  /** Merge cannot be said as a patch, so it brings its own reversal. */
  run?: () => void;
  /**
   * Done *inside* whatever is open — the open note, the Ticker — and reversed
   * there too, so the reversal must leave that screen standing. `onReverted`
   * closes the open note and the canvas, which is right for merge (its new
   * idea is open and the sources are coming back) and wrong for Untick all:
   * undoing it from inside the note would slam the note shut on the list you
   * were putting back. The board reads this flag and stands down.
   */
  inPlace?: boolean;
  /**
   * What goes with the steps once they have fired — a move that made its board
   * takes the board away again if nothing else is in it. Not called when no
   * step could fire (the notes have moved on, so the board may not be empty).
   * It is handed the steps that did fire: the notes were written a moment ago,
   * and the board may not have drawn them yet, so what the notes now hold is
   * known from these and not from a read of the board.
   */
  after?: (fired: UndoStep[]) => void;
}

/**
 * Whether the strip should offer an Undo button for this entry.
 *
 * A notice — "Copied 3" — is pushed with no steps and no `run`, so the strip
 * can say what just happened in the one place it says such things. `undoLast`
 * already skips an entry with nothing to fire and tries the one behind it,
 * which is right for Ctrl+Z; but a *button* labelled Undo beside "Copied 3"
 * would quietly reverse whatever came before the copy. So the button is only
 * drawn when there is something of this entry's own to reverse.
 */
export function undoable(entry: Undo): boolean {
  return entry.run !== undefined || entry.steps.length > 0;
}

function stillLooksLike(note: Note, expect: Partial<Note>): boolean {
  return (Object.keys(expect) as (keyof Note)[]).every(
    (field) => note[field] === expect[field],
  );
}

/**
 * The steps that can still fire: each one's note still holds what the action
 * put there. The guard every reversal goes through — `undoLast` below, and a
 * `run` that has to restore something else first and then its notes
 * (deleting a folder, `lib/useFolderVerbs.ts`).
 */
export function liveSteps(steps: UndoStep[], byId: ReadonlyMap<string, Note>): UndoStep[] {
  return steps.filter((step) => {
    const note = byId.get(step.id);
    return note ? stillLooksLike(note, step.expect) : false;
  });
}

interface Options {
  /** The notes as they are at the moment a reversal runs, never as they were
   *  when it was pushed — a ref for the same reason the outbox uses one. */
  notesRef: RefObject<Note[]>;
  update: (id: string, patch: Partial<Note>) => void;
  /** The steps that are actually going to fire, handed over before they do, so
   *  the board can decide what the movement should look like. Not called for a
   *  reversal that brings its own `run`. */
  onReverting?: (live: UndoStep[]) => void;
  /** After any reversal, whatever kind, handed the entry that was reversed.
   *  The board closes what is open here, unless the entry says `inPlace`. */
  onReverted?: (entry: Undo) => void;
}

export function useUndo({ notesRef, update, onReverting, onReverted }: Options) {
  // Two different lifetimes, deliberately. `undos` is the stack Ctrl+Z walks
  // back through and it keeps its entries; `offered` is only which one is being
  // shown, and that expires on its own so the strip never piles up on screen.
  const [undos, setUndos] = useState<Undo[]>([]);
  const [offered, setOffered] = useState<number | null>(null);
  const undoKey = useRef(0);
  const undosRef = useRef<Undo[]>([]);
  undosRef.current = undos;

  /** The entry the strip is currently offering, or null when it has gone quiet. */
  const offer = offered === null ? null : (undos.find((u) => u.key === offered) ?? null);

  // The offer expires on its own; it should never pile up on screen. The entry
  // itself stays on the stack — the strip going quiet ends the invitation, not
  // the ability.
  useEffect(() => {
    if (offered === null) return;
    const t = window.setTimeout(() => setOffered(null), UNDO_MS);
    return () => window.clearTimeout(t);
  }, [offered]);

  /** Offers a reversal, and keeps it for Ctrl+Z after the offer has gone. */
  const pushUndo = useCallback((entry: Omit<Undo, "key">) => {
    const key = (undoKey.current += 1);
    setUndos((prev) => [{ ...entry, key }, ...prev].slice(0, UNDO_DEPTH));
    setOffered(key);
    // Every path that takes a note off the board offers it back, so an offer is
    // also the word that the user just moved something: if that emptied the
    // board, its creature arrives awake (lib/emptiedByHand.ts). A notice with
    // nothing to reverse (the trash sweep's) took nothing off any board.
    if (entry.steps.length > 0 || entry.run) leftByHand("undo");
  }, []);

  // The callbacks reach the caller through refs so `undoLast` can keep a stable
  // identity: it is handed to a keyboard listener that is registered once, and
  // a new function every render would leave that listener holding an old one.
  const revertingRef = useRef(onReverting);
  revertingRef.current = onReverting;
  const revertedRef = useRef(onReverted);
  revertedRef.current = onReverted;

  /**
   * Walks back one action.
   *
   * Steps whose notes have moved on since are skipped, and an entry with
   * nothing left it can say is dropped and the one behind it tried — otherwise
   * Ctrl+Z would jam against a reversal that can no longer happen, with nothing
   * on screen to explain why.
   *
   * **`onReverted` fires only when something was actually reversed.** It used
   * to run on every press, including the press that found an empty stack — and
   * what the board does with it is close whatever is open (merge leaves its new
   * idea open, so putting the sources back has to close it). Ctrl+Z stands down
   * while a *note* is open, but nothing stood it down over an idea's **canvas**:
   * so a Ctrl+Z on a canvas with nothing left to undo closed the canvas, having
   * undone nothing at all. Ending an invitation is not the same event as
   * carrying one out.
   *
   * It hands back the entry it reversed, or null: the keyboard's Ctrl+Z says
   * what it did from that (`lib/useKeyboardUndo.ts`).
   */
  const undoLast = useCallback((): Undo | null => {
    const stack = undosRef.current;
    // The notes as one lookup rather than a walk of the archive per step: a
    // selection of four hundred is four hundred steps, and each one was
    // scanning all of them.
    const byId = new Map(notesRef.current.map((note) => [note.id, note]));
    let at = 0;
    let reverted: Undo | null = null;
    for (; at < stack.length; at++) {
      const entry = stack[at];
      if (entry.run) {
        entry.run();
        reverted = entry;
        break;
      }
      const live = liveSteps(entry.steps, byId);
      if (live.length === 0) continue;
      revertingRef.current?.(live);
      for (const step of live) update(step.id, step.revert);
      entry.after?.(live);
      reverted = entry;
      break;
    }
    setUndos(at >= stack.length ? [] : stack.slice(at + 1));
    setOffered(null);
    if (reverted) revertedRef.current?.(reverted);
    return reverted;
  }, [notesRef, update]);

  return { undos, offer, pushUndo, undoLast };
}
