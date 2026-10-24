import { useLayoutEffect, useMemo, useRef } from "react";
import { keepAbove, pointerAnchor, slideInside } from "../lib/pointerAnchor";
import { isTypingTarget } from "../lib/hotkeys";
import { walkRows } from "../lib/rowKeys";
import type { Format } from "../lib/format";
import { Action } from "./shared/Action";
import { FormatRow } from "./InsertPanel";
import {
  IconArchive,
  IconCode,
  IconCopy,
  IconDelete,
  IconFolder,
  IconPriority,
  IconReminder,
  IconRestore,
  IconSplit,
  IconTodo,
} from "./Icons";

interface Props {
  /** Where the pointer was when the right-click came. */
  at: { x: number; y: number };
  /** Words are picked out, so the rows about them are drawn at the top. */
  picked: boolean;
  important: boolean;
  /** Whether the note is on Todos (`isTodoNote`), as the bar's mark reads it. */
  todo: boolean;
  archived: boolean;
  trashed: boolean;
  reminderSet: boolean;
  /** Absent rows are not drawn: a row the note cannot answer is never shown. */
  onFormat?: (fmt: Format) => void;
  /** Puts the picked lines between ``` fences, as the insert panel's Code
   *  block row does with a selection. */
  onCodeBlock?: () => void;
  onCopyPicked?: () => void;
  onSplit?: () => void;
  onCopy?: () => void;
  /** Absent on a note in the Trash (audit UX-2). */
  onImportant?: () => void;
  onTodo?: () => void;
  onReminder?: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onMove?: () => void;
  /** A second right-click while the menu is up: open again there. */
  onReopen: (at: { x: number; y: number }) => void;
  onClose: () => void;
}

/**
 * The open note's right-click menu, on a desktop with a mouse — the board's
 * right-click on a card, said inside the note (`SelectionBar` opened at the
 * pointer, review 2026-10-01, UX-11).
 *
 * Same panel, same rows, same order, so a hand that knows one knows the other:
 * Copy, Important, To-do and the reminder leave the note where it is; under
 * the one hairline, Delete, Archive and Move change where it *is*. The six
 * marks in the bar are still the way in for a finger — this is the second
 * door the board has too, opened where the mouse already is.
 *
 * With words picked out it leads with what acts on those words — the insert
 * panel's format row, Code block, Copy selection and New note from selection — because
 * that is the question a right-click on a selection is asking. The browser's
 * own menu is still one Shift away, and is left alone on a link, a picture
 * and a field (`NoteView`'s `openNoteMenu` decides).
 *
 * Opened from the editor, the caret and the selection stay in the text (every
 * row swallows `mousedown`, as the insert panel's do), so a format lands on
 * the words still highlighted. Opened while reading, the panel takes the focus
 * so the arrows walk it; Escape and Back close it through the note.
 */
export function NoteMenu({
  at,
  picked,
  important,
  todo,
  archived,
  trashed,
  reminderSet,
  onFormat,
  onCodeBlock,
  onCopyPicked,
  onSplit,
  onCopy,
  onImportant,
  onTodo,
  onReminder,
  onDelete,
  onArchive,
  onMove,
  onReopen,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Read once per opening, as the selection panel's is.
  const anchor = useMemo(
    () => pointerAnchor(at, { width: window.innerWidth, height: window.innerHeight }),
    [at],
  );
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    // Lifted once measured, so a click near the foot of the window does not
    // hang the panel off it. Nothing measured is a test: leave it hanging.
    const height = el.getBoundingClientRect().height;
    if (height > 0) {
      el.style.top = `${keepAbove(at.y, height, window.innerHeight)}px`;
      slideInside(el);
    }
    if (!isTypingTarget(document.activeElement)) el.focus({ preventScroll: true });
  }, [at]);

  return (
    <>
      <button
        type="button"
        className="menu-dismiss menu-dismiss-over"
        aria-label="Close menu"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onReopen({ x: e.clientX, y: e.clientY });
        }}
      />
      <div
        ref={panelRef}
        className="selpanel selpanel-right selpanel-over"
        style={anchor}
        role="group"
        aria-label="This note"
        tabIndex={-1}
        onKeyDown={(e) => walkRows(e, ".selpanel-btn:not(:disabled), .fmtbtn")}
        onContextMenu={(e) => e.preventDefault()}
      >
        {picked && onFormat && <FormatRow onFormat={onFormat} />}
        {picked && onCodeBlock && (
          <Action label="Code block" keepFocus announce onClick={onCodeBlock}>
            <IconCode tier="inline" />
          </Action>
        )}
        {picked && onCopyPicked && (
          <Action label="Copy selection" keepFocus announce onClick={onCopyPicked}>
            <IconCopy />
          </Action>
        )}
        {picked && onSplit && (
          <Action label="New note from selection" keepFocus announce onClick={onSplit}>
            <IconSplit />
          </Action>
        )}
        {onCopy && (
          <Action label="Copy" keepFocus announce onClick={onCopy}>
            <IconCopy />
          </Action>
        )}
        {onImportant && (
          <Action label="Important" pressed={important} keepFocus announce onClick={onImportant}>
            <IconPriority on={important} tier="inline" />
          </Action>
        )}
        {onTodo && (
          <Action label="To-do" pressed={todo} keepFocus announce onClick={onTodo}>
            <IconTodo on={todo} tier="inline" />
          </Action>
        )}
        {onReminder && (
          <Action
            label={reminderSet ? "Change reminder" : "Set reminder"}
            keepFocus
            announce
            onClick={onReminder}
          >
            <IconReminder tier="inline" />
          </Action>
        )}
        <Action
          label={trashed ? "Put back" : "Delete"}
          className="selpanel-split"
          keepFocus
          announce
          onClick={onDelete}
        >
          {trashed ? <IconRestore /> : <IconDelete tier="inline" />}
        </Action>
        <Action label={archived ? "Unarchive" : "Archive"} keepFocus announce onClick={onArchive}>
          <IconArchive on={archived} tier="inline" />
        </Action>
        {onMove && (
          <Action label="Move" keepFocus announce onClick={onMove}>
            <IconFolder />
          </Action>
        )}
      </div>
    </>
  );
}
