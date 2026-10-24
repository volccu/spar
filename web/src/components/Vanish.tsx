import { useEffect } from "react";
import { VANISH_MS } from "../lib/motion";
import { IconArchive, IconDelete, IconFolder, IconRestore, IconTodo } from "./Icons";
import type { Leaving } from "../lib/useGridReflow";

export type Mark = "trash" | "archive" | "restore" | "move" | "todo";

/**
 * Which mark a note leaving the board for a given status shrinks into.
 *
 * Beside the type rather than in App.tsx, because it is the same question the
 * type asks and it was being answered by hand in three places — with twelve
 * more bare assignments around them. The mark is the only thing telling the
 * user where the note just went, so a path that sets the wrong one, or
 * inherits whatever the last path happened to set, is a note that appears to
 * have gone somewhere it did not. A sixth mark now has one place to be added.
 */
export function markFor(status: "active" | "archived" | "trashed"): Mark {
  if (status === "trashed") return "trash";
  if (status === "archived") return "archive";
  return "restore";
}

export interface Ghost extends Leaving {
  mark: Mark;
}

interface Props {
  ghosts: Ghost[];
  onDone: () => void;
}

/**
 * What a card does when it stops being on the board.
 *
 * The real card is already gone — the grid is closing over its slot in the same
 * frame — so this is a still of it, pinned where it stood, shrinking into the
 * mark of what just happened to it. Two things are being said at once: *this
 * one*, and *this is where it went*. Neither one survives being said in words
 * a moment later by the undo offer.
 *
 * It is not interactive and it isn't announced: the undo offer already
 * offers the undo, and a screen reader shouldn't have to sit through a picture.
 */
export function Vanish({ ghosts, onDone }: Props) {
  useEffect(() => {
    if (ghosts.length === 0) return;
    // The last one starts latest, so the layer lives until it has finished.
    const t = window.setTimeout(onDone, VANISH_MS + ghosts.length * 26 + 80);
    return () => window.clearTimeout(t);
  }, [ghosts, onDone]);

  if (ghosts.length === 0) return null;

  return (
    <div className="vanish-layer" aria-hidden>
      {ghosts.map((g, i) => (
        <div
          key={g.id}
          className="vanish"
          style={
            {
              left: g.rect.left,
              top: g.rect.top,
              width: g.rect.width,
              height: g.rect.height,
              // Emptying a selection of six should read as a run, not a flash.
              // Capped, or clearing the trash would be half a second of stagger.
              "--vanish-delay": `${Math.min(i, 5) * 26}ms`,
            } as React.CSSProperties
          }
        >
          <div className="card vanish-card">
            <div className="card-body">{g.text}</div>
          </div>
          <span className="vanish-mark">
            {g.mark === "trash" ? (
              <IconDelete />
            ) : g.mark === "archive" ? (
              <IconArchive on />
            ) : g.mark === "move" ? (
              <IconFolder tier="nav" />
            ) : g.mark === "todo" ? (
              <IconTodo on tier="nav" />
            ) : (
              <IconRestore />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
