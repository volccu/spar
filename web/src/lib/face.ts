import type { Attachment, Note } from "../types";
import { hasCode, headingOf, markerOf, parseBlocks } from "./blocks";
import { plainInline, type InlineSeg } from "./inline";
import { countLinks, domainFor, firstLink, linkify, SAVED_LINK_PREFIX } from "./links";
import { listTitle } from "./autoformat";
import { noteName } from "./name";

/**
 * Card face derivation.
 *
 * The app derives no heading. The card shows the note's text from its first
 * character, cut when it runs out of room, and says how much it cut. Nothing is
 * promoted or split off, and `title` is still never drawn.
 *
 * What the user marks by hand is a different matter and always was: a tick box
 * is drawn as a tick box here, and a line the user opened with "#" is drawn in
 * the heavier weight they asked for. The app is not choosing — it is reading.
 *
 * This is the primary rendering path, not a fallback: 237 of the 241 real
 * notes have no title and no gist. Measured over the real archive:
 *   -  64/241 (26%) are saved links   -> show a link icon in the footer
 *   -   4/241        are checklists   -> handle, don't over-invest
 *   -  35/241        are >= 1500 chars (max 15k) -> must be cut, or they eat
 *                                        the screen
 */

/**
 * A card holds *lines*, not characters, and the difference matters: a shopping
 * list of eight short lines and a paragraph of the same character count fill
 * completely different amounts of the card. Measuring in characters made the
 * "+1.4k" under the cut wrong on every note with hard line breaks.
 *
 * Both numbers are measured, not guessed. The card body is clamped in
 * styles.css to a whole number of line boxes, and Libre Baskerville runs about
 * 0.52em per character, so 13px text is ~6.8px a character:
 *
 * `lines` is what every card holds — every card face uses the same line budget.
 *
 * These are only the first-paint defaults. `useCardMetrics` measures a real
 * card and replaces them, because a desktop column is anywhere from 246px to
 * 323px wide depending on how many fit, and one fixed number tuned for the
 * wide end spills over at the narrow one.
 */
export interface CardMetrics {
  /** Whole line boxes the card body can show. Mirrors --card-lines. */
  lines: number;
  /** Characters that fit on one of those lines. */
  charsPerLine: number;
}

export const CARD_METRICS: CardMetrics = { lines: 8, charsPerLine: 22 };

/**
 * Lines of the note's own words a Links-board row shows.
 *
 * A row is the one shape in the app that is not a card in the grid — see the
 * block comment above the row face in `NoteCard.tsx` for why the Links board
 * has a geometry of its own, and why that is not the rejected list/grid toggle.
 * Its height is built on this number, so it is the row's `--card-lines`: it
 * must equal `--row-lines` in `styles.css`, and `constants.test.ts` holds the
 * two together. The two disagreeing is a row overflowing its own clamp.
 */
export const ROW_LINES = 2;

/**
 * Lines a slip holds: the Todos board's short shape (owner picked it from the
 * mockups, 2026-10-17). A to-do whose whole text fits in this many lines is
 * drawn a third of a card tall — most to-dos are one sentence, and a full card
 * spent 180px of black on each. Anything longer, a list, a file or a link stays
 * a full card. `styles.css` sets the slip's `--card-lines` from the card's
 * inline style, so this is the one place the number lives.
 */
export const SLIP_LINES = 2;

/**
 * Lines a card hands its strip of links when the note also has words.
 *
 * The strip is drawn inside a box clamped to this many card line boxes
 * (`--card-link-lines` in `styles.css`, which `constants.test.ts` holds to this
 * number), so it is also **how many links a card can name**: one line each.
 *
 * It was three before and it still is — what changed on 2026-09-19 is what
 * fits in them. The strip used to draw the fat 58px preview box with the
 * picture in it, `min-height: 58px` against a `max-height` of 58.5, so a note
 * with ten addresses in it rendered two previews and a "+8 links" line and
 * showed exactly **one**: the rest were cut off by the clamp, silently, and
 * the card looked for all the world like a note with a single link in it. A
 * card with more than one link now draws one line per link instead, so three
 * of them fit where one used to.
 */
export const LINK_STRIP_LINES = 3;

/**
 * How many of a card's lines the row of file squares under its words takes
 * (`.card[data-has-files]` in the stylesheet, `--strip-lines`, which
 * `constants.test.ts` holds to this). Four, so a square is large enough to
 * recognise a screenshot by (owner's sketch, 2026-10-16); it was three, as a
 * letterbox the full width of the card.
 */
export const FILE_STRIP_LINES = 4;

/**
 * How many characters of a line a checklist item's box takes from its words.
 *
 * `charsPerLine` is measured across the whole list, but an item's words start
 * after the "[ ]" (three mono characters at the data size) and the 7px gap
 * beside it — about 26px, or four characters of body text. Budgeted on the
 * full width, an item that wraps beside its box was counted as one line, and
 * the card sliced its second line through the middle at the clamp.
 */
export const CHECK_BOX_CHARS = 4;

const SAVED_LINK_RE = /^Saved link:\s*(.*)$/im;

export interface ChecklistItem {
  text: string;
  done: boolean;
  /**
   * The item's words the way the body draws its own: delimiters dropped,
   * emphasis applied, and — while a search is running — the matched run cut out
   * as a segment of its own so the card can hold it at full ink.
   *
   * The face used to hand the card bare strings and the card drew them as bare
   * strings, so a forty-item list found by a word on item thirty showed items
   * one to eight with nothing marked in any of them. That is the exact failure
   * the searched face exists to prevent, on the one face that had no way of
   * reporting it.
   */
  segs: InlineSeg[];
}

export type FaceKind = "link" | "checklist" | "file" | "text";

export interface CardFace {
  kind: FaceKind;
  /** Uppercase mono label shown in the card's corner. */
  label: string;
  /** The note's own text, already trimmed to the card budget. */
  body: string;
  /** Characters hidden by the cut. 0 means nothing was hidden. */
  remaining: number;
  items: ChecklistItem[];
  hiddenItems: number;
  domain: string | null;
  /** Total URLs found in the note. 0 = no links. */
  linkCount: number;
  /**
   * Tick boxes and code in the note, for the footer marks.
   *
   * The card shows the first few lines and the footer says what is in the rest —
   * the same job the link count has always done. A list of things to do and a
   * snippet you saved are both worth knowing about from the board, and both are
   * routinely below the cut: the card face is eight lines and the tick boxes
   * often start on the tenth.
   */
  checkCount: number;
  /**
   * How many of those boxes are ticked — the footer's `done/total`. Counted by
   * the same `parseChecklist` walk as `checkCount`, so the two halves of the
   * fraction come from one definition of a box (`markerOf`) and can never
   * describe two different lists. Nothing to do with the note-level `done`
   * field, which is dead (root CLAUDE.md).
   */
  checkDone: number;
  /**
   * Whether the face itself draws a tick box — the checklist face, or a text
   * face whose cut body still holds one. The footer then gives the bare
   * `done/total` and no `[ ]`: that mark is for boxes below the cut, and on a
   * card already drawing boxes it was the footer repeating the face (audit
   * 2026-10-24, UX-008).
   */
  boxesShown: boolean;
  codeInside: boolean;
  /** The file this card stands for, when the note is a file and nothing else. */
  file: Attachment | null;
  /** All files on a file-only note, so the card can preview a small gallery. */
  files: Attachment[];
  /** Files carried, for the footer mark. Counted even when the face is text. */
  fileCount: number;
  /** A checklist's title line, drawn over its boxes (`listTitle`); null on every other face. */
  title: string | null;
}

/**
 * The note's own words — what is left after the filenames.
 *
 * A dropped file writes nothing into the note now; the file is what the note
 * is, and the name is already under the picture. But notes captured before that
 * changed do have the filename as their text, so it is still stripped here: it
 * was never the user writing, and the difference is what decides the card.
 * Words the user wrote are always worth more than a picture of the file; a
 * filename standing alone is worth less than the picture.
 *
 * Which makes this a rule about old notes and a no-op on new ones — a note with
 * no text at all trims to "" on the first line and takes the same branch.
 */
function ownWords(text: string, atts: Attachment[]): string {
  if (atts.length === 0) return text.trim();
  const names = new Set(atts.map((a) => a.name));
  return text
    .split("\n")
    .filter((line) => !names.has(line.trim()))
    .join("\n")
    .trim();
}

/**
 * Through `markerOf`, which web/CLAUDE.md names as the only definition of a
 * list marker: "written twice they drift, and a card ends up disagreeing with
 * the note it stands for."
 *
 * It was written twice, and it had drifted. This carried its own pattern that
 * accepted a tick box after a hyphen or an asterisk but not after an en dash —
 * and the en dash is the one the app produces itself, since typing help
 * rewrites "- " to "– " as you type (`autoformat.ts`). So a checklist the app
 * had just helped somebody type counted zero items here: no checklist face, no
 * tick-box count in the footer, and missing from the Todos board, while the
 * open note drew every one of its lines as a tickable box.
 */
function parseChecklist(text: string, terms: string[] = []): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const line of text.split("\n")) {
    const marker = markerOf(line);
    if (marker?.kind !== "check") continue;
    const words = marker.words.trim();
    // The same two steps a line of the text face takes (`cardLines`), so an
    // item is drawn by one grammar rather than by a second one written here —
    // and a hit inside an item can be marked at all.
    items.push({ text: words, done: marker.done, segs: markHits(plainInline(words), terms) });
  }
  // The item holding the most of the words lights them most strongly — the
  // same line `shiftToItem` opens the list on (`bestLine`).
  const wanted = usableTerms(terms);
  if (wanted.length > 1) {
    const best = bestLine(
      items.map((item) => item.text),
      wanted,
    );
    if (singlesOut(wanted, best.count)) {
      items[best.at] = { ...items[best.at], segs: lightBest(items[best.at].segs) };
    }
  }
  return items;
}

/**
 * Card faces are display-only, so runs of blank lines and the gaps left where
 * an address was removed are closed up. A blank line costs a seventh of a
 * phone card, which is far too much to spend on nothing. The note itself is
 * never touched — this only ever affects what the card draws. A line of code
 * keeps its indentation and its inner spacing (2026-10-23): on a card the
 * indentation is the only picture of the code's structure there is.
 */
function tidyForCard(text: string): string {
  const code = codeLines(text);
  return text
    .split("\n")
    .map((line, i) => (code.get(i) === "body" ? line.trimEnd() : line.replace(/[ \t]+/g, " ").trim()))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+/, "")
    .trimEnd();
}

/**
 * The card's text with a fence closed that the cut left open, for reading its
 * code lines only. On a narrow card the cut can fall inside a fenced block, and
 * an opening fence with no close is not a block — the fence line was drawn as
 * prose and the code lost its face (seen on a phone, design review 2026-10-23).
 */
const FENCE_MARK = /^[ \t]*(`{3,}|~{3,})/;

function closedFences(text: string): string {
  const fences = text.split("\n").flatMap((line) => FENCE_MARK.exec(line)?.[1] ?? []);
  return fences.length % 2 === 0 ? text : `${text}\n${fences[fences.length - 1]}`;
}

/**
 * Removes every address, then the punctuation left dangling where one used to
 * be — a note reading "Fables patreon — https://…" must not render as
 * "Fables patreon —".
 */
function stripUrls(text: string): string {
  return (
    linkify(text)
      .map((segment) => (segment.href ? "" : segment.text))
      .join("")
      // "Anthropic — <url> — Claude learns" would otherwise close up into
      // "Anthropic — — Claude learns". Two dashes in a row were never text.
      .replace(/([—–|:,])[ \t]*(?=[—–|:,])/g, "")
      .replace(/[ \t]*[—–|:,][ \t]*$/gm, "")
      .replace(/^[ \t]*[—–|:,][ \t]*/gm, "")
  );
}

/**
 * Fills the card a line at a time. A source line longer than the card is wide
 * counts as the several lines it will actually wrap to; a short one counts as
 * one however few characters it holds.
 */
function cutToLines(
  text: string,
  { lines, charsPerLine }: CardMetrics,
): { body: string; fitted: string; truncated: boolean } {
  const rows = text.split("\n");
  // A line of code is one card line however long (it does not wrap, it gives
  // way), and a fence line costs nothing (it is not drawn) — what styles.css
  // draws for `.card-line[data-code]` and `.card-code-fence`.
  const code = codeLines(closedFences(text));
  let used = 0;
  let end = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const kind = code.get(i);
    // A blank line is a break, not a line of the note, and on a card it is
    // charged as one — half a line box, which is what styles.css draws it at
    // (`.card-line:empty`). The two must agree or the card overflows the
    // budget the cut was measured against.
    const cost =
      row.trim() === ""
        ? 0.5
        : kind === "fence"
          ? 0
          : kind === "body"
            ? 1
            : Math.max(1, Math.ceil(row.length / charsPerLine));

    if (used + cost <= lines) {
      used += cost;
      end += row.length + (i < rows.length - 1 ? 1 : 0);
      // A half-cost line can leave `used` short of `lines` forever, so this
      // has to catch it landing on or past the budget rather than exactly on
      // it — a run of blanks would otherwise slip a half box over unnoticed.
      if (used >= lines) break;
      continue;
    }

    // Take as much of this row as the remaining lines can hold, breaking on a
    // word when one is near so the cut looks deliberate rather than sliced.
    const room = (lines - used) * charsPerLine;
    if (room > 0) {
      const slice = row.slice(0, room);
      const lastSpace = slice.lastIndexOf(" ");
      end += lastSpace > room * 0.7 ? lastSpace : room;
    }
    // No `used = lines` here: this is the last row either way, and nothing
    // after the loop reads it. Setting it looked like bookkeeping and was a
    // dead store.
    break;
  }

  if (end >= text.length) {
    return { body: text, fitted: text, truncated: false };
  }

  // Deliberately overfill by a line. The character budget is an estimate and a
  // conservative one, so cutting to exactly it often left the last line of text
  // on line 7 of 8 — and the fade, which is anchored to the bottom of the card,
  // then landed on a line that was not the last one. Handing CSS more text than
  // it can show guarantees the final line box is full and is the one that
  // fades; the clamp in styles.css eats the surplus.
  //
  // `fitted` is the honest cut, and it is what the hidden remainder is measured
  // against. Measuring against the overfilled body would let the surplus
  // swallow the remainder on a short note and report nothing hidden at all,
  // which is how the card would end up cut with no mark to say so.
  const spill = Math.min(text.length, end + charsPerLine + 12);
  return {
    body: text.slice(0, spill).trimEnd(),
    fitted: text.slice(0, end),
    truncated: true,
  };
}

/**
 * The stretch of the note a card is filled from, and whether it opens anywhere
 * but at the note's own first line.
 *
 * The two facts travel together because the second is true only during a
 * search, is easy to forget about, and is exactly what was forgotten — see
 * `faceBody` below.
 */
interface FaceWindow {
  shown: string;
  shifted: boolean;
}

function windowFor(tidied: string, terms: string[]): FaceWindow {
  const shown = shiftToMatch(tidied, terms);
  return { shown, shifted: shown.length < tidied.length };
}

/**
 * What the card shows, and how much of the note it is hiding.
 *
 * The remainder is measured against the *original* note, not the tidied face,
 * so a card that has closed up blank lines and dropped a 90-character URL
 * still tells you truthfully how much you have not seen.
 *
 * It has to count every line of the note the card is not showing, and there
 * are two ways for a line to be missing: it fell off the bottom, or the window
 * was wound past it at the top (`shiftToMatch`, while a search is running).
 * Only the first used to count. Search a three-hundred-line note for a word on
 * line 298 and the four surviving lines fit the budget with room to spare — so
 * nothing was truncated, the remainder came out zero, and the tail of a long
 * note was presented as the whole note: no cut mark, no fade, nothing at all
 * saying there was anything above it. Mismeasuring the remainder in either
 * direction is how the card would end up cut with no mark to say so.
 */
function faceBody(
  original: string,
  window: FaceWindow,
  metrics: CardMetrics,
): { body: string; remaining: number; boxesShown: boolean } {
  const { body, fitted, truncated } = cutToLines(window.shown, metrics);
  const hidden = Math.max(0, original.trim().length - fitted.length);
  return {
    body,
    remaining: truncated || window.shifted ? hidden : 0,
    boxesShown: parseChecklist(body).length > 0,
  };
}

/**
 * One face per (note, metrics) pair, kept only as long as the note object
 * itself is kept. Every write in this app replaces a note with a new object
 * rather than mutating one in place (`localPatch`, `putNotesFromServer`, ...),
 * so a stale cache entry can never be read back for an edited note — it simply
 * falls out of the map along with the object it was keyed on.
 *
 * This exists because `matchesBoard` calls `deriveFace(note)` — always the
 * same default `CARD_METRICS` reference — once per note for the Links board
 * and again for the Todos board, and the board-count total in App.tsx redoes
 * that over the whole archive on every note change, every board. Reading a
 * face means walking the note for URLs, tick boxes and code; on the real
 * archive that walk was measured at 12ms, uncached, every time.
 *
 * **A slot per metrics object, and not one slot per note**, which is what this
 * held first. The two callers never agree on a metrics object: `matchesBoard`
 * asks with the default `CARD_METRICS`, and every card on screen asks with the
 * budget it derived for its own shape. With one slot they evicted each other
 * turn and turn about, so the cache missed for exactly the notes it was
 * written for. The inner map is weak too, so a metrics object the layout has
 * stopped using takes its faces with it and nothing here can grow unbounded.
 */
const faceCache = new WeakMap<Note, WeakMap<CardMetrics, CardFace>>();

export function deriveFace(
  note: Note,
  metrics: CardMetrics = CARD_METRICS,
  terms: string[] = [],
): CardFace {
  // A searched face is a different face for every query, so it is never cached:
  // the key would have to carry the query, and the cache exists for the board's
  // repeated `matchesBoard` walk over the whole archive, which never searches.
  // A result set is one screenful, so the walk is paid once per keystroke on a
  // few dozen notes rather than on all of them.
  if (terms.length > 0) return computeFace(note, metrics, terms);
  let byMetrics = faceCache.get(note);
  if (!byMetrics) {
    byMetrics = new WeakMap<CardMetrics, CardFace>();
    faceCache.set(note, byMetrics);
  }
  const cached = byMetrics.get(metrics);
  if (cached) return cached;
  const face = computeFace(note, metrics);
  byMetrics.set(metrics, face);
  return face;
}

/**
 * Whether this note's card draws the link face.
 *
 * Exported because `NoteCard` has to reserve the preview's three lines *before*
 * it can ask for a face, so it needs the answer early — and it used to work it
 * out for itself with a different definition of "a link". When the two
 * disagreed the card reserved three lines and then drew nothing in them.
 * One question, one answer, asked in two places.
 */
export function isLinkNote(note: Note): boolean {
  const text = note.body ?? "";
  if (SAVED_LINK_RE.test(text)) return true;
  if (firstLink(text) === null) return false;
  // Measured on the note's **own words**, with the addresses lifted out.
  //
  // The 400 has always meant "there is not much prose here, so the card can
  // give three of its lines to a preview". It used to measure the whole text,
  // addresses included — and an address is not prose. A note of ten fishing
  // spots from Google Maps is 440 characters of which 360 are URL: it read as a
  // page of writing, fell through to the text face, and drew no preview at all
  // for the ten links that were the entire point of it (2026-09-19). What the
  // user actually wrote there is eighty characters.
  return stripUrls(text.replace(SAVED_LINK_PREFIX, "")).trim().length < 400;
}

/**
 * The note's own words with every address lifted out — exactly the text a link
 * card prints under its strip of links, and exactly what `computeFace` passes
 * to `faceBody` for the link face.
 *
 * Exported for one caller and one question. `NoteCard` has to decide how many
 * of its lines to hand the link strip *before* it can ask for a face (the face
 * is derived against a budget the strip has already taken its share out of), so
 * it cannot look at `face.body` to find out whether there are any words to
 * leave room for. It asks here instead. A note that is nothing but ten Google
 * Maps addresses answers `""`, and the strip is welcome to the whole card.
 */
export function wordsBesideLinks(note: Note): string {
  return stripUrls((note.body ?? "").replace(SAVED_LINK_PREFIX, "")).trim();
}

/**
 * Whether this note is **nothing but addresses** — one or more links, no words
 * of the user's own around them, and no file.
 *
 * The owner's rule (2026-09-16): a note that is only links belongs on the Links
 * board and nowhere else, until the user says otherwise by filing it or marking
 * it as a to-do. A bare link is already where it belongs the moment it is
 * written, exactly as a to-do is, so it has no business waiting in the Inbox's
 * pile or padding All. `matchesBoard` reads this; this only answers what the
 * note *is*.
 *
 * "Words" is judged on what `stripUrls` leaves behind, the same removal the
 * link card draws its face from, with Keep's `Saved link:` prefix ignored —
 * that prefix is the importer's, not the user's. Only a letter or a digit
 * counts as a word: a dash or a bullet left between two addresses is layout.
 * A single word beside the address ("recipe https://…") makes it a note about
 * a link, and a note about a link stays on every board it was on before.
 *
 * Cached per note object for the same reason `deriveFace` is: the Inbox and
 * All ask it of every note on every change, and every write replaces the
 * object, so a stale answer can never be read back.
 */
const onlyLinksCache = new WeakMap<Note, boolean>();

export function isOnlyLinks(note: Note): boolean {
  const cached = onlyLinksCache.get(note);
  if (cached !== undefined) return cached;
  const text = note.body ?? "";
  const answer =
    (note.attachments ?? []).length === 0 &&
    countLinks(text) > 0 &&
    !/[\p{L}\p{N}]/u.test(stripUrls(text.replace(SAVED_LINK_PREFIX, "")));
  onlyLinksCache.set(note, answer);
  return answer;
}

function computeFace(note: Note, metrics: CardMetrics, terms: string[] = []): CardFace {
  const text = note.body ?? "";
  const atts = note.attachments ?? [];
  // A name (`lib/name.ts`) is drawn *over* a face rather than being what the
  // face is made of, so the two faces that are chosen by what a note holds ask
  // their question of the text under it. Asked of the whole text, naming a
  // photograph gave its card back to one line of words, and naming a to-do
  // list made it prose — which also took it off the Todos board, because
  // `isTodoNote` reads this face.
  const named = noteName(text) !== null;
  const underName = named ? text.split("\n").slice(1).join("\n") : text;

  const linkCount = countLinks(text);
  const items = parseChecklist(text, terms);

  const base: CardFace = {
    kind: "text",
    label: "NOTE",
    body: "",
    remaining: 0,
    items: [],
    hiddenItems: 0,
    domain: null,
    linkCount,
    checkCount: items.length,
    checkDone: items.filter((item) => item.done).length,
    boxesShown: false,
    codeInside: hasCode(text),
    file: null,
    files: atts,
    fileCount: atts.length,
    title: null,
  };

  // --- A file, and nothing else --------------------------------------------
  // First, because it is the only face that beats the user's own words — and
  // it only applies when there are none. A screenshot sent from the other
  // machine has no words, so the card is the screenshot, which is exactly how
  // you find it again. Write a line about it and the words take the card back.
  if (atts.length > 0 && ownWords(underName, atts) === "") {
    return { ...base, kind: "file", label: "FILE", file: atts[0] };
  }

  // --- Checklist -----------------------------------------------------------
  // Rows sit on the same line box as body text (styles.css), so exactly as
  // many fit as there are lines.
  //
  // The boxes have to *be* the note, not merely be in it. This face shows the
  // items and nothing else, so a page of writing that happens to end in two
  // tick boxes was having the writing taken off its card and replaced by the
  // afterthought — the card stopped standing for the note. Falling through to
  // the text face loses nothing: that face already draws a tick box as a tick
  // box, in its place, with the words around it kept.
  // A title above the boxes ("Packing:", or a line a blank one sets off) gets
  // the name's row, by the same rule the To-do mark titles a list with
  // (`listTitle`): one title line, and everything under it a box.
  const title = named ? null : listTitle(text.split("\n"));
  const rows = title === null ? underName : text.split("\n").slice(1).join("\n");
  const written = rows.split("\n").filter((line) => line.trim() !== "").length;
  // The checklist face draws only its items. Use it only when the note is
  // entirely a checklist, otherwise prose before or between boxes disappears
  // from the card even though it is still part of the note.
  //
  // `note_type` is read here for one thing only: a hand-marked `todo` may draw
  // this face on a *single* box, where two are wanted otherwise. It is
  // deliberately not asked about `"note"`, the opt-out `isTodoNote` reads
  // (`lib/boards.ts`) — that answers "which board is this on", and a face
  // answers "how is this text arranged". A shopping list the user has said is
  // not a to-do is off the Todos board and still draws its own tick boxes,
  // because the boxes are characters they typed.
  const onlyBoxes = items.length === written;
  if (onlyBoxes && (items.length >= 2 || note.note_type === "todo") && items.length > 0) {
    // An item may now wrap to a second line box (styles.css, `.check-item`),
    // so the budget is spent in line boxes rather than in items — the same
    // measure `cutToLines` fills the text face with.
    //
    // And, while a search is running, spent from the item the match is on
    // rather than from the first one. This face used to be returned before
    // `shiftToMatch` was ever reached, so a forty-item list found by a word on
    // item thirty drew items one to eight and said nothing at all about why it
    // was a result — the one thing the searched face exists to fix. Items
    // wound past at the top are hidden exactly as the ones below the budget
    // are, and `hiddenItems` counts by number rather than by position, so the
    // cut level stays honest without having to know which end they went off.
    // The name takes its row out of the items' lines, never out of the card.
    const lines = Math.max(1, metrics.lines - (named || title !== null ? 1 : 0));
    // The words of an item start after its box, so they are measured on what
    // is left of the line once the box has taken its share (review UI-07).
    const itemChars = Math.max(8, metrics.charsPerLine - CHECK_BOX_CHARS);
    const shown: ChecklistItem[] = [];
    let used = 0;
    for (const item of items.slice(shiftToItem(items, terms))) {
      const cost = Math.max(1, Math.ceil(item.text.length / itemChars));
      if (used + cost > lines && shown.length > 0) break;
      shown.push(item);
      used += cost;
    }
    return {
      ...base,
      kind: "checklist",
      label: "TODO",
      items: shown,
      boxesShown: true,
      hiddenItems: items.length - shown.length,
      title,
    };
  }

  // --- Saved link ----------------------------------------------------------
  // Addresses are dropped from the card face. The note view still shows every
  // address in full and live; a link icon in the footer is enough to tell you
  // at a glance that there is something to follow here.
  const link = firstLink(text);
  if (isLinkNote(note) && link) {
    const shown = windowFor(
      tidyForCard(stripUrls(text.replace(SAVED_LINK_PREFIX, ""))),
      terms,
    );
    return {
      ...base,
      kind: "link",
      label: "LINK",
      domain: domainFor(link.href),
      ...faceBody(text, shown, metrics),
    };
  }

  // --- Text ----------------------------------------------------------------
  return {
    ...base,
    label: labelFor(note),
    ...faceBody(text, windowFor(tidyForCard(text), terms), metrics),
  };
}

function labelFor(note: Note): string {
  return (note.note_type ?? "note").toUpperCase();
}

/**
 * How much more there is, in three steps rather than a number.
 *
 * "+1.4k" was precise and unreadable: nobody converts 1,400 characters into an
 * amount of reading at a glance, and the exact figure was never the question.
 * The question is "a bit more, or a lot?", which has three useful answers. Drawn
 * as one, two or three stacked lines — a rising level, in the space the count
 * used to hold.
 *
 * The thresholds come from the real archive: a phone card holds roughly 180
 * characters, and 35 of the 241 notes run past 1,500.
 */
/**
 * A line of a card face, and whether it is an item.
 *
 * The card used to print the face as one run of pre-wrapped text, which meant a
 * list on a card was a paragraph that happened to start with numbers. The open
 * note has always set its lists properly; the card is the surface you actually
 * scan, and it was the one not doing it.
 *
 * A card cannot afford the open note's spacing — every card is exactly
 * `--card-lines` line boxes tall and the grid depends on that being true — so an
 * item on a card costs exactly one line box and simply spends it differently:
 * the leading is pulled in and the difference is put back between items. See
 * `--card-item-lh` and `--card-item-gap` in styles.css, which must sum to
 * `--card-lh` or this stops being free.
 */
export interface CardLine {
  /** The whole line, for a line that carries no marker. */
  text: string;
  /** Indent plus marker, when the line is an item. Null when it is not. */
  marker: string | null;
  /** The item's own words. Empty for a line that is not an item. */
  words: string;
  numbered: boolean;
  done: boolean;
  /**
   * Whether the user marked this line as a heading. A card draws it in the
   * card's own size and never a larger one: every card is exactly
   * `--card-lines` line boxes tall and the grid depends on that staying true,
   * so at this size the heading is said in the weight alone. The hashes are
   * dropped rather than hidden — a card is display-only and has no caret to
   * keep honest.
   */
  heading: boolean;
  /**
   * The line's words with emphasis applied and its delimiters dropped. A card
   * reading "**Tuesday**" is worse than one reading Tuesday in bold, and worse
   * again than one reading Tuesday plain.
   */
  segs: InlineSeg[];
  /** The reader's code blocks, with fence lines kept display-only. */
  code: "body" | "fence" | false;
  /**
   * A leading tag line — the `#todo` a Keep import left on line one. It is a
   * filing artifact rather than the note, so the card draws it one step down
   * the ramp. Only ever the first line, and never when it is the only line:
   * then it is the note.
   */
  tag: boolean;
}

function codeLines(body: string): Map<number, "body" | "fence"> {
  const out = new Map<number, "body" | "fence">();
  let cursor = 0;

  for (const block of parseBlocks(body)) {
    if (block.kind !== "code") continue;
    const start = body.indexOf(block.text, cursor);
    if (start < 0) continue;
    cursor = start + block.text.length;

    const lineAt = (offset: number) => body.slice(0, offset).split("\n").length - 1;
    const codeStart = start + block.lead.length + block.open.length;
    const codeEnd = codeStart + block.code.length;
    const first = lineAt(codeStart);
    const count = Math.max(1, block.code.split("\n").length);
    for (let i = 0; i < count; i++) out.set(first + i, "body");

    if (block.open) out.set(lineAt(start + block.lead.length), "fence");
    if (block.close) out.set(lineAt(codeEnd), "fence");
  }
  return out;
}

/* --- a card face while a search is running -----------------------------------
   The app is opened to *find* something, and a card normally shows the note
   from its first character. Search a long note for a word buried two hundred
   lines down and the card showed you the opening, which need not contain the
   word at all: a hit you have to open to understand, which is the one job the
   board is supposed to save you.

   So during a search the face does two things it never otherwise does. It
   starts at the match rather than at the top, and it says which words matched.
   Both are facts about the *query*, not about the note, so neither touches the
   stored text or any face drawn when nothing is being searched. The open note
   opened from a result says the same two things (`hitScrollTop` below, and
   `markHits` in `NoteReader`) until the first tap into its text — the owner
   asked for the note to open where the words are, not at its top. */

/**
 * The terms actually worth looking for.
 *
 * An empty string is not a harmless term: `indexOf("")` answers 0 for ever, so
 * `markHits`' walk would never advance and the tab would stop. `searchTerms`
 * splits on non-word characters and drops the empties, so the running app
 * cannot reach it — but `markHits` and `shiftToMatch` are exported and are
 * already called directly from tests, which means the invariant is being kept
 * by a module that merely happens to satisfy it. It is kept here instead, in
 * the module that depends on it.
 */
function usableTerms(terms: string[]): string[] {
  return terms.length === 0 ? terms : terms.filter((term) => term !== "");
}

/**
 * The fenced code blocks in a face, as the first and last line each occupies.
 *
 * Read back through `parseBlocks` in its fenced-only mode, so which fence
 * closes which is answered by `fenceRuns` — the one definition of it — rather
 * than by a second pattern here. `markerOf` is the standing argument for that:
 * written twice, the two drift, and a card ends up disagreeing with the note it
 * stands for.
 */
function fenceSpans(text: string): Array<{ open: number; close: number }> {
  const spans: Array<{ open: number; close: number }> = [];
  let cursor = 0;
  for (const block of parseBlocks(text, false)) {
    if (block.kind !== "code" || !block.open) continue;
    const start = text.indexOf(block.text, cursor);
    if (start < 0) continue;
    cursor = start + block.text.length;
    const lineAt = (offset: number) => text.slice(0, offset).split("\n").length - 1;
    const open = lineAt(start + block.lead.length);
    const codeStart = start + block.lead.length + block.open.length;
    spans.push({ open, close: lineAt(codeStart + block.code.length) });
  }
  return spans;
}

/**
 * The line the window may open on, moved back to a fenced block's own opening
 * fence when it would otherwise land inside one.
 *
 * `cardLines` re-reads the *shifted* text for its code blocks, and a fence only
 * makes a block when a close follows an open. Open the window in the middle of
 * a block and the surviving close is drawn as a literal "```" line of prose
 * while the code around it loses the machine face; in a note holding two
 * blocks, that orphan close can pair with the *next* block's open and set the
 * ordinary writing between them as code. Neither is something a card may show,
 * so the window opens on the block's own fence and the block is drawn whole.
 * That costs the lead-in line and, in a long block, the match's place near the
 * top of the card — much the cheaper of the two losses.
 */
function wholeFences(text: string, want: number): number {
  // Almost no note has a fence in it, and parsing the blocks of one that has
  // not is work paid on every card of every result, on every keystroke.
  if (!/^[ \t]*(?:`{3,}|~{3,})/m.test(text)) return want;
  let from = want;
  for (const span of fenceSpans(text)) {
    if (from > span.open && from <= span.close) from = span.open;
  }
  return from;
}

/**
 * The note's text, wound forward to the line the first match is on.
 *
 * One line of lead-in is kept so the match is not flush against the top edge
 * with no context above it. A match already at the top is left alone: the
 * opening is the best thing to show anyway, and shifting would only lose the
 * beginning of the note for nothing.
 */
export function shiftToMatch(text: string, terms: string[]): string {
  const wanted = usableTerms(terms);
  if (wanted.length === 0) return text;
  const lines = text.split("\n");
  const i = bestLine(lines, wanted).at;
  // The hit was somewhere the card does not draw — a filename, most likely.
  if (i < 0) return text;
  // At the top already, or one line down: nothing to gain by winding on.
  if (i <= 1) return text;
  const from = wholeFences(text, i - 1);
  return from === 0 ? text : lines.slice(from).join("\n");
}

/**
 * The line a search should open on: the first one holding the most of its
 * distinct words, and how many it holds (`at` is -1 when no line holds any).
 *
 * For one word that is simply the first line it is on — what this always was.
 * For several it is the line that answers the whole query (review 2026-10-04,
 * UI-A-11): "number 50" used to open a long note on line 1, where "number"
 * stood alone, while the one line holding both was two screens down and
 * marked no differently from the sixty other hits. Ranked by distinct words,
 * not by hits, so a line saying "number" five times does not outrank the one
 * that says "number 50". The card (`shiftToMatch`, `shiftToItem`), its marks
 * (`lightBest`) and the open note (`NoteReader`) all ask this one question.
 */
export function bestLine(lines: readonly string[], terms: readonly string[]): {
  at: number;
  count: number;
} {
  let at = -1;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let here = 0;
    for (const t of terms) if (t !== "" && lower.includes(t)) here += 1;
    if (here > count) {
      at = i;
      count = here;
      if (count === terms.length) break;
    }
  }
  return { at, count };
}

/**
 * Whether a search singles out one line to light most strongly: only for
 * several words, and only where some line holds more than one of them. A
 * single word has no line to prefer, and words that never meet on a line
 * leave every hit equal.
 */
export function singlesOut(terms: readonly string[], count: number): boolean {
  return terms.length > 1 && count > 1;
}

/** The same segments, every hit on them marked as the best line's. */
function lightBest(segs: InlineSeg[]): InlineSeg[] {
  return segs.map((seg) => (seg.hit ? { ...seg, best: true } : seg));
}

/**
 * Where the open note should be scrolled to so its first hit is in view —
 * `shiftToMatch` for the open note, which cannot wind its text on and so
 * moves the window over it instead. Null means leave it where it is.
 *
 * All four positions are in the scroller's own content coordinates. A hit
 * already wholly on screen is left alone, whether the note opened at the top
 * or at a remembered reading position: the words are in front of the reader,
 * and moving them would only lose whatever they were looking at around them.
 * Otherwise the hit is brought up to one `lead` below the top edge — one line
 * of lead-in, the same the card keeps, so the match is never flush against the
 * edge with nothing above it.
 */
export function hitScrollTop(
  hitTop: number,
  hitHeight: number,
  scrollTop: number,
  viewHeight: number,
  lead: number,
): number | null {
  if (hitTop >= scrollTop && hitTop + hitHeight <= scrollTop + viewHeight) return null;
  return Math.max(0, hitTop - lead);
}

/**
 * The item a checklist face starts on — `shiftToMatch` for a list, which has
 * items where the text face has lines.
 *
 * One item of lead-in is kept for the same reason one line is, and a match on
 * the first or the second item leaves the list exactly where it is: the top of
 * a list is the best thing to show anyway.
 */
function shiftToItem(items: ChecklistItem[], terms: string[]): number {
  const wanted = usableTerms(terms);
  if (wanted.length === 0) return 0;
  const i = bestLine(
    items.map((item) => item.text),
    wanted,
  ).at;
  // The hit was somewhere the list does not draw — a filename, most likely.
  if (i < 0) return 0;
  return i <= 1 ? 0 : i - 1;
}

/**
 * The same segments, split so every run of matched characters is its own.
 *
 * Overlapping and repeated terms are merged first, or "an" inside "and" would
 * emit two segments for one word and the card would draw the join.
 *
 * **It does not normalise, and `searchNotes` does.** A note holding `ä` as
 * `a` + U+0308 is found by a query typed as precomposed `ä` — the search side
 * composes both before comparing — and its card then draws *without* the
 * highlight, because the offsets here are into the note's own characters and
 * composing changes their number. Marking it correctly means carrying an
 * offset map from the composed string back to the original, per segment, per
 * card, on the walk that runs for every keystroke of a query. The result is
 * right either way; what is missing is the emphasis on one kind of match that
 * is rare in this archive. If it is ever worth building, build it here rather
 * than by loosening the search: a card that marks a word the search did not
 * match on is the worse failure, and `hitTerms` exists to make that
 * impossible.
 */
/**
 * The text lowercased without changing its length, so an offset found in it is
 * an offset in the text. `İ` lowercases to two characters, which moved every
 * mark after it onto the wrong letters; a character like that keeps its case.
 */
function sameLengthLower(text: string): string {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  return Array.from(text, (c) => {
    const l = c.toLowerCase();
    return l.length === c.length ? l : c;
  }).join("");
}

export function markHits(segs: InlineSeg[], terms: string[]): InlineSeg[] {
  const wanted = usableTerms(terms);
  if (wanted.length === 0) return segs;
  const out: InlineSeg[] = [];
  for (const seg of segs) {
    if (seg.hidden || seg.text === "") {
      out.push(seg);
      continue;
    }
    const lower = sameLengthLower(seg.text);
    const found: Array<[number, number]> = [];
    for (const term of wanted) {
      let at = lower.indexOf(term);
      while (at !== -1) {
        found.push([at, at + term.length]);
        at = lower.indexOf(term, at + term.length);
      }
    }
    if (found.length === 0) {
      out.push(seg);
      continue;
    }
    found.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const range of found) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([range[0], range[1]]);
    }
    let at = 0;
    for (const [from, to] of merged) {
      if (from > at) out.push({ ...seg, text: seg.text.slice(at, from) });
      out.push({ ...seg, text: seg.text.slice(from, to), hit: true });
      at = to;
    }
    if (at < seg.text.length) out.push({ ...seg, text: seg.text.slice(at) });
  }
  return out;
}

/** Splits a card face into lines using the reader's block and inline grammar. */
export function cardLines(body: string, terms: string[] = []): CardLine[] {
  if (body === "") return [];
  // A fence the cut left open is closed for the reading (`closedFences`).
  const code = codeLines(closedFences(body));
  // A hit is drawn on the words the query actually matched — see `markHits`.
  const hits = (segs: InlineSeg[]) => markHits(segs, terms);
  // The archive is a Google Keep import: `#todo`, `#someday/maybe`, on line
  // one, blank line, then the note. That tag is a filing artifact rather than
  // the note, so it steps a step down the ramp — but never when it is the
  // only line, because then it *is* the note (`#todo claude code test`).
  const written = body.split("\n").filter((l) => l.trim() !== "").length;
  const tagFirst = written > 1 && /^#\S/.test(body.split("\n")[0].trim());
  const lines = body.split("\n").map((text, index): CardLine => {
    const tag = index === 0 && tagFirst;
    const codeKind = code.get(index);
    if (codeKind) {
      return {
        text,
        marker: null,
        words: "",
        numbered: false,
        done: false,
        heading: false,
        segs: hits([{ text }]),
        code: codeKind,
        tag,
      };
    }

    const h = headingOf(text);
    if (h) {
      return {
        text,
        marker: null,
        words: h.words,
        numbered: false,
        done: false,
        heading: true,
        segs: hits(plainInline(h.words)),
        code: false,
        tag,
      };
    }

    const m = markerOf(text);
    if (!m) {
      return {
        text,
        marker: null,
        words: "",
        numbered: false,
        done: false,
        heading: false,
        segs: hits(plainInline(text)),
        code: false,
        tag,
      };
    }
    return {
      text,
      marker: m.prefix + m.marker,
      words: m.words,
      numbered: m.numbered,
      done: m.done,
      heading: false,
      segs: hits(plainInline(m.words)),
      code: false,
      tag,
    };
  });
  // Several words: the line holding the most of them — the one the face was
  // wound to (`shiftToMatch`) — lights its words most strongly.
  const wanted = usableTerms(terms);
  if (wanted.length > 1) {
    const best = bestLine(
      lines.map((line) => line.text),
      wanted,
    );
    if (singlesOut(wanted, best.count)) {
      lines[best.at] = { ...lines[best.at], segs: lightBest(lines[best.at].segs) };
    }
  }
  return lines;
}

export type CutDepth = 0 | 1 | 2 | 3;

export function cutDepth(face: CardFace): CutDepth {
  if (face.hiddenItems > 0) {
    return face.hiddenItems <= 2 ? 1 : face.hiddenItems <= 5 ? 2 : 3;
  }
  if (face.remaining <= 0) return 0;
  return face.remaining < 200 ? 1 : face.remaining < 1200 ? 2 : 3;
}
