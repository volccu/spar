import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { keepAbove, pointerAnchor, slideInside } from "../lib/pointerAnchor";
import type { UserBoard } from "../types";
import { ARCHIVE_KEY, FLAG_KEY, hotkeyTitle, MOVE_KEY, SELECT_ALL_KEY, useHasKeyboard } from "../lib/hotkeys";
import { chordWords } from "../lib/shortcuts";
import { bareKey, verbOfKey } from "../lib/useGridKeyboard";
import { BoardChooser } from "./BoardChooser";
import { Hotkey, KeyCaps } from "./Hotkey";
import { Action } from "./shared/Action";
import { walkRows } from "../lib/rowKeys";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import {
  IconArchive,
  IconClear,
  IconCopy,
  IconDelete,
  IconFolder,
  IconMerge,
  IconPriority,
  IconReminder,
  IconRestore,
  IconSelectAll,
  IconTodo,
} from "./Icons";

interface Props {
  count: number;
  anyArchived: boolean;
  /** Every selected note is already a todo — so the row clears the type
   *  instead of setting it, the same swap `anyArchived` makes for Archive. */
  allTodo: boolean;
  /** Every picked note already carries priority, so the row clears it. */
  allPriority?: boolean;
  /** At least one picked note has a reminder, so the panel offers to clear it. */
  anyReminder?: boolean;
  /** In the trash, the verbs change: put back, or destroy now. */
  inTrash: boolean;
  /** The board chooser is open, swapping the panel's rows for its own. */
  moving: boolean;
  /** At least one selected note is filed in a folder — so the chooser has a
   *  real "take these off their boards" to offer, and draws its Inbox row.
   *  The same test the open note's own Move mark makes about its one note. */
  anyFiled: boolean;
  /** The user's own folder boards, shown first as one-tap destinations. */
  boards: UserBoard[];
  /** How many notes are currently filed in each — purely informational. */
  countFor: (boardId: string) => number;
  /** Why the last name typed was refused, or null. */
  moveError: string | null;
  onMoveOpen: () => void;
  onMoveCancel: () => void;
  onMoveChoose: (board: UserBoard) => void;
  onMoveCreate: (name: string) => void;
  /** The chooser's Inbox row: take every selected note off whatever board it
   *  is on, back into the pile. */
  onMoveUnfile: () => void;
  /** The chooser's Links row, or undefined when it is not offered. */
  onMoveLinks?: () => void;
  /** Every note currently visible — the board you are standing on, or the
   *  results if a search is running. */
  onSelectAll: () => void;
  /** Every selected note's text onto the clipboard, one blank line apart. */
  onCopy: () => void;
  onMerge: () => void;
  onPriority: () => void;
  onTodo: () => void;
  onClearReminder?: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
  /** Drop the selection. The panel goes with it. */
  onCancel: () => void;
  /** Close the panel and keep the selection — a tap outside it. */
  onClose: () => void;
  /**
   * Where the pointer was, when the panel was opened by a right-click on a
   * card — it then opens there rather than in the corner (review 2026-10-01,
   * UX-11). Absent when the burger opened it.
   */
  at?: { x: number; y: number } | null;
}

/**
 * The panel's first line: how many are picked, and the way to unpick them.
 *
 * The sentence is the real thing and stays in the accessibility tree; the
 * cross beside it is Cancel, named so, and is the one control on the line.
 * Cancel used to be a row of its own at the top of the column, and the count
 * a line above it — two lines saying "this selection" — so the two were
 * folded into one: the number, and the cross that ends it.
 */
function Head({ count, onCancel }: { count: number; onCancel: () => void }) {
  return (
    <div className="selpanel-head">
      <span className="selpanel-count mono">{count} selected</span>
      <button
        type="button"
        className="selpanel-x"
        aria-label="Cancel"
        title="Cancel"
        onClick={onCancel}
      >
        <IconClear />
      </button>
    </div>
  );
}

/**
 * What can be done to a selection, as the rows of the menu.
 *
 * **It does not appear on its own.** Picking a card used to put this panel on
 * screen at once — a column on a desktop, and on a phone a strip of nine
 * unlabelled marks that ran off the edge of a 360px screen — landing under
 * the hand at the exact moment it was picking cards out. Now a selection puts
 * nothing on screen but the selection: the cards invert, the header counts
 * them, the burger in the capture bar lights up with the number, and the
 * panel opens when that burger is tapped. It is the same inverted panel the
 * menu is, in the same corner, with the same rows — a mark and a name — and
 * the burger is the door to both: what it opens depends on whether
 * anything is picked (`App.tsx` renders one or the other, never both). On a
 * desktop a right-click on a card is a second door to this one, and opens it
 * beside the pointer (`at`) — the corner is the thumb's place, and a mouse is
 * wherever it clicked (review 2026-10-01, UX-11). The
 * strip is gone with everything that held it up: the bare numeral, the
 * stylesheet's own row order, the fading edge.
 *
 * Every row prints its word. `announce` is still set on each so the word is
 * the hover title too, from the same string — a desktop pointer gets it
 * without reading the row.
 *
 * The order is read by distance from the thumb, and position is the only
 * emphasis there is: nothing in an already-inverted panel may invert again.
 * Nearest the thumb are the three verbs that take a note somewhere — Move,
 * then Archive, then Delete — under one hairline, the same line the shelf
 * draws where places stop: past it, a row changes where a note *is*. Above
 * the line are the rows that leave a note where it is: Merge, which makes a
 * new one; Todo and Priority, marks on the notes; Copy, which changes nothing
 * at all; and Select all, furthest of all, because a stray tap there costs the
 * selection picked by hand and replaces it with the whole board — the one
 * mistake here that looks like a success. Merge is the only row that can be
 * unavailable, and it says why in its own name rather than going dead.
 *
 * Move swaps the rows for `BoardChooser` in the same corner rather than
 * opening a second panel elsewhere, and a board is a real folder (SPEC §6):
 * choosing one files every selected note into it.
 *
 * Tapping outside closes the panel and keeps the selection — the menu's own
 * `menu-dismiss`, reused. Only the cross on the first line, or a verb, ends
 * the selection itself.
 */
export function SelectionBar({
  count,
  anyArchived,
  allTodo,
  allPriority = false,
  anyReminder = false,
  inTrash,
  moving,
  anyFiled,
  boards,
  countFor,
  moveError,
  onMoveOpen,
  onMoveCancel,
  onMoveChoose,
  onMoveCreate,
  onMoveUnfile,
  onMoveLinks,
  onSelectAll,
  onCopy,
  onMerge,
  onPriority,
  onTodo,
  onClearReminder,
  onArchive,
  onDelete,
  onRestore,
  onCancel,
  onClose,
  at = null,
}: Props) {
  // Whether the shortcut is worth saying out loud. The drawn box asks the same
  // predicate for itself (`Hotkey`); this second reading is what puts the
  // shortcut into the row's *name*, which an `aria-label` would otherwise
  // swallow — see `announceAs` on `Action`. Naming "Ctrl+A" on a phone would
  // be describing a machine the reader is not holding, which is the one thing
  // the query exists to refuse.
  const keyboard = useHasKeyboard();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Read once per opening: the panel stays where it was opened even if the
  // window is resized under it, as a desktop's own context menu does.
  const anchor = useMemo(
    () => (at ? pointerAnchor(at, { width: window.innerWidth, height: window.innerHeight }) : undefined),
    [at],
  );
  useRestoreFocus();
  useLayoutEffect(() => {
    if (!moving) panelRef.current?.focus({ preventScroll: true });
  }, [moving]);
  // Opened at the pointer, the panel hangs from it — and is lifted, once it
  // can be measured, so it ends above the capture bar rather than over it.
  // Every render, because the Move chooser grows as a name is typed.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!at) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(".selpanel");
    const height = el?.getBoundingClientRect().height ?? 0;
    // Nothing measured is nothing laid out (no layout engine at all, in a
    // test): leave it hanging from the pointer.
    if (!el || height === 0) return;
    const bar = document.querySelector(".capture")?.getBoundingClientRect();
    const floor = bar && bar.height > 0 ? bar.top : window.innerHeight;
    el.style.top = `${keepAbove(at.y, height, floor)}px`;
    slideInside(el);
  });
  // The grid's bare keys, drawn beside the rows they answer to (E, M, F and
  // Delete work on a selection as on a focused card, `useGridKeyboard`) —
  // and, like Select all's, said in the row's own name.
  const cap = (label: string) => (keyboard ? <KeyCaps label={label} /> : undefined);
  const saying = (label: string, key: string) =>
    keyboard ? `${label}, ${chordWords({ key })}` : undefined;
  // The grid stands down while this panel is up, so the same keys are answered
  // here: each runs the row it is drawn beside, which closes the panel first
  // like any verb. Read from a ref, so the listener is set once per opening.
  const verbs = useRef({ onArchive, onMoveOpen, onPriority, onDelete });
  verbs.current = { onArchive, onMoveOpen, onPriority, onDelete };
  useEffect(() => {
    // The Move chooser has a field of its own, and its own keys.
    if (moving) return;
    function onKey(e: KeyboardEvent) {
      const key = bareKey(e);
      if (key === null) return;
      const verb = verbOfKey(key);
      const del = key === "Delete" || key === "Backspace";
      // The trash's panel offers Delete for good and Put back; the letters ask
      // for nothing there (as on the grid).
      if (!del && (!verb || inTrash)) return;
      e.preventDefault();
      if (del) verbs.current.onDelete();
      else if (verb === "archive") verbs.current.onArchive();
      else if (verb === "move") verbs.current.onMoveOpen();
      else verbs.current.onPriority();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moving, inTrash]);
  const selectAllRow = (
    <Action
      label="Select all"
      announceAs={keyboard ? `Select all, ${hotkeyTitle(SELECT_ALL_KEY)}` : undefined}
      onClick={onSelectAll}
      suffix={<Hotkey keyName={SELECT_ALL_KEY} />}
      announce
    >
      <IconSelectAll tier="inline" />
    </Action>
  );

  if (moving) {
    return (
      <div ref={wrapRef}>
      <BoardChooser
        boards={boards}
        countFor={countFor}
        showUnfiled={anyFiled}
        onUnfile={onMoveUnfile}
        onLinks={onMoveLinks}
        onChoose={onMoveChoose}
        onCreate={onMoveCreate}
        onCancel={onMoveCancel}
        error={moveError}
        style={anchor}
      />
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      <button
        type="button"
        className="menu-dismiss"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="selpanel selpanel-right"
        style={anchor}
        role="group"
        aria-label="Selected notes"
        // Reachable from the keyboard the way the menu is: focus lands on the
        // panel itself when it opens, and the arrows, Home and End walk its
        // rows. The panel, not its first row — that is Select all, and in the
        // trash the next is Delete for good, so a stray Enter lands nowhere.
        tabIndex={-1}
        onKeyDown={(e) => walkRows(e, ".selpanel-btn:not(:disabled)")}
      >
        <Head count={count} onCancel={onCancel} />
        {/* The trash is a board like any other and `visible` means the same
            thing standing on it, so Ctrl+A works there — and a key that works
            where the panel offers nothing would be a shortcut for whoever
            wrote it. Same place in the order, for the same reason. */}
        {selectAllRow}
        {inTrash ? (
          <>
            <Action
              label="Delete for good"
              announceAs={saying("Delete for good", "Delete")}
              onClick={onDelete}
              className="selpanel-split"
              suffix={cap("Delete")}
              announce
            >
              <IconDelete tier="inline" />
            </Action>
            <Action label="Put back" onClick={onRestore} announce>
              <IconRestore tier="inline" />
            </Action>
          </>
        ) : (
          <>
            <Action label="Copy" onClick={onCopy} announce>
              <IconCopy />
            </Action>
            {/* A toggle with one name, as in the open note, the write bar and
                Tidy up; pressed while every note in the selection carries the
                mark, which is when a press clears it — `doPriority` raises
                every note otherwise (review 2026-10-04, CD-02). */}
            <Action
              label="Important"
              announceAs={saying("Important", FLAG_KEY)}
              pressed={allPriority}
              onClick={onPriority}
              suffix={cap(FLAG_KEY.toUpperCase())}
              announce
            >
              <IconPriority on={allPriority} tier="inline" />
            </Action>
            <Action label="To-do" pressed={allTodo} onClick={onTodo} announce>
              <IconTodo on={allTodo} tier="inline" />
            </Action>
            {/* Offered only while a picked note has a reminder: the way to
                clear a pile of passed ones in one go (review 2026-10-24, UX-14). */}
            {anyReminder && onClearReminder && (
              <Action label="Clear reminder" onClick={onClearReminder} announce>
                <IconReminder tier="inline" />
              </Action>
            )}
            <Action
              label={count < 2 ? "Pick 2 to merge" : `Merge ${count}`}
              onClick={onMerge}
              disabled={count < 2}
              announce
            >
              <IconMerge />
            </Action>
            <Action
              label="Delete"
              announceAs={saying("Delete", "Delete")}
              onClick={onDelete}
              className="selpanel-split"
              suffix={cap("Delete")}
              announce
            >
              <IconDelete tier="inline" />
            </Action>
            <Action
              label={anyArchived ? "Unarchive" : "Archive"}
              announceAs={saying(anyArchived ? "Unarchive" : "Archive", ARCHIVE_KEY)}
              onClick={onArchive}
              suffix={cap(ARCHIVE_KEY.toUpperCase())}
              announce
            >
              <IconArchive on={anyArchived} tier="inline" />
            </Action>
            <Action
              label="Move"
              announceAs={saying("Move", MOVE_KEY)}
              onClick={onMoveOpen}
              suffix={cap(MOVE_KEY.toUpperCase())}
              announce
            >
              <IconFolder />
            </Action>
          </>
        )}
      </div>
    </div>
  );
}
