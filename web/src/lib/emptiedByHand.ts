import { useEffect, useRef, useState } from "react";

/**
 * "You just emptied this board yourself": the one fact the sleeping creature
 * needs to arrive awake and then fall asleep (joy review 2026-10-14, #5).
 *
 * Two things say it. Every path that takes a note off the board offers it
 * back (web/CLAUDE.md, "Undo"), so `pushUndo` reports each offer that can
 * actually be undone here (`"undo"`); a notice with nothing to reverse, like
 * the trash sweep's "Cleared 3", is not a note leaving, and a sync offers
 * nothing at all. And a mode closing (Tidy up, Tick off) reports itself
 * (`"mode"`), because a pile emptied inside a mode empties the board
 * underneath while nobody can see it: the moment it can be seen is the mode
 * going away.
 *
 * An offer only counts close to the moment the board went empty
 * (`EMPTIED_WINDOW_MS` either side of the empty board appearing): an undo
 * offered later, for something done elsewhere while you stand on a board that
 * was already empty (a folder deleted from the shelf), did not empty it. That
 * is the case that must stay simply asleep, as must opening the app onto an
 * empty board. (The `Vanish` mark is not a third signal: the last card's mark
 * is never drawn, because the grid it would be measured in has already gone.)
 *
 * A module, not state: it is a moment, not something any screen keeps.
 */

/** How close to a board going empty an offer has to be to have emptied it. */
export const EMPTIED_WINDOW_MS = 800;

export type LeftBy = "undo" | "mode";

let lastAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<(by: LeftBy) => void>();

/** Something the user did just took a note off the board, or closed a mode. */
export function leftByHand(by: LeftBy = "undo", now = Date.now()) {
  if (by === "undo") lastAt = now;
  listeners.forEach((listen) => listen(by));
}

/** Whether a board that has just gone empty was emptied by hand. */
export function emptiedJustNow(now = Date.now()): boolean {
  return now - lastAt <= EMPTIED_WINDOW_MS;
}

/** Calls `listen` on every later `leftByHand`; returns the way to stop. */
export function onLeftByHand(listen: (by: LeftBy) => void): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** For tests: forget the last leave. */
export function resetEmptiedByHand() {
  lastAt = Number.NEGATIVE_INFINITY;
  listeners.clear();
}

/**
 * The empty board's side of it: a number for the creature's `wake` attribute,
 * which goes up each time the board is emptied by hand while the creature is
 * shown. It starts at 1 when the board has only just gone empty, so the
 * creature mounting for that very emptying arrives awake; an offer landing
 * just after the board appeared (the write and the offer are not always in the
 * same render) counts too, and later ones do not. A mode closing always does.
 * Hidden (a search or the reminders over the board), it goes back to 0, so a
 * creature put back when they close is simply asleep.
 */
export function useWakeOnEmptied(shown: boolean): number {
  const [wake, setWake] = useState(() => (shown && emptiedJustNow() ? 1 : 0));
  const since = useRef(Date.now());
  useEffect(() => {
    if (!shown) {
      setWake(0);
      return;
    }
    since.current = Date.now();
    return onLeftByHand((by) => {
      if (by === "undo" && Date.now() - since.current > EMPTIED_WINDOW_MS) return;
      setWake((n) => n + 1);
    });
  }, [shown]);
  return wake;
}
