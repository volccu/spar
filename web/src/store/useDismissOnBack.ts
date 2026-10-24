import { useEffect, useRef } from "react";

/** What the one entry this hook pushes carries, so it can be told apart. */
export const LAYER_STATE = { spar: "layer" } as const;

/** Whether a history state is one of this hook's entries — live or left over. */
export function isLayerEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { spar?: unknown }).spar === "layer";
}

/**
 * How long our own `history.back()` is waited on before it is taken as never
 * coming. A same-document Back answers within a frame or two on a desktop and
 * well inside this on a slow phone; the wait only matters on a runtime that
 * swallows the step without a `popstate`, and there it is the delay before
 * history is put right again.
 */
export const BACK_ANSWER_MS = 1000;

/**
 * Makes the phone's back gesture and the browser's back button close whatever
 * is open on top of the grid, instead of leaving the app.
 *
 * Without this, opening a note changes what is on screen but not what the
 * browser thinks the page is, so back walks out of the app entirely — a blank
 * screen on Android, and nothing at all on desktop.
 *
 * One history entry, not one per layer. The note view and multi-select are
 * mutually exclusive, and merge hands straight from one to the other in a
 * single render; a per-layer entry would push and pop in the same tick and
 * lose the race. So: something is open, or nothing is.
 *
 * Deliberately does *not* trap back at the top level. Pressing back on the
 * grid should close the app, the way every other app on the phone behaves —
 * **in one press**: with nothing open, no entry of ours may be left under the
 * board (2026-10-12, the owner's "it takes two backs to close spår").
 *
 * `dismiss` may report that it closed something *inside* the open layer rather
 * than the layer itself — a picture at full screen over the note. That is still
 * one entry, not two: the entry is put straight back, because the screen the
 * user is on has not changed. Pushing an entry per layer is what loses the race
 * when merge hands selection to the note view in a single render.
 *
 * **And the report is not the only way to learn that something is still
 * open.** `dismiss` answers `false` for "that layer closed", which is true of
 * the layer and says nothing about what was under it: a selection made inside
 * a search, the Look sheet over the phone's drawer, a note opened from a
 * search. Trusting the answer alone put no entry back for any of those, so the
 * second Back walked out of the app with search or the drawer still on screen.
 * `open` is the whole app's answer, so it is read again once React has
 * committed the dismissal, and the entry goes back if anything is still up.
 *
 * **One step at a time.** `history.back()` is asynchronous: a request,
 * answered later by a `popstate`. A layer that closes and another that opens
 * before that answer — a note closed and the next card tapped at once — used
 * to push the new entry with the old Back still in flight, and the browsers
 * disagree about what that means (measured 2026-10-12, Chromium and Firefox):
 * Chromium runs the Back *after* the push, so the stale `popstate` read as the
 * user's Back and closed the new note by itself; Firefox *drops* the pending
 * Back when a push follows in the same task, so the old entry stayed under the
 * new one — and once that note closed, the board stood on an entry of ours and
 * Back took two presses to leave. So nothing is pushed while our own Back is
 * unanswered: `settle` waits for it, then makes history match `open`.
 *
 * **And an entry of ours with nothing open is never kept.** Whatever left one
 * there — a reload or a restored session landing on it, a Back of ours some
 * runtime swallowed, an older build — `settle` reads where the page actually
 * stands (`history.state`), not only what it remembers pushing: on one of our
 * entries with nothing open it steps back over it, and with something open it
 * adopts it rather than push a second. On boot that runs once, before anything
 * is opened; after a Back, once the dismissal has rendered. Either way the
 * board is left on the entry under all of ours, so the next Back leaves.
 */
export function useDismissOnBack(open: boolean, dismiss: () => boolean | void) {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  /** `open` as of the last render — what the frame after a dismissal reads. */
  const openRef = useRef(open);
  openRef.current = open;
  /** Whether *our* entry is the one the page stands on. */
  const pushed = useRef(false);
  /** Our own `history.back()` calls whose `popstate` has not arrived yet. */
  const backing = useRef(0);
  /** `settle`, for the `open` effect below; it reads nothing but refs. */
  const settleRef = useRef<() => void>(() => {});

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    /** Waits on our own Back, in case its answer never comes. */
    function armTimer() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Never answered: the step was swallowed. Stop waiting, and put
        // history right from where the page actually stands.
        backing.current = 0;
        settle();
      }, BACK_ANSWER_MS);
    }
    function retreat() {
      // At the app's first entry there is nothing of ours to step over, and a
      // Back would leave the app — where the Navigation API can say so.
      const nav = (window as { navigation?: { canGoBack?: boolean } }).navigation;
      if (nav && nav.canGoBack === false) return;
      backing.current += 1;
      armTimer();
      window.history.back();
    }
    function settle() {
      // Our own Back is still on its way: whatever happens next waits for it,
      // or a push now would race it ("One step at a time", above).
      if (backing.current > 0) return;
      const onOurs = isLayerEntry(window.history.state);
      if (openRef.current) {
        if (pushed.current) return;
        pushed.current = true;
        // Standing on an entry of ours already (left over, or where the last
        // Back landed): it is the one entry, not a reason for a second.
        if (!onOurs) window.history.pushState(LAYER_STATE, "");
        return;
      }
      // Closed from inside the app — Back button, Escape, Archive — or an
      // entry of ours that nothing is open on: take it off the stack, so one
      // press of the real back button leaves from the board.
      if (pushed.current || onOurs) {
        pushed.current = false;
        retreat();
      }
    }
    settleRef.current = settle;
    // A remount (StrictMode's, in development) while a Back of ours is out:
    // the wait went with the old effect, and is taken up again here.
    if (backing.current > 0) armTimer();

    function onPopState() {
      if (backing.current > 0) {
        // The answer to our own Back, not the user's: nothing to dismiss.
        backing.current -= 1;
        if (backing.current === 0) window.clearTimeout(timer);
        settle();
        return;
      }
      if (!pushed.current) {
        // Not off an entry of ours — Forward onto an old one, a Back off one
        // left over. Nothing to close; only history to put right, once any
        // render in flight is through.
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(settle);
        return;
      }
      // The browser has already removed our entry; only close the layer.
      pushed.current = false;
      const stillOpen = dismissRef.current() === true;
      // Something was closed from *inside* the layer and the layer is still
      // there. The `open` effect only fires when `open` changes, and it
      // hasn't — so the entry goes back here, or the next press walks out of
      // the app from a screen the user is still looking at.
      if (stillOpen) {
        settle();
        return;
      }
      // The layer closed, but maybe not the last one. The dismissal is a state
      // change that has not rendered yet, so `open` is asked a frame later,
      // once it has: the entry goes back if anything is still up — and if
      // nothing is, but the Back landed on another entry of ours, the page
      // steps over that one too.
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(settle);
    }
    window.addEventListener("popstate", onPopState);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  // Declared after the listener's effect, so `settle` is in place on mount —
  // where it also steps off an entry of ours the page was loaded onto.
  useEffect(() => {
    settleRef.current();
  }, [open]);
}
