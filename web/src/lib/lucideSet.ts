/**
 * The Lucide drawings, in a module of its own so the chunk has a name
 * (`lucideSet-<hash>.js`) — the same build reason as `lib/iconSet.ts`, and the
 * same rule: **nothing may import this statically.** `BoardLook.tsx` reaches it
 * by a dynamic import, the first time a folder wears a Lucide mark or the Look
 * sheet is opened, and `buildInvariants.test.ts` asserts the chunk exists and
 * is not in the shell's precache.
 *
 * **Data, not components.** Lucide's 1,854 marks come from `lucide-static` as
 * one JSON file of path data (about 420 kB, under 100 kB gzipped), drawn by the
 * one renderer `lucide-react` exports. Importing `lucide-react`'s index instead
 * would reach 1,854 modules for the same drawings — the bundler reads each of
 * them before it can drop any, so the build's module count, which web/CLAUDE.md
 * reads as the barrel alarm, would go to four figures. The renderer is reached
 * by its own file for the same reason; `lib/lucide.d.ts` types both paths.
 *
 * The two packages are pinned to the same exact version, and
 * `boardLook.test.ts` fails if they drift: the search words in
 * `lib/markSearch.ts` are keyed by the names in this file.
 */
import nodes from "lucide-static/icon-nodes.json";
import Icon from "lucide-react/dist/esm/Icon.mjs";
import { lucideMark, lucideName } from "./boardLook";

export { Icon };

/** Every drawing by its Lucide name (`fish`, `fishing-rod`), alphabetical. */
export const LUCIDE_NODES = nodes;

/**
 * The everyday topics that follow the picks with nothing typed (review UIB-03):
 * home, food, travel, hobbies, pets and people, health and money. Without them
 * the grid went on in the set's own alphabet, and its first page was arrows,
 * text alignment and alarm clocks.
 */
export const EVERYDAY_MARKS = [
  "sofa", "bed", "bath", "lamp", "armchair", "key-round", "door-open", "hammer", "flower-2", "sprout",
  "utensils", "chef-hat", "cooking-pot", "coffee", "pizza", "apple", "carrot", "salad", "soup", "wine",
  "beer", "cookie", "fish", "shopping-basket",
  "map", "luggage", "tent", "mountain", "compass", "car", "bike", "train-front", "bus", "ship",
  "tree-palm", "sun", "backpack", "map-pin", "hotel", "ticket",
  "palette", "brush", "guitar", "piano", "headphones", "film", "clapperboard", "popcorn", "tv",
  "gamepad-2", "dices", "puzzle", "library", "scissors", "shirt", "dumbbell", "trophy", "fishing-rod",
  "flower", "leaf",
  "dog", "cat", "paw-print", "baby", "user", "heart-handshake", "party-popper", "graduation-cap",
  "school", "stethoscope",
  "pill", "heart-pulse", "calendar", "wallet", "piggy-bank", "credit-card", "receipt", "landmark",
  "shopping-bag", "notebook",
].map(lucideMark);

/**
 * Marks a board is hardly ever named by — arrows, alignment and type, layout,
 * code, shapes and charts — and the -off, -plus, -minus, -check and -x variants
 * of a mark. Left out of the browsing grid and found by a search only.
 */
const SEARCH_ONLY =
  /^(a|align|arrow|arrows|axis|baseline|between|binary|bold|braces|brackets|bring|case|chart|chevron|chevrons|circle|code|columns|corner|database|file|flip|folder|git|grip|heading|indent|italic|layout|list|move|outdent|panel|panels|pilcrow|rectangle|regex|remove|replace|rotate|rows|scaling|scan|send|separator|server|spell|square|strikethrough|subscript|superscript|table|terminal|text|underline|whole|wrap)(-|$)|-(off|plus|minus|check|x)$/;

/** Whether a mark is left to search, out of the browsing grid. */
export function searchOnly(mark: string): boolean {
  return SEARCH_ONLY.test(lucideName(mark));
}
