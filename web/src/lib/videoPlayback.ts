import type { VideoSource } from "./wall";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIDEO_FILE = /\.(?:mp4|webm|m4v)$/i;
const STREAM_HOSTS = new Set(["v.redd.it"]);

/**
 * How a stored `video` source may be played, or `null`.
 *
 * The entry is synced JSON that another device (or an older or hostile client)
 * wrote, and it is about to become an `<iframe src>` or a `<video src>`. So this
 * is a gate and not a formatter: a file must be an `https:` address that is on
 * the one streaming host we know or ends in a video extension; YouTube and Vimeo
 * are **ids only** — the address is built here, on the privacy-respecting hosts
 * (`youtube-nocookie.com`, `player.vimeo.com`), never taken from the entry.
 * Everything else — `javascript:`, `data:`, plain `http:`, a page, an unknown
 * kind, a missing field — is `null`, and the viewer shows the poster with
 * **Open site**. Autoplay is the caller's to add (it depends on reduced motion).
 */
export function videoPlayback(
  video: VideoSource | null | undefined,
): { mode: "file"; src: string } | { mode: "embed"; src: string } | null {
  if (!video || typeof video !== "object" || typeof video.src !== "string") return null;
  switch (video.kind) {
    case "file": {
      let url: URL;
      try {
        url = new URL(video.src);
      } catch {
        return null;
      }
      if (url.protocol !== "https:") return null;
      if (!STREAM_HOSTS.has(url.hostname.toLowerCase()) && !VIDEO_FILE.test(url.pathname)) return null;
      return { mode: "file", src: url.toString() };
    }
    case "youtube":
      return YOUTUBE_ID.test(video.src)
        ? { mode: "embed", src: `https://www.youtube-nocookie.com/embed/${video.src}?rel=0&playsinline=1` }
        : null;
    case "vimeo":
      return VIMEO_ID.test(video.src)
        ? { mode: "embed", src: `https://player.vimeo.com/video/${video.src}?playsinline=1` }
        : null;
    default:
      return null;
  }
}
