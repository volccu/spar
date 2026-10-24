import { useState } from "react";
import { videoPlayback } from "../lib/videoPlayback";
import type { VideoSource } from "../lib/wall";

/**
 * A video, in the viewer, streamed from where it lives and **never saved** — no
 * bytes are fetched by the app, stored in a note or synced; the element asks the
 * source directly (the CSP names the hosts, `deploy/nginx.conf`). Where it will
 * not play — a source we do not recognise, a stream that errors, a site that
 * refuses to be framed — the poster stands and the words say where to go; the
 * viewer's bar carries **Open site** either way.
 *
 * `autoplay` is the caller's: reduced motion turns it off, and a person who
 * asked for less movement is not startled by a picture that begins to move.
 * The box is 16:9 and letterboxed before a byte arrives (web/CLAUDE.md, "Anything
 * that arrives late is bounded, or it is reserved").
 */
interface Props {
  video: VideoSource | null | undefined;
  poster: string;
  title: string;
  autoplay: boolean;
}

/**
 * The stored picture is always a small data URL (the function inlines it); an
 * entry whose `image` is anything else came from somewhere that is not this
 * app, and it is not given to the page as a source of anything.
 */
function safePoster(poster: string | null | undefined): string {
  return typeof poster === "string" && poster.startsWith("data:image/") ? poster : "";
}

/** What a link's video says where it will not play: the bar has Open site. */
const OPEN_THE_SITE = "Can't play here. Open the site.";

export function ViewerVideo({ video, poster: stored, title, autoplay }: Props) {
  const poster = safePoster(stored);
  const play = videoPlayback(video);

  if (play?.mode === "embed") {
    return (
      <div className="viewer-video">
        <iframe
          className="viewer-player"
          src={autoplay ? `${play.src}&autoplay=1` : play.src}
          title={title}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <ViewerFilm
      src={play?.src ?? null}
      poster={poster}
      title={title}
      autoplay={autoplay}
      controlsList="nodownload noplaybackrate"
      unplayable={OPEN_THE_SITE}
      failed={OPEN_THE_SITE}
      under={play && silentStream(play.src) ? "No sound here. Open the site to hear it." : null}
    />
  );
}

/**
 * The film box both kinds of video play in: a link's stream on the wall
 * (`ViewerVideo`) and a film the note itself carries (`FileFilm` in
 * Lightbox.tsx). Written twice, the two had already begun to drift, so the
 * element, its frame standing until the stream has one, and the fallback that
 * is words — never a dead black box — live here once. What differs is said by
 * the caller: which words, whether the element offers its own download, and
 * whether a click is kept inside.
 */
export function ViewerFilm({
  src,
  poster,
  title,
  autoplay,
  controlsList,
  unplayable,
  failed: failedWords,
  under = null,
  holdClicks = false,
}: {
  /** What the element plays; null where there is nothing this page may play. */
  src: string | null;
  /** The frame that stands before the stream has one, and in place of it. */
  poster: string;
  title: string;
  autoplay: boolean;
  /** The element's own menu, trimmed where the film is never to be kept. */
  controlsList?: string;
  /** The words where there is nothing to play; null draws the frame alone. */
  unplayable: string | null;
  /** The words where this browser tried and could not play it. */
  failed: string;
  /** One line under a playing film — a stream that has no sound. */
  under?: string | null;
  /** Keeps a click on the controls from reaching the layer, which closes on one. */
  holdClicks?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const hold = holdClicks ? (e: React.MouseEvent) => e.stopPropagation() : undefined;

  if (src === null || failed) {
    const words = failed ? failedWords : unplayable;
    return (
      <div className="viewer-video" data-fallback={words !== null || undefined} onClick={hold}>
        {poster && <img className="viewer-poster" src={poster} alt={title} draggable={false} />}
        {words !== null && <p className="viewer-video-note mono">{words}</p>}
      </div>
    );
  }

  return (
    <div className="viewer-video" data-muted={under !== null || undefined} onClick={hold}>
      <video
        className="viewer-player"
        src={src}
        poster={poster || undefined}
        controls
        playsInline
        autoPlay={autoplay}
        preload="metadata"
        controlsList={controlsList}
        aria-label={title}
        onError={() => setFailed(true)}
      />
      {under !== null && <p className="viewer-video-note mono">{under}</p>}
    </div>
  );
}

/**
 * A Reddit video plays without sound: the stream is the playlist's video-only
 * file (`bestRedditStream`), and the sound lives in a second file the element
 * cannot join to it. Said in one line under the player, so silence does not
 * read as a broken speaker (audit 2026-10-10, UX-8).
 */
function silentStream(src: string): boolean {
  try {
    return new URL(src).hostname.toLowerCase() === "v.redd.it";
  } catch {
    return false;
  }
}
