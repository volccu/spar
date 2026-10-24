import {
  ARCHIVE_KEY,
  BOLD_KEY,
  FLAG_KEY,
  MOVE_KEY,
  CAPTURE_KEY,
  HELP_KEY,
  hotkeyLabel,
  hotkeyTitle,
  ITALIC_KEY,
  SEARCH_KEY,
  SELECT_ALL_KEY,
  SETTINGS_KEY,
  UNDO_KEY,
} from "./hotkeys";

/**
 * Every key the app answers to, in one list, for the About page.
 *
 * The keys existed long before anybody could find them. A few are drawn beside
 * the thing they open (`Hotkey`), and the rest — the grid's arrows, the
 * editor's Ctrl+B, the Sorter's right arrow — were known to whoever wrote them
 * and to nobody else. So they are written down once, here, and the About page
 * draws this list (`components/About.tsx`, "The keys"); `?` opens the page at
 * it.
 *
 * **One source, not a second copy.** Every letter shortcut below is the same
 * constant the listener compares against (`lib/hotkeys.ts`), so renaming a key
 * renames it here. The keys that are not letters — arrows, Enter, Escape — are
 * spelled the way `KeyboardEvent.key` spells them, and `shortcuts.test.ts`
 * reads the source of every component for the keys it actually compares
 * against and fails on one this list does not mention. That is the drift this
 * file is for: a binding added without a line here is a shortcut for whoever
 * wrote it, which is where every one of these started.
 *
 * Only what a person would press on purpose. Tab walking the focus, and Enter
 * or Space pressing whatever button has it, are the browser's own and the
 * same in every app; Tab being *kept inside* a dialog is not a shortcut
 * either. Enter in a one-line field (a name, a new board) saving it and
 * Escape leaving it are said once, in the general Escape line, rather than
 * once per field.
 */

/** One key, with or without the platform's modifier (Ctrl, or ⌘ on a Mac). */
export interface Chord {
  /** As `KeyboardEvent.key` spells it: "k", "ArrowLeft", "Escape", "?". */
  key: string;
  mod?: boolean;
  shift?: boolean;
}

export interface Shortcut {
  /** Alternatives — any one of them does it. */
  keys: Chord[];
  /** What it does, in the app's own words. */
  does: string;
}

export interface ShortcutGroup {
  /** Where the keys work. */
  where: string;
  shortcuts: Shortcut[];
}

const mod = (key: string): Chord => ({ key, mod: true });
const key = (name: string): Chord => ({ key: name });
const shiftMod = (name: string): Chord => ({ key: name, mod: true, shift: true });

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    where: "Anywhere on a board",
    shortcuts: [
      { keys: [mod(SEARCH_KEY)], does: "Search" },
      { keys: [mod(CAPTURE_KEY)], does: "Write a new note" },
      { keys: [mod(SELECT_ALL_KEY)], does: "Select every note on the board" },
      { keys: [mod(UNDO_KEY)], does: "Undo what was last done to a note" },
      { keys: [key(HELP_KEY)], does: "These keys" },
      { keys: [mod(SETTINGS_KEY)], does: "Settings" },
      { keys: [key("Escape")], does: "Close whatever is on top" },
    ],
  },
  {
    where: "The cards",
    shortcuts: [
      {
        keys: [key("ArrowLeft"), key("ArrowRight"), key("ArrowUp"), key("ArrowDown")],
        does: "Walk from card to card",
      },
      { keys: [key("Home"), key("End")], does: "The first card, the last card" },
      { keys: [key("Enter")], does: "Open the card" },
      { keys: [key("Delete"), key("Backspace")], does: "Delete the card, or everything selected" },
      { keys: [key(ARCHIVE_KEY)], does: "Archive the card, or everything selected" },
      { keys: [key(MOVE_KEY)], does: "Move the card, or everything selected, to a board" },
      { keys: [key(FLAG_KEY)], does: "Mark the card, or everything selected, Important" },
      { keys: [key(" "), { key: "F10", shift: true }, key("ContextMenu")], does: "Pick the card, to act on several (Ctrl-click does it too)" },
      { keys: [key("ArrowDown")], does: "From the board row: into the cards" },
      { keys: [{ key: "Tab", shift: true }], does: "From an empty write box: into the cards" },
    ],
  },
  {
    where: "The boards",
    shortcuts: [
      { keys: [key("ArrowLeft"), key("ArrowRight")], does: "The board beside, along the strip" },
      { keys: [key("ArrowUp"), key("ArrowDown")], does: "The board beside, in the drawer" },
      { keys: [key("Home"), key("End")], does: "The first board, the last board" },
    ],
  },
  {
    where: "Search",
    shortcuts: [{ keys: [key("Enter"), key("ArrowDown")], does: "From the field to the first note found" }],
  },
  {
    where: "Writing a note",
    shortcuts: [
      { keys: [key("Enter")], does: "Save it" },
      { keys: [{ key: "Enter", shift: true }], does: "A new line" },
      { keys: [key("Escape")], does: "Leave the write box; what you wrote stays" },
    ],
  },
  {
    where: "An open note",
    shortcuts: [
      { keys: [mod("Enter"), key("Escape")], does: "Close it, keeping what you wrote" },
      { keys: [mod(BOLD_KEY)], does: "Bold" },
      { keys: [mod(ITALIC_KEY)], does: "Italic" },
      { keys: [shiftMod(ARCHIVE_KEY)], does: "Archive the note" },
      { keys: [shiftMod(MOVE_KEY)], does: "Move the note to a board" },
      { keys: [shiftMod(FLAG_KEY)], does: "Mark the note Important" },
      { keys: [key("Enter")], does: "Carry a list on to the next item" },
    ],
  },
  {
    where: "An idea, drawn on",
    shortcuts: [{ keys: [mod(UNDO_KEY)], does: "Take back the last stroke, rub-out or Clear" }],
  },
  {
    where: "A picture, opened",
    shortcuts: [
      { keys: [key("ArrowLeft"), key("ArrowRight")], does: "The file before, the file after" },
      { keys: [key("+"), key("-")], does: "Closer, further" },
      { keys: [key("0")], does: "Back to the whole picture" },
      { keys: [key("r")], does: "Turn it a quarter" },
    ],
  },
  {
    where: "Tidy up",
    shortcuts: [
      { keys: [key("ArrowRight")], does: "Leave the note as it is" },
      { keys: [key("ArrowLeft")], does: "Back to the one before" },
      { keys: [key("Enter")], does: "Change the note's words" },
      { keys: [key("1-9")], does: "File the note into the Inbox or board in that place" },
      { keys: [key(ARCHIVE_KEY), key("a")], does: "Archive the note" },
    ],
  },
  {
    where: "Ticking lists",
    shortcuts: [{ keys: [key("ArrowLeft"), key("ArrowRight")], does: "The list before, the list after" }],
  },
  {
    where: "A menu",
    shortcuts: [
      { keys: [key("ArrowUp"), key("ArrowDown")], does: "Walk the rows" },
      { keys: [key("Home"), key("End")], does: "The first row, the last row" },
    ],
  },
];

/** What a key is drawn as, and what it is called out loud. */
const NAMES: Record<string, [drawn: string, said: string]> = {
  ArrowLeft: ["←", "Left arrow"],
  ArrowRight: ["→", "Right arrow"],
  ArrowUp: ["↑", "Up arrow"],
  ArrowDown: ["↓", "Down arrow"],
  Escape: ["Esc", "Escape"],
  Tab: ["Tab", "Tab"],
  Delete: ["Delete", "Delete"],
  Backspace: ["Backspace", "Backspace"],
  Enter: ["Enter", "Enter"],
  Home: ["Home", "Home"],
  End: ["End", "End"],
  ContextMenu: ["Menu", "Menu key"],
  " ": ["Space", "Space"],
  "?": ["?", "Question mark"],
  "1-9": ["1–9", "Number keys 1 to 9"],
};

function names(k: string): [string, string] {
  return NAMES[k] ?? [k.toUpperCase(), k.toUpperCase()];
}

/**
 * A chord as the box draws it — "Ctrl K", "⌘K", "Shift Enter", "←". The
 * modifier is `hotkeyLabel`'s own prefix ("Ctrl " or "⌘"), the one spelling
 * the hints beside search and the write box already use, so the list and the
 * hints can never disagree about what the key is called.
 */
export function chordLabel(chord: Chord): string {
  const [drawn] = names(chord.key);
  const base = chord.mod ? `${hotkeyLabel("")}${drawn}` : drawn;
  return chord.shift ? (chord.mod ? `${hotkeyLabel("")}Shift ${drawn}` : `Shift ${base}`) : base;
}

/** The same chord in words, for a reader who cannot see the box: `hotkeyTitle`'s spelling. */
export function chordWords(chord: Chord): string {
  const [, said] = names(chord.key);
  const base = chord.mod ? `${hotkeyTitle("")}${said}` : said;
  return chord.shift ? (chord.mod ? `${hotkeyTitle("")}Shift+${said}` : `Shift+${base}`) : base;
}
