import { clearDone, untickAll } from "../lib/blocks";
import { IconClearDone, IconUntick } from "./Icons";

/**
 * One rewrite of a whole list, and what its undo offer says about it.
 *
 * Handed to the caller as the rewrite itself rather than as the rewritten
 * text: the open note has to apply it to the text as it stands *at the click*
 * — the press blurs the editor first, and the commit that runs on that blur
 * may count a numbered list straight — not to the text this row was last
 * rendered with.
 */
export interface ListRewrite {
  run: (src: string) => string;
  /** The undo offer's words, given how many ticked items there were. */
  notice: (done: number) => string;
}

export const UNTICK_ALL: ListRewrite = { run: untickAll, notice: (n) => `Unticked ${n}` };
export const CLEAR_DONE: ListRewrite = { run: clearDone, notice: (n) => `Cleared ${n} done` };

/**
 * Untick all and Clear done — the two things said about a whole checklist at
 * once, drawn wherever a list is worked through: the strip under the open
 * note, and the Ticker's foot. One component so the two places cannot offer
 * different verbs, in a different order, under different names (web/CLAUDE.md,
 * "an action keeps one name in every place it is offered").
 *
 * Marks, not words, in the open note, whose row is a row of marks — the name is
 * the accessible name and the hover title. The Ticker asks for `worded`: its
 * foot has the room (a row of its own on a phone), and two bare icons there were
 * guessed at. **Drawn only while the text
 * has a ticked box in it**: with none, unticking has nothing to untick and
 * clearing nothing to clear, and a mark that does nothing is a lie.
 *
 * Neither is a destruction. Both go through the note's ordinary `body` write,
 * so they sync like a keystroke, and both are offered back through the undo
 * stack; `raw_content` keeps the original capture regardless.
 *
 * `mousedown` is deliberately *not* swallowed here, unlike Copy beside it. A
 * press that leaves the editor standing would rewrite the text under a live
 * caret; letting the press take the focus closes the editor and commits it
 * first, and the rewrite then lands on the reader.
 */
export function ListVerbs({
  done,
  className,
  worded = false,
  onRewrite,
}: {
  /**
   * How many boxes are ticked, counted by the caller from the blocks it has
   * already parsed. Not the text: the open note holds its blocks still while
   * the editor is up rather than parsing the whole note on every keystroke,
   * and a count taken here would be that parse again, per character.
   */
  done: number;
  className: string;
  /** Draw each mark with its name beside it. */
  worded?: boolean;
  onRewrite: (rewrite: ListRewrite) => void;
}) {
  if (done === 0) return null;
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={worded ? undefined : "Untick all"}
        title={worded ? undefined : "Untick all"}
        onClick={() => onRewrite(UNTICK_ALL)}
      >
        <IconUntick tier="inline" />
        {worded && <span>Untick all</span>}
      </button>
      <button
        type="button"
        className={className}
        aria-label={worded ? undefined : "Clear done"}
        title={worded ? undefined : "Clear done"}
        onClick={() => onRewrite(CLEAR_DONE)}
      >
        <IconClearDone tier="inline" />
        {worded && <span>Clear done</span>}
      </button>
    </>
  );
}
