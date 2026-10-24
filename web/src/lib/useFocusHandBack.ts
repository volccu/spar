import { useEffect, useRef, type RefObject } from "react";
import { inReadingOrder } from "./useGridKeyboard";

interface Options {
  /** The Sorter or the Ticker is up. */
  modeUp: boolean;
  /** The open note's id, or null. */
  openId: string | null;
  /** The search row is open. */
  searchOpen: boolean;
  /** The capture bar's burger, which a mode hands the focus back to. */
  menuBtn: RefObject<HTMLButtonElement | null>;
  /** The board row's search mark, which search hands the focus back to. */
  searchBtn: RefObject<HTMLButtonElement | null>;
  /** Settings is up (the header's cog opens it; so does Ctrl+comma). */
  settingsOpen: boolean;
  /** About is up (from Settings, or by the ? key). */
  aboutOpen: boolean;
  /** The header's cog, which Settings (and About, by way of Settings) hands the focus back to. */
  cog: RefObject<HTMLButtonElement | null>;
}

/**
 * Where the focus goes when a mode, the open note or search closes — after
 * the commit, because each of them leaves it on the body otherwise (review
 * PL-10 moved this out of `App.tsx` whole; the comments are the ones it had
 * there).
 */
export function useFocusHandBack({
  modeUp,
  openId,
  searchOpen,
  menuBtn,
  searchBtn,
  settingsOpen,
  aboutOpen,
  cog,
}: Options) {
  /**
   * The focus, when a mode closes — and it has to be done here rather than by
   * `useRestoreFocus`, which is where every other layer does it.
   *
   * That hook hands the focus back during the **unmount**, and both of the
   * things it could hand it to are missing at that moment. The control that
   * opened the mode is a row inside the menu, and the menu closed on the way
   * in. The control that row belongs to is the capture bar's burger, and the
   * capture bar is deliberately unmounted for as long as a mode runs — it
   * comes back in the *same commit* the mode leaves in, and React inserts it
   * after it has torn the mode down, so at cleanup time the burger is neither
   * in the document nor attached to its ref. The focus landed on the body.
   *
   * This runs after that commit, when the burger is real again. It fires only
   * on the edge — a mode that was up and now is not — so it can never steal
   * the focus from something the reader has since moved to.
   */
  const modeWasUp = useRef(false);
  useEffect(() => {
    if (modeWasUp.current && !modeUp) menuBtn.current?.focus();
    modeWasUp.current = modeUp;
  }, [modeUp, menuBtn]);

  /**
   * The same after-the-commit hand-back, for the open note and for search
   * (review 2026-10-01, UX-12). Both left the focus on the body.
   *
   * The note's sheet does hand the focus back as it unmounts
   * (`useRestoreFocus`), but in that same commit the board under it is still
   * `inert` — the attribute comes off later in the commit than the sheet comes
   * out — so the card refuses the focus. Search's field simply goes, with the
   * caret in it. Each effect fires on its own edge, and only while the focus
   * is on the body — nothing else claimed it — so a drawer's burger or a tab
   * the reader moved to keeps it. The card is found by the note's id, since
   * the one the sheet remembered may have been drawn afresh while it was open.
   */
  const lastOpenId = useRef<string | null>(null);
  useEffect(() => {
    const closed = lastOpenId.current;
    lastOpenId.current = openId;
    if (openId !== null || closed === null) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const card = [...document.querySelectorAll<HTMLElement>(".card[data-id]")].find(
      (el) => el.dataset.id === closed,
    );
    card?.focus();
  }, [openId]);
  /**
   * About, closed after a key opened it (`?` from a card). The card is `inert`
   * until the same commit About leaves in, so `useRestoreFocus` was refused and
   * the focus fell to the page: arrows, E and Delete did nothing until a click.
   * It goes back to what had it when About opened, or to the cog when About
   * came by way of Settings (whose own hand-back is the cog, `restoreTo`).
   * Read on the render About arrives in, as `useRestoreFocus` reads it.
   */
  const about = useRef({ was: false, settings: false, from: null as Element | null, viaSettings: false });
  const ab = about.current;
  if (aboutOpen && !ab.was) {
    ab.from = document.activeElement;
    ab.viaSettings = ab.settings;
  }
  useEffect(() => {
    const was = ab.was;
    ab.was = aboutOpen;
    ab.settings = settingsOpen;
    if (!was || aboutOpen) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const from = ab.from;
    const own = !ab.viaSettings && from instanceof HTMLElement && from.isConnected && from !== document.body;
    (own ? from : cog.current)?.focus();
  }, [ab, aboutOpen, settingsOpen, cog]);
  const searchWasOpen = useRef(false);
  useEffect(() => {
    const was = searchWasOpen.current;
    searchWasOpen.current = searchOpen;
    if (!was || searchOpen) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    searchBtn.current?.focus();
  }, [searchOpen, searchBtn]);
}

/**
 * Where the focus goes after a verb has moved a card off the board or brought
 * one back (Move, Ctrl+Z): to the card of the note acted on, or, when that
 * card is not on this board, to whatever now fills its slot (the neighbour; the
 * last card if it was the last). Without it the focus fell to the page and the
 * arrows, E and Delete did nothing until a card was clicked.
 *
 * `slot` is `cardSlot` read before the action: where the focus stood on the
 * board, or -1 when it stood nowhere on it — a mouse or a touch has no place to
 * keep, so none is invented (it used to be slot 0, which pulled the board to
 * the top). It stands down when the focus has gone somewhere that is not a card
 * and not the page — the write box, a panel the verb opened — since nothing
 * there is the user's place to lose.
 *
 * **It never moves the board, and never hands the focus to a card that is not
 * on screen**: Delete and E act on the card that holds the focus, and a card
 * the reader cannot see is not one to hand it. The focus goes without scrolling
 * (`preventScroll`).
 */
export function cardSlot(grid: HTMLElement | null, ids: string[]): number {
  const cards = inReadingOrder(Array.from(grid?.querySelectorAll<HTMLElement>(".card[data-id]") ?? []));
  return cards.findIndex((c) => ids.includes(c.dataset.id ?? ""));
}

/**
 * Whether a card is within the board's scroller, as far as it can be told. A
 * card with no height is one nothing was measured for (no layout engine, in a
 * test) and counts as on screen, as everywhere else that measures.
 */
function onScreen(card: HTMLElement): boolean {
  const at = card.getBoundingClientRect();
  if (at.height === 0) return true;
  const view = card.closest(".scroll")?.getBoundingClientRect();
  const measured = view !== undefined && view.height > 0;
  const top = measured ? view.top : 0;
  const bottom = measured ? view.bottom : window.innerHeight;
  return at.bottom > top && at.top < bottom;
}

export function handFocusToCard(grid: HTMLElement | null, ids: string[], slot: number, tries = 0) {
  window.setTimeout(() => {
    const cards = inReadingOrder(Array.from(grid?.querySelectorAll<HTMLElement>(".card[data-id]") ?? []));
    const own = cards.find((c) => ids.includes(c.dataset.id ?? ""));
    // A card coming back is drawn a moment after the reversal; look again
    // before settling for its neighbour.
    if (!own && ids.length > 0 && tries < 3) return handFocusToCard(grid, ids, slot, tries + 1);
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !active.closest(".card")) return;
    const target = own ?? (slot >= 0 ? cards[Math.min(slot, cards.length - 1)] : undefined);
    if (target && onScreen(target)) target.focus({ preventScroll: true });
  }, tries === 0 ? 0 : 50);
}
