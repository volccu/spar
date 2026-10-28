import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { UserBoard } from "../types";
import { BOARD_NAME_MAX, isBoardName } from "../lib/boards";
import { tintOf } from "../lib/boardLook";
import { hasKeyboard, isTypingTarget } from "../lib/hotkeys";
import { hangUnder, keepInside, type UnderAnchor } from "../lib/pointerAnchor";
import { FolderGlyph } from "./BoardLook";
import { IconClear, IconInbox, IconLink, IconPlus } from "./Icons";
import { Action } from "./shared/Action";
import { walkRows } from "../lib/rowKeys";

interface Props {
  /** The user's own folders, in shelf order. */
  boards: UserBoard[];
  /** How many notes are currently in each — purely informational. */
  countFor?: (boardId: string) => number;
  /** Offered as a row when there is a real "take this off its board" to do:
   *  a single open note filed somewhere, or a selection with at least one
   *  filed note in it (`anyFiled` in `SelectionBar`).
   *
   *  **Multi-select used to be refused this row, and the objection was the
   *  word.** A selection can carry notes from several boards or none, and
   *  "Unfiled" had no one honest thing to say about all of them at once. The
   *  row is the **Inbox** now — a destination exactly like every other row in
   *  this list — and "move these to the Inbox" is as honest about forty notes
   *  as about one, which is all any other row here promises. So the objection
   *  went with the word, and the row is offered to both.
   *
   *  **Without it there is no way to empty a folder back into the pile.** The
   *  only other exit was deleting the folder, and `handleDeleteBoard` archives
   *  every note filed there on the way out — so the one gesture that emptied a
   *  folder also took its contents off the board entirely, which is not what
   *  anybody meant by "I do not want this folder any more". Forty notes could
   *  go *into* a folder in one gesture and could not come out at all. */
  showUnfiled?: boolean;
  /** An existing board, tapped. */
  onChoose: (board: UserBoard) => void;
  /** The Inbox row, tapped — one note, or every note in a selection. The two
   *  prop names are the last place the app says "unfiled" out loud; nothing
   *  the user sees does. */
  onUnfile?: () => void;
  /** The Links row, tapped. Drawn only when handed: Links is a lens, and the
   *  one way a note is put there by hand is this row (`keptOnLinks` in
   *  `lib/boards.ts`), offered for notes that carry an address and are not
   *  there already. */
  onLinks?: () => void;
  /** Makes a new board and files into it in one motion: Enter on a name that
   *  matches no board at all, or the **New board** row, drawn for any typed
   *  name no board is called exactly. A name that matches one or more is a
   *  search: Enter files into the top match instead, and the row is the way
   *  to make the board anyway. */
  onCreate: (name: string) => void;
  onCancel: () => void;
  error?: string | null;
  /** Where it stands when it is not in the bottom-right corner — beside the
   *  pointer, when the selection's panel was opened by a right-click, or under
   *  the open note's Move mark with a mouse (`hangUnder`). */
  style?: CSSProperties;
  /** The foot of the mark it hangs under, when it does not stand in the
   *  bottom-right corner — the open note's Move mark, with a mouse (review
   *  UI-A-03; `hangUnder` in `lib/pointerAnchor.ts`). */
  under?: UnderAnchor;
  /** Standing over the open note, above the layer that closes it on a click
   *  anywhere else (`.menu-dismiss-over`), as the reminder panel does. */
  over?: boolean;
}

/**
 * The board picker, shared by the multi-select Move panel (`SelectionBar`)
 * and the open note's own Move mark (`NoteView`) — one chooser, one set of
 * rules, so filing a note looks and behaves the same however you reached it.
 *
 * The one text field does double duty as search and creation, exactly the
 * way the old tag chooser's did: typing narrows the list below, and Enter
 * either lands on the board that matches or makes a new one.
 *
 * **A new board is always one row away** (owner approved 2026-10-19,
 * review). Enter files into the top match, so a name inside another's —
 * "Car" with Cards listed — could never be made: every Enter went to Cards.
 * Any typed name that no board is called exactly now draws a **New board
 * “Car”** row after the matches, a button like the rest and reached by the
 * arrows; Enter still files into the top match when there is one, so "kit"
 * with Kitchen listed is still Kitchen.
 *
 * **Every folder is listed, in shelf order, and the list scrolls** (owner
 * approved 2026-10-05, review UX-A-06). It used to stop at six and say "2 more
 * — type to find them", so a folder past the sixth could only be reached by
 * remembering its name, while Tidy up's own grid showed them all. The wall is
 * kept short by the scroll region's height (`.selpanel-scroll`, about six
 * rows), not by hiding anything; typing still narrows it.
 */
export function BoardChooser({
  boards,
  countFor,
  showUnfiled = false,
  onChoose,
  onUnfile,
  onLinks,
  onCreate,
  onCancel,
  error,
  style,
  under,
  over = false,
}: Props) {
  const [name, setName] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  // Whatever held the focus when the chooser opened: the Move mark, the
  // selection's panel, the capture bar's board mark.
  const opener = useRef<Element | null>(
    typeof document === "undefined" ? null : document.activeElement,
  );

  useEffect(() => {
    setName("");
  }, []);

  // Hung under a mark near the right edge, pulled back in by its own width.
  // Hung from the top, it also keeps the height it opened at: typing narrows
  // the list, and a panel shrinking towards its top carried the field being
  // typed in up with it (ui-sweep 2026-10-28). Standing on the floor, as on a
  // phone, it shrinks downwards and the field already stays put.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!under || !panel) return;
    keepInside(panel, under);
    if (panel.offsetHeight > 0) panel.style.setProperty("--held-h", `${panel.offsetHeight}px`);
  }, [under]);

  /**
   * The focus goes in when the chooser opens, and back to what opened it when
   * it closes (review UX-B-05). Pressing Move from the keyboard left the focus
   * on the mark, eight Tabs from the chooser and fifteen from its field, and
   * choosing a folder dropped it to the page.
   *
   * In: the field, where a hardware keyboard can type a folder's name at
   * once — never on a phone, where focusing a field throws the keyboard up
   * over the list. There the panel itself takes it (no ring: it is the one
   * thing asking), unless a text field already holds it — the capture bar's
   * words, whose keyboard must not drop because the chooser opened.
   *
   * Back: only while the focus is still the chooser's (inside it, or lost to
   * the page as its rows went). A caller that already put it somewhere —
   * the capture bar hands it to the write field — keeps its answer.
   */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (hasKeyboard(false)) fieldRef.current?.focus({ preventScroll: true });
    else if (!isTypingTarget(document.activeElement)) panel?.focus({ preventScroll: true });
    const back = opener.current;
    return () => {
      const active = document.activeElement;
      const ours = !active || active === document.body || Boolean(panel?.contains(active));
      if (ours && back instanceof HTMLElement && back.isConnected) {
        back.focus({ preventScroll: true });
      }
    };
  }, []);

  const typed = name.trim();
  const query = typed.toLowerCase();
  const matched = query ? boards.filter((b) => b.name.toLowerCase().includes(query)) : boards;
  const exact = query ? boards.find((b) => b.name.toLowerCase() === query) : undefined;
  // Where Enter goes: the board named exactly, else the first one the typed
  // words narrow the list to; with none, Enter makes a new board.
  const target = query ? (exact ?? matched[0]) : undefined;
  // The New board row: any valid name no board is called exactly. A name that
  // is only part of another's ("Car" in Cards) is a new board too, and with
  // Enter going to the top match the row is the only way to make it.
  const canMake = query !== "" && !exact && isBoardName(typed);

  return (
    <div
      ref={panelRef}
      className={`selpanel selpanel-chooser ${under ? "selpanel-under" : "selpanel-right"}${over ? " selpanel-over" : ""}`}
      style={under ? hangUnder(under) : style}
      role="group"
      aria-label="Move to a board"
      tabIndex={-1}
      // The arrows walk the board rows (the New board row among them), from
      // the field and between rows; Home and End stay the field's own (the
      // caret). Never while an input method is composing: its arrows walk its
      // own suggestions, and taking them threw the focus onto a row.
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.target === fieldRef.current && (e.key === "Home" || e.key === "End")) return;
        walkRows(e, ".selpanel-board, .selpanel-new");
      }}
    >
      <Action label="Cancel" onClick={onCancel}>
        <IconClear />
      </Action>
      {/* The place a note goes when it leaves its board is the Inbox, and it
          is called that everywhere else in the app and drawn with the inbox
          mark. This row used to read "Unfiled" over a folder — a word used
          nowhere else, above a glyph that made it look like a folder of that
          name, so the one row that puts a note *back* was the one row you
          could not find. It sits first, above the folders, because it is the
          only row here that is not one: a note leaves by it, and every row
          under it is somewhere a note arrives. */}
      {showUnfiled && onUnfile && (
        <Action label="Inbox" onClick={onUnfile} className="selpanel-board">
          <IconInbox />
        </Action>
      )}
      {/* Beside the Inbox, above the folders: the other place a note can go
          that is not one of the user's. A note with words beside its address
          otherwise sat in the pile for good. */}
      {onLinks && (
        <Action label="Links" onClick={onLinks} className="selpanel-board">
          <IconLink tier="inline" />
        </Action>
      )}
      {/* The folders, every one, scrolling inside their own region so the
          field under them and Cancel over them stay put. */}
      {matched.length > 0 && (
        <div className="selpanel-scroll">
          {matched.map((b) => (
            <Action
              key={b.id}
              label={b.name}
              onClick={() => onChoose(b)}
              className="selpanel-board"
              style={tintOf(b)}
              suffix={countFor && <span className="selpanel-n">{countFor(b.id)}</span>}
            >
              {/* A folder's own mark on its row here, exactly as the shelf,
                  the drawer and the open note draw it — this list drew the
                  generic folder on every row and so was the one place a
                  dressed folder was not recognisable before its name was
                  read. Its **hue** too, since 2026-10-01 (owner approved,
                  review UI-08): the tint belongs to the folder's mark wherever
                  the folder is named (`DESIGN.md` §2b), and a chooser naming
                  the folders to file into is exactly where it is recognised
                  before it is read. Set on the row as `--board-tint` by
                  `tintOf`; the name beside it stays on the greyscale, in the
                  shelf's own display face (`.selpanel-board`). */}
              <FolderGlyph icon={b.icon} picked />
            </Action>
          ))}
        </div>
      )}
      {/* After the matches and outside their scroll region, so it is never
          scrolled out of sight: the one row that makes what was typed. A
          button like the rest, ~44px, with nothing that needs a key or a
          hover, so a finger has it. */}
      {canMake && (
        <Action label={`New board “${typed}”`} onClick={() => onCreate(typed)} className="selpanel-new">
          <IconPlus tier="inline" />
        </Action>
      )}
      <div className="selpanel-row">
        <input
          ref={fieldRef}
          className="field-words"
          value={name}
          maxLength={BOARD_NAME_MAX}
          placeholder="Search or new board"
          aria-label="Search boards or name a new one"
          enterKeyHint="go"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter that picks a word in an input method is not a commit.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              // The same rule App's own create paths check. This one leaned on
              // the input's maxLength instead, so the rule and the cap only
              // agreed by coincidence — and this is the create path the open
              // note's Move chooser uses.
              if (!isBoardName(typed)) return;
              // A partial name is a search, not a new board: "kit" with Kitchen
              // listed once made an empty board called KIT. Enter makes one
              // only for a name that matches nothing; for any other, the New
              // board row does.
              if (target) onChoose(target);
              else onCreate(typed);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
      </div>
      {/* One line kept under the field whether or not it says anything, so
          the first letter typed does not push the field up to make room for
          it (ui-sweep 2026-10-28). */}
      <p className="selpanel-hint mono">
        {error
          ? error
          : target
            ? `Enter to move to ${target.name}`
            : query
              ? `Enter to create “${typed}”`
              : null}
      </p>
    </div>
  );
}

/** Re-exported so callers validating a typed name before creating share the
 *  one rule (`lib/boards.ts`) rather than each inventing their own. */
export { isBoardName };
