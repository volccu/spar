import type { Note } from "../types";
import { cmpStamp, editedAt, sortStamp, type SortStamp } from "./versions";

/**
 * Local keyword search — instant, offline, runs against the IndexedDB store.
 * The only search this app has (SPEC §9): AI-assisted semantic search was
 * tried and removed, so a query matches the words actually in a note, never
 * "what it means".
 *
 * The archive is Finnish and English mixed, so this deliberately does no
 * stemming. What it does instead is a plain `indexOf`, which matches a term
 * **anywhere inside a word**, not only at its head: "resepti" finds
 * "reseptit" and "reseptiä", which is the whole of what an English stemmer
 * would have been for, and it finds "kanelipullat" from "pulla" too, which no
 * stemmer would. The docblock here claimed "matches prefixes" for months; it
 * never did, and the difference is not pedantry — mid-word noise is the price
 * of the Finnish case, and `fieldScore`'s word-start bonus is what pays it
 * back by keeping a real word ahead of the noise.
 */

export interface Scored {
  note: Note;
  score: number;
}

/**
 * The query, as the words it is actually made of.
 *
 * Exported because the card face highlights the same words this ranks on. Two
 * definitions of "what did they search for" would let a card mark a word the
 * search did not match on, or miss one it did.
 */
export function searchTerms(q: string): string[] {
  return tokenize(q);
}

/**
 * Composed characters only, once, for the query.
 *
 * `ä` is one character (U+00E4) or two (`a` + U+0308) depending on what wrote
 * it, and the two are different strings to `indexOf` — a note carrying the
 * decomposed form is simply invisible to a query typed as the composed one.
 * Google Takeout can carry either, and the owner writes Finnish, so this is a
 * real class of miss rather than a theoretical one. The query is one short
 * string typed by a person, so composing it costs nothing measurable and is
 * done unconditionally; what the *notes* cost is argued at `compose` below.
 */
function tokenize(q: string): string[] {
  const terms = q
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map(singular);
  // A term repeated in the query is one condition, not two. Typed twice — a
  // stutter, a pasted phrase, "milk milk" — it was scored twice by
  // `fieldScore` and counted twice by the coverage check, so a note saying it
  // once looked like a note answering two separate words.
  return terms.length > 1 ? [...new Set(terms)] : terms;
}

/**
 * The phrases a query asks for word for word: each run of words inside double
 * quotes, as a pattern that finds those words standing together, in that
 * order (review 2026-10-04, FX-A-04).
 *
 * A quote is remembered exactly, and the ordinary search cannot ask for that —
 * every word is its own condition, so three common words find every note
 * holding them in any order and any distance apart. A quoted run adds one
 * condition beside those: the words are adjacent, with nothing but spaces,
 * punctuation or a line break between them. Its words still go through
 * `tokenize` like any other (the quotes are split away there), so they are
 * scored, counted and marked on the card as before.
 *
 * **Substring matching stays.** Only the joins are tightened: the first word
 * may still end another word and the last may still begin one, as a single
 * term may. The words are matched as typed, with no plural ending taken off —
 * a phrase is a quotation. A quote left open runs to the end of the query, so
 * the results while it is being typed are the ones the closing quote keeps. A
 * "phrase" of one word is just that word, already a term, and adds nothing.
 */
function phrases(q: string): RegExp[] {
  const out: RegExp[] = [];
  for (const m of q.matchAll(/"([^"]*)"?/g)) {
    const words = m[1]
      .toLowerCase()
      .normalize("NFC")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 0);
    // Letters and digits only by now, so nothing in a word needs escaping.
    if (words.length > 1) out.push(new RegExp(words.join("[^\\p{L}\\p{N}]+"), "u"));
  }
  return out;
}

/** Whether the query holds a quoted phrase of two words or more. */
export function hasPhrase(q: string): boolean {
  return q.includes('"') && phrases(q).length > 0;
}

/**
 * A word with a plural ending taken off: "tyres" is searched as "tyre",
 * "boxes" as "box" (review 2026-10-01, UX-27).
 *
 * Matching is by substring, so the shorter form finds every note the whole
 * word found and the singular besides — this can only widen a search, never
 * lose a hit. It is not a stemmer: one ending, English only in shape, and
 * deliberately timid. `-es` goes only after s, x, z, ch or sh, where English
 * spells a plural that way ("notes" loses only its s, or it would find
 * "not"); a double s is a word, not a plural ("glass"); and nothing shorter
 * than three letters is left behind, so "bus" and "is" stay whole. A Finnish
 * word ending in s loses it too, which finds its inflected forms ("kokous"
 * finds "kokouksen") — the same direction the substring match already leans.
 *
 * Applied in `tokenize`, so the ranking, the "every word" check and the
 * card's highlight all read the same shortened word.
 */
function singular(term: string): string {
  if (!term.endsWith("s") || term.endsWith("ss")) return term;
  if (/(?:[sxz]|ch|sh)es$/.test(term) && term.length - 2 >= 3) return term.slice(0, -2);
  return term.length - 1 >= 3 ? term.slice(0, -1) : term;
}

/**
 * Anything outside printable ASCII — the only kind of character that can make
 * composing a note's text change an answer. A term holds nothing but letters
 * and digits by the time it is tested (the tokenizer split on everything
 * else), so the printable range is the whole range there is to ask about, and
 * asking about it that way keeps a control character out of the pattern.
 *
 * A pure-ASCII query cannot tell the two forms of `ä` apart *because it never
 * looks at them*: the decomposed `ä` still holds a plain `a`, so "kana" finds
 * it either way. So the notes are only composed when the query itself carries
 * a character that could have been written two ways — which for this owner
 * means the Finnish half of his searching, and for everything else means the
 * hot path pays literally nothing.
 */
const NON_ASCII = /[^\u0020-\u007E]/;

/**
 * A combining mark — the second half of a decomposed letter.
 *
 * The gate that keeps the Finnish case cheap as well as correct. `normalize`
 * allocates and walks; a string holding no combining mark has nothing for NFC
 * to compose, so the test stands in for the work. Measured over 401 notes of
 * ~750 characters: lowercasing alone 0.11ms, lowercase plus this test 0.12ms,
 * lowercase plus an unconditional `normalize` 0.44ms. Per keystroke, so 0.32ms
 * is the same order as the whole board-count walk that was worth a fix.
 *
 * The known hole is the singleton mappings — NFC also turns U+212B ANGSTROM
 * SIGN into `Å` with no mark in sight — and it stays a hole deliberately: a
 * query would have to contain one of those characters for it to matter, and
 * nobody types the Angstrom sign into a notes app.
 */
const COMBINING = /\p{M}/u;

/**
 * A field, lowercased once and composed only where both gates say it could
 * matter. Every haystack in `searchNotes` goes through exactly this, so the
 * body is lowercased once per note per keystroke and no more — the double
 * lowercasing this file used to do was a finding of its own (2026-09-06 perf
 * audit, P1) and must not come back.
 */
function prepare(text: string, compose: boolean): string {
  const lower = text.toLowerCase();
  return compose && COMBINING.test(lower) ? lower.normalize("NFC") : lower;
}

/**
 * How much a term said again is worth, and how many times it is counted.
 *
 * A note that says "verokortti" twelve times is *about* verokortti; one that
 * says it once may only mention it in passing. A single `indexOf` could not
 * tell them apart — both scored exactly 1 — which is the oldest complaint
 * anyone has about a keyword search.
 *
 * Bounded, or the longest note wins every query by being long: a 6000
 * character brain dump mentions everything a few times, and unbounded
 * frequency is precisely how it would outrank the four-word note that is the
 * answer. Four repeats is where a mention has plainly become a subject, and
 * nothing past it says anything further — so a term is worth at most 2, the
 * same as the two placement bonuses together. The scan stops at the bound too,
 * so counting costs a fixed handful of `indexOf` calls rather than one per
 * occurrence in the archive's longest note.
 */
const REPEAT_WEIGHT = 0.25;
const REPEAT_MAX = 4;

/**
 * Scores one field, handed already lowercased and composed — see `prepare`.
 *
 * Three things about a hit are worth something: that it is there at all, that
 * it is there more than once, and where it sits. A term starting a word is a
 * word the writer meant; a term buried inside one is the price of doing no
 * stemming, and it still counts, just for less.
 */
function fieldScore(hay: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    let at = hay.indexOf(term);
    if (at === -1) continue;
    let hits = 0;
    // Any occurrence starting a word earns the bonus, not only the first one:
    // in "unreceipted receipt" the first hit is mid-word and the second is the
    // word itself, and the walk is already passing over both.
    let wordStart = false;
    while (at !== -1 && hits <= REPEAT_MAX) {
      hits += 1;
      if (!wordStart) {
        const before = at === 0 ? " " : hay[at - 1];
        wordStart = !/[\p{L}\p{N}]/u.test(before);
      }
      // Non-overlapping: "aa" occurs once in "aaa". Overlaps would count a
      // repeated letter as a subject.
      at = hay.indexOf(term, at + term.length);
    }
    score += 1 + REPEAT_WEIGHT * (hits - 1);
    if (wordStart) score += 0.5;
    if (hay.startsWith(term)) score += 0.5;
  }
  return score;
}

/**
 * The names of the files a note carries.
 *
 * A dropped file writes nothing into the note's text — the file is what the
 * note is — so without this a screenshot would be findable only by scrolling
 * to it. Weighted like the body: the name is a real thing the user knows the
 * note by, but it is the machine's words, not theirs.
 */
function fileNames(note: Note): string {
  return (note.attachments ?? []).map((a) => a.name).join(" ");
}

/**
 * The titles a note's links were fetched under.
 *
 * The same argument as `fileNames`, one board over. A URL saved with none of
 * the user's own words beside it is drawn on the Links board under its
 * `og:title` (`rowName` in `NoteCard`, `linkRow` in `lib/linkRow.ts`) — so the
 * name the user reads off the board, remembers the note by, and then types
 * into the search field was the one thing search could not see. It found
 * nothing, about a note whose name was on screen. Weighted like the filename
 * for the same reason: it is a real handle on the note, and it is the page's
 * words rather than the user's.
 *
 * **A title the note already says is dropped rather than counted twice.** The
 * stored preview is not always a fetched `og:title`: a link the edge function
 * refused to answer for keeps the *local* unfurl (`useLinkUnfurl`), whose
 * title `previewsFor` builds out of the sentence standing in front of the
 * address — and a link with no words in front of it is titled with its own
 * domain, which is inside the URL in the body. Scored as it comes, every link
 * note would quietly outrank every plain one on words the reader can only see
 * once. `previewsFor` cuts a long title at 87 characters and ends it in an
 * ellipsis, so the comparison is made against the same trimmed head `rowWords`
 * compares. The body arrives already prepared, so nothing here lowercases a
 * string twice.
 */
function previewTitles(note: Note, body: string, compose: boolean): string {
  const titles: string[] = [];
  for (const preview of note.link_previews ?? []) {
    const title = prepare(preview.title ?? "", compose);
    if (title === "") continue;
    if (body.includes(title.replace(/\.{3}$/, ""))) continue;
    titles.push(title);
  }
  return titles.join(" ");
}

/**
 * A note's three searchable fields, lowercased (and composed, for a query that
 * needs it), remembered per note object.
 *
 * Notes are never changed in place — every edit makes a new object — so a
 * `WeakMap` on the note is a cache that can never be stale and lets go of a
 * note the moment nothing else holds it. Typing a query is a keystroke per
 * search over the whole archive; the text of every note that did not change
 * since the last keystroke no longer gets lowercased again.
 */
type Prepared = { body: string; names: string; titles: string };
const preparedPlain = new WeakMap<Note, Prepared>();
const preparedComposed = new WeakMap<Note, Prepared>();
function preparedFields(note: Note, compose: boolean): Prepared {
  const cache = compose ? preparedComposed : preparedPlain;
  const held = cache.get(note);
  if (held) return held;
  const body = prepare(note.body, compose);
  const fields = {
    body,
    names: prepare(fileNames(note), compose),
    titles: previewTitles(note, body, compose),
  };
  cache.set(note, fields);
  return fields;
}

/**
 * The words inside a note's files, by attachment id — a PDF's text layer,
 * read once per device at idle (`store/pdfText.ts`) and handed in here.
 *
 * A parameter rather than something this module reaches for: the text arrives
 * minutes after the note does, on its own clock, and a pure function of what
 * it is given is what lets the note's own `preparedFields` stay cached against
 * the note object while this changes underneath it.
 */
export type FileTexts = ReadonlyMap<string, string>;
const NO_FILE_TEXTS: FileTexts = new Map();

/**
 * What a hit inside a file is worth, against one in the note's own words.
 *
 * Half. A document is the machine's words in the way a filename is, and far
 * more of them — a lease mentions the street, the landlord, the bank and the
 * year — so a note that *says* the word has to stay ahead of a note that
 * carries a PDF which happens to. The archived penalty below is the same
 * factor, for the same kind of reason.
 */
const FILE_TEXT_WEIGHT = 0.5;

/** A query with no quoted phrase in it, shared so the hot path allocates nothing. */
const NO_PHRASES: RegExp[] = [];

/**
 * A file's text, lowercased (and composed, when asked), remembered by
 * attachment id against the exact string it was made from.
 *
 * Not the `WeakMap` the note's own fields use: a string cannot key one, and
 * the text is not part of the note object anyway. Keyed by id with the source
 * kept beside it, a changed text is noticed by identity and prepared again;
 * the map holds at most one entry per document this device has read, which is
 * the size of the store it came from.
 */
const preparedFiles = new Map<string, { src: string; plain?: string; composed?: string }>();
function preparedFileText(id: string, src: string, compose: boolean): string {
  let held = preparedFiles.get(id);
  if (!held || held.src !== src) {
    held = { src };
    preparedFiles.set(id, held);
  }
  if (compose) return (held.composed ??= prepare(src, true));
  return (held.plain ??= prepare(src, false));
}

/** The prepared texts of a note's files that have any, in attachment order. */
function fileTexts(note: Note, files: FileTexts, compose: boolean): string[] {
  if (files.size === 0) return [];
  const out: string[] = [];
  for (const att of note.attachments ?? []) {
    const src = files.get(att.id);
    if (src) out.push(preparedFileText(att.id, src, compose));
  }
  return out;
}

/**
 * Runs on every keystroke over the whole archive, so what it does per note
 * is done once per note. Each field is lowercased once — `fieldScore` used to
 * lowercase it and the coverage haystack lowercased it again — and each
 * note's `editedAt` is read once, up front, and carried into the sort: it
 * walks the per-field clocks and parses a stamp per field, and the
 * comparator asked for it twice per comparison, which on a comparison sort
 * is about eighteen walks per note. `sortForBoard` made the same trade for
 * the board. `now` is a parameter for the reason `fullDate`'s is: the
 * ranking is then a pure function of its inputs and a test can say what a
 * note from a month ago scores.
 *
 * `files` adds the words inside a note's documents (see `FileTexts`): matched
 * like any other field, worth `FILE_TEXT_WEIGHT` of a hit in the note's own
 * words, and counted for "every word must be found" like the rest — a note
 * whose text says "lease" and whose PDF says "Tampere" is an answer to "lease
 * tampere".
 */
export function searchNotes(
  notes: Note[],
  query: string,
  now = Date.now(),
  files: FileTexts = NO_FILE_TEXTS,
): Note[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const compose = terms.some((t) => NON_ASCII.test(t));
  const quoted = query.includes('"') ? phrases(query) : NO_PHRASES;

  const scored: (Scored & { edited: SortStamp; born: SortStamp })[] = [];
  for (const note of notes) {
    // Trashed notes are on their way out; they are not results. Archived ones
    // stay fully searchable, which is the whole point of archiving.
    if (note.status === "trashed") continue;
    const { body, names, titles } = preparedFields(note, compose);
    let score = 0;
    score += fieldScore(body, terms);
    score += fieldScore(names, terms);
    score += fieldScore(titles, terms);
    const docs = fileTexts(note, files, compose);
    for (const doc of docs) score += FILE_TEXT_WEIGHT * fieldScore(doc, terms);

    if (score === 0) continue;

    // **A second word narrows.** `coverage / terms.length` used to be a
    // multiplier applied right here, which meant it could only ever *rank*: a
    // note holding one word of three was still a result, sitting under the
    // better ones — and on a query that matched nothing well it was the only
    // result there was. Every search anybody has ever used works the other
    // way, and a person typing a second word is narrowing, not describing.
    // It matters more here than in most places because there is no stemming
    // and no word boundary: a term matches inside a word, so one short word
    // sweeps in a third of the archive on its own, and the second word is the
    // only tool there is for cutting that down. What it costs is that one
    // mistyped word finds nothing — which the user sees instantly and fixes,
    // unlike the right note buried at position forty, which they never see at
    // all. A single-term query is untouched: coverage was always 1 there, so
    // the multiplier was already a no-op and the ranking is unchanged.
    //
    // Asked field by field rather than against a joined haystack: a term
    // holds no whitespace (the tokenizer split on everything that is not a
    // letter or a digit), so it can never straddle a join, and the join was
    // building a fresh copy of every note's text on every keystroke.
    if (
      terms.length > 1 &&
      !terms.every(
        (t) =>
          body.includes(t) ||
          names.includes(t) ||
          titles.includes(t) ||
          docs.some((doc) => doc.includes(t)),
      )
    ) {
      continue;
    }
    // **A quoted phrase must stand whole in one field** — its words together,
    // in order. A phrase cannot straddle the body and a file name any more
    // than a quotation can.
    if (
      quoted.length > 0 &&
      !quoted.every(
        (p) =>
          p.test(body) || p.test(names) || p.test(titles) || docs.some((doc) => p.test(doc)),
      )
    ) {
      continue;
    }

    const edited = editedAt(note);
    score *= recencyBoost(edited, now);
    // Archived notes stay searchable but rank lower (SPEC §9).
    if (note.status === "archived") score *= 0.5;
    scored.push({
      note,
      score,
      edited: sortStamp(edited),
      born: sortStamp(note.created_at ?? ""),
    });
  }

  // The tiebreak between two equally good matches: whichever was touched
  // last. The same order the board is in, for the same reason — of two notes
  // that answer the query equally well, the one you were working on is the
  // one you were looking for.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      cmpStamp(b.edited, a.edited) ||
      cmpStamp(b.born, a.born),
  );
  return scored.map((s) => s.note);
}

/**
 * A mild pull toward whatever was touched recently, folded into the score
 * itself rather than only breaking a tie between equal scores.
 *
 * Deliberately gentle: it decides a near-tie in favour of the note you were
 * just working on, the same instinct `sortForBoard` already has, but it must
 * never let a stale note beat a genuinely better keyword match — so the swing
 * is capped at 15%, floors out rather than reaching zero, and decays slowly
 * enough that "recent" means weeks, not minutes.
 */
function recencyBoost(edited: string, now: number): number {
  const days = (now - Date.parse(edited)) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(days) || days <= 0) return 1;
  return 0.85 + 0.15 / (1 + days / 30);
}

/**
 * The notes in the Trash that would answer `query` if search read the Trash —
 * which it never does (they are never results). Asked only when a search found
 * nothing, so the empty answer can say "1 match is in the Trash" and offer the
 * way there (audit 2026-10-10, UX-1). Same matching as `searchNotes`, run on
 * copies marked active; the notes returned are the originals.
 */
export function trashMatches(notes: Note[], query: string, files: FileTexts = NO_FILE_TEXTS): Note[] {
  const trashed = notes.filter((n) => n.status === "trashed");
  if (trashed.length === 0) return [];
  const byId = new Map(trashed.map((n) => [n.id, n]));
  return searchNotes(
    trashed.map((n) => ({ ...n, status: "active" as const })),
    query,
    Date.now(),
    files,
  ).map((n) => byId.get(n.id)!);
}

/** Whether two words differ by one letter: swapped, added, dropped or changed. */
function oneLetterApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (i === a.length && i === b.length) return false;
  const rest = (x: string) => x.slice(i + 1);
  if (a.length === b.length) {
    return rest(a) === rest(b) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  return a.length > b.length ? rest(a) === b.slice(i) : a.slice(i) === rest(b);
}

/** The words of the notes that are not trashed, counted. Kept per notes array,
 *  so a keystroke that finds nothing does not read every note again. */
const vocabularies = new WeakMap<Note[], Map<string, number>>();
function vocabularyOf(notes: Note[]): Map<string, number> {
  const known = vocabularies.get(notes);
  if (known) return known;
  const vocabulary = new Map<string, number>();
  for (const n of notes) {
    if (n.status === "trashed") continue;
    for (const w of n.body.toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3) vocabulary.set(w, (vocabulary.get(w) ?? 0) + 1);
    }
  }
  vocabularies.set(notes, vocabulary);
  return vocabulary;
}

/**
 * What to offer when a search found nothing (review 2026-10-24, PL-07): the
 * query with each word no note holds swapped for a word the notes really do
 * hold, one letter away, the commonest if several. Results stay exact — this
 * is asked only on an empty answer — and the offer is made only if it would
 * find something itself. Words come from notes that are not trashed; a word
 * under four letters is too short to guess; a quoted phrase is a quotation.
 */
export function didYouMean(notes: Note[], query: string, files: FileTexts = NO_FILE_TEXTS): string | null {
  if (query.includes('"')) return null;
  const terms = tokenize(query);
  if (terms.length === 0) return null;
  const unfound = terms.filter((t) => t.length >= 4 && searchNotes(notes, t, undefined, files).length === 0);
  if (unfound.length === 0) return null;
  const vocabulary = vocabularyOf(notes);
  const swaps = new Map<string, string>();
  for (const t of unfound) {
    let best: string | null = null;
    for (const [w, count] of vocabulary) {
      if (!oneLetterApart(t, w)) continue;
      if (best === null || count > vocabulary.get(best)! || (count === vocabulary.get(best) && w < best)) best = w;
    }
    if (best === null) return null;
    swaps.set(t, best);
  }
  const fixed = terms.map((t) => swaps.get(t) ?? t).join(" ");
  return searchNotes(notes, fixed, undefined, files).length > 0 ? fixed : null;
}
