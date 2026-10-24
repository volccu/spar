import { samples, type Gesture } from "./speed";

/** Reading back what `speed.ts` recorded — the About page's half, off the first paint. */

export const GESTURES: readonly Gesture[] = ["capture", "open", "type", "find"];

/** The promise being checked, from SPEC §2.6. */
export const PROMISE_MS = 50;

export interface Speed {
  gesture: Gesture;
  /** Median of the recent samples, in whole milliseconds; null before the first. */
  median: number | null;
  count: number;
}

export function speeds(): Speed[] {
  return GESTURES.map((gesture) => {
    const list = [...(samples.get(gesture) ?? [])].sort((a, b) => a - b);
    if (list.length === 0) return { gesture, median: null, count: 0 };
    const mid = list.length >> 1;
    const median = list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
    return { gesture, median: Math.round(median), count: list.length };
  });
}
