import { useMemo } from "react";
import type { HeldNote } from "../store/held";
import type { Note } from "../types";

interface Props {
  /** A note, a canvas or the folder list on screen and not yet on disk — the
   *  first of the three stores' words, or null. */
  unsaved: string | null;
  /** The archive itself could not be read, so the way out is a reload. */
  loadFailed: boolean;
  onRetryUnsaved: () => void;
  /** Notes the server will not take (`store/held.ts`). */
  held: HeldNote[];
  /** The archive, to name a single held note by its first line. */
  notes: Note[];
  onRetryHeld: () => unknown;
  onKeepHeldLocal: () => unknown;
}

/**
 * The two banners under the header, each saying "somewhere this note has not
 * reached": this device (a write or a read IndexedDB refused), or the server
 * (a note it will not take).
 */
export function StorageBanners({
  unsaved,
  loadFailed,
  onRetryUnsaved,
  held,
  notes,
  onRetryHeld,
  onKeepHeldLocal,
}: Props) {
  /**
   * A note the server will not take, said once rather than as a sync mark
   * that reads "failed" forever (`store/held.ts`).
   *
   * It is a different fact from the banner above it, which is about this
   * *device* having no room: that note is on screen and not on disk, this one
   * is on disk and not on the server. Both are "somewhere this note has not
   * reached", so they share a shape, and only one of them can be true about
   * any given note at a time.
   *
   * The reason is the server's own sentence, and it goes to the console, not
   * the screen (review CD-01): it names a column or a constraint, never a
   * cause the person can act on. The screen says what to do instead.
   */
  const heldWords = useMemo(() => {
    if (held.length === 0) return null;
    for (const one of held) console.error("the server refused a note", one.id, one.message);
    if (held.length > 1) {
      return `${held.length} notes could not be saved to the server. Try again, or keep them on this device only.`;
    }
    const words = notes.find((n) => n.id === held[0].id)?.body.trim().split("\n")[0] ?? "";
    const named = words ? `“${words.slice(0, 40)}${words.length > 40 ? "…" : ""}”` : "That note";
    return `${named} could not be saved to the server. Try again, or keep it on this device only.`;
  }, [held, notes]);

  return (
    <>
      {unsaved && (
        <div className="storage-warning" role="alert">
          <span>{unsaved}</span>
          {/* A write that failed can be tried again from the queue it left. An
              archive that could not be *read* left no queue — the only thing
              that asks the database again is a reload, so that is the button,
              and it is named for what it does. */}
          {loadFailed ? (
            <button type="button" className="mono" onClick={() => window.location.reload()}>
              Reload
            </button>
          ) : (
            <button type="button" className="mono" onClick={onRetryUnsaved}>
              Try again
            </button>
          )}
        </div>
      )}

      {heldWords && (
        <div className="storage-warning" role="alert">
          <span>{heldWords}</span>
          <span className="storage-warning-actions">
            <button type="button" className="mono" onClick={() => void onRetryHeld()}>
              Try again
            </button>
            <button type="button" className="mono" onClick={() => void onKeepHeldLocal()}>
              Stop sending
            </button>
          </span>
        </div>
      )}
    </>
  );
}
