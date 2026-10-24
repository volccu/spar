/**
 * Finding a mark by what a folder is about, in a chunk of its own
 * (`markSearch-<hash>.js`) that only the Look sheet asks for.
 *
 * The drawings say what they *are* — a fish, a hook, a rod — and people look
 * for a mark by what the folder is *about*: "fishing", "gym", "money". Lucide
 * keeps a list of those words per icon (`fishing-hook`: angler, bait, reel,
 * fishing, outdoors …), and this file reads them beside the marks' own names.
 * About 50 kB gzipped, needed by nothing but the filter field, so it is split
 * from `lib/lucideSet.ts` — a shelf drawing its marks never fetches it — and
 * kept off the first paint with the ranking that reads it.
 *
 * **Nothing may import this statically**, for the same reason as the sets
 * (`lib/iconSet.ts`); `buildInvariants.test.ts` holds the chunk out of the
 * shell's precache.
 */
import tags from "lucide-static/tags.json";
import { LUCIDE_PREFIX, iconWords, lucideMark, lucideName } from "./boardLook";

/** Lucide's search words, by the set's own name (`fishing-hook`). */
export const LUCIDE_TAGS = tags;

/**
 * What a folder is *about*, mapped to the marks that say it (review GAP-06).
 *
 * Lucide's own tags do most of this now — "fishing", "money", "pet" and
 * "cooking" all find their marks through them (`LUCIDE_TAGS` above). This list
 * is only the everyday words its tags leave empty or send somewhere odd
 * ("games" found nothing, "home" led with a dock, "gym" with a whistle). Kept
 * short and English; a word earns a line only when the tags do not already
 * answer it well, and a hit here ranks just under a mark's own name.
 * `boardLook.test.ts` checks that every mark named here is in the set.
 */
const MARK_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  home: ["house"],
  games: ["gamepad-2", "dices", "puzzle", "joystick"],
  gaming: ["gamepad-2", "joystick"],
  gym: ["dumbbell"],
  recipe: ["chef-hat", "cooking-pot", "utensils", "book-open"],
  groceries: ["shopping-basket", "shopping-cart", "apple", "carrot"],
  family: ["users", "house", "heart-handshake", "baby"],
  friends: ["users"],
  kids: ["baby", "blocks"],
  health: ["heart-pulse", "stethoscope", "pill"],
  movies: ["film", "clapperboard", "popcorn", "tv"],
  travel: ["plane", "luggage", "map", "globe"],
  holiday: ["plane", "sun", "tent"],
  hiking: ["mountain", "footprints", "backpack", "tent"],
  garden: ["sprout", "flower", "shovel", "leaf"],
  taxes: ["receipt", "calculator", "landmark"],
  work: ["briefcase"],
  ideas: ["lightbulb"],
  hunting: ["crosshair", "target"],
  dance: ["music", "party-popper"],
  apartment: ["building", "house", "sofa"],
  wedding: ["gem", "heart"],
  skiing: ["mountain-snow", "snowflake"],
  sauna: ["flame", "thermometer", "waves-vertical"],
  passwords: ["key-round", "lock"],
  food: ["utensils", "apple", "salad", "pizza"],
  photos: ["camera", "image", "images"],
  weather: ["cloud-sun", "sun", "cloud-rain", "snowflake"],
  doctor: ["stethoscope"],
  tools: ["wrench", "hammer", "toolbox"],
};

/** The same list turned round: a mark's name to the words that reach it. */
const WORDS_FOR_MARK = new Map<string, string[]>();
for (const [word, marks] of Object.entries(MARK_SYNONYMS)) {
  for (const name of marks) WORDS_FOR_MARK.set(name, [...(WORDS_FOR_MARK.get(name) ?? []), word]);
}

/** Every mark the synonym list names, for the test that holds them to the set. */
export const SYNONYM_MARKS: readonly string[] = [...new Set(Object.values(MARK_SYNONYMS).flat())].map(
  (name) => lucideMark(name),
);

/**
 * The forms a typed word may take on its way to a mark's word: as typed, and
 * with an English ending taken off — "fishing" finds `fish`, "recipes" finds
 * the recipe line, "running" finds `run`. Four plain rules, not a stemmer: a
 * wrong guess costs one extra mark at the end of a list, never a missing one,
 * because the word as typed is always tried too.
 */
function forms(term: string): string[] {
  const out = [term];
  if (term.length >= 5 && term.endsWith("ing")) {
    const bare = term.slice(0, -3);
    out.push(bare);
    // "running" -> "runn" -> "run".
    if (/(.)\1$/.test(bare)) out.push(bare.slice(0, -1));
  }
  if (term.length >= 4 && term.endsWith("ies")) out.push(`${term.slice(0, -3)}y`);
  if (term.length >= 4 && term.endsWith("es")) out.push(term.slice(0, -2));
  if (term.length >= 3 && term.endsWith("s") && !term.endsWith("ss")) out.push(term.slice(0, -1));
  return out;
}

/** Whether `term` names `mark` through the synonym list: as typed, as it is being typed, or in another form. */
function synonymHit(entry: Entry, term: string, shapes: readonly string[]): boolean {
  if (term.length < 3) return false;
  return entry.synonyms.some(
    (word) => word.startsWith(term) || shapes.includes(word) || forms(word).includes(term),
  );
}

/** What a mark is searched by, worked out once per mark rather than per keystroke. */
interface Entry {
  /** Its name in words: `fishing rod`. */
  words: string;
  nameWords: string[];
  /** Each of Lucide's tags, as its words, in the tag list's own order. */
  tagWords: string[][];
  /** The synonym-list words that reach it. */
  synonyms: string[];
}

const entries = new Map<string, Entry>();

function entryOf(mark: string): Entry {
  const hit = entries.get(mark);
  if (hit) return hit;
  const words = iconWords(mark);
  const lucide = mark.startsWith(LUCIDE_PREFIX);
  const name = lucideName(mark);
  const entry: Entry = {
    words,
    nameWords: words.split(" "),
    tagWords: lucide ? (LUCIDE_TAGS[name] ?? []).map((tag) => tag.toLowerCase().split(/[\s-]+/)) : [],
    synonyms: lucide ? (WORDS_FOR_MARK.get(name) ?? []) : [],
  };
  entries.set(mark, entry);
  return entry;
}

/**
 * How well one typed word names a mark: lower is better, `Infinity` is not at
 * all. The order is the order a person means it in — the mark's own name, then
 * what a folder is about (the synonyms), then Lucide's tags, earlier tags
 * before later ones (a tag list leads with what the drawing most is: `house`
 * opens on "home", `dock` mentions it far down), then a word merely *inside* a
 * name ("ball" in volleyball).
 *
 * Within the name, the word as typed beats another form of it ("fishing" puts
 * the rod and the hook before the fish), a name that *starts* with the word
 * beats one that ends with it, and a shorter name beats a longer — so "car"
 * opens on the car, not the cable car, and "music" on the note, not a file.
 */
function termScore(entry: Entry, term: string): number {
  const { nameWords, words, tagWords } = entry;
  const shapes = forms(term);
  const tieBreak = (at: number) => at / 100 + (nameWords.length - 1) / 1000;
  const exact = nameWords.indexOf(term);
  if (exact >= 0) return tieBreak(exact);
  const other = nameWords.findIndex((w) => shapes.includes(w));
  if (other >= 0) return 0.5 + tieBreak(other);
  const begun = nameWords.findIndex((w) => w.startsWith(term));
  if (begun >= 0) return 1 + tieBreak(begun);
  if (synonymHit(entry, term, shapes)) return 1.5;
  let best = Infinity;
  tagWords.forEach((tag, i) => {
    const rank = Math.min(i, 30) / 100;
    for (const word of tag) {
      if (shapes.includes(word)) best = Math.min(best, 2 + rank);
      else if (term.length >= 3 && word.startsWith(term)) best = Math.min(best, 3 + rank);
    }
  });
  if (best < Infinity) return best;
  if (term.length >= 3 && words.includes(term)) return 4;
  return Infinity;
}

/**
 * Filters the set by what has been typed, best match first. Every word typed
 * must name the mark somehow; an empty query is the whole set, in its order.
 * A Heroicons name is searched by its words alone — it has no tags.
 */
export function filterMarks(names: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...names];
  const terms = q.split(/\s+/);
  const hits: { mark: string; score: number; at: number }[] = [];
  names.forEach((mark, at) => {
    const entry = entryOf(mark);
    let score = 0;
    for (const term of terms) {
      score += termScore(entry, term);
      if (score === Infinity) return;
    }
    hits.push({ mark, score, at });
  });
  hits.sort((a, b) => a.score - b.score || a.at - b.at);
  return hits.map((h) => h.mark);
}

