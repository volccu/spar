import { useIsShort } from "../lib/breakpoint";
import { Count } from "./Count";
import { IconClear } from "./Icons";
import { Speech, type Said } from "./Speech";

/**
 * Everything in the header made of words, beside the creature. Moved out of
 * `App.tsx` with the speech bubble (2026-10-16), whose arrival is the reason
 * the row changed: the wordmark is gone — the creature is the app's identity
 * now — and the bubble stands where it stood. "sync failed" and "Update"
 * stopped being words of their own here and are things the creature says
 * (`lib/useSpeech.ts`).
 *
 * The row is one group so its words can sit on a shared baseline while the
 * group is centred against the creature, which is 56px tall and sets the
 * band's height.
 */
interface Props {
  said: Said | null;
  /** What sync just became, for a reader (`useSyncAnnouncement`). */
  announcement: string;
  /** What just happened to a note, for a reader. */
  offerMessage: string;
  updateReady: boolean;
  /** "This device only", or the demo's "Your notes stay in this browser". */
  quiet: { words: string; run: () => void } | null;
  /** What the board row cannot count: "3 selected", "5 found", "2 reminders". */
  headerCount: string | null;
  /** While notes are picked: the count is a button that ends the selection (review 2026-10-24, UX-15). */
  onEndSelection?: () => void;
}

export function HeaderWords({ said, announcement, offerMessage, updateReady, quiet, headerCount, onEndSelection }: Props) {
  // What the bubble says that no other region already does: a capture's
  // receipt, a link already saved, the answer to a poke or a double tap, a
  // reminder about to ring, the connection coming back, and a moment
  // (`lib/mascotMoments.ts`). The sync
  // words, the undo offer's message and the update each have a region below.
  const aloud = said && /^(landed|poke|link|saved|remind|sync|synced|moment):/.test(said.key) ? said.words : "";
  // On a short screen the words stand as a plate under the board row, with no
  // creature beside them to point at: the bubble has no tail there.
  const short = useIsShort();
  return (
    <div className="topbar-words">
      <Speech said={said} tail={!short} />
      {/* The creature is named for a screen reader but cannot report to one:
          a changed `aria-label` on something that is not a live region is not
          reliably announced. These are, so the reporting is done here — and
          every one of them is **mounted all the time**, because a region
          minted with its content already in it is the case assistive
          technology misses. Each is empty between its moments. */}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {offerMessage}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {aloud}
      </span>
      {/* A quiet setting rather than a status, and only while nothing is being
          said: beside a bubble it would be two voices at once. Not on a phone,
          where the menu says the same thing one tap away (2026-09-04, F8). */}
      {quiet && !said && (
        <button type="button" className="sync-state quiet-notice" data-state="off" onClick={quiet.run}>
          {quiet.words}
        </button>
      )}
      {headerCount && onEndSelection ? (
        <button
          type="button"
          className="count count-end mono"
          aria-label={`Cancel, ${headerCount}`}
          title="Cancel"
          onClick={onEndSelection}
        >
          <Count className="" text={headerCount} />
          <IconClear />
        </button>
      ) : (
        headerCount && <Count className="count mono" text={headerCount} />
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {updateReady ? "A new version is ready. Reload to use it." : ""}
      </span>
    </div>
  );
}
