// pageMeta.ts — what a fetched page says about itself: its title, its
// description and every picture it names, read out of its HTML.
//
// One copy for both backends. `link-preview` reads pages with it on Supabase
// and the self-hosted server's `server/src/linkPreview.ts` reads them with it
// too, so a page unfurls alike on either; they used to hold a copy each, said
// to be kept line for line, and had already drifted apart. Each side keeps its
// own fetching (Deno's `fetch` there, `pinnedFetch` on the server) and its own
// read cap, which is why the cap is handed in.
//
// Pure and free of imports — nothing from Deno, nothing from Node — so the
// root suite tests it (`tests/pageMeta.test.ts`) and the server's esbuild
// bundle carries it unchanged.

/**
 * The first `max` bytes of a page, as text. A longer page is cut at the cap,
 * not refused: the tags read here sit in its `<head>`.
 */
export async function readHtml(response: Response, max: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      // Kept before the check, not after it: the copy below cuts this chunk at
      // the cap. Dropped instead, the buffer was sized to the cap and filled
      // with less — and a page whose first chunk alone ran past it read as
      // half a megabyte of NULs, with no tags in it to find.
      chunks.push(next.value);
      if (total > max) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total > max ? max : total);
  let offset = 0;
  for (const chunk of chunks) {
    const end = Math.min(bytes.length, offset + chunk.byteLength);
    bytes.set(chunk.slice(0, end - offset), offset);
    offset = end;
    if (offset === bytes.length) break;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Reads a response body up to `max` bytes and returns it whole, or `null` if
 * it runs over. Unlike `readHtml`, this never truncates: a partial picture is
 * a broken one, so anything past the cap is skipped rather than cut short.
 */
export async function readCapped(response: Response, max: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * A numeric reference as a character, or U+FFFD for one that names none.
 *
 * `String.fromCodePoint` throws a RangeError past U+10FFFF, and a page carrying
 * `&#x110000;` or a twenty-digit decimal in its title took the whole handler
 * down with it: a 502, which the client rightly reads as a passing failure and
 * asks again about on every open, for ever. A lone surrogate does not throw but
 * is not a character either. Both become the replacement character, which is
 * what the HTML spec makes of them too.
 */
function codePoint(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
    ? String.fromCodePoint(n)
    : "\uFFFD";
}

export function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => codePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // `&amp;` last, or the `&` it makes is read again by the rules after it:
    // a title that *says* `&lt;` is written `&amp;lt;`, and decoded in the old
    // order it came out as `<`.
    .replace(/&amp;/gi, "&")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decode(match[2]) : null;
}

/** The first `<link rel="…">` href a page carries for this relation. */
function linkHref(html: string, rel: string): string | null {
  for (const tag of html.match(/<link\b[^>]{0,2000}>/gi) ?? []) {
    const value = attribute(tag, "rel");
    if (value && value.toLowerCase().split(/\s+/).includes(rel)) {
      const href = attribute(tag, "href");
      if (href) return href;
    }
  }
  return null;
}

/** What a page says about itself: title, description and picture candidates, best first. */
export function readMeta(fullHtml: string): { title: string; description: string | null; candidates: string[] } {
  // Everything read here lives in <head>, so a page is read no further than its
  // first 128 KB; with the length limits on each pattern below, a page made of
  // unclosed tags cannot keep the thread busy for long.
  const html = fullHtml.slice(0, 128 * 1024);
  const values = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]{0,2000}>/gi) ?? []) {
    // `itemprop` reads last because it is the least standard of the three,
    // and it is read at all because a page carrying only microdata was being
    // treated as a page carrying no picture.
    const key = attribute(tag, "property") ?? attribute(tag, "name") ?? attribute(tag, "itemprop");
    const value = attribute(tag, "content");
    if (key && value && !values.has(key.toLowerCase())) values.set(key.toLowerCase(), value);
  }
  const titleTag = html.match(/<title\b[^>]{0,2000}>([\s\S]{0,2000}?)<\/title>/i)?.[1];
  const title = values.get("og:title") ?? values.get("twitter:title") ?? (titleTag ? decode(titleTag) : "");
  const description =
    values.get("og:description") ?? values.get("twitter:description") ?? values.get("description") ?? null;
  // Every place a page says where its picture is, best first, for the caller
  // to try in turn until one of them actually yields bytes. This used to be
  // three names read with `??`, which stopped at the first one *named* rather
  // than the first one that worked: a page whose og:image was a dead URL never
  // got as far as the twitter:image standing right beside it.
  const candidates = [
    values.get("og:image"),
    values.get("og:image:url"),
    values.get("og:image:secure_url"),
    values.get("twitter:image"),
    values.get("twitter:image:src"),
    values.get("image"),
    linkHref(html, "image_src"),
  ].filter((value): value is string => typeof value === "string" && value.trim() !== "");
  return { title, description, candidates };
}
