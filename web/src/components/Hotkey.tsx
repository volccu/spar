import { hotkeyLabel, hotkeyTitle, keyCaps, useHasKeyboard } from "../lib/hotkeys";

/**
 * A shortcut, drawn.
 *
 * Machine data in the machine voice, which is what a key name is — so it takes
 * `--t-data` and the mono face, exactly like a count or a stamp. Each key is
 * its own small cap (DESIGN.md §6): a faint fill, a hairline at `--rule` and
 * the one rounded corner the system allows, `--r-key`, which belongs to this
 * element and nothing else.
 *
 * Drawn only where the key exists. The box itself is `aria-hidden`: a reader
 * announcing "Ctrl K" as loose text beside "Search" would be reading the
 * furniture rather than the control, and the stylesheet gives `.kbd`
 * `pointer-events: none` so it can never be hovered either. Neither of those
 * is a reason for the shortcut to go unsaid — *a shortcut nobody is told about
 * is a shortcut for whoever wrote it* — so it belongs in the **accessible name
 * of the control it opens**, and there are two shapes of that:
 *
 * - Where the hint sits *inside* the control — the menu's Search row — set
 *   `announce`. It adds the shortcut in words in a visually-hidden span, which
 *   joins the button's own name: "Search Ctrl+K", said once.
 * - Where the hint is only a *sibling* of the control — the search field,
 *   which is an `<input>` and so is named by its `aria-label` and by nothing
 *   around it — the name is composed at the call site out of `hotkeyTitle`,
 *   and this stays purely decorative.
 *
 * The `title` attribute this used to carry was neither: `pointer-events: none`
 * meant the browser never rendered the tooltip, and `aria-hidden` meant no
 * reader ever reached it, so the one place the shortcut was written in words
 * was a place nobody could get to.
 */
export function Hotkey({
  keyName,
  announce,
}: {
  keyName: string;
  /** Only where this sits inside the control the shortcut opens; loose in a
   *  row, the hidden words would be read as text of their own. */
  announce?: boolean;
}) {
  const keyboard = useHasKeyboard();
  if (!keyboard) return null;
  return (
    <>
      {announce && <span className="offscreen">{hotkeyTitle(keyName)}</span>}
      <KeyCaps label={hotkeyLabel(keyName)} />
    </>
  );
}

/**
 * The drawing alone: one small cap per key, in a group that is `aria-hidden`
 * (the words for a reader are the caller's, never these). Every place a key is
 * drawn — the hints, the Sorter's numbers, the About list — goes through here,
 * so there is exactly one shape of cap in the app.
 */
export function KeyCaps({ label }: { label: string }) {
  return (
    <span className="kbd" aria-hidden>
      {keyCaps(label).map((cap, i) => (
        <span className="kbd-cap mono" key={i}>
          {cap}
        </span>
      ))}
    </span>
  );
}
