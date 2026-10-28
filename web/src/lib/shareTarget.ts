/**
 * A share, arriving.
 *
 * `share.ts` is the way out of the app; this is the way in. The manifest
 * declares `/share` as a `share_target`, `public/share-sw.js` catches Android's
 * POST to it inside the service worker and parks what it found in a cache, and
 * everything below is the app coming up afterwards to collect it.
 *
 * The worker is deliberately the dumb half — it cannot be imported, tested or
 * type-checked, so it decides nothing. What a share *becomes* is decided here:
 * which files came, in which order, and what words go into the note.
 *
 * A shared file is not a new kind of thing. It comes out of here as a plain
 * `File`, goes through the same `takeFiles` a dropped file goes through, and
 * lands as one note carrying every picture — which is what selecting eight
 * photos in the gallery means: one thing, sent once.
 */

/** The cache `public/share-sw.js` parks a share in. Named in both files. */
export const SHARE_INBOX = "share-inbox";

/**
 * What `takeShared` answers when a share was waiting and could not be read
 * (and has been dropped): a marker, not a share, for the caller to say so.
 */
export const UNREADABLE = "unreadable" as const;

/** The one entry holding the share's words rather than its bytes. */
const TEXT_KEY = "/__share/text";

/** What the sheet sent: some files, some words, either side possibly empty. */
export interface SharedCapture {
  files: File[];
  text: string;
  /**
   * Files the worker would not park — over the size bound, or past the count
   * or the total one share may carry (audit SEC-1). Named so the app can say
   * which; `count` may be larger than `names`, which the worker caps.
   */
  left?: { names: { name: string; size: number }[]; count: number; full?: true };
  /**
   * Empties the inbox — called **once the note exists**, and never before.
   *
   * The delete used to happen inside `takeShared`, before returning, and the
   * docblock below claimed that made a half-collected share impossible. It did
   * the opposite: the note is written *after* this returns, and for eight
   * photographs that means eight decodes, eight thumbnails and eight IndexedDB
   * writes on a phone that has just cold-started to answer a share. Android
   * reclaiming the tab anywhere in there left no note and an empty inbox, with
   * nothing anywhere to say a share had ever arrived. The read is still a
   * drain in the sense that matters — one collector, guarded by its own ref —
   * and the bytes stay put until there is something to point at.
   */
  commit: () => Promise<void>;
}

/** The three text fields a share sheet may fill in, none of them promised. */
interface SharedWords {
  title?: unknown;
  text?: unknown;
  url?: unknown;
  left?: unknown;
  leftCount?: unknown;
  /** The device ran out of room partway through parking the files. */
  leftFull?: unknown;
}

/** The worker's `left` list, read as warily as everything else it parked. */
export function readLeft(words: SharedWords | null): SharedCapture["left"] {
  const raw = Array.isArray(words?.left) ? (words.left as unknown[]) : [];
  const names = raw
    .filter((v): v is { name: unknown; size: unknown } => !!v && typeof v === "object")
    .map((v) => ({
      name: typeof v.name === "string" && v.name ? v.name : "file",
      size: typeof v.size === "number" && Number.isFinite(v.size) ? v.size : 0,
    }));
  const said = typeof words?.leftCount === "number" ? words.leftCount : 0;
  const count = Math.max(names.length, Number.isFinite(said) ? Math.floor(said) : 0);
  if (count === 0) return undefined;
  return words?.leftFull === true ? { names, count, full: true } : { names, count };
}

/**
 * One field of a share, as text this app can hold.
 *
 * The newlines are normalised here and nowhere later, because here is the one
 * place a share's words enter the app. Android hands over whatever the sending
 * app put on the clipboard-shaped object, and a page shared from a Windows
 * browser or a mail client routinely arrives with "\r\n" line endings. Every
 * line pattern in `blocks.ts` reads a line up to its newline, so a note whose
 * lines end "\r" drew with no tick boxes, no headings and no list items — the
 * marks were all still in the text, and none of them were on the screen.
 *
 * A textarea normalises its own value, so nothing typed here can carry a "\r";
 * this is the door that has no textarea behind it. Both spellings go: "\r\n"
 * and the lone "\r" of a very old Mac, in that order, or the pair would become
 * two breaks.
 */
function str(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

/**
 * The words of a share, as one note's worth of text.
 *
 * A share sheet hands over up to three fields and no two apps agree on how to
 * fill them. Chrome sharing a page sends the page's title and its address;
 * plenty of apps put the address in `text` and send no `url` at all; some send
 * the title *as* the text. So the rule is to keep each part only if it is not
 * already said by another one, in the order a person would write them: what it
 * is called, what was said about it, where it is.
 *
 * Nothing is invented and nothing is labelled. A share with no words at all —
 * which is every share of a photograph — comes back as the empty string, and
 * the note is then the picture, exactly as a dropped file is.
 */
export function composeShared(words: SharedWords | null): string {
  const title = str(words?.title);
  const text = str(words?.text);
  const url = str(words?.url);

  const parts: string[] = [];
  /**
   * Two parts say the same thing when one **opens or closes** the other.
   *
   * Plain containment was too eager. A share of a Hacker News item arrives as
   * `title: "news"` with the address in `url`, and "news" is inside
   * `news.ycombinator.com` — so the title was thrown away and the note became
   * the bare URL. The duplication actually worth catching always meets at an
   * edge: an app that fills `text` with the address and sends `url` too (they
   * are equal), or one that appends the address to a sentence (the longer ends
   * with the shorter). A word buried in the middle of an address is a
   * coincidence, and the app should not act on a coincidence.
   */
  const sameThing = (a: string, b: string) => {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return long.startsWith(short) || long.endsWith(short);
  };

  const keep = (part: string) => {
    if (!part) return;
    // The longer one wins, which is why a kept part is replaced rather than
    // skipped.
    const clash = parts.findIndex((p) => sameThing(p, part));
    if (clash === -1) parts.push(part);
    else if (part.length > parts[clash].length) parts[clash] = part;
  };

  keep(title);
  keep(text);
  keep(url);
  return parts.join("\n");
}

/**
 * Empties the share inbox and returns what was in it, or `null` when there was
 * nothing — which is every ordinary open of the app.
 *
 * It is collected exactly once — the caller's own ref sees to that, and the
 * next open must not make a second note out of the same photographs — but the
 * **emptying is the caller's to do**, through `commit`, once the note it made
 * is on disk. See `SharedCapture.commit` for what deleting it here cost.
 *
 * Never throws. A browser with no Cache API, a storage error, an entry that
 * will not decode — all of them are simply "no share waiting". This runs on
 * every open, and nothing about it may ever stand in front of the board.
 *
 * A share that cannot be decoded at all is dropped where it stands: the
 * `catch` empties the inbox on its way out, because an entry that failed once
 * will fail identically on every open for the rest of the device's life, and
 * an inbox nobody can read is storage held for nothing. **It is dropped
 * aloud:** the answer is `UNREADABLE`, so the app can tell the reader that
 * something they shared was not added, instead of nothing arriving and nothing
 * being said. Not knowing whether a share is waiting at all (no Cache API, the
 * existence check failing) stays `null` — that is every ordinary open.
 */
export async function takeShared(): Promise<SharedCapture | null | typeof UNREADABLE> {
  if (typeof caches === "undefined") return null;
  try {
    // `open` would *create* the cache, leaving an empty one on every device
    // that has never received a share. Ask first.
    if (!(await caches.has(SHARE_INBOX))) return null;
  } catch {
    return null;
  }
  try {
    const cache = await caches.open(SHARE_INBOX);
    const keys = await cache.keys();
    if (keys.length === 0) {
      await caches.delete(SHARE_INBOX);
      return null;
    }

    // The worker numbers the file entries zero-padded, so sorting by path puts
    // ten photographs back in the order they were picked rather than 1, 10, 2.
    const sorted = [...keys].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));

    const files: File[] = [];
    let text = "";
    let left: SharedCapture["left"];

    for (const key of sorted) {
      const response = await cache.match(key);
      if (!response) continue;
      if (pathOf(key) === TEXT_KEY) {
        const words = (await response.json().catch(() => null)) as SharedWords | null;
        text = composeShared(words);
        left = readLeft(words);
        continue;
      }
      const blob = await response.blob();
      files.push(
        new File([blob], decode(response.headers.get("x-share-name")) || "file", {
          // The type as the sheet gave it, which is quite often nothing at all.
          // `blob.type` would report the `application/octet-stream` the worker
          // had to invent to write a legal header, and `fileKind` reads the
          // extension first anyway.
          type: decode(response.headers.get("x-share-type")),
        }),
      );
    }

    if (files.length === 0 && !text && !left) {
      await caches.delete(SHARE_INBOX);
      return null;
    }
    return { files, text, ...(left ? { left } : {}), commit: () => forgetShare() };
  } catch (error) {
    console.error("could not read the share that was waiting", error);
    await forgetShare();
    return UNREADABLE;
  }
}

/** The path of a cache key, which is stored as a whole same-origin URL. */
function pathOf(key: Request): string {
  try {
    return new URL(key.url).pathname;
  } catch {
    return key.url;
  }
}

/** Header values are ASCII, so the worker percent-encodes what it writes. */
function decode(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Drops the inbox, whatever state it is in, without ever throwing. */
async function forgetShare(): Promise<void> {
  try {
    await caches.delete(SHARE_INBOX);
  } catch (error) {
    console.error("could not empty the share inbox", error);
  }
}
