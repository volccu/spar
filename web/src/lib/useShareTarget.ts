import { useEffect, useRef } from "react";
import { hasContent } from "./files";
import { takeShared, type SharedCapture } from "./shareTarget";
import { pictureArrived, robotSays } from "./mascotMoments";

interface Options {
  /** The local archive is still being read. Nothing is collected until it is in. */
  loading: boolean;
  /**
   * Words alone, handed to the write field unsaved (review 2026-10-04,
   * FX-A-02). `then` runs once they are in the field's draft, which is when
   * the share's parking space may be emptied.
   */
  offer: (text: string, then: () => void, boardOffer?: { id: string; name: string } | null) => void;
  /**
   * A share carrying files, held for one tap (2026-10-10, owner approved,
   * audit SEC-1). Nothing is made until the reader says Save; the share stays
   * parked until then, so a reload brings the same offer back.
   */
  hold: (shared: SharedCapture) => void;
  /** Says which shared files the worker left out, when nothing else came. */
  tellLeft: (left: NonNullable<SharedCapture["left"]>) => void;
  /**
   * Where the share's Inspiration offer points, read when the share is taken —
   * not when the hook mounted. Null until the board exists on this device: a
   * share collected before then simply gets no offer.
   */
  inspirationRef?: { readonly current: { id: string; name: string } | null };
}

/**
 * Photographs sent here from the phone's own share sheet.
 *
 * The share arrives as a POST that never reaches a server: the manifest names
 * `/share`, `public/share-sw.js` answers it inside the service worker, parks
 * what it found in a cache and sends the browser here. So by the time the app
 * is running the share is already waiting, and this is only the collection.
 *
 * It runs on every open rather than on the `?shared=1` the worker redirects
 * to, so a share whose navigation went astray is still picked up next time
 * instead of sitting in the cache forever. `takeShared` empties the inbox as
 * it reads it, and answers `null` — with no cache opened and nothing else
 * touched — on every ordinary open, which is nearly all of them.
 *
 * Pictures and words together are one note, exactly as dropping eight files
 * on the window is one note: selecting eight photographs in the gallery is
 * one thing being sent, not eight. **That note waits for one tap** (2026-10-10,
 * owner approved, audit SEC-1): any website can post a form to `/share`, so a
 * share of files used to be a way for a page to plant pictures in the notes
 * and on the server. The bar now says what arrived, with Save beside it
 * (`hold`), and the files stay parked until then. **Words
 * alone wait in the write field** (review 2026-10-04, FX-A-02, owner approved
 * 2026-10-05): a blank first line holding the caret, the page under it, the
 * marks offered, and one tap or Enter saves. They used to be saved blind, so
 * why a page was kept was lost at the one moment it was known. The bar's
 * draft survives a reload, so a share left unsaved is never lost — and the
 * bar's own "Saved … · Open" line says so if the page is already here.
 *
 * It waits for the archive, exactly as `lib/useReturnSpot.ts` does, and the
 * wait is not caution. The local read replaces the whole list
 * outright (`load` in `store/useNotes.ts`), so a note created before it
 * lands is wiped straight off the board — persisted to this device, but gone
 * from the screen, with the trace pointing at a card that is not there. A
 * cold start *is* the case this feature exists for: the share is what starts
 * the app, and reading a cache beats opening IndexedDB and reading 241 notes
 * easily. The re-load a sign-in triggers cannot drain a second time; the ref
 * is already spent.
 *
 * The ref is not belt and braces either. `offer` and `hold` never
 * change, so this fires once — except in StrictMode, which runs every effect
 * twice on purpose to catch exactly this, and two drains racing each other
 * could both read the cache before either deleted it, and make the note
 * twice.
 */
export function useShareTarget({ loading, offer, hold, tellLeft, inspirationRef }: Options): void {
  const shareTaken = useRef(false);
  useEffect(() => {
    if (shareTaken.current || loading) return;
    shareTaken.current = true;
    // Cleared out of the address bar straight away, the same way `?note=` is:
    // it is a signal from the worker to this open, not a place to come back to.
    // The entry's state is kept: it may be `useDismissOnBack`'s.
    if (new URLSearchParams(window.location.search).has("shared")) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    void takeShared().then((shared) => {
      if (!shared) return;
      // Waiting and unreadable, and dropped (`UNREADABLE`): said, because
      // otherwise a share just vanishes. Asked as "is it a string" so a test's
      // stand-in for the module need not carry the marker.
      if (typeof shared === "string") {
        robotSays("Uh-oh. Couldn't read what you shared. Try again.");
        return;
      }
      // A folder arrives as a `File` with no bytes and is never a note's file
      // (`withinLimit` drops it without a word), so it is not worth asking
      // about: a share that is only that is a share of its words.
      if (shared.files.some(hasContent)) {
        // Held, not saved: the bar says what came and offers Save. The share is
        // spent by that Save (or by the reader letting it go), never here.
        hold(shared);
        // A picture coming in: the creature's screen flashes like a camera.
        if (shared.files.some((f) => f.type.startsWith("image/"))) pictureArrived();
        return;
      }
      // Every file was left out by the worker's bounds — said, as a refusal
      // at the door always is, and then the words (if any) go on alone.
      if (shared.left) tellLeft(shared.left);
      // Emptied only once there is a note to point at — see
      // `SharedCapture.commit`.
      const done = () => void shared.commit();
      if (!shared.text) {
        done();
        return;
      }
      // Words alone wait in the write field for one tap, and the share is
      // spent once they are drafted.
      offer(shared.text, done, inspirationRef?.current ?? null);
    });
  }, [loading, offer, hold, tellLeft, inspirationRef]);
}
