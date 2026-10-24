import { useCallback, useRef } from "react";
import { useDismissOnBack } from "../store/useDismissOnBack";

/**
 * Every layer the app can put over the board, **top first**, in one table.
 *
 * Until 2026-10-11 "what is on top" was written down in five places in
 * `App.tsx` — the list behind Back (`dismissLayer`), the Escape listener's own
 * cascade, the two `inert` guards and the covered lists the grid's keys read —
 * and the first two disagreed: Escape cleared a selection before it closed a
 * folder's menu, Back closed the menu first (audit 2026-10-10, CODE-6). Now
 * each of those is *read off* this table, so Back and Escape always pick the
 * same layer — the first open one here — and a layer's effect on the board
 * behind it is stated once, beside it.
 *
 * The order is the order things stand on screen when two are up together:
 *
 * - A question (`dialog`) is over everything, and the Add panel over
 *   everything else with its scrim.
 * - The wall's viewer and the picture over the open note are full-screen and
 *   close themselves.
 * - The drawer, and what it opens (a folder's menu, its Look sheet, the new-
 *   board field inside it), can be opened from inside the open note, so they
 *   stand over the note — and over a selection, which leaves the board under
 *   them (the CODE-6 repro: the menu goes first, by Escape as by Back).
 * - The note can be opened from the idea canvas, so it stands over the canvas.
 * - The full-screen modes (Tidy up, Tick off, About, Settings, the import) cover the
 *   board and nothing covers them but a question.
 * - The selection's Move chooser is a face its panel wears, the panel a face
 *   the selection wears: each closes before the one under it.
 * - The menu, search and the Reminders mode take the header and nothing else.
 *
 * Some pairs cannot actually be up together (the drawer has a scrim, so a
 * canvas cannot be opened under it); the order still answers for them, so the
 * question "which goes first" never has two answers.
 */
export const LAYERS = [
  { id: "dialog", grid: "covers", escape: "own" },
  { id: "add", grid: "leaves", escape: "app" },
  { id: "wall", grid: "covers", inert: "board+row", escape: "own" },
  // The picture over the open note: NoteView's Lightbox, registered rather
  // than held in App's state. Nothing on the board changes for it — the note
  // under it already covers the board.
  { id: "picture", grid: "leaves", escape: "own" },
  { id: "look", grid: "covers", escape: "app", verbKeys: "close" },
  { id: "boardMenu", grid: "covers", escape: "app", verbKeys: "close" },
  // The new-board field, inside the drawer: over the note when the drawer is.
  { id: "newBoardInDrawer", grid: "covers", escape: "app" },
  { id: "drawer", grid: "covers", inert: "board+row", escape: "app", verbKeys: "close" },
  { id: "note", grid: "covers", inert: "board", escape: "own" },
  { id: "canvas", grid: "covers", inert: "board+row", escape: "app" },
  // The strip's own new-board field. It closes on blur, so it is open only
  // while it holds the focus — and then its own handler takes Escape.
  { id: "newBoardOnStrip", grid: "covers", escape: "own" },
  { id: "sorter", grid: "covers", inert: "board+row", escape: "own" },
  { id: "ticker", grid: "covers", inert: "board+row", escape: "own" },
  { id: "about", grid: "covers", inert: "board+row", escape: "own" },
  { id: "settings", grid: "covers", inert: "board+row", escape: "own" },
  { id: "import", grid: "covers", inert: "board+row", escape: "own" },
  { id: "moveChooser", grid: "leaves", escape: "app" },
  { id: "selectionPanel", grid: "covers", escape: "app", verbKeys: "close" },
  { id: "selection", grid: "leaves", escape: "app", verbKeys: "pass" },
  { id: "menu", grid: "covers", escape: "own", verbKeys: "close" },
  { id: "search", grid: "quiets", escape: "app", verbKeys: "close" },
  { id: "reminders", grid: "leaves", escape: "app", verbKeys: "close" },
] as const satisfies readonly LayerSpec[];

export interface LayerSpec {
  id: string;
  /**
   * What the layer does to the grid behind it.
   *
   * - `covers`: it stands over the grid. The arrows, Delete, Ctrl+A and `?`
   *   stand down (`coveredOtherThanSearch`).
   * - `quiets`: search, the one entry that does not cover the grid but changes
   *   what it holds. The arrows stand down for its field (`gridCovered`);
   *   Ctrl+A does not, since the honest scope is what is on screen.
   * - `leaves`: the grid stays on screen and in charge — a selection is what
   *   Delete means, the Reminders mode is cards to walk.
   */
  grid: "covers" | "quiets" | "leaves";
  /**
   * Takes the board out of the tab order, not merely out of sight: `board` is
   * `main`, `board+row` the board row as well. The note leaves the row alone —
   * it has always been the narrower half. Menus, sheets and a question leave
   * both: the board behind a small panel stays legitimately reachable, and a
   * dialog hands focus back into it (see the comments at the two `inert`s).
   */
  inert?: "board" | "board+row";
  /**
   * Who answers Escape when this layer is on top.
   *
   * - `app`: the app's one window listener closes it, from wherever focus is.
   * - `own`: the layer's own element takes the key (it holds the focus and
   *   traps Tab), and the app's listener stands down — never reaching past it
   *   to close something underneath.
   */
  escape: "app" | "own";
  /**
   * What the two verbs' keys, Ctrl+K and Ctrl+E, do while this layer is up.
   *
   * - `close`: they put it away on the way to search or the write box — the
   *   menu, the drawer and what it opens, search itself, the Reminders mode.
   *   Left up, the caret would land in a field behind it.
   * - `pass`: they work over it and it stays — a selection, which no key with
   *   a modifier stands down for.
   * - absent: they stand down (`verbKeysWait`). The layer is asking something
   *   or holds the screen — a question, the open note, the canvas, a full-
   *   screen mode, the wall — and this is not the moment to open something
   *   behind it.
   */
  verbKeys?: "close" | "pass";
}

export type LayerId = (typeof LAYERS)[number]["id"];

/** Whether a layer is up. A function for a layer the app learns of by
 *  registration rather than by its own state, read at the moment it is asked. */
export type Up = boolean | (() => boolean);
export type OpenLayers = Record<LayerId, Up>;

const up = (v: Up): boolean => (typeof v === "function" ? v() : v);

/** The layer Back and Escape both close: the first open one in `LAYERS`. */
export function topLayer(open: OpenLayers): (typeof LAYERS)[number] | null {
  for (const layer of LAYERS) if (up(open[layer.id])) return layer;
  return null;
}

/** What closes on Back: the top layer's id, or null with nothing up. */
export function backTarget(open: OpenLayers): LayerId | null {
  return topLayer(open)?.id ?? null;
}

/**
 * What Escape closes, and who closes it: the same layer as Back, answered by
 * the app's listener or by the layer's own element. Never a layer under it.
 */
export function escapeTarget(open: OpenLayers): { id: LayerId; by: "app" | "own" } | null {
  const top = topLayer(open);
  return top ? { id: top.id, by: top.escape } : null;
}

/** Whether anything above `id` in the table is open. */
export function coveredAbove(open: OpenLayers, id: LayerId, except: readonly LayerId[] = []): boolean {
  for (const layer of LAYERS) {
    if (layer.id === id) return false;
    if (!except.includes(layer.id) && up(open[layer.id])) return true;
  }
  return false;
}

/** Whether anything below `id` in the table is open. */
function openBelow(open: OpenLayers, id: LayerId): boolean {
  let past = false;
  for (const layer of LAYERS) {
    if (past && up(open[layer.id])) return true;
    if (layer.id === id) past = true;
  }
  return false;
}

/** Everything the board reads off the stack, derived in one place. */
export function layerFlags(open: OpenLayers) {
  let coveredOtherThanSearch = false;
  let gridCovered = false;
  let layerOpen = false;
  let inertBoard = false;
  let inertRow = false;
  let verbKeysWait = false;
  for (const layer of LAYERS) {
    if (!up(open[layer.id])) continue;
    const spec: LayerSpec = layer;
    layerOpen = true;
    if (spec.grid === "covers") coveredOtherThanSearch = true;
    if (spec.grid !== "leaves") gridCovered = true;
    if (spec.inert) inertBoard = true;
    if (spec.inert === "board+row") inertRow = true;
    if (!spec.verbKeys) verbKeysWait = true;
  }
  return { coveredOtherThanSearch, gridCovered, layerOpen, inertBoard, inertRow, verbKeysWait };
}

interface Options {
  /** Which layers are up, this render. */
  open: OpenLayers;
  /**
   * How Back closes each one. `true` means it closed something *inside* a
   * layer that is still up — the history entry goes straight back (see
   * `useDismissOnBack`); `false` that the layer itself went. `below` says
   * whether any other layer is open under it.
   */
  back: Record<LayerId, (below: boolean) => boolean>;
  /**
   * How the app's Escape listener closes an `app` layer, where that is not
   * simply Back's close with the key stopped there. The layer is the same one
   * Back would close; only the manner differs (the canvas hands focus back to
   * its card, search lets other listeners see the key).
   */
  escape?: Partial<Record<LayerId, (e: KeyboardEvent) => void>>;
}

/**
 * The stack, wired: the flags for this render, Back through
 * `useDismissOnBack`, and the Escape handler for the app's window listener.
 * The table is read at the moment of the key or the Back, never as it was when
 * a listener was registered.
 */
export function useLayerStack({ open, back, escape }: Options) {
  const latest = useRef({ open, back, escape });
  latest.current = { open, back, escape };
  const flags = layerFlags(open);

  const dismissLayer = useCallback((): boolean => {
    const { open: now, back: close } = latest.current;
    const top = topLayer(now);
    return top ? close[top.id](openBelow(now, top.id)) : false;
  }, []);
  useDismissOnBack(flags.layerOpen, dismissLayer);

  const onEscape = useCallback((e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const { open: now, back: close, escape: own } = latest.current;
    const target = escapeTarget(now);
    if (!target || target.by === "own") return;
    const handler = own?.[target.id];
    if (handler) {
      handler(e);
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    close[target.id](openBelow(now, target.id));
  }, []);

  /** Which layers are up, as one string — changes whenever any opens or closes. */
  const openKey = LAYERS.filter((l) => typeof open[l.id] === "boolean" && open[l.id]).map((l) => l.id).join(" ");

  return { ...flags, dismissLayer, onEscape, openKey };
}
