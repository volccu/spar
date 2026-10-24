import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { cycleTab } from "../lib/focusTrap";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import type { CSSProperties, ReactNode } from "react";
import type { BoardKind } from "../types";
import { isBuiltIn } from "../lib/boards";
import { IconPlus } from "./Icons";
import { NewBoardName } from "./NewBoardName";
import { Count } from "./Count";
import { ENTER, EXIT, SLIDE_IN_MS, SLIDE_OUT_MS, animates } from "../lib/motion";
import type { BoardPress } from "../lib/useBoardPress";

/** One row: a board on the shelf, in shelf order. Trash is the last one. */
interface ShelfBoard {
  id: string;
  name: string;
  /** What the board *does*, which is what the shelf divides on — `isBuiltIn`
   *  reads this and nothing else, so the drawer draws its hairline off the
   *  same definition the strip does. */
  kind: BoardKind;
  count: number;
  /** The board's chosen mark, if it has one — the strip's own `Board.icon`. */
  icon?: string;
  /** Its hue as a CSS value, already resolved by `boardTint`, or null. */
  tint?: string | null;
}

interface Props {
  /** The whole shelf in order, Trash included — index `i` is `goToBoard(i)`. */
  boards: ShelfBoard[];
  /** Which one is on. `-1` while searching, when none of them is. */
  index: number;
  /** The board mark, so the shelf and the strip draw the same one. */
  icon: (board: ShelfBoard) => ReactNode;
  /** Hands each row to the same ref array the strip fills, so the app's own
      focus and paging code reaches whichever of the two is on screen. */
  registerTab: (i: number, el: HTMLButtonElement | null) => void;
  onChoose: (i: number) => void;
  /** Arrow/Home/End moved to a board — the strip's own step, said vertically. */
  onStep: (i: number) => void;
  /**
   * The strip's own hold (`useBoardPress` in App.tsx): hold a row and carry it
   * to move it along its run, let go in place for its menu, right-click for the
   * menu at once. Handed in whole, so the drawer cannot press differently from
   * the strip — it only says which way it runs.
   */
  press: BoardPress;
  onClose: () => void;
  /** The burger this opened from — where the focus goes when it shuts. */
  restoreTo: React.RefObject<HTMLButtonElement | null>;
  /**
   * Opened from the burger inside an open note rather than over a board. The
   * note is a full-screen sheet above the board, so the drawer and its scrim
   * take the step the note's own panels take, or they open underneath it.
   */
  over?: boolean;
  /**
   * Whether this drawer is the only shelf on screen. On a phone it is, and
   * its rows are the tabs the board panel is named by, so each carries its
   * `board-tab-*` id. On a desktop the strip is still standing behind it and
   * already carries every one of those ids, so the rows here go without: two
   * elements with one id is invalid markup, not a hidden duplicate. The rows
   * are still tabs, still control the panel and still hold the app's own ref
   * array while the drawer is up, so the arrow keys and the focus walk them.
   */
  alone?: boolean;
  /**
   * The folder whose Look sheet is standing over this drawer, if one is. The
   * sheet takes the foot of the screen, so the drawer makes that much room
   * under its rows (`.shelf[data-dressing]`) and brings this row up above the
   * sheet, where its new mark and tint can be seen landing. Left as the
   * sheet's own layer, never a reason to close the drawer: the sheet is what
   * the drawer opened, and closing it hands the reader back to the drawer.
   */
  dressing?: string | null;
  /** The new-board field, which is the same one the strip opens. */
  creating: boolean;
  newName: string;
  nameMax: number;
  onNewName: (value: string) => void;
  onStartCreate: () => void;
  onCreate: (name: string) => void;
  onCancelCreate: () => void;
}

/**
 * The shelf of boards standing up: a drawer that slides in, not a page.
 *
 * Sideways is the wrong axis for a phone. The strip works on a desktop, where
 * it is one row of a wide window and every board is visible at once; on a
 * 390px screen the same row holds three tabs and hides the rest behind a
 * scroll nobody can see the end of — so the board you want is somewhere off
 * the edge, and finding it is a drag with no landmarks. Standing them up in a
 * drawer shows the whole shelf at once, which is the thing the strip was for.
 * On a phone it *replaces* the strip; on a desktop it stands beside it, behind
 * a burger at the row's left end, for a shelf grown too long to lie down in
 * one row (see `alone`).
 *
 * A row is a board and says two things: its mark and its name, with the count
 * out at the right edge. **No glimpse of what is inside it.** That was tried —
 * two muted lines off the top of each board, under the name — and it turned a
 * shelf you could take in at a glance into a wall of half-sentences: what you
 * are looking for on this screen is a *name*, and every line that is not a name
 * is something to read past. The board itself is one tap away and is the right
 * place for its own contents.
 *
 * **The one hairline is here too, on the other axis.** The shelf divides
 * places from the app's own boards — Inbox, folders, Archive, then the line,
 * then Inspiration, Todos, Links, Files, All — and the line means *the app's
 * own boards start here* (Inspiration, a place, is the one of them a note can
 * be filed into). The strip drew it and the drawer did not, which had it missing
 * from exactly the shape where all fourteen rows are read top to bottom. It is
 * `isBuiltIn` in `lib/boards.ts` on both sides, never a second rule, and it is
 * still **one** line: a row already carries a soft rule under it, so the
 * division is that rule at the weight every real edge in the app takes, laid
 * over the soft one rather than added to it (`.shelf-split`). Trash gets none
 * — the strip separates it by pinning it outside the scroller, and a second
 * hairline in here would be the multiplication the shelf allows exactly one of.
 *
 * It comes in from the **left**, because that is the edge the burger that
 * opens it sits on. A panel that opens away from its own control is a panel
 * you have to look for. (The app's other panels — the menu, the selection
 * actions — anchor bottom-right, where the thumb is; that rule is about a
 * short list of *actions* answering a button in that same corner, and this is
 * navigation answering a button in this one.)
 *
 * Everything it does, it does through the app's own handlers: the same
 * `goToBoard`, the same hold that carries a board or opens `BoardMenu`, the
 * same new-board field. It is a second shape for one shelf, never a second
 * shelf. A row carried here moves up and down rather than sideways, and a
 * carry never closes the drawer — the release is swallowed before the row's
 * click can close it, so a person putting their shelf in order can move one
 * row after another without opening it again each time.
 */
export function Shelf({
  boards,
  index,
  icon,
  registerTab,
  onChoose,
  onStep,
  press,
  onClose,
  restoreTo,
  over = false,
  alone = true,
  dressing = null,
  creating,
  newName,
  nameMax,
  onNewName,
  onStartCreate,
  onCreate,
  onCancelCreate,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const leaving = useRef(false);
  // Where the focus goes when this shuts — MenuPanel's dance, with one change.
  // MenuPanel restores to whatever had the focus when it opened, and that is
  // only the button that opened it if the browser focused the button on the
  // way in: a tap on a touch screen often does not, and neither does every
  // desktop browser. The burger is named outright, and the remembered element
  // is the fallback for the case the burger is no longer on screen.
  useRestoreFocus(restoreTo);

  // The row being dressed, brought up out from under the Look sheet. After the
  // room is made (the attribute is in this same commit), and only as far as
  // needed: `scroll-padding` says the sheet's band is out of view.
  useEffect(() => {
    if (!dressing) return;
    const row = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>("[data-board-id]") ?? []),
    ].find((el) => el.dataset.boardId === dressing);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [dressing]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    // In from the edge it is anchored to. No `fill`, so the animation lets go
    // of the element the moment it lands and the resting position is the CSS's
    // again — the same rule the board deck's own enter follows.
    if (animates(el)) {
      el.animate(
        [{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }],
        { duration: SLIDE_IN_MS, easing: ENTER },
      );
    }
    const first =
      el?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]') ??
      el?.querySelector<HTMLButtonElement>('[role="tab"]');
    first?.focus();
  }, []);

  /**
   * Closing, with whatever the tap actually asked for done first.
   *
   * The board changes immediately and the drawer slides off what is already
   * the new board — the 90% path does not wait on an animation. Reversed, a
   * tap would sit for the length of the move before anything happened, which
   * is the one thing the local-first store exists to avoid.
   */
  function close(after?: () => void) {
    if (leaving.current) return;
    after?.();
    const el = panelRef.current;
    if (!animates(el)) {
      onClose();
      return;
    }
    leaving.current = true;
    // `fill: forwards` and not bare, unlike the enter above. Without it the
    // animation lets go of the element the instant it finishes, which drops the
    // drawer back to its resting `translateX(0)` — fully open — for however many
    // frames pass before React unmounts it on `onClose`. That is one frame of
    // the whole drawer reappearing at the end of every close: the flash. It is
    // safe here in a way it would not be on the enter, because this element is
    // on its way out and nothing will ever read its transform again — the same
    // reason the deck's leaving half, a swiped card and the Sorter's close all
    // fill forwards while their entering halves do not.
    const out = el.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }],
      { duration: SLIDE_OUT_MS, easing: EXIT, fill: "forwards" },
    );
    out.onfinish = () => onClose();
  }

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // The drawer behaves as a modal — a full-screen dismiss button in front of
    // the page, and `App.tsx` marks the board and the grid behind it `inert` —
    // but the header and the capture bar are outside that, so Tab off the last
    // row landed in the write field *behind the scrim*, where what you typed
    // was invisible. Kept inside, like every other layer here.
    if (e.key === "Tab") {
      cycleTab(e, panelRef.current);
      return;
    }
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  /**
   * A vertical tablist walks with Up and Down, which is the whole difference
   * between this and the strip. The step itself is the app's — the same one
   * the strip's Left/Right arrows take, so paging, the selection it clears on
   * the way into Trash, and where the focus lands are decided in one place.
   */
  function onRowKeyDown(i: number, e: React.KeyboardEvent<HTMLButtonElement>) {
    const total = boards.length;
    let next: number | null = null;
    if (e.key === "ArrowDown") next = (i + 1) % total;
    else if (e.key === "ArrowUp") next = (i - 1 + total) % total;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = total - 1;
    if (next === null) return;

    e.preventDefault();
    e.stopPropagation();
    onStep(next);
  }

  return (
    <>
      {/* Outside the drawer is the close action, and it is the app's one
          pattern for that — the same full-screen button every bottom panel
          dismisses through. */}
      <button
        type="button"
        className={over ? "menu-dismiss menu-dismiss-over" : "menu-dismiss shelf-dismiss"}
        aria-label="Close boards"
        tabIndex={-1}
        onClick={() => close()}
      />
      {/* Modal in behaviour, so modal in markup: it says what it is and what
          it is called, and the reader is told it has arrived somewhere rather
          than being left to infer it from the rows. */}
      <div
        ref={panelRef}
        className={over ? "shelf shelf-over" : "shelf"}
        // The drawer itself is what scrolls, so it is what a carried row
        // scrolls when it is held near the top or the foot.
        data-shelf-scroll
        data-dressing={dressing ?? undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Boards"
        onKeyDown={onPanelKeyDown}
      >
        <div
          className="shelf-list"
          role="tablist"
          aria-label="Boards"
          aria-orientation="vertical"
        >
          {boards.map((b, i) => {
            const on = index === i;
            // The first of the app's own boards after the places, which is the
            // one place the line falls. Read the same way App.tsx reads it for the strip.
            const prev = boards[i - 1];
            const opensBuiltIns = isBuiltIn(b) && (!prev || !isBuiltIn(prev));
            return (
              <Fragment key={b.id}>
                {opensBuiltIns && <span className="shelf-split" aria-hidden />}
                <button
                  ref={(el) => registerTab(i, el)}
                  id={alone ? `board-tab-${b.id}` : undefined}
                  data-board-id={b.id}
                  role="tab"
                  type="button"
                  className="shelf-row"
                  // The app's own boards, and Trash which closes them, stand on one lifted
                  // ground (styles.css, `--lens-ground`).
                  data-lens={isBuiltIn(b) || b.kind === "trash" ? true : undefined}
                  // A coloured board is recognised in the drawer the same way it
                  // is in the strip: by its mark. No style attribute at all for a
                  // board with no colour, so its mark falls through to the tone
                  // it has always had.
                  style={b.tint ? ({ "--board-tint": b.tint } as CSSProperties) : undefined}
                  aria-selected={on}
                  aria-controls="board-panel"
                  tabIndex={on ? 0 : -1}
                  onKeyDown={(e) => onRowKeyDown(i, e)}
                  {...press.bind({ id: b.id, name: b.name }, "y")}
                  onClick={(e) => press.click(e, () => close(() => onChoose(i)))}
                >
                  {icon(b)}
                  <span className="shelf-row-name">{b.name}</span>
                  <Count className="tab-n" text={b.count} />
                </button>
              </Fragment>
            );
          })}
        </div>

        {/* Making a board still costs one tap and a name, and the field still
            opens where the board is about to sit. Outside the tablist, because
            it is not a board and a tablist holds nothing but tabs — the strip
            keeps it inline for want of anywhere else to put it. */}
        {creating ? (
          <span className="shelf-row shelf-row-new">
            <IconPlus tier="inline" />
            <NewBoardName
              className="field-words"
              value={newName}
              max={nameMax}
              onChange={onNewName}
              onCreate={(name) => close(() => onCreate(name))}
              onCancel={onCancelCreate}
            />
          </span>
        ) : (
          <button
            type="button"
            className="shelf-row shelf-row-add"
            onClick={onStartCreate}
          >
            <IconPlus tier="inline" />
            <span className="shelf-row-name">New board</span>
          </button>
        )}
      </div>
    </>
  );
}
