import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { FORMATS, type Format } from "../lib/format";
import { hasKeyboard, isTypingTarget } from "../lib/hotkeys";
import { hangFrom, hangUnder, keepInside } from "../lib/pointerAnchor";
import { Action } from "./shared/Action";
import {
  IconAttachment,
  IconCheck,
  IconCode,
  IconDate,
  IconReminder,
  IconSplit,
} from "./Icons";

/**
 * Things you can put into a note at the caret.
 *
 * A list, because the list is going to grow — an image is coming, and whatever
 * comes after it lands here as one more row rather than as a second control in
 * the bar. `caret` is where the cursor should end up inside what was inserted,
 * so a tick box leaves you typing the item and a code block leaves you inside
 * the fences rather than after them.
 *
 * A row with `text: null` is worked out at the moment it is tapped, and is
 * the one kind of insert that goes *into* the line rather than onto a line of
 * its own (`insertInline`): today's date is a word in a sentence — "call back
 * on 27 Sep 2026" — where a box or a fence means nothing mid-sentence. Its
 * caret is always straight after what went in.
 */
export const INSERTS = [
  { label: "Code block", text: "```\n\n```", caret: 4 },
  { label: "Today's date", text: null, caret: 0 },
  // Last, so it sits nearest the thumb. Position is the only emphasis a panel
  // in this app gets; nothing inverts to call itself the primary row.
  { label: "Tick box", text: "[ ] ", caret: 4 },
] as const;

/** One row of `INSERTS`. */
export type Insert = (typeof INSERTS)[number];

/** The Code block row, which the note's right-click menu also offers for a
 *  selection (`NoteMenu`): one act, one name, wherever it is drawn. */
export const CODE_BLOCK = INSERTS[0];

/** Each row's mark, from `Icons.tsx` like every other. */
function insertMark(item: Insert) {
  if (item.label === "Code block") return <IconCode tier="inline" />;
  if (item.label === "Today's date") return <IconDate />;
  return <IconCheck />;
}

/**
 * Heading, Bold and Italic as one row of short letter marks — the insert
 * panel's first row, and the note's right-click menu's when words are picked
 * out (`NoteMenu`). Each swallows `mousedown`, so the selection it acts on is
 * still there when the click lands.
 */
export function FormatRow({ onFormat }: { onFormat: (fmt: Format) => void }) {
  return (
    <div className="fmtrow" role="group" aria-label="Format">
      {FORMATS.map((f) => (
        <button
          key={f.label}
          type="button"
          className="fmtbtn mono"
          data-mark={f.label}
          title={f.title}
          aria-label={f.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onFormat(f)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The open note's insert panel: the format row, then — while something is
 * selected — New note from selection, then Attachment, the reminder, and
 * `INSERTS` nearest the thumb. Whether it is open is the note's
 * (`inserting`), and every row hands its act back up — the text maths and the
 * caret are the note's business, not the panel's.
 */
export function InsertPanel({
  from,
  reminderSet,
  onFormat,
  onSplit,
  onAttach,
  onReminder,
  onInsert,
  onClose,
}: {
  /** The + that opened it. With a mouse the panel hangs under it, as the
   *  reminder panel and Move do — except at phone width, where the + is in the
   *  bar at the foot and there is no room under it (`hangFrom`); otherwise it
   *  stands in the bottom-right corner, where the thumb is. Read once, when
   *  the panel opens. */
  from: RefObject<HTMLElement | null>;
  /** Whether the note already has a reminder, which renames its row. */
  reminderSet: boolean;
  onFormat: (fmt: Format) => void;
  /**
   * Moves the selected words out into a note of their own. Handed down only
   * while there is a selection worth moving, and the row is not drawn
   * otherwise — a row that did nothing with no selection would be a row that
   * sometimes lies.
   */
  onSplit?: () => void;
  /** Opens the file picker, and closes the panel. */
  onAttach: () => void;
  /** Closes this panel and opens the reminder panel in its place. */
  /** Absent on a note in the Trash (audit UX-2). */
  onReminder?: () => void;
  onInsert: (item: Insert) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchor] = useState(() => hangFrom(from.current));
  // The focus comes in with the panel (review UX-B-05): opened from the
  // keyboard, the focus fell to the page. With a keyboard it lands on the first
  // row; on a touch screen on the panel itself, which draws no ring. Not when
  // the editor holds it — the + keeps the caret for a tap, and the rows act
  // on it. The note hands it back to the + on close.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (anchor) keepInside(el, anchor);
    if (isTypingTarget(document.activeElement)) return;
    const first = hasKeyboard(false) ? el.querySelector<HTMLElement>("button:not(:disabled)") : el;
    first?.focus({ preventScroll: true });
    // Once, on opening: the anchor is read when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <button
        type="button"
        className="menu-dismiss menu-dismiss-over"
        aria-label="Close insert menu"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={
          anchor ? "selpanel selpanel-under selpanel-over" : "selpanel selpanel-right selpanel-over"
        }
        style={anchor ? hangUnder(anchor) : undefined}
        role="menu"
        aria-label="Insert"
        tabIndex={-1}
      >
      {/* One row, three marks. These act on text that is already written,
          which makes them a different question from the rows below — and
          three more rows would have taken this panel to eight on a
          phone. */}
      <FormatRow onFormat={onFormat} />
      {/* Split, the inverse of merge. It sits straight under the format row
          because it is the same kind of question — it acts on words already
          written, and on the ones picked out — and furthest from the thumb of
          the rows, because it is the one row here that takes words *out* of
          this note. It destroys nothing: the words land in a new note in the
          same folder, and one undo puts both halves back. */}
      {onSplit && (
        <Action
          role="menuitem"
          keepFocus
          label="New note from selection"
          onClick={onSplit}
        >
          <IconSplit />
        </Action>
      )}
      {/* One row, saying the same word the capture bar's panel says, and
          reaching everything a note can carry. A picture is usually here
          by Ctrl+V or by the phone's share sheet long before anybody opens
          this panel looking for it. */}
      <Action
        role="menuitem"
        keepFocus
        label="Attachment"
        onClick={onAttach}
      >
        <IconAttachment />
      </Action>
      {onReminder && (
        <Action
          role="menuitem"
          keepFocus
          label={reminderSet ? "Change reminder" : "Set reminder"}
          onClick={onReminder}
        >
          <IconReminder tier="inline" />
        </Action>
      )}
      {INSERTS.map((item) => (
        <Action
          key={item.label}
          role="menuitem"
          keepFocus
          label={item.label}
          onClick={() => onInsert(item)}
        >
          {insertMark(item)}
        </Action>
      ))}
      </div>
    </>
  );
}
