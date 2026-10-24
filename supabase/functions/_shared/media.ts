// media.ts — what a few specific sites can say about their own picture.
//
// Pure, dependency-free and shared on purpose, as `linkStatus.ts` is: the
// `link-preview` function does the network work and reads every *decision*
// from here, and the root suite (`tests/media.test.ts`) imports this same file
// without Deno. Nothing in here fetches anything.
//
// The generic path (`og:image` → `twitter:image` → `image_src`) is unchanged
// and is what everything not named here still gets. These are the sites where
// the page's own picture is poor, absent or a login wall — Reddit's HTML is
// served to bots as a wall, YouTube's picture is a derived address, Vimeo and
// Imgur have a public answer — and where the Inspiration wall wants the post's
// picture, the way a chat app unfurls a link. X and Instagram are skipped:
// no outside service sees their posts, so those stay title cards.
//
// Reddit, 2026-10-09: the post's `.json` now answers 403 to everything that is
// not signed in — from a home connection as well as a cloud one. What still
// answers an honestly named fetcher, best first: the post's **embed page** (the
// one other sites frame; measured at 200 requests a window) carries the poster
// frame and the video's address, and the post's oEmbed its title; the post's
// Atom feed (`.rss`) carries all three but allows about one request a window,
// which a shared cloud address has always spent. The video's own playlist names
// the stream sizes. Then the `.json`, should it ever answer again; and last the
// picture Reddit draws of the post for its own share sheet, which is a card
// rather than the post's media but is always better than a title card.
// Pinterest's pin page carries its og:image 1.4 MB in — past what the page
// fetch reads — and its oEmbed answers in a few hundred bytes.

export interface VideoSource {
  kind: "file" | "youtube" | "vimeo";
  /** An address for `file`; an id for `youtube` and `vimeo`. */
  src: string;
}

export interface SiteMedia {
  title: string | null;
  /** Candidate picture addresses, best first; the first that yields bytes wins. */
  images: string[];
  media: "image" | "video";
  width: number | null;
  height: number | null;
  video: VideoSource | null;
}

export type MediaPlan =
  | { site: "reddit"; id: string; embed: string; oembed: string; feed: string; json: string }
  | { site: "youtube"; id: string; oembed: string }
  | { site: "vimeo"; id: string; oembed: string }
  | { site: "imgur"; image: string }
  | { site: "pinterest"; oembed: string }
  | null;

const REDDIT_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "np.reddit.com",
  "m.reddit.com",
  "new.reddit.com",
]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);
const IMGUR_HOSTS = new Set(["imgur.com", "www.imgur.com"]);
/** The one host a Reddit video's stream is accepted from. */
const REDDIT_STREAM_HOST = "v.redd.it";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{5,12}$/;
const IMGUR_ID = /^[A-Za-z0-9]{5,8}$/;

/** A positive finite number, or null — a size the post may have written as anything. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 200) : null;
}

/** An `https:` address, with the `&amp;` Reddit's older JSON leaves in, or null. */
function https(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.replace(/&amp;/g, "&"));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function pathParts(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

/** Which of these sites, if any, this address is — and what to ask. */
export function mediaPlan(url: URL): MediaPlan {
  const json = redditJsonUrl(url);
  const post = redditPost(url);
  if (json && post) {
    const page = encodeURIComponent(`https://www.reddit.com${redditBase(post)}`);
    return {
      site: "reddit",
      id: post.id,
      embed: `https://embed.reddit.com${redditBase(post)}`,
      oembed: `https://www.reddit.com/oembed?url=${page}`,
      feed: redditFeedUrl(post),
      json,
    };
  }
  const pin = pinterestId(url);
  if (pin) {
    const page = encodeURIComponent(`https://www.pinterest.com/pin/${pin}/`);
    return { site: "pinterest", oembed: `https://www.pinterest.com/oembed.json?url=${page}` };
  }
  const yt = youtubeId(url);
  if (yt) {
    const watch = encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`);
    return { site: "youtube", id: yt, oembed: `https://www.youtube.com/oembed?format=json&url=${watch}` };
  }
  const vm = vimeoId(url);
  if (vm) {
    const page = encodeURIComponent(`https://vimeo.com/${vm}`);
    return { site: "vimeo", id: vm, oembed: `https://vimeo.com/api/oembed.json?url=${page}` };
  }
  const im = imgurDirect(url);
  if (im) return { site: "imgur", image: im };
  return null;
}

/** The subreddit (when the address names one) and id of a Reddit post, or null. */
function redditPost(url: URL): { sub: string | null; id: string } | null {
  if (!REDDIT_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = /^\/(?:r\/([A-Za-z0-9_]+)\/)?comments\/([a-z0-9]+)(?:\/|$)/i.exec(url.pathname);
  return match ? { sub: match[1] ?? null, id: match[2].toLowerCase() } : null;
}

function redditBase({ sub, id }: { sub: string | null; id: string }): string {
  return sub ? `/r/${sub}/comments/${id}/` : `/comments/${id}/`;
}

/** A Reddit post's Atom feed — the post first, then its comments. */
function redditFeedUrl(post: { sub: string | null; id: string }): string {
  return `https://www.reddit.com${redditBase(post)}.rss`;
}

/** A Reddit post's own `.json`, on the canonical host — or null for anything that is not a post. */
export function redditJsonUrl(url: URL): string | null {
  const post = redditPost(url);
  if (!post) return null;
  const base = redditBase(post);
  // `limit=1&depth=1` asks for the post and at most one top comment: without
  // them a busy thread's whole comment tree comes back, passes the function's
  // 1 MB JSON cap, and the post falls back to a title card.
  return `https://www.reddit.com${base}.json?raw_json=1&limit=1&depth=1`;
}

/**
 * The picture, size and (for a video) stream of a post, read out of Reddit's
 * `[listing, comments]` answer. Returns null for a text post, a removed one and
 * anything that is not that shape — the caller then takes the generic path.
 * Addresses must be `https:`; a stream must be on `v.redd.it`.
 * Crossposts (`crosspost_parent_list`) are not unwrapped: one whose own data
 * carries no picture takes the generic path.
 */
export function parseRedditPost(payload: unknown): SiteMedia | null {
  const post = (payload as { 0?: { data?: { children?: { 0?: { data?: unknown } } } } } | null | undefined)?.[0]
    ?.data?.children?.[0]?.data as Record<string, unknown> | undefined;
  if (!post || typeof post !== "object") return null;
  const title = text(post.title);
  const source = (
    post.preview as { images?: { source?: { url?: unknown; width?: unknown; height?: unknown } }[] } | undefined
  )?.images?.[0]?.source;
  const previewUrl = https(source?.url);

  // A gallery: its first picture.
  const items = (post.gallery_data as { items?: { media_id?: unknown }[] } | undefined)?.items;
  if (post.is_gallery === true && items?.length && post.media_metadata && typeof post.media_metadata === "object") {
    const first = items[0]?.media_id;
    const meta = typeof first === "string" ? (post.media_metadata as Record<string, { s?: Record<string, unknown> }>)[first] : undefined;
    const url = https(meta?.s?.u ?? meta?.s?.gif);
    if (url) {
      return { title, images: [url], media: "image", width: num(meta?.s?.x), height: num(meta?.s?.y), video: null };
    }
  }

  // A video: its poster, and the stream when it is on Reddit's own host.
  const rv = (
    (post.media as { reddit_video?: Record<string, unknown> } | null | undefined)?.reddit_video ??
    (post.secure_media as { reddit_video?: Record<string, unknown> } | null | undefined)?.reddit_video
  ) as Record<string, unknown> | undefined;
  if (post.is_video === true && rv && previewUrl) {
    const stream = https(rv.fallback_url);
    const playable = stream && new URL(stream).hostname.toLowerCase() === REDDIT_STREAM_HOST ? stream : null;
    return {
      title,
      images: [previewUrl],
      media: playable ? "video" : "image",
      width: num(rv.width) ?? num(source?.width),
      height: num(rv.height) ?? num(source?.height),
      video: playable ? { kind: "file", src: playable } : null,
    };
  }

  // A picture post: the full address first, the preview second.
  const direct = https(post.url);
  const isPicture = post.post_hint === "image" || (direct !== null && /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(direct));
  if (isPicture && (direct || previewUrl)) {
    return {
      title,
      images: [direct, previewUrl].filter((x): x is string => x !== null),
      media: "image",
      width: num(source?.width),
      height: num(source?.height),
      video: null,
    };
  }

  // A link post: whatever picture Reddit made for the page it points at.
  if (previewUrl) {
    return { title, images: [previewUrl], media: "image", width: num(source?.width), height: num(source?.height), video: null };
  }
  return null;
}

/** The id of a YouTube video in any of its spellings, or null. */
export function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;
  if (host === "youtu.be") {
    candidate = pathParts(url)[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = pathParts(url);
    if (parts[0] === "watch") candidate = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) candidate = parts[1] ?? null;
  }
  return candidate !== null && YOUTUBE_ID.test(candidate) ? candidate : null;
}

/** The picture of a YouTube video, from its id, best first — plus the title from its oEmbed. */
export function youtubeMedia(id: string, title: string | null): SiteMedia {
  return {
    title,
    images: [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`],
    media: "video",
    width: 1280,
    height: 720,
    video: { kind: "youtube", src: id },
  };
}

/** The id of a Vimeo video, or null. */
export function vimeoId(url: URL): string | null {
  if (!VIMEO_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = pathParts(url);
  const last = parts.at(-1) ?? "";
  if (parts[0] === "video" && VIMEO_ID.test(parts[1] ?? "")) return parts[1];
  return VIMEO_ID.test(last) ? last : null;
}

/** The fields of an oEmbed answer this reads, or null for anything that is not one. */
export function parseOembed(
  payload: unknown,
): { title: string | null; image: string | null; width: number | null; height: number | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  return {
    title: text(data.title),
    image: https(data.thumbnail_url),
    width: num(data.thumbnail_width) ?? num(data.width),
    height: num(data.thumbnail_height) ?? num(data.height),
  };
}

/** A Vimeo video's media from its oEmbed — null without a picture. */
export function vimeoMedia(id: string, oembed: ReturnType<typeof parseOembed>): SiteMedia | null {
  if (!oembed?.image) return null;
  return {
    title: oembed.title,
    images: [oembed.image],
    media: "video",
    width: oembed.width,
    height: oembed.height,
    video: { kind: "vimeo", src: id },
  };
}

/** `imgur.com/<id>` — one picture — as its direct `i.imgur.com` address; albums and galleries are not. */
export function imgurDirect(url: URL): string | null {
  if (!IMGUR_HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = pathParts(url);
  if (parts.length !== 1 || !IMGUR_ID.test(parts[0])) return null;
  return `https://i.imgur.com/${parts[0]}.jpg`;
}

export function imgurMedia(image: string): SiteMedia {
  return { title: null, images: [image], media: "image", width: null, height: null, video: null };
}

/* --- Reddit, through the post's feed ---------------------------------------- */

/** What the first entry of a post's Atom feed says about the post. */
export interface RedditFeedPost {
  title: string | null;
  /** Reddit's own preview picture of the post (`media:thumbnail`). */
  poster: string | null;
  /** The picture itself, for a picture post (`i.redd.it`). */
  picture: string | null;
  /** The `v.redd.it` id, for a video post. */
  videoId: string | null;
}

/** XML's own escapes and numeric references, once. */
function unescapeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const REDDIT_VIDEO_ID = /^[a-z0-9]{5,20}$/i;

/**
 * The post in a Reddit post's `.rss` — the feed's first `<entry>`; the rest are
 * comments. The entry's `content` is HTML escaped into XML, so its addresses are
 * unescaped twice. Null for anything without an entry.
 */
export function parseRedditFeed(xml: unknown): RedditFeedPost | null {
  if (typeof xml !== "string") return null;
  const entry = /<entry\b[^>]{0,2000}>([\s\S]*?)<\/entry>/i.exec(xml)?.[1];
  if (!entry) return null;
  const titleRaw = /<title\b[^>]{0,2000}>([\s\S]*?)<\/title>/i.exec(entry)?.[1];
  const thumb = /<media:thumbnail\b[^>]{0,2000}\burl\s*=\s*"([^"]*)"/i.exec(entry)?.[1];
  const content = unescapeXml(/<content\b[^>]{0,2000}>([\s\S]*?)<\/content>/i.exec(entry)?.[1] ?? "");
  let picture: string | null = null;
  let videoId: string | null = null;
  for (const match of content.matchAll(/href\s*=\s*"([^"]*)"/gi)) {
    const href = https(unescapeXml(match[1]));
    if (!href) continue;
    const link = new URL(href);
    const host = link.hostname.toLowerCase();
    const first = pathParts(link)[0] ?? "";
    if (host === "i.redd.it" && !picture) picture = href;
    if (host === REDDIT_STREAM_HOST && !videoId && REDDIT_VIDEO_ID.test(first)) videoId = first;
  }
  return {
    title: text(titleRaw ? unescapeXml(titleRaw) : null),
    poster: https(thumb ? unescapeXml(thumb) : null),
    picture,
    videoId,
  };
}

/**
 * The post on a Reddit embed page (`embed.reddit.com/r/…/comments/<id>/`): the
 * video player's poster and stream id, or a picture post's `i.redd.it` picture,
 * or the first preview picture the page shows (a gallery's first, a link post's
 * card). The page names no title; the caller brings the oEmbed's. Null for a
 * page carrying none of them — a text post, a refusal.
 */
export function parseRedditEmbed(html: unknown, title: string | null): RedditFeedPost | null {
  if (typeof html !== "string") return null;
  const attr = (pattern: RegExp) => {
    const raw = pattern.exec(html)?.[1];
    return raw ? https(unescapeXml(raw)) : null;
  };
  const player = /<shreddit-player\b[^>]{0,2000}>/i.exec(html)?.[0] ?? "";
  const playerPoster = /\bposter\s*=\s*"([^"]+)"/i.exec(player)?.[1];
  const videoId = /https:\/\/v\.redd\.it\/([a-z0-9]{5,20})(?:[\/"?&]|$)/i.exec(html)?.[1] ?? null;
  const picture = attr(/"(https:\/\/i\.redd\.it\/[A-Za-z0-9_-]+\.(?:jpe?g|png|gif|webp)[^"]*)"/i);
  const poster =
    (playerPoster ? https(unescapeXml(playerPoster)) : null) ??
    attr(/\bsrc\s*=\s*"(https:\/\/(?:external-)?preview\.redd\.it\/[^"]+)"/i);
  if (!videoId && !picture && !poster) return null;
  return { title: text(title), poster, picture, videoId };
}

/** The playlist naming a Reddit video's stream sizes. */
export function redditPlaylistUrl(videoId: string): string {
  return `https://${REDDIT_STREAM_HOST}/${videoId}/DASHPlaylist.mpd`;
}

/** The tallest stream at or under this height is what a wall tile and its viewer play. */
const STREAM_MAX_HEIGHT = 720;

export interface RedditStream {
  src: string;
  width: number | null;
  height: number | null;
}

/**
 * The stream to play out of a Reddit video's DASH playlist: the tallest video
 * representation no taller than `STREAM_MAX_HEIGHT` (the smallest there is when
 * every one is taller). Its file name must be a plain `.mp4` and the address is
 * built on `v.redd.it` here, so the playlist cannot point anywhere else. The
 * stream is silent — Reddit keeps sound in a separate file — which is what a
 * wall plays anyway.
 */
export function bestRedditStream(mpd: unknown, videoId: string): RedditStream | null {
  if (typeof mpd !== "string" || !REDDIT_VIDEO_ID.test(videoId)) return null;
  const streams: { file: string; width: number | null; height: number }[] = [];
  for (const [, attrs, body] of mpd.matchAll(/<Representation\b([^>]{0,2000})>([\s\S]*?)<\/Representation>/gi)) {
    if (!/mimeType\s*=\s*"video\//i.test(attrs)) continue;
    const height = num(Number(/\bheight\s*=\s*"(\d+)"/i.exec(attrs)?.[1]));
    const file = /<BaseURL>\s*([A-Za-z0-9_.-]+\.mp4)\s*<\/BaseURL>/i.exec(body)?.[1];
    if (!height || !file) continue;
    streams.push({ file, height, width: num(Number(/\bwidth\s*=\s*"(\d+)"/i.exec(attrs)?.[1])) });
  }
  if (streams.length === 0) return null;
  streams.sort((a, b) => a.height - b.height);
  const pick = streams.filter((s) => s.height <= STREAM_MAX_HEIGHT).at(-1) ?? streams[0];
  return { src: `https://${REDDIT_STREAM_HOST}/${videoId}/${pick.file}`, width: pick.width, height: pick.height };
}

/**
 * A post's media from its feed, and its stream when the playlist gave one.
 * A video's picture is its poster; a picture post's is the full picture, poster
 * second; a link or gallery post's is the poster. Null without any picture.
 */
export function redditFeedMedia(post: RedditFeedPost | null, stream: RedditStream | null): SiteMedia | null {
  if (!post) return null;
  const images = [post.videoId ? null : post.picture, post.poster].filter((x): x is string => x !== null);
  if (images.length === 0) return null;
  const playable = post.videoId ? stream : null;
  return {
    title: post.title,
    images,
    media: playable ? "video" : "image",
    width: playable?.width ?? null,
    height: playable?.height ?? null,
    video: playable ? { kind: "file", src: playable.src } : null,
  };
}

/**
 * The card Reddit draws of a post for its own share sheet — the address its
 * pages hand to Slack and Discord as og:image. Not the post's media, but a
 * picture of the post, and the last thing tried before a title card.
 */
export function redditShareCard(id: string): SiteMedia {
  return {
    title: null,
    images: [`https://share.redd.it/preview/post/${id}`],
    media: "image",
    width: null,
    height: null,
    video: null,
  };
}

/* --- Pinterest ------------------------------------------------------------- */

/** pinterest.com and its country hosts — `fi.pinterest.com`, `pinterest.co.uk`. */
const PINTEREST_HOST = /^(?:[a-z]{2,3}\.)?pinterest\.(?:com|[a-z]{2})(?:\.[a-z]{2})?$/;
const PINTEREST_PIN = /^\/pin\/(?:[^/]*--)?(\d{5,25})(?:\/|$)/;

/** The id of a Pinterest pin, or null. `pin.it` short links are not followed. */
export function pinterestId(url: URL): string | null {
  if (!PINTEREST_HOST.test(url.hostname.toLowerCase())) return null;
  return PINTEREST_PIN.exec(url.pathname)?.[1] ?? null;
}

/**
 * A pin's picture from its oEmbed. The oEmbed's thumbnail is 236 pixels wide;
 * the same picture is served at 736 under a sibling path, and that is asked for
 * first. Only `i.pinimg.com` addresses are rewritten or accepted.
 */
export function pinterestMedia(oembed: ReturnType<typeof parseOembed>): SiteMedia | null {
  const thumb = oembed?.image;
  if (!thumb || new URL(thumb).hostname !== "i.pinimg.com") return null;
  const large = thumb.replace(/^(https:\/\/i\.pinimg\.com\/)\d+x\//, "$1" + "736x/");
  return {
    title: oembed.title,
    images: large === thumb ? [thumb] : [large, thumb],
    media: "image",
    width: oembed.width,
    height: oembed.height,
    video: null,
  };
}

/* --- Screenshots, for the Inspiration wall ----------------------------------- */

/**
 * Whether this address is a site's front page — `saleor.io`, not an article on
 * it. On the wall a front page is kept as a picture of the site itself (owner's
 * ruling, 2026-10-09): a site's own share picture is usually a marketing card,
 * and a front page is saved for how it looks.
 */
export function isFrontPage(url: URL): boolean {
  return url.pathname === "/" || url.pathname === "";
}

/**
 * Whether a page's own picture is only its logo or icon — hudsandguis.com's
 * og:image is a white logo on a transparent ground, which a dark tile shows as
 * a black box. Read off the file name alone; on the wall such a picture is
 * replaced by a screenshot when one can be had, and kept when it cannot.
 */
export function weakPicture(address: string): boolean {
  let leaf: string;
  try {
    leaf = pathParts(new URL(address)).at(-1) ?? "";
  } catch {
    return false;
  }
  return /logo|favicon|apple-touch|(?:^|[-_.])icon(?:[-_.]|$)/i.test(leaf);
}

/**
 * Microlink's screenshot of a page, answered as the picture itself (`embed`).
 * Free without a key, 50 a day, which a personal wall does not approach; a
 * refusal or a timeout is simply no screenshot. The owner agreed to the page's
 * address going to Microlink, for wall links only (2026-10-09).
 */
export function screenshotUrl(page: URL): string {
  const query = new URLSearchParams({
    url: page.toString(),
    screenshot: "true",
    meta: "false",
    embed: "screenshot.url",
    "screenshot.type": "jpeg",
    "viewport.width": "1280",
    "viewport.height": "800",
    "viewport.deviceScaleFactor": "1",
  });
  return `https://api.microlink.io/?${query}`;
}
