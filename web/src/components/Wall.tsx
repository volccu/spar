import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEventHandler,
  type ReactElement,
} from "react";
import type { Note } from "../types";
import { placeTiles, tileHeight, wallColumns, wallFace } from "../lib/wall";

/**
 * The Inspiration board's grid: flex columns, filled by `placeTiles`.
 *
 * Not CSS `columns` (see `lib/wall.ts` for why), and not `.grid` — it states
 * nothing of the uniform grid's rows, so none of that grid's rules can reach it.
 * The tiles arrive already drawn as cards, in board order; this only decides
 * which column each stands in. DOM order is therefore column by column, and
 * every tile says its board position in `data-pos` for the keyboard.
 *
 * Reached through a dynamic import (`App`), so the wall costs the first paint
 * nothing.
 */
interface Props {
  /** The board's notes, in the order the board draws them. */
  notes: Note[];
  /** One drawn card per note, same order. */
  cards: ReactElement[];
  /** Hands the wall element up, as the uniform grid's ref is (`setGrid` in App.tsx). */
  gridRef: (el: HTMLElement | null) => void;
  onFocus: FocusEventHandler<HTMLElement>;
}

export function Wall({ notes, cards, gridRef, onFocus }: Props) {
  const el = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  // One stable callback, so the parent's setter is not told "gone, back again"
  // on every render of the wall.
  const setNode = useCallback(
    (node: HTMLDivElement | null) => {
      el.current = node;
      gridRef(node);
    },
    [gridRef],
  );

  // The column count follows the board's own width, so a phone turning on its
  // side or a window being dragged re-places the tiles. Where there is no
  // ResizeObserver (jsdom) the width stays 0 and the wall is two columns.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const read = () => setWidth(node.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const heights = useMemo(() => notes.map((n) => tileHeight(wallFace(n))), [notes]);
  const placed = useMemo(() => placeTiles(heights, wallColumns(width)), [heights, width]);

  return (
    <div className="wall" data-wall ref={setNode} onFocus={onFocus}>
      {placed.map((column, c) => (
        <div className="wall-col" key={c}>
          {column.map((i) => cards[i])}
        </div>
      ))}
    </div>
  );
}
