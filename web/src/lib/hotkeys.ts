import { matchesMedia, useMediaQuery } from "./breakpoint";

/**
 * The shortcuts the board answers to, and how they are drawn and said.
 *
 * The app is opened dozens of times a day to do one of two things: find
 * something, or put something down. Capture is always on screen, so its
 * shortcut is a convenience. **Search is not** — it is revealed rather than
 * resident (SPEC §12), so without a key there is no way to reach the app's
 * primary verb without first finding a mark to click. That is what these fix.
 *
 * The third is Ctrl/Cmd+A, and it is a different kind of thing from the other
 * two: it does not *open* anything, it acts on the board that is already in
 * front of you. It is here rather than in `App.tsx` for the reason everything
 * else in this file is — a shortcut is a fact with three spellings (the bound
 * key, the drawn box, the words a reader hears), and one place to write the
 * key down is what stops the three from drifting.
 *
 * They are drawn as well as bound. A shortcut nobody is told about is a
 * shortcut for whoever wrote it, and the app already keeps a machine voice for
 * exactly this kind of fact — so the hint is set in the mono face at
 * `--t-data` inside a square hairline box, which is the same vocabulary the
 * counts and stamps speak. It is never drawn on a device that has no key to
 * press (see `hasKeyboard`).
 *
 * **"Nobody" includes a reader who cannot see the box.** The drawn hint is
 * `aria-hidden` — a screen reader announcing "Ctrl K" as loose text beside a
 * search field would be reading the furniture rather than the control — so
 * the shortcut is put into the *accessible name of the control it belongs to*
 * instead, in words, by `hotkeyTitle`. Both call sites do it: the search
 * field's own `aria-label` in `App.tsx`, and a visually-hidden span inside the
 * menu's Search button (`Hotkey`'s `announce`). It was for a while announced
 * to nobody at all — `hotkeyTitle` sat in a `title` attribute on an element
 * the stylesheet gives `pointer-events: none`, so no hover could ever reach
 * it and no reader could ever see it.
 *
 * `aria-keyshortcuts` is the attribute nominally for this and is deliberately
 * not used: its value is a third spelling of the same shortcut ("Control+K",
 * "Meta+K" — neither of the two already here), and a third spelling of one
 * fact is the drift this file exists to avoid, for an attribute most readers
 * still say nothing about.
 */

/** Reach search. The key every app with a search field now uses. */
export const SEARCH_KEY = "k";

/**
 * Reach the write box. `n`, `t` and `w` are all taken by the browser for a new
 * window, a new tab and closing one, and a page cannot refuse any of them, so
 * the mnemonic that was actually available won: **e** for *enter a note*.
 */
export const CAPTURE_KEY = "e";

/**
 * Take every note currently on the board. **a** for *all*, which is what the
 * key means in every other application, and the one shortcut here that the
 * browser is happy to hand over: `preventDefault` on a page's own select-all
 * is honoured everywhere, unlike `n`, `t` and `w`.
 *
 * Taking it costs nothing that was worth having. The browser's own select-all
 * would run over the grid, and this app turns the text selection colour off
 * entirely (`web/CLAUDE.md`) — so what it selects is invisible, and there is
 * nothing on a board that a reader would want as *text* anyway. The panel's
 * own Copy row is the way a selection's words leave the app.
 */
export const SELECT_ALL_KEY = "a";

/**
 * Undo, on the board and never in a field — Ctrl+Z inside a note is the
 * browser's own undo of the typing (`App.tsx`, and `web/CLAUDE.md` on why the
 * two scopes never overlap).
 */
export const UNDO_KEY = "z";

/**
 * On a canvas only (`CanvasSheet.tsx`): Redo — Ctrl+Y, and Ctrl+Shift+Z beside it — and
 * Duplicate, a copy of what the Select tool holds. The board has neither, so nothing there
 * is shadowed.
 */
export const REDO_KEY = "y";
export const DUPLICATE_KEY = "d";

/**
 * Clearing a note from the keyboard (review 2026-10-04, FX-A-05): **e** archives,
 * **m** opens Move, **f** flags it Important. Bare on a focused card or a
 * selection (`useGridKeyboard`) and while the selection's panel is open, which
 * covers the grid and answers them itself (`SelectionBar`); with Ctrl+Shift in
 * the open note (`NoteView.tsx`), where a bare letter is typing. They go through the same
 * paths as the selection panel's rows and the note's own marks.
 */
export const ARCHIVE_KEY = "e";
export const MOVE_KEY = "m";
export const FLAG_KEY = "f";

/** Bold and italic, in the open note's editor and nowhere else (`NoteView.tsx`). */
export const BOLD_KEY = "b";
export const ITALIC_KEY = "i";

/**
 * The one shortcut with no modifier: `?` opens the About page at its list of
 * every key (`lib/shortcuts.ts`). It needs none because it is not a letter a
 * person writes by itself, and it stands down in any field, so typing a
 * question into a note is typing a question. The convention is borrowed from
 * every web app that has one — Gmail, GitHub, Slack — which is the whole
 * reason to pick it: it is the key a person tries.
 */
export const HELP_KEY = "?";

/**
 * Settings (2026-10-11, owner approved): Ctrl/Cmd+comma, the key desktop apps
 * use for their preferences. Free in every browser, so a page may take it.
 * Same guards as Ctrl+K: it stands down in a field and under any layer.
 */
export const SETTINGS_KEY = ",";

/**
 * Whether this machine spells the modifier as a symbol or a word.
 *
 * `navigator.platform` is deprecated but is the only spelling every engine
 * still answers; `userAgentData` is asked first where it exists. Neither is
 * present under the test runner, which falls through to the word — the right
 * default, since the symbol is meaningless off a Mac.
 */
function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = data?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform);
}

/** "⌘K", or "Ctrl K" everywhere else. What the hairline box draws. */
export function hotkeyLabel(key: string): string {
  return isMac() ? `⌘${key.toUpperCase()}` : `Ctrl ${key.toUpperCase()}`;
}

/**
 * A label as the separate caps it is drawn in: "Ctrl K" is two keys, "⌘K" is
 * two, "Shift Enter" is two, "?" is one. The Mac's command sign is glued to
 * the letter in the label (it is one word there) but is its own key, so it is
 * peeled off first; everything else splits on its spaces.
 */
export function keyCaps(label: string): string[] {
  const command = label.startsWith("⌘");
  const rest = command ? label.slice(1) : label;
  const caps = rest.split(/\s+/).filter(Boolean);
  return command ? ["⌘", ...caps] : caps;
}

/**
 * The same shortcut said in words, for the accessible name of whatever the
 * shortcut opens. The symbol is a drawing and a reader would say nothing
 * useful about it, so this spells the modifier out on both platforms.
 */
export function hotkeyTitle(key: string): string {
  return isMac() ? `Command+${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}

/**
 * Whether this device has a hardware keyboard — **the app's only definition of
 * that**, and one query, asked from two places.
 *
 * A phone has no Ctrl key, so drawing "Ctrl K" beside its search mark is the
 * interface describing a machine the reader is not holding; and a phone has no
 * Shift+Enter either, so the capture bar's Enter has to break the line there
 * rather than save (`CaptureBar.tsx`). Those are the same question, and they
 * were asked two different ways — `(hover: hover) and (pointer: fine)` here
 * and `(pointer: coarse)` in the capture bar — which is exactly the drift a
 * single exported predicate exists to stop. This is the pair the peek and the
 * drawn cursors already use: a fine pointer that can hover means a mouse, and
 * a mouse means a keyboard.
 *
 * The two queries agree on every device either of them was written for — a
 * phone is coarse and cannot hover, a desktop is fine and can, and a
 * touchscreen laptop reports a fine *primary* pointer and so counts as the
 * desktop it is. They part on a device that is **neither**: a television, a
 * set-top box or a kiosk whose primary pointer is `none`. There the capture
 * bar used to conclude "hardware keyboard, Enter saves" and now concludes the
 * opposite, so Enter breaks the line and Save is the button in the corner.
 * That is the deliberate cost of having one answer instead of two, and it is
 * the safer half of the trade: the drawn hint already refused those devices.
 *
 * `whenUnasked` is the answer where the question cannot be put at all — no
 * `matchMedia`, which is jsdom and so the whole test suite. The two callers
 * want opposite things there and both are right, which is why it is a
 * parameter with no default rather than a constant. A hint must never be
 * *invented*: naming a key the reader may not have is the very thing the
 * query is for, so the hint asks with `false` and no test renders a hint it
 * did not ask for. Enter must go on *saving*: a capture bar where Enter never
 * saves is a broken capture bar, so the bar asks with `true`.
 */
const KEYBOARD_QUERY = "(hover: hover) and (pointer: fine)";

export function hasKeyboard(whenUnasked: boolean): boolean {
  return matchesMedia(KEYBOARD_QUERY, () => whenUnasked);
}

/** Module-level, so the subscription in `useMediaQuery` is built once. */
const readKeyboard = () => hasKeyboard(false);

export function useHasKeyboard(): boolean {
  return useMediaQuery(KEYBOARD_QUERY, readKeyboard);
}

/**
 * Whether a key event is aimed at something being typed into — a field, a
 * textarea, anything contenteditable — and so is not the board's to take.
 * One definition: it was written out four times, identically, and a fifth
 * time in the Sorter without the contenteditable half.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return Boolean(
    t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable),
  );
}
