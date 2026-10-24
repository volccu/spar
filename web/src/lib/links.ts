import type { LinkPreview } from "../types";

/**
 * Link detection inside note text.
 *
 * 64 of the 241 real notes are saved links, and plenty of the rest have a URL
 * buried in the middle of prose. A link you cannot tap is a link you have to
 * retype, so every URL in a note is live.
 *
 * The one hard rule here: the segments must concatenate back to exactly the
 * input string, character for character. The note view relies on that to map
 * a tap in the rendered text onto a caret position in the raw text.
 */

export interface Segment {
  text: string;
  /** Where this segment points, or null when it is ordinary prose. */
  href: string | null;
}

export type LinkPreviewData = LinkPreview;

// An apostrophe may stand inside an address (Wikipedia's "Schindler's_List");
// one at the end is the sentence's, and `TRAILING` takes it off.
const LINK_RE = /(?:https?:\/\/|www\.)[^\s<>"` ]+/gi;

/**
 * Punctuation that ends a sentence, not an address, and the closing stars of
 * a bold or italic address (`**https://…**`), which are the text's own marks.
 */
const TRAILING = ".,;:!?'\"»›…-]}>*";

function parensBalanced(url: string): boolean {
  let depth = 0;
  for (const ch of url) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  return depth === 0 && url.includes("(");
}

/**
 * "see https://example.com/a." — the full stop belongs to the sentence. But
 * "…/wiki/Kanel_(krydda)" keeps its bracket, because it opened inside the URL.
 */
function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (ch === ")") {
      if (parensBalanced(url.slice(0, end))) break;
    } else if (!TRAILING.includes(ch)) {
      break;
    }
    end--;
  }
  return url.slice(0, end);
}

function hrefFor(url: string): string {
  return url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
}

/** Splits text into prose and link runs, in order, losing nothing. */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;

  LINK_RE.lastIndex = 0;
  for (let m = LINK_RE.exec(text); m !== null; m = LINK_RE.exec(text)) {
    const url = trimTrailing(m[0]);
    // A bare "www." with nothing after it is not an address.
    if (url.length < 5 || !url.includes(".")) {
      LINK_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index), href: null });
    out.push({ text: url, href: hrefFor(url) });
    last = m.index + url.length;
    LINK_RE.lastIndex = last;
  }

  if (last < text.length) out.push({ text: text.slice(last), href: null });
  return out;
}

/**
 * Every address in the note, in order.
 *
 * `linkify` is the one scanner, so everything that wants to know about links
 * asks it rather than carrying a second regex. `face.ts` used to carry that
 * second regex — narrower, http-only — and the disagreement was visible on the
 * board: a note whose only address was a bare "www." host had three card lines
 * reserved for a link preview by one definition and no link face drawn by the
 * other, so the card came out three lines short with blank space where the
 * preview should have been. It also never reached the Links board.
 */
function linksIn(text: string): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  for (const segment of linkify(text)) {
    if (segment.href) out.push({ text: segment.text, href: segment.href });
  }
  return out;
}

/** How many addresses the note carries — the footer's link count. */
export function countLinks(text: string): number {
  return linksIn(text).length;
}

/** The first address, which is the one a link card names its domain from. */
export function firstLink(text: string): { text: string; href: string } | null {
  return linksIn(text)[0] ?? null;
}

/**
 * What an address is *the same as*, for asking whether it is already saved.
 *
 * Two spellings of one page must meet, and two pages must not: the scheme,
 * a leading `www.`, the case of the host, a trailing slash and the fragment
 * are how a link happens to have been copied, and none of them names a
 * different page — but the path and the query do, so both are kept exactly
 * as written. `https://www.example.com/a/#top` and `http://example.com/a`
 * are one key; `example.com/a?id=2` is another. An address `URL` cannot
 * parse keeps itself, lowercased and without its slash, so it can still meet
 * its own copy.
 */
export function addressKey(href: string): string {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "");
    const port = url.port ? `:${url.port}` : "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${port}${path}${url.search}`;
  } catch {
    return href.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }
}

/** Every address in the text, as the key `addressKey` gives it, in order. */
export function addressKeys(text: string): string[] {
  return linksIn(text).map((link) => addressKey(link.href));
}

/**
 * The site an address belongs to, said the way a person says it — `www.`
 * dropped, nothing else touched.
 *
 * One definition, because two things ask the question and they must never
 * answer it differently: the unfurl a card and the open note draw their domain
 * from, and the Links row's footer, which stands the site under every row on
 * the board. An address `URL` cannot parse keeps itself as its own label — it
 * is a note the user wrote, not a request we are about to make.
 */
export function domainFor(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/**
 * What is left of an address once its site has been named: the path, and the
 * query where it carries one. `null` for a bare host, which has nothing more
 * to say than its domain.
 *
 * This is what a Links row puts in the footer when the *name* of the row has
 * already had to fall back to the domain — a note that is nothing but an
 * address would otherwise print one word twice, once in each half of the row.
 */
export function pathLabel(href: string): string | null {
  try {
    const url = new URL(href);
    const tail = `${url.pathname}${url.search}`.replace(/\/$/, "");
    return tail === "" ? null : tail;
  } catch {
    return null;
  }
}

/**
 * Whether a title is just the site saying its own name.
 *
 * An `og:title` of "www.youtube.com" is a page that declined to say what it is,
 * and drawn as a row's name over a footer reading "youtube.com" it is the one
 * word on screen twice. `www.` and a trailing slash are noise on both sides of
 * the comparison, so both come off before it is made.
 */
export function namesTheSite(title: string, domain: string): boolean {
  const tidy = (s: string) => s.trim().toLowerCase().replace(/^www\./, "").replace(/\/$/, "");
  return tidy(title) === tidy(domain);
}

/**
 * Keep's own prefix on an imported saved link — the importer's words, not the
 * user's. The one definition: `face.ts` strips it with this too. It was written
 * twice, and the copy here let `\s` run across line breaks while the card's
 * did not, so the two could disagree about where the prefix ended. Spaces and
 * tabs only, at the start of any line (`m`), is what Keep actually writes.
 */
export const SAVED_LINK_PREFIX = /^[ \t]*Saved link:[ \t]*/im;

/**
 * A separator left standing on its own once the address beside it has been
 * lifted out — "Kanelbullar — " with the URL gone, or the bullet in front of
 * "- Spot 3". It is layout, not a name, at either end.
 */
const DANGLING = /^[\s|—:–\-•*]+|[\s|—:–\-•*]+$/g;

/**
 * The words that name **one** address — the title a local unfurl carries until
 * the page's own `og:title` arrives, and the name a Links row opens with.
 *
 * Three questions, in this order, and the first one that answers wins.
 *
 * 1. **The address's own line** — what stands in front of it there, or behind
 *    it when nothing stands in front — and only when that line holds exactly
 *    one address. This is the fix of 2026-09-19.
 *    Every name used to be cut from `text.slice(0, offset)`, *everything before
 *    the link*, so in a note of ten fishing spots the second spot was called
 *    "Spot 1 https://maps.app.goo.gl/… Spot 2" and spots three to ten were all
 *    called the same 90-character run off the top of the note, ellipsis and
 *    all. Ten links, one legible name between them. A line is the unit a person
 *    writes a list in, so a line is what names its address.
 * 2. **Whatever was written since the previous address**, which is what the
 *    rule above has always been for the first link in a note and still is: a
 *    Keep import reads `Saved link: Kanelbullar — https://…`, and a note that
 *    opens with two lines of prose and ends in a URL is named by those lines.
 *    Bounded at the previous address so it can never again reach back over one.
 * 3. **The site itself.** A note that is nothing but an address has no name of
 *    its own to give, and the domain is the honest answer.
 *
 * `from` is where the previous address ended, `start`–`end` where this one sits.
 */
function nameFor(text: string, from: number, start: number, end: number): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineBreak = text.indexOf("\n", end);
  const lineEnd = lineBreak === -1 ? text.length : lineBreak;
  // Two addresses on one line cannot both be named by it — "a and b" names
  // neither — so such a line is left to the question below.
  if (countLinks(text.slice(lineStart, lineEnd)) === 1) {
    // In front of the address first, which is where a person writes the name
    // of a thing: "Row fit test https://… and a line of my own" is named by
    // its first three words, not by the whole sentence with a hole in it.
    const before = tidyName(text.slice(lineStart, start));
    if (before) return before;
    // Behind it only when there is nothing in front — "https://… north bay".
    const after = tidyName(text.slice(end, lineEnd));
    if (after) return after;
  }
  return tidyName(text.slice(from, start));
}

/** One run of words, ready to stand as a name: no prefix, one line, no dangling marks. */
function tidyName(raw: string): string {
  return raw.replace(SAVED_LINK_PREFIX, "").replace(/\s+/g, " ").replace(DANGLING, "");
}

/** Builds a local unfurl from the words already saved with the URL. */
export function previewsFor(text: string): LinkPreviewData[] {
  const segments = linkify(text);
  const out: LinkPreviewData[] = [];
  const seen = new Set<string>();
  let offset = 0;
  // Where the last address ended, so a name can never be cut from text that
  // belongs to the address before it.
  let since = 0;
  for (const segment of segments) {
    const end = offset + segment.text.length;
    if (segment.href) {
      if (seen.has(segment.href)) {
        offset = end;
        since = end;
        continue;
      }
      seen.add(segment.href);
      let title = nameFor(text, since, offset, end);
      const domain = domainFor(segment.href);
      // Cut by character, never inside an emoji: half of one is a lone
      // surrogate, which the server's JSON column refuses.
      if (title.length > 90) title = `${Array.from(title).slice(0, 87).join("")}...`;
      if (!title) title = domain;
      out.push({
        href: segment.href,
        domain,
        title,
        description: null,
        image: null,
        fetched_at: null,
      });
      since = end;
    }
    offset = end;
  }
  return out;
}

/**
 * Whether a link box's title adds nothing to what the card already shows
 * (review 2026-10-24, PL-05). Until a page's own title arrives — offline, or a
 * site that refuses — the box is titled with the words beside the address
 * (`nameFor`), and the card draws those same words as its lines: said twice.
 * With no words at all it is titled with the site, which the box's domain row
 * says already. True while the title is still the local one and is either the
 * site, or words that are on the face. Whitespace is read as one space.
 */
export function titleAddsNothing(
  preview: LinkPreviewData,
  local: LinkPreviewData | undefined,
  words: string,
): boolean {
  if (preview.title === preview.domain) return true;
  if (!local || preview.title !== local.title) return false;
  // `previewsFor` ends a long title in an ellipsis; the note does not.
  const head = local.title.replace(/\.{3}$/, "");
  return head !== "" && words.replace(/\s+/g, " ").includes(head);
}

/**
 * The previews a note draws: the local unfurl for every address in its text,
 * each overlaid with whatever the server has since saved for that address.
 *
 * One definition, because three surfaces drew it — the card, the canvas
 * note and the open note — and each had its own copy of the same six lines,
 * one of them running unmemoised on every card render. The text is the
 * source of truth for *which* links there are; a saved preview for an
 * address no longer in the note is not drawn.
 */
export function mergedPreviews(
  text: string,
  saved: LinkPreview[] | null | undefined,
): LinkPreviewData[] {
  return overlaySaved(previewsFor(text), saved);
}

/** The overlay half of `mergedPreviews`, for a caller that already holds the local unfurls. */
export function overlaySaved(
  locals: LinkPreviewData[],
  saved: LinkPreview[] | null | undefined,
): LinkPreviewData[] {
  const byHref = new Map((saved ?? []).map((preview) => [preview.href, preview]));
  return locals.map((local) => {
    const stored = byHref.get(local.href);
    return stored ? { ...local, ...stored } : local;
  });
}

/** The previews the owner has not put away. */
export function visiblePreviews(previews: readonly LinkPreviewData[]): LinkPreviewData[] {
  return previews.filter((preview) => preview.hidden !== true);
}

/** How many of the drawn previews the owner has hidden. */
export function hiddenCount(previews: readonly LinkPreviewData[]): number {
  return previews.length - visiblePreviews(previews).length;
}

/**
 * The note's stored previews with the given addresses hidden, or shown again.
 * `null` when nothing would change, so a caller neither writes nor offers an
 * undo for a press that did nothing.
 *
 * Hiding sets `hidden: true` on that address's entry and **creates the entry**
 * when the link has never been stored (it is drawn from the text until an
 * unfurl lands), built from what is drawn now. Every other entry is spread
 * through whole, so fields this build does not know survive. An address that
 * is not in the text is ignored: the text says which links there are.
 *
 * Showing takes the key off instead of writing `false`, and drops an entry
 * that was only ever made to carry the flag (it has never been fetched),
 * since such an entry would otherwise freeze the title the text gave it
 * through `overlaySaved`. The note's text is never touched either way.
 */
export function withPreviewsHidden(
  body: string,
  saved: readonly LinkPreview[] | null | undefined,
  hrefs: readonly string[],
  hide: boolean,
): LinkPreview[] | null {
  const wanted = new Set(hrefs);
  const drawn = mergedPreviews(body, saved as LinkPreview[] | undefined);
  const inText = new Map(drawn.map((preview) => [preview.href, preview]));
  const out: LinkPreview[] = [];
  let changed = false;
  const storedHrefs = new Set<string>();
  for (const entry of saved ?? []) {
    storedHrefs.add(entry.href);
    if (!wanted.has(entry.href)) {
      out.push(entry);
    } else if (hide) {
      if (!inText.has(entry.href) || entry.hidden === true) out.push(entry);
      else {
        out.push({ ...entry, hidden: true });
        changed = true;
      }
    } else if (entry.hidden === true) {
      changed = true;
      if (entry.fetched_at) {
        const { hidden: _gone, ...rest } = entry;
        out.push(rest);
      }
    } else {
      out.push(entry);
    }
  }
  if (hide) {
    for (const href of wanted) {
      const local = inText.get(href);
      if (!local || storedHrefs.has(href)) continue;
      out.push({ ...local, hidden: true });
      changed = true;
    }
  }
  return changed ? out : null;
}

/**
 * The moment the whole pipeline — server fetch *and* client shrink — last
 * learned to deliver a picture. A stored preview stamped before this says
 * nothing about whether its page has an og:image, so `needsUnfurl` grants
 * each one a single fresh ask; left alone they would keep their empty picture
 * forever, because the fetch is gated on `fetched_at` and theirs is set.
 *
 * Three times moved, for three different faults. 2026-08-15: the function had
 * been answering `image: null` for every page there has ever been. 2026-08-19:
 * the function was answering with pictures, and the deployed client dropped
 * every one — `thumbFromDataUrl` reached its own data URL through `fetch()`,
 * which the production Content-Security-Policy refuses — then stamped the
 * preview "asked, no picture". 2026-09-04: two faults at once, found together.
 * The function's CORS allowlist still named the Vercel address after the app
 * moved to the server on 2026-09-01, so from that day *no* unfurl reached the
 * client at all — that is the whole of the outage. Loosened alongside it, and
 * the reason the window re-opens over the older stamps too: the og:image was
 * being fetched under a one-megabyte cap and a five-second clock it shared
 * with the page fetch, either of which quietly turns a page that has a picture
 * into a page recorded as having none. Every stamp written in each window is a
 * statement about the bug, not about the page, so the window is re-opened
 * once.
 */
export const PREVIEW_IMAGE_SINCE = "2026-09-04T20:00:00.000Z";

/**
 * The long edge of a link picture **stored for the Inspiration wall** — larger
 * than `PREVIEW_THUMB_PX` because a wall tile is a column wide (~240–300px) and
 * 200 was visibly soft there, and because the wall's viewer opens it at the
 * size of the screen: at 480 (until 2026-10-09) a picture filled a desktop
 * screen at more than twice its pixels and looked it. About 80–150 kB a
 * picture, and paid on every pull, so it is stored this size **only for a note
 * on Inspiration** — a board of a few dozen — and everywhere else a link
 * picture stays 200; an attachment's own thumbnail stays capped at 320
 * (`THUMB_PX`) — never raise that one, the wall reads the local decode instead.
 */
export const WALL_THUMB_PX = 1080;

/**
 * How many unfurls may be on the wire at once.
 *
 * Small on purpose. An unfurl is background enrichment for a preview that is
 * already rendering from the note's own words, so there is no moment a user
 * is waiting on one — the only thing concurrency buys is finishing a backlog
 * sooner, and the backlog only exists on the one load after a rule like
 * `PREVIEW_IMAGE_SINCE` widens what is eligible. Three keeps that load from
 * arriving at the edge function as a thirty-request burst.
 */
export const UNFURL_AT_ONCE = 3;

/**
 * Wall answers stamped before this moment were given by a function that could
 * not yet read Reddit's feed or a Pinterest pin, read only half a megabyte of a
 * page, and took no screenshots (2026-10-09). Each such wall entry is asked
 * once more — the answer stamps a newer `wall_asked_at`, so it is once, not on
 * every open. Moved only alongside a function change that would answer an old
 * wall question differently — or alongside a client fix that makes an old
 * answer worth having again: moved to 09:05 the same day because the burst of
 * re-asks this set off drew every wall picture as a solid black box (see
 * `BLANK_PICTURES_FROM`), and one pin had been asked just before the new
 * function went live. Moved again to 18:37 with `WALL_THUMB_PX` going from 480
 * to 1080, so every picture already on the wall is asked for at the new size.
 * Moved again to 2026-10-10 20:00 (audit BUG-1): until then a see-through
 * picture was shrunk onto black, so each wall picture is asked for once more
 * and comes back on white. Only the wall's own pictures — the link a tile
 * shows — are re-asked; the small previews elsewhere are left as they are,
 * and a re-ask that brings no picture keeps the one already stored.
 */
export const WALL_PICTURE_SINCE = "2026-10-10T20:00:00.000Z";

/**
 * Pictures shrunk from this moment until `WALL_PICTURE_SINCE` may be solid black, and each is
 * asked about once more, on the wall or off it (2026-10-09). The deploy at the
 * first moment set a dozen unfurls going at once in one browser, whose canvas
 * drew nothing; an empty canvas encodes as a black JPEG, and that was stored and
 * synced as the link's picture (`DREW_BLANK` in `lib/files.ts` now refuses it).
 * A stored picture from inside the window is known bad, so a re-ask that
 * brings no picture clears it rather than keeping it (`useLinkUnfurl`, which
 * asks `needsUnfurl` of the stored entry for that).
 */
export const BLANK_PICTURES_FROM = "2026-10-09T08:54:00.000Z";
/**
 * The end of that window: the fixed client went live at 09:05. Its own
 * constant since `WALL_PICTURE_SINCE` moved again the same day (the 1080px wall
 * pictures), which must re-ask wall entries and must not reach back and call
 * every link picture shrunk this morning black.
 */
export const BLANK_PICTURES_UNTIL = "2026-10-09T09:05:00.000Z";

/** A stored picture shrunk inside the black-picture window — known bad, never worth keeping. */
export function blackWindowPicture(stored: LinkPreviewData): boolean {
  const at = stored.fetched_at;
  return Boolean(stored.image) && at !== null && at >= BLANK_PICTURES_FROM && at < BLANK_PICTURES_UNTIL;
}

/**
 * The entry with a black-window picture taken out, and the size that described
 * it; any other entry as it is. For the answers that keep the stored entry —
 * a page refused (400/413/415) or gone — which used to stamp a fresh
 * `fetched_at` over the black box and so keep it for good (audit BUG-9).
 */
export function withoutBlackPicture(stored: LinkPreviewData): LinkPreviewData {
  if (!blackWindowPicture(stored)) return stored;
  const clean = { ...stored, image: null };
  delete clean.width;
  delete clean.height;
  delete clean.thumb_px;
  return clean;
}

/**
 * Which of a wall note's links the wall shows a picture of, and so the only one
 * whose picture is asked for and stored at the wall's size (audit BUG-7,
 * 2026-10-10). `previews` is what the note draws (`overlaySaved` over
 * `previewsFor`), in its own order; `showsFile` is true when the tile wears one
 * of the note's own files instead, and then no link is the wall's.
 *
 * The tile wears the first shown link that has a picture (`wallFace`). Before
 * any answer that is unknown, so the first shown link still waiting for its
 * answer counts as well: a link already answered with no picture is passed
 * over for the next. Ten links used to be ten 1080px pictures in the row, ten
 * screenshot calls and megabytes re-sent on every edit, for one tile.
 */
export function wallLinkHref(previews: readonly LinkPreviewData[], showsFile: boolean): string | null {
  if (showsFile) return null;
  const shown = previews.find(
    (p) => p.hidden !== true && ((typeof p.image === "string" && p.image !== "") || needsUnfurl(p)),
  );
  return shown?.href ?? null;
}

/**
 * Whether this link is still worth asking the server about.
 *
 * Never fetched → yes, the ordinary case. Fetched, but before pictures
 * existed *and* holding none → yes, exactly once: the answer that comes back
 * carries today's `fetched_at`, so the next open sees a modern preview and
 * leaves it alone whether or not it found a picture. A page that genuinely
 * has no og:image therefore costs one extra request in its whole life, not
 * one every time the app opens.
 *
 * **On the Inspiration wall, one more reason** (`onWall`, 2026-10-08): the entry
 * was fetched before the function could say what the picture *is*
 * (`media === undefined`), or its picture is stored at the small size and the
 * wall wants `WALL_THUMB_PX`. Either asks once: the write that follows carries
 * `wall_asked_at` whatever the answer held, so a function not yet deployed, or
 * a page with nothing bigger to give, is never fetched again on every open. A
 * page marked gone is left to the monthly re-check, which asks in full.
 * A wall entry asked before `WALL_PICTURE_SINCE` is asked once more, and so is
 * any picture shrunk in the black-picture window (`BLANK_PICTURES_FROM` to
 * `BLANK_PICTURES_UNTIL`).
 */
export function needsUnfurl(stored: LinkPreviewData | undefined, onWall = false): boolean {
  if (!stored?.fetched_at) return true;
  if (stored.image === null && stored.fetched_at < PREVIEW_IMAGE_SINCE) return true;
  if (blackWindowPicture(stored)) return true;
  if (!onWall || stored.gone) return false;
  if (stored.wall_asked_at) return stored.wall_asked_at < WALL_PICTURE_SINCE;
  if (stored.media === undefined) return true;
  return stored.image !== null && (stored.thumb_px ?? 0) < WALL_THUMB_PX;
}

/**
 * How long a link's last answer stands before the app asks again whether the
 * page is still there.
 *
 * A preview is fetched once, so without this a page that died after it was
 * saved would go on wearing the title and picture it had the day it was
 * alive, for ever. A month is slow enough that a link costs about a dozen
 * requests a year, and fast enough that the "gone" beside it is never more
 * than a few weeks behind the page.
 */
export const RECHECK_DAYS = 30;

/**
 * How many links one open of the app re-asks about, at most.
 *
 * The backlog is the whole archive the first time — a quarter of it is saved
 * links — and this is background work nobody is waiting on. Five an open
 * walks a hundred links in twenty opens and never arrives at the function as
 * a burst; each one is then quiet for `RECHECK_DAYS`.
 */
export const RECHECK_AT_ONCE = 5;

/** When the app last heard anything about this link: the later of the fetch and the re-check. */
export function lastAsked(preview: LinkPreviewData): string | null {
  const { fetched_at: fetched, checked_at: checked } = preview;
  if (!checked) return fetched;
  if (!fetched) return checked;
  return Date.parse(checked) > Date.parse(fetched) ? checked : fetched;
}

/**
 * The links worth asking again about, oldest answer first, at most `limit`.
 *
 * Only a link that has an answer to be stale — anything `needsUnfurl` still
 * wants is the first-time scan's, and asking twice would be two requests for
 * one link — and only a link still in the note's text, since a preview for an
 * address that was edited out is kept but never drawn. A note in the trash is
 * skipped for the reason the first-time scan skips it: a write there restamps
 * `updated_at`, which is what the trash counts its thirty days from. Archived
 * notes are in; they are still found by search, and a dead link is still
 * worth knowing about there.
 */
export function dueForRecheck(
  notes: readonly { id: string; body: string; status: string; link_previews?: LinkPreview[] }[],
  now: number,
  limit = RECHECK_AT_ONCE,
): { noteId: string; href: string }[] {
  const before = now - RECHECK_DAYS * 86_400_000;
  const due: { noteId: string; href: string; at: number }[] = [];
  for (const note of notes) {
    if (note.status === "trashed" || !note.link_previews?.length) continue;
    let inText: Set<string> | null = null;
    for (const preview of note.link_previews) {
      if (needsUnfurl(preview)) continue;
      const at = Date.parse(lastAsked(preview) ?? "");
      if (!Number.isFinite(at) || at > before) continue;
      // The body is walked only for a note that has something due, and once.
      inText ??= new Set(linksIn(note.body).map((link) => link.href));
      if (!inText.has(preview.href)) continue;
      due.push({ noteId: note.id, href: preview.href, at });
    }
  }
  return due
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map(({ noteId, href }) => ({ noteId, href }));
}

/** How many of the note's addresses answered 404 or 410 the last time they were asked. */
export function goneCount(previews: readonly LinkPreviewData[]): number {
  let n = 0;
  for (const preview of previews) if (preview.gone) n++;
  return n;
}
