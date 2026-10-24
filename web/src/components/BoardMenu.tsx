import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOARD_NAME_MAX } from "../lib/boards";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { hangUnder, keepInside } from "../lib/pointerAnchor";
import {
  IconClear,
  IconDelete,
  IconFolder,
  IconMoveEarlier,
  IconMoveLater,
  IconPencil,
  IconScreenOn,
} from "./Icons";
import { Action } from "./shared/Action";

interface Props {
  name: string;
  /** Swaps the menu's rows for a single rename field. */
  renaming: boolean;
  /**
   * Rename, Look and Delete are a folder's. **Undefined means the row is not
   * drawn**, which is how a lens — Todos, Links, Files — gets a menu that is
   * only its two Move rows: the app named it and marks it by what it does, so
   * there is nothing of it to rename, dress or throw away.
   */
  onRename?: () => void;
  /** Opens the sheet where the board's mark and hue are chosen. */
  onLook?: () => void;
  /**
   * Whether this folder's notes keep the screen on while open
   * (`UserBoard.awake`), and the switch that flips it — a folder's alone, like
   * Look. The row says what a tap will *do*, "Keep screen on" or "Let screen
   * sleep", the reminder panel's own pattern for a switch ("Notify on this
   * device" / "Stop notifying…"): a row cannot draw a state the way a mark
   * can, and a word for the state would read as a command either way.
   */
  awake?: boolean;
  onToggleAwake?: () => void;
  onSubmitRename: (name: string) => void;
  onDelete?: () => void;
  /**
   * Which shape the shelf is in — `useIsPhone`, handed down, never asked again
   * here. It decides what the two reorder rows are *called*; see the block
   * comment below, which is the whole argument for the prop existing.
   */
  vertical: boolean;
  /**
   * One step towards the Inbox, and one step away from it. **Undefined means
   * the row is not drawn**, which is how the first folder has no "move earlier"
   * and the last has no "move later".
   *
   * Same rule the list-item grip in the open note follows — it "is drawn only
   * on an item with somewhere to go — a run of one is not a list"
   * (`web/CLAUDE.md`). A disabled row would be a control that is present,
   * legible, thumb-sized and inert, and the reader has to tap it to find out;
   * an absent row costs nothing to understand. It also means a folder that is
   * the only one there is gets neither, which is correct: a run of one is not
   * an order.
   */
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  onCancel: () => void;
  /** Reached from the drawer opened inside a note, so it stands over the note
   *  the way the note's own panels do. */
  over?: boolean;
  /**
   * Where the tab it was opened from ends, in viewport pixels — handed only on
   * a desktop's strip, where the pointer is at the tab. The menu then hangs
   * under that tab and reads top-down; without it, it stands in the
   * bottom-right corner, where the thumb is (review UI-15).
   */
  anchor?: { left: number; top: number };
}

/**
 * Reached by holding the tab and letting go where it was, or right-clicking
 * it. **Where it opens depends on what pressed it** (2026-10-01, owner
 * approved, review UI-15): on a phone, and from the drawer, it answers in the
 * bottom-right corner every other panel opens in, where the thumb is; on a
 * desktop's strip the pointer is *at the tab*, so it hangs under the tab
 * (`anchor`). Either way its first line names the board, with Cancel as the
 * cross at that line's end, and Delete stands at the far end from the hand,
 * past the heavier rule `SelectionBar` puts before its own destructive rows.
 *
 * On the floor of the screen the rows are ordered by distance from the thumb:
 * Delete furthest (it archives every note filed here — see the confirm dialog
 * this opens), then Look, then the two reorder rows, then Rename nearest
 * because it's the row you reach for most. Hanging under a tab the same rows
 * read top-down: Rename first, Delete last.
 *
 * ## What the two reorder rows are called, and why it is not one answer
 *
 * The shelf has two shapes and one set of handlers (`web/CLAUDE.md`): a
 * horizontal strip on a desktop, a vertical drawer on a phone — and, since the
 * desktop grew a burger of its own, the same drawer over the strip whenever it
 * is open there. So there is no
 * pair of words that is true on both. "Move left" is a lie in a drawer, "Move
 * up" is a lie in a strip, and a direction-free pair — "Move earlier" / "Move
 * sooner" / "Promote" — is honest and asks the reader to work out which way
 * that is, on a control whose entire job is a direction. The row has to name
 * the direction the folder will visibly travel for the person reading it, so
 * the words branch on which shelf is on screen, in JS, exactly as `App.tsx`
 * branches rather than rendering both shapes (`useIsPhone` in
 * `lib/breakpoint.ts` is the one definition of which is which). The mark
 * branches with the words, or the arrow would be describing the other shelf.
 *
 * The pair is listed earlier-above-later, which on a phone means the two rows
 * sit in the panel the same way round as the movement they promise.
 *
 * ## It answers the keyboard, because every other panel does
 *
 * This panel is a `role="group"` of buttons and it used to be the one layer in
 * the app with no way in and no way out from a key: nothing took the focus on
 * open, so Escape had nothing to fire at, and the app's own Escape listener
 * cannot see this layer at all (it early-returns on `coveredOtherThanSearch`,
 * which `boardMenu` is part of). A long-press that opened this by accident —
 * which is the gesture that opens it — could only be undone by finding the
 * Cancel row with a thumb. It now does what `MenuPanel`, `Shelf` and
 * `BoardLook` do: the first row takes the focus on open, Escape on the panel
 * is Cancel, and outside the panel is the app's one dismiss scrim.
 *
 * **Cancel is the control that takes the focus**, and it is first for exactly
 * that reason — the Sorter's rule, that nothing on a layer should be one stray
 * Enter from a consequence. It is the cross at the end of the head line now.
 *
 * **The rows stay, now that a board can be dragged.** Holding a tab and
 * carrying it is the quick way to reorder the shelf (the owner's ask of
 * 2026-09-29, `lib/useBoardPress.ts`), and it needs a pointer. These two rows
 * are the path that does not: the context-menu key opens this panel on a
 * focused tab, and walking a board four places is four presses in a panel that
 * stays open while you do it. They are also the answer for anyone who finds a
 * drag fiddly, which on a 44px tab under a thumb is not nobody.
 */
export function BoardMenu({
  name,
  renaming,
  onRename,
  onLook,
  awake = false,
  onToggleAwake,
  onSubmitRename,
  onDelete,
  vertical,
  onMoveEarlier,
  onMoveLater,
  onCancel,
  over = false,
  anchor,
}: Props) {
  const [draft, setDraft] = useState(name);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocus();

  useEffect(() => {
    if (renaming) setDraft(name);
  }, [renaming, name]);

  // The first row, on open — MenuPanel's own dance, keyed on `renaming` because
  // the two panels are two branches of one component: the rename field carries
  // its own `autoFocus`, so this stands down while that is what is on screen.
  useLayoutEffect(() => {
    if (renaming) return;
    panelRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [renaming]);

  // Hung under a tab near the right end of the strip, the menu would run off
  // the screen: pulled back in by its own width, measured once it is drawn.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!anchor || !el) return;
    keepInside(el, anchor);
  }, [anchor]);

  /** Escape is Cancel, taken on the panel and stopped there. React listens at
   *  the root, so stopping it here is what keeps the board underneath from
   *  reading the same key as "clear the selection" or "leave search". */
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  }

  /* Outside the panel is the way out, the same full-screen button every other
     bottom-right panel dismisses through. Rendered in both branches: a rename
     you did not mean to start is as much a thing to walk away from as the menu
     that started it. */
  const scrim = (
    <button
      type="button"
      className={over ? "menu-dismiss menu-dismiss-over" : "menu-dismiss"}
      aria-label="Close menu"
      tabIndex={-1}
      onClick={onCancel}
    />
  );
  const panelClass = [
    "selpanel",
    "selpanel-menu",
    anchor ? "selpanel-under" : "selpanel-right",
    over ? "selpanel-over" : null,
  ]
    .filter(Boolean)
    .join(" ");

  /* One panel in both states. Rename used to swap the whole panel for Cancel
     and a field, and the panel is anchored at its foot, so its top edge and
     Cancel dropped three or four rows the moment Rename was pressed. Now the
     rows keep their boxes and only stop being there to press — hidden, which
     also takes them out of the tab order and the accessibility tree — and the
     field takes the Rename row's own place, at the Rename row's own height. */
  const held = renaming ? "selpanel-held" : undefined;

  const deleteRow = onDelete && (
    <Action
      label="Delete"
      onClick={onDelete}
      className={anchor ? cls("selpanel-split", held) : held}
      disabled={renaming}
    >
      <IconDelete tier="inline" />
    </Action>
  );
  /* The row after Delete carries the heavier rule when Delete stands first. */
  const afterDelete = !anchor && onDelete ? "selpanel-split" : undefined;

  const lookRow = onLook && (
    <Action label="Look" onClick={onLook} className={cls(afterDelete, held)} disabled={renaming}>
      <IconPencil />
    </Action>
  );
  /* Beside Look, in both orders: both are about how the folder behaves rather
     than where it is. The heavier rule after Delete falls to it only when
     there is no Look row to carry it. */
  const awakeRow = onToggleAwake && (
    <Action
      label={awake ? "Let screen sleep" : "Keep screen on"}
      onClick={onToggleAwake}
      className={cls(onLook ? undefined : afterDelete, held)}
      disabled={renaming}
    >
      <IconScreenOn />
    </Action>
  );
  const moveRows = (
    <>
      {onMoveEarlier && (
        <Action
          label={vertical ? "Move up" : "Move left"}
          onClick={onMoveEarlier}
          className={cls(onLook || onToggleAwake ? undefined : afterDelete, held)}
          disabled={renaming}
        >
          <IconMoveEarlier vertical={vertical} />
        </Action>
      )}
      {onMoveLater && (
        <Action
          label={vertical ? "Move down" : "Move right"}
          onClick={onMoveLater}
          className={held}
          disabled={renaming}
        >
          <IconMoveLater vertical={vertical} />
        </Action>
      )}
    </>
  );
  const renameRow = renaming ? (
    <div className="selpanel-row selpanel-row-field">
      <input
        className="field-words"
        autoFocus
        value={draft}
        maxLength={BOARD_NAME_MAX}
        aria-label="Board name"
        enterKeyHint="done"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = draft.trim();
            if (trimmed) onSubmitRename(trimmed);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
    </div>
  ) : (
    onRename && (
      <Action label="Rename" onClick={onRename}>
        <IconFolder />
      </Action>
    )
  );

  return (
    <>
      {scrim}
      <div
        ref={panelRef}
        className={panelClass}
        style={anchor ? hangUnder(anchor) : undefined}
        role="group"
        aria-label={renaming ? `Rename ${name}` : `${name} board`}
        onKeyDown={onKeyDown}
      >
        {/* Which board this is, said first, with the way out at its end — the
            selection panel's own head. The menu used to name nothing, and on a
            desktop it opened a long way from the tab it was about. Cancel is
            the cross here and is still what takes the focus. */}
        <div className="selpanel-head">
          <span className="selpanel-title" title={name}>
            {name}
          </span>
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
        {anchor ? (
          /* Hanging under the tab: read top-down, the row reached for most
             first and Delete last, past the heavier rule. */
          <>
            {renameRow}
            {lookRow}
            {awakeRow}
            {moveRows}
            {deleteRow}
          </>
        ) : (
          /* Standing on the floor of the screen: ordered by distance from
             the thumb, Rename nearest and Delete furthest, under the head
             and above the heavier rule. */
          <>
            {deleteRow}
            {lookRow}
            {awakeRow}
            {moveRows}
            {renameRow}
          </>
        )}
      </div>
    </>
  );
}

/** Joins the classes that are there. */
function cls(...names: (string | undefined)[]): string | undefined {
  const joined = names.filter(Boolean).join(" ");
  return joined || undefined;
}
