import { useEffect, useRef, type RefObject } from "react";
import type { Undo } from "../store/useUndo";
import { UNDO_KEY, isTypingTarget } from "./hotkeys";
import { robotSays } from "./mascotMoments";
import { spokenUndo } from "./useSpeech";
import { cardSlot, handFocusToCard } from "./useFocusHandBack";

/**
 * Ctrl+Z on the board — and only there: in a note it is the browser's own undo
 * of the typing, so the two never overlap (`web/CLAUDE.md`, "Undo").
 *
 * **It says what it did.** A press used to reverse in silence, and a few
 * presses walked back to loading the samples and trashed fifty-three notes
 * with no word. The creature says it in its bubble, which the header's live
 * region says too (`robotSays`): "Undid: archived 3 notes". A press with
 * nothing left says that. Shift+Z is let through: there is no redo.
 *
 * **It keeps the cursor.** A reversal that takes a card off the board left the
 * focus on the page; it goes to the card acted on, or its neighbour.
 */
export function undoneWords(entry: Undo): string {
  const said = spokenUndo(entry.message);
  return `Undid: ${said.charAt(0).toLowerCase()}${said.slice(1)}`;
}

export function useKeyboardUndo(o: {
  openId: RefObject<string | null>;
  undoLast: RefObject<() => Undo | null>;
  grid: HTMLElement | null;
}) {
  const grid = useRef(o.grid);
  grid.current = o.grid;
  const { openId, undoLast } = o;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== UNDO_KEY) return;
      if (openId.current) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      const held = (document.activeElement as HTMLElement | null)?.dataset?.id;
      const slot = cardSlot(grid.current, held ? [held] : []);
      const entry = undoLast.current();
      robotSays(entry ? undoneWords(entry) : "Hm. Nothing to undo");
      if (entry) handFocusToCard(grid.current, entry.steps.map((s) => s.id), slot);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, undoLast]);
}
