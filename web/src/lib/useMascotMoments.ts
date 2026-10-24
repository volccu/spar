import { useEffect, useMemo, useRef, useState } from "react";
import type { BarLine } from "../components/CaptureLine";
import { mascotGlance, mascotPlay } from "../components/mascot-element";
import type { Note } from "../types";
import { celebrate, hush, quoted, robotSays } from "./mascotMoments";

/**
 * The creature's moments that `App` holds the facts for (2026-10-16, owner
 * approved): the ones the rest of the app tells it directly are in
 * `lib/mascotMoments.ts`. Lifted out of `App.tsx`, which has a ceiling.
 */

/** How often, while offline, it asks whether anything is still waiting to go up. */
const WAITING_ASK_MS = 4_000;
/** A search has to have found nothing for this long, unchanged, before it shrugs. */
const SHRUG_WAIT_MS = 900;
/** A note made within this long counts as just made, for a milestone. */
const JUST_MADE_MS = 10_000;

interface Options {
  online: boolean;
  /** There is a server to sync to. */
  syncs: boolean;
  /** How much is waiting to go up (`unsentWorkCount`). */
  unsent: () => Promise<number>;
  notes: readonly Note[];
  /** A capture's receipt for a note that landed out of sight ("Saved to Recipes"). */
  landed: BarLine | null;
  /** The words being searched for, and what came of it. */
  search: { query: string; found: number; inTrash: number; goToTrash: () => void } | null;
}

export function useMascotMoments({ online, syncs, unsent, notes, landed, search }: Options): { waiting: boolean } {
  // Offline with changes still to send: the antenna blinks until they have
  // gone. Asked now and then rather than watched, because the outbox lives in
  // IndexedDB; back online it simply stops.
  const [waiting, setWaiting] = useState(false);
  const unsentRef = useRef(unsent);
  unsentRef.current = unsent;
  useEffect(() => {
    if (online || !syncs) {
      setWaiting(false);
      return;
    }
    let live = true;
    const ask = () =>
      void unsentRef.current().then(
        (n) => live && setWaiting(n > 0),
        () => {},
      );
    ask();
    const timer = window.setInterval(ask, WAITING_ASK_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [online, syncs]);

  // A milestone: the note just made took the count to 100, 500 or a thousand.
  // Only one more than before, and only a note made just now — a sync that
  // brings in a pile, or a note put back from the trash, never holds up a sign.
  const { count, newest } = useMemo(() => {
    let n = 0;
    let latest = 0;
    for (const note of notes) {
      if (note.status === "trashed") continue;
      n += 1;
      const at = Date.parse(note.created_at);
      if (at > latest) latest = at;
    }
    return { count: n, newest: latest };
  }, [notes]);
  const counted = useRef<{ count: number; newest: number } | null>(null);
  useEffect(() => {
    const was = counted.current;
    counted.current = { count, newest };
    if (was === null || count !== was.count + 1) return;
    // The note that arrived is the newest one, made just now — not an old note
    // put back while some other note happened to be recent.
    if (newest <= was.newest || Date.now() - newest > JUST_MADE_MS) return;
    celebrate(count);
  }, [count, newest]);

  // A capture that landed in another board: the eyes go to that board's tab.
  const landedKey = landed && !landed.leaving && landed.place ? landed.key : null;
  const landedPlace = landed?.place ?? null;
  useEffect(() => {
    if (!landedKey || !landedPlace) return;
    const frame = requestAnimationFrame(() => {
      const tab = tabNamed(landedPlace);
      if (!tab) return;
      const r = tab.getBoundingClientRect();
      if (r.width > 0) mascotGlance(r.left + r.width / 2, r.top + r.height / 2);
    });
    return () => cancelAnimationFrame(frame);
  }, [landedKey, landedPlace]);

  // A search that found nothing, once it has settled: a shrug, and where it
  // would have found it if that is the Trash. Once per query.
  const shrugged = useRef("");
  const shrugSaid = useRef("");
  const goRef = useRef(search?.goToTrash);
  goRef.current = search?.goToTrash;
  const query = search?.query.trim() ?? "";
  const nothing = search !== null && search.found === 0 && query.length > 0;
  const inTrash = search?.inTrash ?? 0;
  const searching = search !== null;
  useEffect(() => {
    if (!searching) {
      shrugged.current = "";
      // The search has closed: what it found nothing for is no longer the question.
      hush(shrugSaid.current);
    }
    // Results again: the line about nothing is no longer true, whatever its time.
    if (!nothing) hush(shrugSaid.current);
    if (!nothing || shrugged.current === query) return;
    const timer = window.setTimeout(() => {
      shrugged.current = query;
      mascotPlay("shrug");
      shrugSaid.current = robotSays(
        `Hm. Nothing for ${quoted(query)}`,
        inTrash > 0 ? { verb: "Go to Trash", label: "Go to Trash", run: () => goRef.current?.() } : undefined,
      );
    }, SHRUG_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [nothing, query, inTrash, searching]);

  return { waiting };
}

/** The board strip's tab for a board, by its name, if one is on screen. */
function tabNamed(name: string): HTMLElement | null {
  for (const tab of document.querySelectorAll<HTMLElement>('.board-tab[role="tab"]')) {
    // A tab reads its name, then its count: "Recipes12".
    const text = (tab.textContent ?? "").trim().replace(/\s*\d+$/, "");
    if (tab.title === name || text === name) return tab;
  }
  return null;
}
