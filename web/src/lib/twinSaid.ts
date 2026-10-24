import { useSyncExternalStore } from "react";
import type { BarLine } from "../components/CaptureLine";

/**
 * "You saved this 3 days ago · Open", handed from the capture bar to the
 * header's creature (2026-10-16, owner approved). The bar is what knows the
 * words being written and whether an address in them is already in a note
 * (`findSaved`, `lib/savedLinks.ts`); the creature is what says it. A store of
 * one value rather than state in `App`, so the bar can hand it over without
 * the app re-rendering on every keystroke that changes nothing.
 */

let twin: BarLine | null = null;
/** The newest Open, so the value read stays one object while the match does. */
let latestAct: () => void = () => {};
const listeners = new Set<() => void>();

/**
 * The bar's current match, or null. The same match handed again — the bar
 * builds a fresh one on every render — changes nothing that is read, only
 * which Open runs: a store that handed out a new object each time would make
 * every reader render again, and the bar with it, for ever.
 */
export function setTwin(next: BarLine | null) {
  if (next) latestAct = next.act;
  if ((twin?.key ?? null) === (next?.key ?? null) && twin?.said === next?.said) return;
  twin = next ? { ...next, act: () => latestAct() } : null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => twin;

/** The saved note the words in the bar already point at, for the creature to say. */
export function useTwin(): BarLine | null {
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The bar's "Saved 3 days ago" as the creature says it: "You saved this 3 days
 * ago", "You saved this on 5 Aug, it's in the Archive".
 */
export function twinWords(said: string): string {
  const archived = /, archived$/.test(said);
  const base = said.replace(/, archived$/, "");
  const words = /^Saved /.test(base) ? base.replace(/^Saved /, "Hm. You saved this ") : "Hm. You already saved this";
  return archived ? `${words}, it's in the Archive` : words;
}
