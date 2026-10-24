/* --- how fast the 90% path actually is, on this device ----------------------
   SPEC §2.6 promises that open, capture, edit and find each reach the screen in
   under 50ms, and until this file nothing measured it: the promise was a rule
   in a document, and the phone was never asked.

   So each of those four gestures is timed from the moment the app hears it to
   the frame that shows its answer — the second animation frame after it, which
   is the first one painted with the change in it — and the About page shows
   the median of the last few (`speedReport.ts`). It is the honest number to
   show, because it is what a person waits for, frame and all; it is also a
   floor of roughly one frame (≈16ms at 60Hz) that no speed in the app can go
   under.

   **Nothing is stored and nothing leaves the device.** A ring of numbers in
   memory, for this session, read by one page. There is no telemetry here and
   there never may be: the notes are nobody else's business, and neither is
   how the app is used.

   This half is the recorder and nothing else, because it is imported by the
   hot path and so rides on the first paint; reading the numbers back is the
   About page's business and loads with it.
   -------------------------------------------------------------------------- */

export type Gesture = "open" | "capture" | "type" | "find";

const KEEP = 20;
export const samples = new Map<Gesture, number[]>();
const pending = new Set<Gesture>();

export function record(gesture: Gesture, ms: number): void {
  const list = samples.get(gesture) ?? [];
  list.push(ms);
  if (list.length > KEEP) list.shift();
  samples.set(gesture, list);
}

/**
 * Times a gesture from now to the frame that shows its answer. Call it the
 * moment the gesture is heard, before the work. At most one measurement per
 * gesture is in flight, so a burst of keystrokes costs one pair of frame
 * callbacks, not one per character.
 */
export function timeToFrame(gesture: Gesture): void {
  if (pending.has(gesture) || typeof requestAnimationFrame !== "function") return;
  pending.add(gesture);
  const start = performance.now();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      pending.delete(gesture);
      record(gesture, performance.now() - start);
    }),
  );
}
