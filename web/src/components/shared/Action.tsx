import type { CSSProperties, ReactNode } from "react";

interface Props {
  label: string;
  /** The event is handed over for the one row that needs its own rect — the
   *  mode row, which the Sorter and the Ticker grow out of. Every other
   *  caller ignores it, and a plain `() => void` still satisfies this. */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  disabled?: boolean;
  /**
   * Sets `aria-label` and `title` from `label`. `SelectionBar` sets it on
   * every row so a desktop pointer gets the word on hover from the same
   * string the row prints; it dates from when that panel lay down into an
   * unlabelled strip on a phone and the name had to survive the collapse.
   * The menu, the board chooser and a board's own menu leave it off.
   */
  announce?: boolean;
  /**
   * The accessible name where it has to say more than the printed word does —
   * today the selection panel's Select all and the four rows that draw the
   * grid's own key (Archive, Move, Important, Delete), whose drawn box is
   * `aria-hidden` and so reaches no reader on its own.
   *
   * `Hotkey`'s own `announce` cannot do it here. That works by putting the
   * shortcut in words *inside* the button, where it joins the button's name —
   * and an `aria-label` replaces the content rather than joining it, so on
   * every row of this panel (all of which set `announce`, because the phone's
   * strip drops the printed label) the hidden words would be thrown away
   * unread. So the name is composed at the call site instead, exactly as
   * `App.tsx` composes the search field's "Search notes, Ctrl+K" for the same
   * reason: that control is named by an `aria-label` too.
   *
   * `title` deliberately keeps the plain word. A tooltip only ever reaches a
   * pointer, and a pointer can already see the drawn box beside the label.
   */
  announceAs?: string;
  /** `menuitem` inside `MenuPanel`'s `role="menu"`; every other panel is a
   *  plain button and leaves this unset. */
  role?: string;
  /** A trailing mark after the label — the board chooser's and the trash
   *  row's own note counts (`.selpanel-n`). */
  suffix?: ReactNode;
  /**
   * An extra class on the row: `selpanel-split`, the heavier rule
   * `SelectionBar` draws above the first of the rows that move a note, and
   * `selpanel-quiet`, the reminder panel's device-level switch under the
   * times.
   */
  className?: string;
  /**
   * Swallows `mousedown`, so pressing the row does not take focus off the
   * field behind the panel. The insert, reminder and add panels all sit over
   * a textarea whose caret has to survive the tap — this is the prop they
   * lacked, and the reason each of them hand-rolled the row again after this
   * component was made to end exactly that.
   */
  keepFocus?: boolean;
  /** `aria-checked`, for a row whose `role` is `menuitemcheckbox`. */
  checked?: boolean;
  /** `aria-pressed`, for a row that is a toggle with one fixed name — the
   *  selection's Important and To-do (review 2026-10-04, CD-02). */
  pressed?: boolean;
  /** Inline custom properties for the row — today only a folder's own
   *  `--board-tint`, from `tintOf`, so its mark wears its hue in the board
   *  chooser exactly as it does on the shelf. */
  style?: CSSProperties;
}

/**
 * One row in a bottom-right panel: a mark, and a name written exactly once.
 *
 * `SelectionBar`, `MenuPanel`, `BoardMenu` and `BoardChooser` all hand-rolled
 * this same `.selpanel-btn` markup before this was pulled out from under
 * `SelectionBar`'s own internal `Action` — one row, one place its appearance
 * is decided.
 *
 * ~44px so a thumb can hit it (`.selpanel-btn` in `styles.css`), and it never
 * inverts to mark itself primary — inside an already-inverted panel that
 * reads as a warning rather than a default. Position is the only emphasis.
 */
export function Action({
  label,
  onClick,
  children,
  disabled,
  announce,
  announceAs,
  role,
  suffix,
  className,
  keepFocus,
  checked,
  pressed,
  style,
}: Props) {
  return (
    <button
      type="button"
      className={className ? `selpanel-btn mono ${className}` : "selpanel-btn mono"}
      style={style}
      onClick={onClick}
      onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
      disabled={disabled}
      role={role}
      aria-checked={checked}
      aria-pressed={pressed}
      aria-label={announce ? (announceAs ?? label) : undefined}
      title={announce ? label : undefined}
    >
      {children}
      <span className="selpanel-label">{label}</span>
      {suffix}
    </button>
  );
}
