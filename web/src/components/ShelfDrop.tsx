import { Fragment, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { BoardKind } from "../types";
import { isBuiltIn } from "../lib/boards";
import { ENTER, SLIDE_IN_MS, animates } from "../lib/motion";
import { Count } from "./Count";

interface DropRow {
  id: string;
  name: string;
  kind: BoardKind;
  count: number;
  icon?: string;
  tint?: string | null;
}

interface Props {
  /** The shelf in order, Trash last — the drawer's own rows. */
  boards: DropRow[];
  /** The board mark, so this draws the one the strip and the drawer draw. */
  icon: (board: DropRow) => ReactNode;
  /** The row under the finger that would take the notes. */
  target: string | null;
  /** The rows that would refuse them, dimmed. */
  refuses: readonly string[];
}

/**
 * The shelf a phone opens for a carried note (2026-10-23, `lib/shelfDrop.ts`).
 *
 * A phone has no strip — its shelf is the drawer behind the burger — so a note
 * carried up to the board row brings the drawer in to be dropped on. This is
 * that drawer's picture and nothing more: the same rows, the same marks and
 * names, the same hairline, sliding in from the same edge. It is not the
 * drawer itself, which is a modal layer that takes the focus and seals the
 * board behind it — that would take the pointer away from the card carrying
 * the notes mid-gesture. Nothing here can be pressed: the finger is still on
 * the card, and letting go over a row is the whole of the interaction. Hidden
 * from a reader, who has Move for the same thing.
 */
export function ShelfDrop({ boards, icon, target, refuses }: Props) {
  const panel = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = panel.current;
    if (animates(el)) {
      el.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }], {
        duration: SLIDE_IN_MS,
        easing: ENTER,
      });
    }
  }, []);

  return (
    <div ref={panel} className="shelf shelf-drop" aria-hidden>
      <div className="shelf-list">
        {boards.map((b, i) => {
          const prev = boards[i - 1];
          const opensBuiltIns = isBuiltIn(b) && (!prev || !isBuiltIn(prev));
          return (
            <Fragment key={b.id}>
              {opensBuiltIns && <span className="shelf-split" />}
              <div
                className="shelf-row"
                data-drop-board={b.id}
                data-drop-target={target === b.id || undefined}
                data-refuses={refuses.includes(b.id) || undefined}
                data-lens={isBuiltIn(b) || b.kind === "trash" ? true : undefined}
                style={b.tint ? ({ "--board-tint": b.tint } as CSSProperties) : undefined}
              >
                {icon(b)}
                <span className="shelf-row-name">{b.name}</span>
                <Count className="tab-n" text={b.count} />
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
