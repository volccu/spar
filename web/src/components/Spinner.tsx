import { useId } from "react";

/**
 * The app's one loading mark — an hourglass, turned and drained by CSS,
 * decorative only (`aria-hidden`) beside whatever text is actually doing
 * the announcing (a `role="status"`/`role="alert"` paragraph, as at every
 * call site — the mark is never the only thing saying "loading").
 *
 * Adapted from a design proposal (`TEMP/loading-spinner.html`), with two
 * things cut rather than ported:
 *
 *  - The sand was drawn in the app's one warm hue, `--sand-color: #c06c53`.
 *    That hue does not exist here — DESIGN.md is absolute that the app has
 *    no colour at all, not even one accent — so the whole mark is drawn in
 *    `currentColor` instead, the same convention `SyncMark` uses, coloured
 *    by whoever places it.
 *  - The whole drawing was distorted every 300ms by an SVG turbulence
 *    filter driven by a raw SMIL `<animate>` on `feTurbulence`'s seed — a
 *    second, uninvited animation system running beside the one
 *    `lib/motion.ts` already is, unable to fold into
 *    `prefers-reduced-motion` the way everything else here does, and a
 *    wobble nothing else in a hard-edged, brutalist app reaches for either.
 *    What's left is the actual mechanism: the glass turning, the sand
 *    draining, the stream running — in plain CSS keyframes, the same
 *    mechanism `SyncMark`'s two nodes turn on, and just as silenced under
 *    reduced motion (styles.css).
 *
 * `clipPath` ids are per-instance (`useId`) so two spinners on screen at
 * once never share one — SVG ids are document-global, and a second, static
 * copy pinned to the first instance's clip would only look wrong.
 */
export function Spinner({ size = 40 }: { size?: number }) {
  const uid = useId();
  const topClip = `spinner-top-${uid}`;
  const bottomClip = `spinner-bottom-${uid}`;

  return (
    <svg
      className="spinner"
      style={{ width: size, height: size }}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={topClip}>
          <path d="M 27 17 C 27 38 45 43 49 48 L 51 48 C 55 43 73 38 73 17 Z" />
        </clipPath>
        <clipPath id={bottomClip}>
          <path d="M 49 52 L 51 52 C 55 57 73 62 73 83 L 27 83 C 27 62 45 57 49 52 Z" />
        </clipPath>
      </defs>
      <g className="spinner-flip">
        <g clipPath={`url(#${topClip})`}>
          <rect className="spinner-sand spinner-sand-top" x="10" y="10" width="80" height="50" />
        </g>
        <g clipPath={`url(#${bottomClip})`}>
          <rect className="spinner-sand spinner-sand-bottom" x="10" y="50" width="80" height="50" />
        </g>
        <line className="spinner-stream" x1="50" y1="50" x2="50" y2="83" />
        <path
          className="spinner-glass"
          d="M 25 15 C 25 40 45 45 45 50 C 45 55 25 60 25 85 L 75 85 C 75 60 55 55 55 50 C 55 45 75 40 75 15 Z"
        />
        <line className="spinner-glass" x1="20" y1="15" x2="80" y2="15" />
        <line className="spinner-glass" x1="20" y1="85" x2="80" y2="85" />
      </g>
    </svg>
  );
}
