import { useState, type RefObject } from "react";
import type { Note } from "../types";
import { isReturnNavigation } from "./returnState";
import { useDeckGrowth } from "./useDeckGrowth";
import { useGridFill } from "./useGridFill";

/**
 * useGridContents — which of the board's notes are mounted as cards right now.
 *
 * Two limits stack. A freshly paged-to board renders a screenful first and the
 * rest after the slide-in, so the commit that has to land between slide-out and
 * slide-in stays small — see `useGridFill`. And of that, how much the reader
 * has come near (audit PERF-3, PERF-6): a long board, and every search letter,
 * mounts a few screens of cards and grows as the sentinel after the last one
 * nears the bottom of the scroller (`useDeckGrowth`). The smaller of the two
 * wins. Everything that *reads* the board keeps reading `visible` whole
 * (select-all, sibling navigation, the counts); only the cards in the DOM go
 * through `deck`.
 *
 * `fillKey` is the view's *identity*, not its `viewKey` whole: the Inbox's
 * `since` half arrives from prefs a beat after boot and changes again when the
 * first-open question is answered, and neither of those is a paging — the first
 * would quietly re-chunk the boot render the exemption in `useGridFill` exists
 * to keep whole.
 *
 * `restored` is whether the board has a place to come back to — it arrives
 * whole then (see `useBoardScroll`); so does the first view of a
 * back-from-a-link boot, whose offset `useReturnSpot` puts straight back. The
 * deck is never short of `openId`'s card, so the one a closing note shrinks
 * into is there.
 *
 * What comes back: `deck` (the notes to draw), `setDeckEnd` (the ref callback
 * for the sentinel after the last card) and `wantsEnd` (whether that sentinel
 * should be drawn: there are more, and growth has not yet gone past the fill).
 */
export function useGridContents(
  fillKey: string,
  visible: Note[],
  restored: boolean,
  scrollRef: RefObject<Element | null>,
  openId: string | null,
) {
  const shown = useGridFill(fillKey, visible.length, restored);
  const [deckEnd, setDeckEnd] = useState<HTMLElement | null>(null);
  const [returnBoot] = useState(() => ({ view: fillKey, back: isReturnNavigation() }));
  const openAt = openId ? visible.findIndex((n) => n.id === openId) + 1 : 0;
  const grown = useDeckGrowth(
    fillKey,
    visible.length,
    deckEnd,
    scrollRef,
    restored || (returnBoot.back && fillKey === returnBoot.view),
    openAt,
  );
  const mounted = Math.min(shown, grown);
  const deck = mounted < visible.length ? visible.slice(0, mounted) : visible;
  const wantsEnd = deck.length < visible.length && grown <= shown;
  return { deck, setDeckEnd, wantsEnd };
}
