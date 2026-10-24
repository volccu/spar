import { useEffect, useMemo, useRef, useState } from "react";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import type { ComponentType, CSSProperties, SVGProps } from "react";
import type { LucideIconNode } from "lucide-react";
import {
  BOARD_COLORS,
  SUGGESTED_MARKS,
  iconWords,
  lucideMark,
  lucideName,
  markSet,
  orderMarks,
  type MarkSet,
} from "../lib/boardLook";
import { INSPIRATION_MARK } from "../lib/boards";
import { hasKeyboard } from "../lib/hotkeys";
import {
  IconArchive,
  IconClear,
  IconDelete,
  IconFile,
  IconFolder,
  IconInbox,
  IconInspiration,
  IconLink,
  IconRecent,
  IconTodo,
} from "./Icons";
import { ENTER, EXIT, SLIDE_IN_MS, SLIDE_OUT_MS, animates } from "../lib/motion";

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;
type LucideSet = typeof import("../lib/lucideSet");

/**
 * The icon sets, each fetched the first time something asks for it.
 *
 * **These are the app's only whole-set imports, and they are deliberate.**
 * `web/CLAUDE.md` says marks are imported one component at a time, never the
 * index — that rule is about the *first paint*, and it still holds everywhere
 * else in the app: the bar and the card faces each name the one mark they draw.
 *
 * A picker that offers a set cannot name one mark; it needs the set. So it
 * follows the precedent `lib/pdf.ts` already set for exactly this shape — the
 * bulk behind a **dynamic** import, in a chunk of its own, never on the 90%
 * path, with `buildInvariants.test.ts` asserting the split holds. Three chunks,
 * each fetched only by what needs it:
 *
 * - `lib/lucideSet.ts` — Lucide's drawings, the set the sheet offers. Fetched
 *   when a folder wears a Lucide mark, or the sheet opens.
 * - `lib/markSearch.ts` — Lucide's search words and the ranking that reads
 *   them, for the filter field and nothing else. Only the sheet fetches it.
 * - `lib/iconSet.ts` — Heroicons, the set folders chose from before
 *   2026-10-12. Fetched only while a board still wears one of its names, so
 *   those boards keep exactly the mark they were given.
 *
 * Each goes through a file of the app's own rather than naming the package
 * here, and that indirection is load-bearing: Rollup names a dynamic chunk
 * after the module it imports. See `lib/iconSet.ts`.
 *
 * Held at module scope rather than in state, so the second board you dress
 * costs nothing at all.
 */
let heroicons: Record<string, Glyph> | null = null;
let lucide: LucideSet | null = null;
type Search = (names: readonly string[], query: string) => string[];
let markSearch: Search | null = null;

const LOADERS: Record<MarkSet, () => Promise<void>> = {
  heroicons: async () => {
    heroicons ??= (await import("../lib/iconSet")) as unknown as Record<string, Glyph>;
  },
  lucide: async () => {
    lucide ??= await import("../lib/lucideSet");
  },
};

async function loadSearch(): Promise<void> {
  markSearch ??= (await import("../lib/markSearch")).filterMarks;
}

/** Whether a set is in memory yet. */
function loaded(set: MarkSet): boolean {
  return set === "heroicons" ? heroicons !== null : lucide !== null;
}

/**
 * Inspiration's mark, shaped like a stock glyph so every caller that draws a
 * board's `icon` through `boardGlyph` (the Move chooser, the Sorter, the capture
 * bar, a card's filed mark, the open note's board row) draws it with no second
 * path. The tier is read off the class the caller already gave its glyph.
 */
const InspirationGlyph: Glyph = ({ className }) => {
  const tier = /\bicon-(nav|inline|data)\b/.exec(className ?? "")?.[1] as
    | "nav"
    | "inline"
    | "data"
    | undefined;
  return <IconInspiration tier={tier ?? "inline"} />;
};

/**
 * One component per Lucide mark, made the first time it is drawn and kept, so
 * a mark keeps the same component across renders (a new one each time would
 * remount the `<svg>` and restart its hover lift).
 *
 * Drawn by Lucide's own renderer from the set's path data. Its `width`,
 * `height` and `stroke-width="2"` are *attributes*, and `.icon` and its tier
 * class set all three in CSS, which beats an attribute — so a Lucide mark sits
 * at exactly the size and stroke of a Heroicons mark beside it (DESIGN.md §7).
 * `fill="none"` and `stroke="currentColor"` are Lucide's defaults, so the
 * folder's tint is the only colour it can take. Twenty or so drawings carry a
 * `fill="currentColor"` dot half a unit across (a palette's paint wells, a
 * scatter chart's points): the mark's own colour, at the size of a pen point.
 *
 * The keys are added here because the JSON has none, and the renderer hands
 * the parts to React as a list. The cast is the JSON's plain strings standing
 * in for React's attribute types (`strokeLinecap` and the like), which the
 * data never sets on a part anyway — Lucide's defaults sit on the `<svg>`.
 * Callers hand a mark its class and `aria-hidden`, and nothing else.
 */
const lucideGlyphs = new Map<string, Glyph>();

function lucideGlyph(mark: string): Glyph | null {
  const hit = lucideGlyphs.get(mark);
  if (hit) return hit;
  const set = lucide;
  const node = set?.LUCIDE_NODES[lucideName(mark)];
  if (!set || !node) return null;
  const keyed = node.map(([tag, attrs], i) => [tag, { ...attrs, key: String(i) }]) as unknown as LucideIconNode[];
  const { Icon } = set;
  const LucideGlyph: Glyph = ({ className, "aria-hidden": hidden }) => (
    <Icon iconNode={keyed} className={className} aria-hidden={hidden} />
  );
  LucideGlyph.displayName = `Lucide(${lucideName(mark)})`;
  lucideGlyphs.set(mark, LucideGlyph);
  return LucideGlyph;
}

/**
 * A board's mark, drawn from a name the picker wrote.
 *
 * Returns `null` for a name the sets have never heard of, and for every name
 * until its set has loaded. Every caller draws the folder in its place — so
 * the failure mode for a board dressed by a newer client, or on the frame
 * before the set lands, is the mark every board started with, never a hole in
 * the shelf.
 */
export function boardGlyph(name: string | null | undefined): Glyph | null {
  if (name === INSPIRATION_MARK) return InspirationGlyph;
  const set = markSet(name);
  if (!name || !set) return null;
  if (set === "lucide") return lucideGlyph(name);
  return heroicons?.[name] ?? null;
}

/**
 * A folder's mark: the glyph it chose, or the folder (review GD-05).
 *
 * The one place the fallback is written. `boardGlyph` answers null until the
 * icon set is in memory and for a name this build has never heard of, and the
 * folder stands in both times — the same brief fallback the shelf itself draws.
 * `picked` adds `icon-picked`, the one hover answer a stock glyph has (no named
 * parts to move), where the mark sits on a row that answers hover; `on` is the
 * solid folder a chosen board with no glyph wears in the capture bar.
 */
export function FolderGlyph({
  icon,
  tier = "inline",
  picked = false,
  on,
}: {
  icon?: string | null;
  tier?: "inline" | "data";
  picked?: boolean;
  on?: boolean;
}) {
  const Glyph = boardGlyph(icon);
  if (Glyph) {
    return <Glyph className={`icon icon-${tier}${picked ? " icon-picked" : ""}`} aria-hidden />;
  }
  return <IconFolder on={on} tier={tier} />;
}

/**
 * A board's mark, wherever a board is named.
 *
 * The eight automatic boards draw what they *are* and can never be dressed —
 * an Inbox with a bicycle on it is the app lying about itself. A folder the
 * user made draws whatever they chose, and falls back to the folder for the
 * frame before its set has loaded and forever for a name this build has never
 * heard of (`boardGlyph`). The failure mode is the mark every board started
 * with; there is no state in which a row loses its mark.
 */
export function BoardIcon({ kind, icon }: { kind: string; icon?: string }) {
  if (kind === "inbox") return <IconInbox />;
  if (kind === "recent") return <IconRecent />;
  if (kind === "todos") return <IconTodo />;
  if (kind === "links") return <IconLink tier="inline" />;
  if (kind === "files") return <IconFile tier="inline" />;
  if (kind === "inspiration") return <IconInspiration />;
  if (kind === "archive") return <IconArchive tier="inline" />;
  if (kind === "trash") return <IconDelete tier="inline" />;
  return <FolderGlyph icon={icon} picked />;
}

/**
 * Loads the sets these marks are drawn from, and reports when all are here.
 *
 * The shelf needs this as much as the picker does: a board's chosen mark
 * cannot be drawn until its set is in memory. So `App.tsx` hands over every
 * board's mark, and only the sets they actually name are fetched — an archive
 * whose folders all take the default fetches nothing, a shelf of Lucide marks
 * never fetches Heroicons — and redraws when they land. Nothing to fetch is
 * ready at once. Kept beside the loaders rather than in `App.tsx`, so one file
 * knows how the sets arrive.
 */
export function useBoardIcons(marks: readonly (string | null | undefined)[]): boolean {
  const sets = [...new Set(marks.map(markSet).filter((s): s is MarkSet => s !== null))].sort();
  const key = sets.join(",");
  const ready = sets.every(loaded);
  const [, landed] = useState(0);
  useEffect(() => {
    if (ready) return;
    let live = true;
    const wanted = key.split(",") as MarkSet[];
    void Promise.all(wanted.map((set) => LOADERS[set]())).then(() => {
      if (live) landed((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [key, ready]);
  return ready;
}

/** Loads the filter's search (`lib/markSearch.ts`), and hands it over once here. */
function useMarkSearch(): Search | null {
  // Wrapped, because a function handed to a state setter is called, not stored.
  const [search, setSearch] = useState<{ run: Search } | null>(markSearch ? { run: markSearch } : null);
  useEffect(() => {
    if (search) return;
    let live = true;
    void loadSearch().then(() => {
      if (live && markSearch) setSearch({ run: markSearch });
    });
    return () => {
      live = false;
    };
  }, [search]);
  return search?.run ?? null;
}

/**
 * How many marks the grid draws before it is scrolled: twelve rows of a
 * phone's eight. The set is some 1,850 marks, and drawing every one is
 * thousands of SVG nodes on the frame the sheet slides in: measured on the demo
 * build with the CPU slowed 4x (a mid-range phone, roughly), opening the sheet
 * from the drawer took about 1.9 s with every mark drawn and about 0.7 s
 * paged, the drawer and the menu included. The rest arrive a page at a time
 * as the grid nears its end (an `IntersectionObserver` on a marker after the
 * last cell). A search draws its first page the same way, and is still a
 * search of the whole set.
 * Where there is no observer to ask (jsdom, a very old browser), everything is
 * drawn: slower, never missing — `lib/useDeckGrowth.ts`, the board grid's own
 * paging, made the same choice.
 */
const PAGE = 96;

interface Props {
  /** The board being dressed — its name titles the sheet. */
  name: string;
  icon: string | null;
  color: string | null;
  /** Every change is written straight through; there is no Save. */
  onPick: (look: { icon?: string | null; color?: string | null }) => void;
  onClose: () => void;
  /** Reached from the drawer opened inside a note, so it stands over the note. */
  over?: boolean;
}

/**
 * What a board looks like: its mark, and the one hue it is recognised by.
 *
 * A sheet on the **paper**, not the inverted slab every other panel takes.
 * That is forced rather than preferred: the sixteen tints in `lib/boardLook.ts`
 * are solved against the ground at 5.5:1 and up, and those same tones on an inverted
 * panel are a pale wash on a pale slab. A picker that shows a colour wrongly
 * is not a picker.
 *
 * **The swatches are the board's own mark, drawn seventeen times.** A row of filled
 * squares would be the one thing `DESIGN.md` refuses outright — colour as a
 * slab — and it would be showing the user something they are not choosing.
 * What they are choosing is what the mark on the shelf will look like, so that
 * is what the row shows.
 *
 * Nothing is saved and nothing is confirmed: a tap writes, the shelf behind
 * changes under it, and closing is closing. Filing a note costs one gesture,
 * and so does this.
 */
export function BoardLook({ name, icon, color, onPick, onClose, over = false }: Props) {
  // Lucide, which the sheet offers — and the board's current mark's own set,
  // so a folder still wearing a Heroicons mark sees it here, chosen.
  const ready = useBoardIcons([SUGGESTED_MARKS[0], icon]);
  const finder = useMarkSearch();
  const [query, setQuery] = useState("");
  /** The tint under the pointer or the keyboard, named beside the swatches (a hover shows it). */
  const [tint, setTint] = useState<string | null>(null);
  const naming = (name: string) => ({
    onPointerEnter: (e: React.PointerEvent) => e.pointerType !== "touch" && setTint(name),
    onPointerLeave: () => setTint(null),
    onFocus: () => setTint(name),
    onBlur: () => setTint(null),
  });
  const grows = typeof IntersectionObserver === "function";
  const [shown, setShown] = useState(grows ? PAGE : Number.POSITIVE_INFINITY);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const leaving = useRef(false);
  useRestoreFocus();
  /**
   * Whether the caret in the filter field would raise a keyboard.
   *
   * The field used to carry a bare `autoFocus`, and on a phone that is the one
   * thing this sheet cannot afford: `.look` is a bottom sheet held at 60dvh,
   * so Android's keyboard comes up over the swatches and the mark grid — the
   * two things the sheet exists to show. Asked through `hasKeyboard`, the
   * app's one keyboard question (`lib/hotkeys.ts`), exactly as `CaptureBar`
   * asks it and for the same reason; `false` where it cannot be asked at all,
   * which is the safe half here, since inventing a keyboard costs the reader
   * the panel and assuming none costs a desktop one tab.
   */
  const keyboard = hasKeyboard(false);

  useEffect(() => {
    const el = panelRef.current;
    if (animates(el)) {
      el.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], {
        duration: SLIDE_IN_MS,
        easing: ENTER,
      });
    }
    // With no caret in the field there has to be something inside this layer
    // holding the focus, or the Escape handler below has nothing to fire from
    // and the sheet answers no key at all. The panel itself, never a swatch:
    // every control in here writes straight through with no Save, so nothing
    // may be one stray Enter from changing how a board looks.
    if (!keyboard) el?.focus();
    // `keyboard` is read once, at mount, which is when autoFocus would have
    // been applied too — a device does not grow a keyboard mid-sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    if (leaving.current) return;
    const el = panelRef.current;
    if (!animates(el)) {
      onClose();
      return;
    }
    leaving.current = true;
    // `fill: forwards` for the same reason the drawer's close fills it: without
    // it the sheet snaps back to fully open for however many frames pass before
    // React unmounts it, which is one frame of the panel reappearing.
    const out = el.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
      { duration: SLIDE_OUT_MS, easing: EXIT, fill: "forwards" },
    );
    out.onfinish = () => onClose();
  }

  /** The whole Lucide set, by stored name, in the set's own (alphabetical) order. */
  const names = useMemo(
    () => (ready && lucide ? Object.keys(lucide.LUCIDE_NODES).map(lucideMark) : []),
    [ready],
  );
  const { suggested, rest: everything } = useMemo(
    () =>
      orderMarks(
        names,
        query,
        finder ?? undefined,
        lucide ? { everyday: lucide.EVERYDAY_MARKS, searchOnly: lucide.searchOnly } : undefined,
      ),
    [names, query, finder],
  );
  // A query typed before the search has landed is not yet a search.
  const loading = !ready || (query.trim() !== "" && !finder);
  /**
   * The board's current mark, at the front with nothing typed — when it would
   * not be in the first rows anyway. That is how a folder still wearing a
   * Heroicons mark (which this sheet no longer offers) sees it here, chosen,
   * rather than looking as if it had lost it; and how a Lucide mark from deep
   * in the alphabet is not a page of scrolling away.
   */
  const front =
    !query && icon && !suggested.includes(icon) && boardGlyph(icon) ? icon : null;
  const rest = front ? everything.filter((n) => n !== front) : everything;
  const more = rest.length > shown;

  // The next page, as the marker after the last cell nears the grid's bottom.
  // A marker still in reach after a page lands fires again on the new
  // observer, so a tall sheet fills itself without a scroll.
  useEffect(() => {
    const marker = moreRef.current;
    if (!grows || !more || !marker) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown((n) => n + PAGE);
      },
      { root: gridRef.current, rootMargin: "0px 0px 100% 0px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [grows, more, shown]);

  /** A new search starts at the top of the grid, a page deep. */
  function search(value: string) {
    setQuery(value);
    setShown(grows ? PAGE : Number.POSITIVE_INFINITY);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }

  function markButton(key: string) {
    const Glyph = boardGlyph(key);
    if (!Glyph) return null;
    const words = iconWords(key);
    return (
      <button
        key={key}
        type="button"
        className="look-icon"
        aria-pressed={icon === key}
        aria-label={words}
        title={words}
        onClick={() => onPick({ icon: key })}
      >
        <Glyph className="icon icon-inline" aria-hidden />
      </button>
    );
  }

  /** The mark the swatches wear: whatever this board has chosen, or the folder. */
  const swatch = <FolderGlyph icon={icon} />;

  return (
    <>
      <button
        type="button"
        className={over ? "menu-dismiss menu-dismiss-over" : "menu-dismiss"}
        aria-label="Close board look"
        tabIndex={-1}
        onClick={close}
      />
      <div
        ref={panelRef}
        className={over ? "look look-over" : "look"}
        role="group"
        aria-label={`How ${name} looks`}
        // Focusable so the layer can hold the focus itself when the field does
        // not — the Sorter's own reason, said again. Never in the tab order.
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
      >
        <div className="look-head">
          <span className="look-name">{name}</span>
          <button type="button" className="look-close" aria-label="Done" onClick={close}>
            <IconClear />
          </button>
        </div>

        {/* The hue, said as the mark it is going to tint. "None" is first,
            because no tint is what every board has until it is given one and
            the way back has to be the shortest thing in the row. */}
        <div className="look-colors" role="group" aria-label="Board colour">
          <button
            type="button"
            className="look-swatch"
            aria-pressed={color === null}
            aria-label="No colour"
            title="No colour"
            {...naming("No colour")}
            onClick={() => onPick({ color: null })}
          >
            {swatch}
          </button>
          {BOARD_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              className="look-swatch"
              style={{ "--board-tint": `var(${c.token})` } as CSSProperties}
              aria-pressed={color === c.key}
              aria-label={c.name}
              title={c.name}
              {...naming(c.name)}
              onClick={() => onPick({ color: c.key })}
            >
              {swatch}
            </button>
          ))}
          {/* The name the tooltip is too slow to give; only where a pointer hovers. */}
          <span className="look-tint mono" aria-hidden>
            {tint}
          </span>
        </div>

        {/* One field, the board chooser's own shape: it narrows the set and
            does nothing else. With some 1,850 marks a filter is not a convenience. */}
        <div className="look-filter">
          <input
            autoFocus={keyboard}
            className="field-words"
            value={query}
            placeholder="Find a mark"
            aria-label="Find a mark"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              if (query) search("");
              else close();
            }}
          />
        </div>

        <div
          ref={gridRef}
          className="look-icons"
          style={{ "--board-tint": color ? `var(--board-${color})` : "" } as CSSProperties}
        >
          {/* The mark every board starts with, and the way back to it. It is
              not taken from the set's own list — the set has a folder, but this
              is the app's folder, the one the strip has always drawn. */}
          {!query && (
            <button
              type="button"
              className="look-icon"
              aria-pressed={icon === null}
              aria-label="Default mark"
              title="Default mark"
              onClick={() => onPick({ icon: null })}
            >
              <IconFolder />
            </button>
          )}
          {loading && <p className="look-wait mono">Loading marks</p>}
          {!loading && rest.length === 0 && <p className="look-wait mono">No mark by that name</p>}
          {/* A handful a folder is usually named by, first — the set itself
              is alphabetical and opens on letters and arrows (review UX-31).
              Then a line across the grid, then the whole set without them. */}
          {front && markButton(front)}
          {suggested.map(markButton)}
          {suggested.length > 0 && <span className="look-break" aria-hidden />}
          {rest.slice(0, shown).map(markButton)}
          {more && <span ref={moreRef} className="look-more" aria-hidden />}
        </div>
      </div>
    </>
  );
}
