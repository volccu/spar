// link-preview — fetches public Open Graph metadata for one URL.
//
// The browser cannot reliably read another site's HTML because of CORS. This
// function keeps that network work off the note hot path and returns only
// optional preview metadata. The client still renders a local fallback when
// this function is unavailable.

import { userIdFromRequest } from "../_shared/auth.ts";
import { pageVerdict, wantsPicture } from "../_shared/linkStatus.ts";
import {
  bestRedditStream,
  imgurMedia,
  isFrontPage,
  mediaPlan,
  parseOembed,
  parseRedditEmbed,
  parseRedditFeed,
  parseRedditPost,
  pinterestMedia,
  redditFeedMedia,
  redditPlaylistUrl,
  redditShareCard,
  screenshotUrl,
  vimeoMedia,
  weakPicture,
  youtubeMedia,
  type SiteMedia,
} from "../_shared/media.ts";
import { allowedOrigins } from "../_shared/origins.ts";
import { judgeUrl, publicUrl as checkedUrl } from "../_shared/netguard.ts";
import { readCapped, readHtml, readMeta } from "../_shared/pageMeta.ts";
import { PREVIEW_BURST, PREVIEW_REFILL_MS, TokenBucket } from "../_shared/rateLimit.ts";

// How far into a page its tags are looked for. It was half a megabyte, which
// is plenty for a page that puts its Open Graph tags in the `<head>` where they
// belong — and Pinterest, measured 2026-10-09, serves a 1.5 MB page with its
// og:image 1.4 MB in, after the app's whole inline state. Two megabytes is still
// a bounded read, and the page is read once.
const MAX_HTML = 2 * 1024 * 1024;
// The picture is optional enrichment carried inside the note row forever
// after the client shrinks it (see thumbFromDataUrl in web/src/lib/files.ts),
// so the raw fetch here only has to be small enough to shrink — not small
// enough to store. Anything over this is skipped, never failed.
//
// It was 1 MB. Measured across a handful of real pages the og:images came in
// at 6-176 kB, so the cap was rarely what stopped a picture — but a full-size
// hero photograph off a shop or a news site does clear a megabyte, and every
// one of those was skipped and then written down as "asked, answered, no
// picture", which is a stamp that never comes off. The cap exists so one page
// cannot pull an arbitrary download through here; it is not a quality bar.
const MAX_IMAGE = 3 * 1024 * 1024;
// The JSON a site answers a media question with (a Reddit post, an oEmbed).
// Small by nature; anything over this is not what was asked for.
const MAX_JSON = 1024 * 1024;
const JSON_TIMEOUT_MS = 8_000;
// A screenshot is a real browser loading the page somewhere else, so it gets
// its own, longer clock. Measured at about two seconds; a cold one is slower.
const SCREENSHOT_TIMEOUT_MS = 25_000;
// The owner's switch for the wall's screenshots: `supabase secrets set
// SCREENSHOTS=off` turns them off without a deploy. On by default (2026-10-09).
const SCREENSHOTS = Deno.env.get("SCREENSHOTS") !== "off";
// One clock for the page and a second, separate one for the picture. They
// used to share a single 5-second AbortController, so a page that took four
// seconds to answer left its og:image one second to arrive in — the picture
// was lost to the page's own slowness, which is the opposite of what a
// timeout is for.
const TIMEOUT_MS = 8_000;
const IMAGE_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
// "Mozilla/5.0 (compatible; …)" is the shape every well-behaved unfurler
// announces itself with. A bare made-up token reads as a scraper to the
// simplest bot walls and got this fetcher turned away from pages that serve
// their Open Graph tags to any named bot; the name still says exactly who is
// asking. IP-reputation walls (Cloudflare challenges) are not defeated by
// this, or by anything else worth doing — those pages keep their word-only
// preview, which is the designed fallback, not a failure.
const USER_AGENT = "Mozilla/5.0 (compatible; spar-link-preview/1.0)";
// Every origin the app is actually served from — and the reason previews
// stopped unfurling altogether on 2026-09-01. The app moved off Vercel onto
// the server's own nginx, and this list did not move with it. The failure is
// invisible from here: Supabase's gateway answers the CORS preflight itself,
// with `*`, before this function runs, so the request goes out and is answered
// normally — and then the browser throws that answer away for carrying no
// `access-control-allow-origin`. The client sees a transport failure, writes
// nothing, and asks again on the next open, forever. What the owner sees is
// that link pictures stopped appearing, because the preview goes on rendering
// from the note's own words whatever happens out here.
//
// **A new address for the app is a change to the `ALLOWED_ORIGINS` secret**
// (comma-separated, `supabase secrets set`). It is read when an instance of
// this function starts. The local dev server is always allowed.
const ALLOWED_ORIGINS = allowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));
const CORS = {
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json",
};

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  return origin && ALLOWED_ORIGINS.has(origin)
    ? { ...CORS, "access-control-allow-origin": origin, vary: "Origin" }
    : CORS;
}

function json(body: unknown, status: number, req: Request) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

/**
 * Reject domains resolving to private/reserved addresses, not just literals —
 * `_shared/netguard.ts`, the self-hosted server's rules (audit SEC-3): ports
 * 80 and 443 only, every IPv6 literal refused, and a name refused if any of its
 * A or AAAA answers is private, NAT64, 6to4 and Teredo included.
 *
 * **DNS rebinding remains a residual risk here.** Deno's `fetch` resolves the
 * name again on its own and cannot be pinned to the address checked, so a name
 * that answers differently the second time is not caught; asking again before
 * every request and every redirect narrows that window and does not close it.
 */
function publicUrl(raw: unknown): Promise<URL | null> {
  return checkedUrl(raw, (hostname, type) => Deno.resolveDns(hostname, type));
}

/** `publicUrl`, keeping a failed lookup apart from a refusal (`judgeUrl`). */
function judgedUrl(raw: unknown): Promise<URL | null | "lookup-failed"> {
  return judgeUrl(raw, (hostname, type) => Deno.resolveDns(hostname, type));
}

/** A name that could not be looked up this time: 502, which the app asks again after. */
const LOOKUP_FAILED = { error: "The address could not be looked up" };

/**
 * Per user, per isolate — see `_shared/rateLimit.ts` for how soft that is.
 * Answered 429, which the app re-asks on a later open.
 */
const previews = new TokenBucket(PREVIEW_BURST, PREVIEW_REFILL_MS);

/** Chunked, so a megabyte of bytes never lands in one `String.fromCharCode` call. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Fetches an og:image (or twitter:image) and returns it as a small data URL,
 * or `null` on any failure. A raw og:image URL handed to the client would be
 * fetched by the browser later, outside every check below — so the bytes are
 * pulled through here instead and handed over already-embedded, the same
 * contract `Attachment.thumb` uses for a dropped file.
 *
 * Every exit is `null`, never a throw: a preview without a picture is the
 * normal, fine outcome, and a link that will not unfurl an image must never
 * fail the note.
 */
async function fetchImage(raw: string, pageUrl: URL): Promise<string | null> {
  let resolved: URL;
  try {
    resolved = new URL(raw, pageUrl);
  } catch {
    return null;
  }

  const current = await publicUrl(resolved.toString());
  if (!current) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    return await pullImage(current, pageUrl, controller);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The redirect walk itself, split out only so `fetchImage` can own the clock
 * around it and still have one `return` to clear it on.
 */
async function pullImage(start: URL, pageUrl: URL, controller: AbortController): Promise<string | null> {
  let current = start;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    // Re-checked on every hop, exactly like the page fetch: the same
    // redirect/rebinding window applies to the image URL too.
    const checked = await publicUrl(current.toString());
    if (!checked) return null;
    current = checked;

    let response: Response;
    try {
      response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        // Some CDNs serve an og:image only to a request that says which page
        // it was linked from — without this they answer 403 and the picture
        // is lost to a hotlink guard the page never meant to point at us.
        headers: { accept: "image/*", "user-agent": USER_AGENT, referer: pageUrl.toString() },
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      if (redirects === MAX_REDIRECTS) return null;
      const location = response.headers.get("location");
      const next = location ? await publicUrl(new URL(location, current).toString()) : null;
      if (!next) return null;
      current = next;
      continue;
    }

    if (!response.ok) return null;
    return await dataUrlOf(response);
  }
  return null;
}

/**
 * A response that should be a picture, as a data URL — or null. The caps are the
 * same everywhere a picture is read: `image/*` only, `MAX_IMAGE` bytes whole.
 */
async function dataUrlOf(response: Response): Promise<string | null> {
  const type = response.headers.get("content-type") ?? "";
  const mime = type.split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) return null;
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_IMAGE) return null;
  const bytes = await readCapped(response, MAX_IMAGE);
  if (!bytes) return null;
  return `data:${mime};base64,${toBase64(bytes)}`;
}

/**
 * Fetches a small JSON answer from a *fixed* site address (a Reddit post's
 * `.json`, an oEmbed). Every hop is re-checked as public exactly as the page
 * fetch is, redirects are walked by hand, and the body is capped. Every failure
 * is `null` — the caller then takes the generic path, which is the whole
 * fallback: Reddit refuses some cloud addresses and the tile is a title card,
 * no worse than before.
 */
async function fetchJson(raw: string): Promise<unknown> {
  const body = await fetchText(raw, "application/json");
  try {
    return body === null ? null : JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * The same guarded fetch as `fetchJson`, answered as text — a Reddit post's
 * feed, a video's playlist. Every failure is `null`.
 */
async function fetchText(raw: string, accept: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JSON_TIMEOUT_MS);
  try {
    let current = await publicUrl(raw);
    for (let hops = 0; current && hops <= MAX_REDIRECTS; hops++) {
      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { accept, "user-agent": USER_AGENT },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        current = location ? await publicUrl(new URL(location, current).toString()) : null;
        continue;
      }
      if (!response.ok) return null;
      const bytes = await readCapped(response, MAX_JSON);
      return bytes ? new TextDecoder().decode(bytes) : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * A screenshot of the page, for a link on the Inspiration wall — through the
 * same guarded picture fetch as an og:image, on a clock of its own. Null when
 * screenshots are switched off or the service will not give one.
 */
async function screenshot(page: URL): Promise<string | null> {
  if (!SCREENSHOTS) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCREENSHOT_TIMEOUT_MS);
  try {
    const start = await publicUrl(screenshotUrl(page));
    return start ? await pullImage(start, page, controller) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** The first candidate address that yields picture bytes, through the guarded fetch. */
async function firstPicture(candidates: string[], pageUrl: URL): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const data = await fetchImage(candidate, pageUrl);
      if (data) return data;
    } catch {
      // `fetchImage` never throws on a failure it knows; this is the guarantee.
    }
  }
  return null;
}

/**
 * What the site itself says about this address, or null — in which case the
 * generic path runs. Only asked for a full unfurl (`wantsPicture`): a re-check
 * is a verdict, and the page's own HTML status is the verdict.
 */
async function siteMedia(url: URL): Promise<Record<string, unknown> | null> {
  const plan = mediaPlan(url);
  if (!plan) return null;
  // Each site's ways of answering, best first. The first one that names a
  // picture *and* yields its bytes wins; the title found on the way is kept for
  // an answer — Reddit's share card — that carries none of its own.
  const attempts: (() => Promise<SiteMedia | null>)[] = [];
  let title: string | null = null;
  // A video post's stream, from its playlist — silent, at most 720 high.
  const redditStream = async (videoId: string | null) =>
    videoId ? bestRedditStream(await fetchText(redditPlaylistUrl(videoId), "application/dash+xml"), videoId) : null;
  if (plan.site === "reddit") {
    attempts.push(
      async () => {
        const [page, oembed] = await Promise.all([fetchText(plan.embed, "text/html"), fetchJson(plan.oembed)]);
        title ??= parseOembed(oembed)?.title ?? null;
        const post = parseRedditEmbed(page, title);
        return redditFeedMedia(post, await redditStream(post?.videoId ?? null));
      },
      async () => {
        const post = parseRedditFeed(await fetchText(plan.feed, "application/atom+xml"));
        return redditFeedMedia(post, await redditStream(post?.videoId ?? null));
      },
      async () => parseRedditPost(await fetchJson(plan.json)),
      () => Promise.resolve(redditShareCard(plan.id)),
    );
  } else if (plan.site === "pinterest") {
    attempts.push(async () => pinterestMedia(parseOembed(await fetchJson(plan.oembed))));
  } else if (plan.site === "youtube") {
    attempts.push(async () => youtubeMedia(plan.id, parseOembed(await fetchJson(plan.oembed))?.title ?? null));
  } else if (plan.site === "vimeo") {
    attempts.push(async () => vimeoMedia(plan.id, parseOembed(await fetchJson(plan.oembed))));
  } else {
    attempts.push(() => Promise.resolve(imgurMedia(plan.image)));
  }

  for (const attempt of attempts) {
    let found: SiteMedia | null = null;
    try {
      found = await attempt();
    } catch {
      found = null;
    }
    if (!found) continue;
    title ??= found.title;
    const image = await firstPicture(found.images, url);
    if (!image) continue;
    return {
      url: url.toString(),
      title: found.title ?? title ?? url.hostname,
      description: null,
      image,
      media: found.media,
      width: found.width,
      height: found.height,
      video: found.video,
    };
  }
  return null;
}

async function metadata(html: string, url: URL, picture: boolean) {
  // The page's own words and every picture it names, best first, tried in
  // turn below until one of them actually yields bytes (`_shared/pageMeta.ts`).
  const { title, description, candidates } = readMeta(html);

  let image: string | null = null;
  let imageFrom: string | null = null;
  // A re-check asks only whether the page is there, and never stores a
  // picture — see `wantsPicture`.
  for (const candidate of picture ? new Set(candidates) : []) {
    try {
      image = await fetchImage(candidate, url);
    } catch {
      // Belt and braces: fetchImage already returns null on every failure
      // path it knows about, but this is the guarantee that nothing here can
      // fail the preview itself.
      image = null;
    }
    if (image) {
      imageFrom = new URL(candidate, url).toString();
      break;
    }
  }
  return {
    title: title.slice(0, 200) || url.hostname,
    description: description ? description.slice(0, 500) : null,
    image,
    imageFrom,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405, req);

  const userId = await userIdFromRequest(req);
  if (!userId) {
    return json({ error: "Authentication required" }, 401, req);
  }
  const wait = previews.take(userId);
  if (wait > 0) {
    const headers = new Headers(corsHeaders(req));
    headers.set("retry-after", String(Math.ceil(wait / 1000)));
    return new Response(JSON.stringify({ error: "Too many link previews; try again shortly" }), {
      status: 429,
      headers,
    });
  }

  let body: { url?: unknown; check?: unknown; wall?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, req);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid JSON body" }, 400, req);
  }
  const url = await judgedUrl(body.url);
  if (url === "lookup-failed") return json(LOOKUP_FAILED, 502, req);
  if (!url) return json({ error: "Only public http(s) URLs are supported" }, 400, req);

  // Sites we can say more about than their HTML does. Only for a full unfurl,
  // and only trusted when it found a picture; anything else falls through to the
  // page fetch below, unchanged.
  if (wantsPicture(body)) {
    const site = await siteMedia(url);
    if (site) return json(site, 200, req);
  }

  // A link on the Inspiration wall may be answered with a screenshot of its
  // page (owner's ruling, 2026-10-09): a front page always, any other page when
  // it offers no picture or only its logo, and a page this fetch is turned away
  // from. Only the wall asks (`wall: true`), so a link anywhere else never sends
  // its address to the screenshot service.
  const wall = wantsPicture(body) && body.wall === true;
  const shotAnswer = (image: string) =>
    json(
      { url: url.toString(), title: url.hostname, description: null, image, media: "image", width: null, height: null, video: null },
      200,
      req,
    );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let current = url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      // Resolve immediately before every request as well as when the URL is
      // first accepted. This closes the common redirect/rebinding window where
      // a hostname changes from a public address to an internal one.
      const checked = await judgedUrl(current.toString());
      if (checked === "lookup-failed") return json(LOOKUP_FAILED, 502, req);
      if (!checked) return json({ error: "The request target is not public" }, 400, req);
      current = checked;
      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": USER_AGENT,
        },
      });

      const verdict = pageVerdict(response.status);
      if (verdict === "redirect") {
        if (redirects === MAX_REDIRECTS) return json({ error: "Too many redirects" }, 502, req);
        const location = response.headers.get("location");
        const next = location ? await judgedUrl(new URL(location, current).toString()) : null;
        if (next === "lookup-failed") return json(LOOKUP_FAILED, 502, req);
        if (!next) return json({ error: "The redirect target is not public" }, 400, req);
        current = next;
        continue;
      }

      // A page that answers 404 or 410 is not a fetch that failed — it is an
      // answer, and the one the app shows as "gone" beside the address. It
      // goes back as a 200 carrying `gone`, not as an error status, for two
      // reasons. A non-2xx is what Supabase's own gateway answers with when
      // the function never ran at all, so a status could not be told apart
      // from a cold start; and the client deployed before this existed reads
      // a 200 as "asked, answered, no picture" and writes the address's own
      // words as its title — which is the right thing to record about a page
      // that is not there, where the 502 it used to get had it asking again
      // on every open for ever. `title` is empty so that client keeps its
      // own. Every other failure below is still a 502: 403, 5xx and the rest
      // say nothing about whether the page exists (`linkStatus.ts`).
      if (verdict === "gone") {
        return json(
          { url: current.toString(), title: "", description: null, image: null, gone: true, status: response.status },
          200,
          req,
        );
      }
      if (verdict === "failed") {
        // A bot wall in front of a page is not the page. A real browser
        // elsewhere often gets past it, and on the wall its picture is enough.
        const shot = wall ? await screenshot(url) : null;
        if (shot) return shotAnswer(shot);
        return json({ error: "The page could not be fetched" }, 502, req);
      }
      const type = response.headers.get("content-type") ?? "";
      // The address is itself a picture — `i.redd.it`, `i.imgur.com`, or any
      // host that serves one. Read it as the picture it is, within the same
      // caps; a check (`wantsPicture` false) only needed the verdict above.
      if (type.toLowerCase().startsWith("image/")) {
        const image = wantsPicture(body) ? await dataUrlOf(response) : null;
        const raw = current.pathname.split("/").filter(Boolean).at(-1) ?? "";
        let leaf = raw;
        try {
          leaf = decodeURIComponent(raw);
        } catch {
          // A malformed `%` — the raw name will do as a title.
        }
        return json(
          {
            url: current.toString(),
            title: (leaf || current.hostname).slice(0, 200),
            description: null,
            image,
            media: image ? "image" : null,
            width: null,
            height: null,
            video: null,
          },
          200,
          req,
        );
      }
      // No refusal on `Content-Length` here, although there was one. `readHtml`
      // already stops at MAX_HTML bytes, and the tags this reads sit in the
      // `<head>`, so a long page is simply read as far as its first half
      // megabyte. The refusal answered 413 for any page that *announced* more,
      // and the client takes 413 as a verdict about the page and never asks
      // again — so every long article was stamped "no preview" for good.
      if (!isHtmlType(type)) {
        return json({ error: "The URL did not return a web page" }, 415, req);
      }
      const html = await readHtml(response, MAX_HTML);
      // A front page on the wall is pictured as the site, and its own share
      // picture is fetched only when no screenshot came.
      let shot = wall && isFrontPage(url) ? await screenshot(url) : null;
      const { imageFrom, ...page } = await metadata(html, current, wantsPicture(body) && !shot);
      if (wall && !shot && (!page.image || (imageFrom !== null && weakPicture(imageFrom)))) {
        shot = await screenshot(url);
      }
      return json(
        {
          url: current.toString(),
          ...page,
          image: shot ?? page.image,
          media: shot ? "image" : null,
          width: null,
          height: null,
          video: null,
        },
        200,
        req,
      );
    }
    return json({ error: "The page could not be fetched" }, 502, req);
  } catch (error) {
    const shot = wall ? await screenshot(url) : null;
    if (shot) return shotAnswer(shot);
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "The page took too long to answer"
      : "The page could not be reached";
    return json({ error: message }, 502, req);
  } finally {
    clearTimeout(timeout);
  }
});

/** A page with no Content-Type is read as HTML, as a browser would sniff it; case never matters. */
function isHtmlType(type: string): boolean {
  const t = type.toLowerCase();
  return t === "" || t.includes("text/html") || t.includes("application/xhtml+xml");
}
