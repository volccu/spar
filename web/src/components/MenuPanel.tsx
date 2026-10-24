import {
  IconDelete,
  IconFolder,
  IconInbox,
  IconReminder,
  IconSamples,
  IconSearch,
  IconTodo,
  mark,
} from "./Icons";
// Imported here rather than in `Icons.tsx`, which rides on the first paint:
// the menu is a lazy panel (`lazyPanels.tsx`) and is the one place it is drawn.
import Cog6ToothIcon from "@heroicons/react/24/outline/Cog6ToothIcon";
import { SEARCH_KEY } from "../lib/hotkeys";
import { Hotkey } from "./Hotkey";
import { Action } from "./shared/Action";
import { useLayoutEffect, useRef } from "react";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { shownRows, walkRows } from "../lib/rowKeys";
import { DEMO } from "../lib/demo";

interface Props {
  trashCount: number;
  inTrash: boolean;
  /**
   * The way into whichever mode this board offers — "Tidy up 34 notes" on a
   * board with a pile, "Tick off 3 lists" on Todos — or null where there is
   * nothing to work through, and then the row is not drawn at all.
   *
   * It was **a line across the top of the board** until 2026-09-25, when the
   * owner asked for it in here. That line was forty pixels of chrome standing
   * between the reader and their own notes, on every board that had any, for
   * an offer taken perhaps once in a sitting; the menu is where a mode is
   * reached from, which was already true of Search and Reminders.
   *
   * **The whole label comes through**, rather than a word here and a count in
   * the suffix the way Trash and Reminders are drawn. Those two count one
   * thing each; this row counts **notes** on one board and **lists** on
   * another, and a bare number in the corner cannot say which.
   */
  modeEntry: { label: string; mode: "sorter" | "ticker" } | null;
  /** Hands back the row's own rect: a mode grows out of whatever was tapped,
   *  and that is this row now rather than the old line on the board. */
  onMode: (rect: DOMRect | null) => void;
  /**
   * How many never-filed notes are being left out of the Inbox by the answer to
   * the first-open question — 0 when none are, which is when this row is not
   * offered at all. It is the way back from "Leave them", so that answer is
   * never permanent (SPEC §6).
   */
  oldNotesOut: number;
  onBringOldNotesIn: () => void;
  onSearch: () => void;
  /**
   * How many notes are carrying a reminder — the answer to "what am I being
   * reminded about" for the commonest case, which is none, given without
   * opening anything. Counted the same way the mode lists them
   * (`notesWithReminders`), so the row and the screen it opens can never
   * disagree.
   */
  reminderCount: number;
  onReminders: () => void;
  onTrash: () => void;
  onEmptyTrash: () => void;
  /**
   * Settings (`components/Settings.tsx`, 2026-10-11, owner approved): the
   * switches, the account, About, and the way in and out of the notes — the
   * Keep import, a spår download and the export. Four rows of this panel
   * became that one, so the panel is left holding what is reached often.
   */
  onSettings: () => void;
  /**
   * The public demo's sample notes, offered here until they are in (review
   * UX-A-03): the empty Inbox's offer goes the moment a first note is written,
   * and a visitor who typed "test" first had no way back to them. Undefined
   * once they are loaded, and in every build but the demo's.
   */
  onSampleNotes?: () => void;
  onClose: () => void;
}

/**
 * Everything that isn't reading, writing or organizing — tucked into the same
 * kind of panel as the selection actions, anchored to the same corner.
 *
 * Search lives here rather than in a permanent bar across the top. It was a
 * whole row of screen, every second of every day, for something used a few
 * times a week; the notes it was covering are the point of the app.
 */
export function MenuPanel({
  trashCount,
  inTrash,
  modeEntry,
  onMode,
  oldNotesOut,
  onBringOldNotesIn,
  onSearch,
  reminderCount,
  onReminders,
  onTrash,
  onEmptyTrash,
  onSettings,
  onSampleNotes,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocus();

  useLayoutEffect(() => {
    if (panelRef.current) shownRows(panelRef.current, '[role="menuitem"]:not(:disabled)')[0]?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    walkRows(e, '[role="menuitem"]:not(:disabled)');
  }

  return (
    <>
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
        role="menu"
        aria-label="Menu"
        onKeyDown={onKeyDown}
      >
        {/* Settings lives in the header's far corner now (2026-10-12, owner).
            This row stays in the panel for the one screen that has no such
            corner — a short one, where the header band folds away — and is
            hidden everywhere else by `.menu-settings` in styles.css. Furthest
            from the thumb, because it is the row opened least. */}
        <Action role="menuitem" label="Settings" onClick={onSettings} className="menu-settings">
          {mark(Cog6ToothIcon, "inline")}
        </Action>

        {/* The demo's way of filling an empty app.
            `DEMO` is a literal, so in every other build this folds away with
            its words. */}
        {DEMO ? (
          onSampleNotes ? (
            <Action role="menuitem" label="Try it with sample notes" onClick={onSampleNotes}>
              <IconSamples />
            </Action>
          ) : null
        ) : null}

        {/* The decision made once on first open, reopened. Only shown while
            there is actually something outside the Inbox to bring into it, and
            it names how many — the same shape the Trash row's count uses. */}
        {oldNotesOut > 0 && (
          <Action
            role="menuitem"
            label="Bring in the old notes"
            onClick={onBringOldNotesIn}
            suffix={<span className="selpanel-n">{oldNotesOut}</span>}
          >
            <IconInbox />
          </Action>
        )}

        {/* Only while the trash is what you are looking at. Destroying notes is
            the one verb here that cannot be undone, so it is offered beside the
            notes it destroys and nowhere else — on an ordinary board it sat one
            row from Trash, promising a count the board on screen has nothing to
            do with. A trash with nothing in it still has nothing to empty. */}
        {inTrash && trashCount > 0 && (
          <Action role="menuitem" label="Empty trash" onClick={onEmptyTrash}>
            <IconDelete tier="inline" />
          </Action>
        )}

        <Action
          role="menuitem"
          label="Trash"
          onClick={onTrash}
          suffix={<span className="selpanel-n">{trashCount}</span>}
        >
          <IconDelete tier="inline" />
        </Action>

        {/* A reminder is a *time*, and a time is not a place a note lives — so
            this is not an eighth row on the shelf, which divides places from
            lenses and takes no more of either without an argument. It is a
            mode over the grid, the same shape search is, and the menu is where
            a mode is reached from. Directly above Search because it is the
            second most likely reason to open this panel, and position is the
            only emphasis there is in here. */}
        <Action
          role="menuitem"
          label="Reminders"
          onClick={onReminders}
          suffix={<span className="selpanel-n">{reminderCount}</span>}
        >
          <IconReminder tier="inline" />
        </Action>

        {/* The pile this board is offering to work through, one card at a
            time. Under Reminders and above Search: it is reached about as
            often as Reminders and rather less than Search, and position is
            the only emphasis there is in this panel. Not drawn at all when
            there is nothing to work through — the reward for an empty Inbox
            is an empty Inbox, not an offer to tidy nothing.

            The mark says which mode: the folder for filing a pile, the tick
            for working through lists. Both are the marks those things already
            wear elsewhere in the app. */}
        {modeEntry && (
          <Action
            role="menuitem"
            label={modeEntry.label}
            onClick={(e) => onMode(e.currentTarget.getBoundingClientRect())}
          >
            {modeEntry.mode === "ticker" ? <IconTodo /> : <IconFolder />}
          </Action>
        )}

        {/* Nearest the thumb, because it is the only thing here used often.
            Position is the emphasis — no second contrast step inside a panel
            that is already inverted. */}
        {/* `announce`, because the drawn box is `aria-hidden` and this row is
            the one place the hint sits *inside* the control it opens: the
            hidden words join the button's own name, so a reader hears
            "Search Ctrl+K" once rather than the shortcut not at all. */}
        <Action
          role="menuitem"
          label="Search"
          onClick={onSearch}
          suffix={<Hotkey keyName={SEARCH_KEY} announce />}
        >
          <IconSearch />
        </Action>
      </div>
    </>
  );
}
