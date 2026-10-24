import type { CSSProperties } from "react";
import type { UserBoard } from "../types";

/**
 * How a board is recognised before it is read — its mark, and its hue.
 *
 * ## Why there is a hue at all, in an app whose design says there is none
 *
 * `DESIGN.md` §1 and §2 say it twice and mean it: *there is no colour. Not an
 * accent, not a link, not an error, not a hue for state.* This file is the one
 * exception, it was asked for deliberately, and the exception is written into
 * `DESIGN.md` §12 rather than left for someone to find here and read as drift.
 *
 * The reason it is allowed is that **a board is not a state.** Every rule the
 * no-colour law exists to protect is about the app not competing with the
 * user's words: a coloured error, a coloured link, a coloured "on" is the
 * interface asserting itself over the note. A board is a *name the user chose*
 * — it is their content, not the app's chrome, and it is the one thing on
 * screen that a person navigates to dozens of times a day by looking for it.
 *
 * ## The rule that keeps it inside the ramp
 *
 * **A tint adds no step to the ramp: it sits inside the span the ramp already
 * has, and it is solved to be there.** Rewritten 2026-10-08 (owner approved)
 * when the set grew from eight to sixteen and gained off-whites. The old rule
 * pinned every mark to `--muted`'s one brightness (0.262); a bone or an oat
 * cannot be pale and sit at 0.262, so a mark may now be anywhere from 0.24 up
 * to `--invert`'s 0.4633 — never above it, because `--invert` is already the
 * brightest thing a *content* surface is allowed to be, and `--ink` (0.672) is
 * the user's words and stays the only tone above it. Every mark is therefore at
 * least 5.5:1 on the ground (4.5 is the floor) and none outshines a selected
 * card. The hairline twin is unchanged: exactly `--rule`'s 0.042 (1.73:1), so
 * the line saying which board you are standing on is as quiet as it ever was
 * whatever the hue.
 *
 * That is also why the numbers below are not eyeballed. Hue and chroma were
 * chosen in OKLCH first, lightness then searched for the target luminance, and
 * the whole set was optimised for the largest minimum OKLab distance between
 * any two marks (0.045 at the time of writing, and never closer to untinted
 * `--muted`). `styles.test.ts` holds the bounds; a change has to be re-solved,
 * not nudged, or the colour stops being free and starts being emphasis.
 *
 * ## And where it is allowed to appear
 *
 * The **mark** of the board, wherever the board is named, and the **hairline**
 * under the board row when you are standing on it. Never a fill, never a slab,
 * never a word — the tint sets the mark and the rule, and the name beside it
 * stays on the greyscale it has always been. A note's own text is never
 * touched by the board it happens to be filed in.
 */

/** One pre-approved tone. `token` is the CSS custom property that holds it. */
export interface BoardColor {
  /** What a synced board stores. **Never rename one**: a key a client does
   *  not know lands as "no tint" (`isBoardColor`), so renaming a key would
   *  quietly strip the colour off every board that wears it. The keys are the
   *  names of the first palette; the values and `name` are the latest's. */
  key: string;
  /** What it is called where the user picks it. */
  name: string;
  token: string;
}

/**
 * The sixteen, in the owner's own order: the off-whites, then the earths, the
 * greens, and the cool and violet ones last.
 *
 * Redrawn twice. 2026-10-01 (owner approved, review UI-21) the rainbow became
 * eight pigments; **2026-10-08 (owner approved)** the eight became sixteen
 * earthy, muted "outdoor gear" colours, with off-whites, so a folder can be
 * pale as well as hued. The story is in `docs/decisions/design.md`.
 *
 * **The first eight keys are older than the names beside them, and a key is
 * never renamed** — a synced board stores it, and an unknown key means "no
 * tint". So each old key keeps the *nearest* new colour (nearest in OKLab) and
 * only its display name changed:
 * ember → Rust, ochre → Ochre, moss → Moss, sage → **Fern**, teal → **Forest**,
 * steel → Slate, iris → Dusk, plum → Plum. That makes `sage` the one key whose
 * name no longer matches what it shows; the colour called Sage is the new key
 * `salvia`. The eight new keys are bone, oat, sand, stone, clay, khaki, olive
 * and salvia. Do not "tidy" this by swapping the two.
 *
 * Sixteen is the whole set, and it has no spare slots for the same reason the
 * type scale has none: a seventeenth is a design failure, not a token shortage.
 */
export const BOARD_COLORS: BoardColor[] = [
  { key: "bone", name: "Bone", token: "--board-bone" },
  { key: "sand", name: "Sand", token: "--board-sand" },
  { key: "oat", name: "Oat", token: "--board-oat" },
  { key: "clay", name: "Clay", token: "--board-clay" },
  { key: "ember", name: "Rust", token: "--board-ember" },
  { key: "ochre", name: "Ochre", token: "--board-ochre" },
  { key: "khaki", name: "Khaki", token: "--board-khaki" },
  { key: "moss", name: "Moss", token: "--board-moss" },
  { key: "olive", name: "Olive", token: "--board-olive" },
  { key: "sage", name: "Fern", token: "--board-sage" },
  { key: "teal", name: "Forest", token: "--board-teal" },
  { key: "salvia", name: "Sage", token: "--board-salvia" },
  { key: "steel", name: "Slate", token: "--board-steel" },
  { key: "stone", name: "Stone", token: "--board-stone" },
  { key: "iris", name: "Dusk", token: "--board-iris" },
  { key: "plum", name: "Plum", token: "--board-plum" },
];

const COLOR_KEYS = new Set(BOARD_COLORS.map((c) => c.key));

/**
 * Whether this is one of the sixteen.
 *
 * Asked on the way *out* of storage rather than only on the way in, because
 * the board list is a synced JSON blob: a value written by a newer client, or
 * by a hand-edited row, must land as "no tint" rather than as a bare
 * `var(--board-)` that resolves to nothing and paints the mark invisible.
 */
export function isBoardColor(key: string | undefined | null): key is string {
  return typeof key === "string" && COLOR_KEYS.has(key);
}

/** The CSS value for a board's tint at mark strength, or null when it has none. */
export function boardTint(board: { color?: string } | null | undefined): string | null {
  if (!board || !isBoardColor(board.color)) return null;
  return `var(--board-${board.color})`;
}

/**
 * The hue a board is recognised by, as an inline custom property.
 *
 * One helper rather than the same ternary at five render sites, and it returns
 * `undefined` for a board with no colour so the element carries no style
 * attribute at all — the CSS then falls through to `--muted` exactly as it did
 * before any of this existed.
 */
export function tintOf(board: { color?: string }): CSSProperties | undefined {
  const tint = boardTint(board);
  return tint ? ({ "--board-tint": tint } as CSSProperties) : undefined;
}

/**
 * Where a board's stored mark comes from.
 *
 * **Lucide is the set the Look sheet offers** (2026-10-12, owner approved): some
 * 1,850 marks with everyday words attached, so a folder called "Fishing" finds a
 * rod and a hook. Its names are stored with a prefix, `lucide:fishing-rod`, that
 * no Heroicons export can ever spell — the two sets share words ("home", "key"),
 * and a bare name would have to be guessed back to its set.
 *
 * **Heroicons is the set folders chose before that**, stored as the export name
 * (`PaintBrushIcon`). Those names are never rewritten — no migration, and a
 * board dressed on an older client keeps exactly the mark it was given — so
 * `lib/iconSet.ts` stays, fetched only when a board still wears one.
 */
export const LUCIDE_PREFIX = "lucide:";

const HEROICONS_NAME = /^[A-Z][A-Za-z0-9]*Icon$/;
const LUCIDE_NAME = /^lucide:[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type MarkSet = "lucide" | "heroicons";

/** Which set a stored mark belongs to, or null for anything that is neither. */
export function markSet(name: string | undefined | null): MarkSet | null {
  if (typeof name !== "string") return null;
  if (LUCIDE_NAME.test(name)) return "lucide";
  if (HEROICONS_NAME.test(name)) return "heroicons";
  return null;
}

/** A Lucide name as stored (`lucide:fish`) from the set's own (`fish`). */
export const lucideMark = (name: string): string => `${LUCIDE_PREFIX}${name}`;

/** The set's own name (`fish`) inside a stored Lucide mark. */
export const lucideName = (mark: string): string => mark.slice(LUCIDE_PREFIX.length);

/**
 * Whether this names a mark in either set.
 *
 * The shape is the whole test: the picker only ever writes names it read out
 * of the set itself, so this is guarding against a synced value from somewhere
 * else. It deliberately holds no list of the names — that list would be a
 * second copy of the package, wrong the day it is upgraded. An unknown name
 * that passes this still falls back to the folder mark at render time
 * (`boardGlyph`), so the failure mode is "the mark it always had", never a
 * hole in the row.
 */
export function isBoardIcon(name: string | undefined | null): name is string {
  return markSet(name) !== null;
}

/** How a board wants to be drawn, cleaned of anything unrecognised. */
export interface BoardLook {
  icon: string | null;
  color: string | null;
}

export function boardLook(board: UserBoard | undefined | null): BoardLook {
  return {
    icon: isBoardIcon(board?.icon) ? board.icon : null,
    color: isBoardColor(board?.color) ? board.color : null,
  };
}

/**
 * The English name of a mark, for the picker's filter and its label.
 *
 * `lucide:fishing-rod` -> `fishing rod`: Lucide's names are already words.
 * `AcademicCapIcon` -> `academic cap`: split on the capitals, drop the `Icon`,
 * lowercase the lot — the words the Heroicons site is searched by.
 */
export function iconWords(name: string): string {
  if (name.startsWith(LUCIDE_PREFIX)) return lucideName(name).replace(/-/g, " ");
  return name
    .replace(/Icon$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}

/**
 * The marks offered first, before the whole set (review UX-31).
 *
 * The set is alphabetical, so the sheet would open on letter marks and arrows
 * — and the marks a folder is actually named by (a house, a book, a cart, a
 * heart) would be screens further down unless you knew to search. Fifteen of
 * those, so that with the folder in front of them they fill two rows of a
 * phone's grid exactly. The rest of the set follows, whole, without these
 * repeated. The same fifteen subjects the Heroicons list had, in Lucide's names.
 */
export const SUGGESTED_MARKS = [
  "house",
  "book-open",
  "shopping-cart",
  "heart",
  "briefcase",
  "cake",
  "music",
  "globe",
  "lightbulb",
  "camera",
  "plane",
  "banknote",
  "wrench",
  "gift",
  "users",
].map(lucideMark);

/** How the grid is browsed with nothing typed (`lib/lucideSet.ts`, review UIB-03). */
export interface Browse {
  everyday: readonly string[];
  searchOnly: (mark: string) => boolean;
}

/**
 * The marks the picker shows, split into the suggestions and the rest. A
 * query searches the whole set and offers no suggestions — what was typed is
 * the suggestion. With nothing typed, the rest is the everyday topics and then
 * the set without what `searchOnly` holds back. A suggestion this build's set
 * does not have is left out rather than drawn as a hole.
 *
 * `search` is `filterMarks` from `lib/markSearch.ts`, handed over once that
 * chunk has landed: the search words and the ranking live there, off the first
 * paint, because only the Look sheet ever searches. Until it is here a query
 * finds nothing yet, and the sheet says it is still loading.
 *
 * `browse` is the everyday topics and `searchOnly` from `lib/lucideSet.ts`,
 * kept in that chunk so their names stay off the first paint.
 */
export function orderMarks(
  names: readonly string[],
  query: string,
  search?: (names: readonly string[], query: string) => string[],
  browse: Browse = { everyday: [], searchOnly: () => false },
): { suggested: string[]; rest: string[] } {
  if (query.trim()) return { suggested: [], rest: search ? search(names, query) : [] };
  const have = new Set(names);
  const suggested = SUGGESTED_MARKS.filter((n) => have.has(n));
  const everyday = browse.everyday.filter((n) => have.has(n) && !SUGGESTED_MARKS.includes(n));
  const picked = new Set([...suggested, ...everyday]);
  return {
    suggested,
    rest: [...everyday, ...names.filter((n) => !picked.has(n) && !browse.searchOnly(n))],
  };
}
