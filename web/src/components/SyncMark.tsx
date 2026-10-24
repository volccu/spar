/**
 * Sync, drawn rather than spelled.
 *
 * Two nodes — this device and the other one. At rest they sit exactly on top
 * of each other, because that is what "synced" means: two copies of the same
 * thing in the same place. While syncing they part, a dashed stream stretches
 * out from the centre, and they snap back together with a jelly bounce. The
 * motion lives in styles.css, one turn of MIN_WORKING_MS.
 *
 * Drawn here rather than imported: no icon set has a word for "these two
 * devices hold the same thing", and the states are animated. It follows the
 * Heroicons the rest of the chrome uses — softened corners, round caps — so it
 * reads as one of them rather than as the one mark from somewhere else.
 *
 * Only the two calm states are drawn. Offline and failed stay as words — a
 * silent icon is the wrong way to tell someone their notes aren't leaving the
 * device.
 */
/**
 * One turn of the mark's animation, start to finish.
 *
 * It lives here, with the drawing, because it is a fact about the drawing:
 * everything that puts the mark into its `working` state has to hold it there
 * for at least this long or the gesture is cut off mid-part, which reads as a
 * twitch rather than as a sync. Two callers need it — `store/useSync.ts`, which
 * holds the header's state open across a sync that finished in 80ms, and the
 * open note, which holds its save mark open across a keystroke — and neither
 * may reach the other: the note would be importing the whole sync loop, and
 * through it Supabase, for one number.
 *
 * Must match the animation duration in styles.css.
 */
export const MIN_WORKING_MS = 1400;

export function SyncMark() {
  return (
    <svg
      className="syncmark"
      viewBox="0 0 24 12"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <g className="syncmark-stream">
        <line x1="6" y1="6" x2="18" y2="6" />
      </g>
      <g className="syncmark-a">
        <g className="syncmark-node jelly-pulse-l">
          <circle cx="12" cy="6" r="3" />
        </g>
      </g>
      <g className="syncmark-b">
        <g className="syncmark-node jelly-pulse-r">
          <circle cx="12" cy="6" r="3" />
        </g>
      </g>
    </svg>
  );
}
