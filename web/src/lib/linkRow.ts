import { cardLines } from "./face";
import { namesTheSite, pathLabel, type LinkPreviewData } from "./links";

/**
 * A line of the note's words with its markup taken out.
 *
 * A row's name is one line and the raw text is not that line: a heading arrives
 * as `## Plan meeting`, a tag as `#todo`, emphasis as asterisks. The card face
 * has never drawn them — `cardLines` puts a heading's own words in `segs` and
 * an item's box in `marker` — so the name asks the same function rather than
 * carrying a second idea of what markup is. Fences are dropped outright: three
 * backticks say nothing on one line.
 */
function flatLine(text: string): string {
  return cardLines(text)
    .filter((line) => line.code !== "fence")
    .map((line) => `${line.marker ?? ""}${line.segs.map((seg) => seg.text).join("")}`)
    .join("  ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a row on the Links board stands for, and the two words it opens and closes with. */
export interface LinkRow {
  /** The link, with whatever the server has saved for it laid over the local unfurl. */
  link: LinkPreviewData;
  /**
   * What the user wrote in front of the address, or nothing. Raw, delimiters
   * and all, because `rowWords` matches it against the front of the body to
   * take that sentence off — flattened it would match nothing and the row
   * would say it twice.
   */
  title: string | null;
  /** The name the row opens with. */
  name: string;
  /** What the footer stands under the row: the site, or the path when the name
   *  has already had to be the site (null for an address with no path). */
  site: string | null;
}

/**
 * The row for a note on the Links board, or null for a note with no link —
 * every note there has one (`matchesBoard`), but a card is not the place to
 * discover the two definitions have drifted, so it falls back to the card.
 *
 * **The user's own words first, the page's title second.** This order is the
 * app's own, and it is not cosmetic: with the `og:title` winning, two notes
 * saved from claude.ai both come out called "Claude Artifact" and the words
 * that tell them apart end up under the name, in the half that gets cut. A
 * title that only says the site again is refused outright (`namesTheSite`),
 * and when there is nothing left the name *is* the site — in which case the
 * footer says the path instead, so the row never prints one word twice.
 *
 * `locals` is the same list before the fetched metadata was laid over it —
 * which is where the user's words are (`previewsFor` builds its title out of
 * whatever stands in front of the address).
 */
export function linkRow(
  previews: LinkPreviewData[],
  locals: LinkPreviewData[],
): LinkRow | null {
  const link = previews[0] ?? null;
  if (!link) return null;
  return rowFor(link, locals[0] ?? null);
}

/** One link's row, by the rule `linkRow` states: the user's words, the page's
 *  title, then the site — and the path in the footer when the name is the site. */
function rowFor(link: LinkPreviewData, local: LinkPreviewData | null): LinkRow {
  const title = local && !namesTheSite(local.title, local.domain) ? local.title : null;
  const name =
    flatLine(title ?? "") ||
    (link.title && !namesTheSite(link.title, link.domain) ? flatLine(link.title) : "") ||
    link.domain;
  const site = name === link.domain ? pathLabel(link.href) : link.domain;
  return { link, title, name, site };
}

/**
 * Every link in a note, each named by the same rule the Links board names its
 * row by. For a place that has to say what a note's addresses *are* without
 * printing them — the Sorter, which showed a saved link as a line of raw URL.
 * `locals` and `previews` pair up by position: `overlaySaved` lays the stored
 * metadata over the local list without reordering it.
 */
export function linkRows(previews: LinkPreviewData[], locals: LinkPreviewData[]): LinkRow[] {
  return previews.map((link, i) => rowFor(link, locals[i] ?? null));
}

/**
 * A row's words, with the sentence the title already says taken off the front.
 *
 * A local unfurl builds its title out of whatever stands in front of the
 * address (`previewsFor`), so on the ordinary "Saved link: …" note the title
 * and the first line of the note are the same sentence — drawn as it comes, a
 * row would say it twice and spend a line of two doing it. Where a real
 * fetched Open Graph title has been stored instead, nothing matches and
 * nothing is dropped: the page's title and the user's words are two different
 * things and the row shows both.
 */
export function rowWords(row: LinkRow, body: string): string {
  if (row.title === null) return body;
  // `previewsFor` ends a long title in an ellipsis; the note does not.
  const head = row.title.replace(/\.{3}$/, "");
  if (head === "" || !body.startsWith(head)) return body;
  // A title cut at 87 characters ends wherever the cut fell — mid-word, as
  // often as not — and taking exactly that much off the body left the row
  // opening on the tail of a word: "orm (like Shopify…" was observed
  // (2026-09-04 audit, F7). If the cut landed inside a word, it moves on to
  // the end of that word, so what is left starts on a whole one. The word
  // itself is not lost: its head is in the title, ellipsis and all.
  let cut = head.length;
  if (/\S/.test(body[cut - 1] ?? "") && /\S/.test(body[cut] ?? "")) {
    const next = body.slice(cut).search(/\s/);
    cut = next === -1 ? body.length : cut + next;
  }
  // Whatever joined the two — "Kanel — some words" — goes with the half that
  // left, the same tidying `stripUrls` does where an address used to be.
  return body.slice(cut).replace(/^[\s—–|:,]+/, "");
}
