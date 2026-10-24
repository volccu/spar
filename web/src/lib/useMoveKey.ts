import { useEffect, useRef } from "react";

/**
 * M on a card picks that card and opens the Move chooser (`useGridKeyboard`).
 * The pick is the key's own, made only so the one chooser serves a lone card:
 * so leaving the chooser with Escape (or Back) drops it again, rather than
 * leaving a card selected that needed two more Escapes to let go of. A
 * selection the user made by hand is never dropped by leaving the chooser.
 *
 * `cancel` returns whether anything is still up (the selection and its panel),
 * which is what Back's layer table wants to know.
 */
export function useMoveKey(o: {
  selected: string[];
  setSelected: (ids: string[]) => void;
  setMoving: (on: boolean) => void;
  setMoveError: (error: string | null) => void;
  setMenuOpen: (on: boolean) => void;
}) {
  const { selected, setSelected, setMoving, setMoveError, setMenuOpen } = o;
  const picked = useRef<string | null>(null);
  // Whenever the selection ends, the key's claim on it ends too.
  useEffect(() => {
    if (selected.length === 0) picked.current = null;
  }, [selected]);
  const latest = useRef(selected);
  latest.current = selected;
  return {
    /** M: the card to act on, or null when a selection already stands. */
    open(id: string | null) {
      picked.current = id;
      if (id) setSelected([id]);
      setMoveError(null);
      setMoving(true);
      setMenuOpen(true);
    },
    cancel(): boolean {
      const mine = picked.current;
      picked.current = null;
      if (mine && latest.current.length === 1 && latest.current[0] === mine) {
        // The panel goes first, as every verb's `then` does: with the selection
        // gone and the menu still open, the ordinary menu would stand up for a
        // frame and take the focus.
        setMenuOpen(false);
        setMoving(false);
        setSelected([]);
        return false;
      }
      setMoving(false);
      return true;
    },
  };
}
