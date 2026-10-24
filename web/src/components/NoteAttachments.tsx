import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Attachment } from "../types";
import { useFileUrl } from "../store/useFileUrl";
import { fetchFile, passingBytes, sendAgain, uploadRefused, watchRefusals } from "../store/attachments";
import { fileIconKey, fileKind, fileSize, isAudio, isImage, isVideo } from "../lib/files";
import { isPdf } from "../lib/pdf";
import { useOnline } from "../lib/useOnline";
import { passingUrl, saveBlob, saveHref } from "../lib/saveFile";
import { robotSays } from "../lib/mascotMoments";
import { usePrint } from "../lib/usePrint";
import { SyncMark } from "./SyncMark";
import { IconClear, IconDownload, IconFileType, IconPlay } from "./Icons";

/** Between one triggered download and the next, so the browser registers each. */
const DOWNLOAD_GAP_MS = 120;

type Open = (att: Attachment, src: string, from: DOMRect, downloadUrl: string | null) => void;

/** What is wrong with a picture's bytes, said under the grid (`TileNotes`). */
interface TileNote {
  text: string;
  /** The server turned it away: offered "send again". */
  resend: boolean;
}

/**
 * Where one file's bytes are, and what this device can do with them — shared
 * by a picture's tile and a file's row, so both say the same thing about the
 * same state.
 *
 * The thumbnail travels inside the note, so a picture is on screen from the
 * first frame — before the file itself has been asked for, and whether or not
 * it ever arrives. The real bytes are then fetched underneath: from this device
 * if it has them, from the server if it does not, and not at all if the other
 * machine hasn't finished uploading. That last case is a normal state and says
 * so plainly rather than failing.
 */
function useAttachment(att: Attachment, sends: boolean, small = false) {
  const image = isImage(att);
  const media = isAudio(att) || isVideo(att);
  /**
   * How far a file reaches for its bytes the moment the note opens. A
   * picture is drawn here, so it is fetched; a film or a sound is streamed
   * (`"stream"`), so playing starts at once and nothing is cached; and every
   * other file — a zip, a spreadsheet, a document — is read only from this
   * device, and fetched when Save or the document's own view asks for it.
   * Opening a note of ten files used to download all ten in full. A picture
   * drawn small in the grid is not drawn large enough to need its bytes: it
   * reads the card-sized copy of what this device already has (`"card"`, as a
   * card does), and the viewer fetches the rest.
   */
  const reach = image ? (small ? "card" : "any") : media ? "stream" : "local";
  const { url, missing: absent } = useFileUrl(att, reach);
  // Read locally, "not here" is not "nowhere": a file the server holds is
  // fetched on demand, and only one that was never sent is still elsewhere.
  const local = reach === "local" || reach === "card";
  const missing = local ? absent && att.path === null : absent;
  const online = useOnline();
  /** This browser could not draw or play the bytes — an iPhone's HEIC in
   *  Chrome, a film in a codec it lacks. Said in words, never a dead box. */
  const [unshowable, setUnshowable] = useState(false);
  /** A fetch Save or a document's view is waiting on. */
  const [fetching, setFetching] = useState(false);
  /** Save or a document's view asked the server for the bytes, and none came (audit BUG-6). */
  const [fetchFailed, setFetchFailed] = useState(false);

  /** The bytes as an address of this page's own, fetched now if they are not here yet. */
  async function bytesNow(): Promise<string | null> {
    if (url && !url.startsWith("http")) return url;
    setFetching(true);
    try {
      // A film or a sound is fetched for Save and handed over, never kept on
      // this device: it streams when played, and 50 MB in the store for one
      // download is what the cache budget exists to stop (audit BUG-6).
      const blob = await (media ? passingBytes(att) : fetchFile(att));
      setFetchFailed(!blob);
      if (!blob) return null;
      return passingUrl(blob);
    } catch (err) {
      // A connection dropped mid-download: say so, never a silent tap.
      console.warn("[spår] the file could not be fetched", err);
      setFetchFailed(true);
      return null;
    } finally {
      setFetching(false);
    }
  }

  /**
   * Where the bytes are, drawn with the mark the app already uses for exactly
   * this. `path` is the whole test: it is set by the upload and by nothing else.
   */
  const sent = att.path !== null;
  // The server turned this file away this session (audit BUG-2): it is not
  // on its way anywhere until it is sent again, so no mark, only words.
  const refused = useSyncExternalStore(watchRefusals, () => uploadRefused(att.id)) && !sent;
  const offline = !sent && !missing && !online;
  /** On its way to the other device now. Kept in this browser only, a file
   *  has no other device to be on its way to (review UI-05). */
  const sending = sends && !sent && !missing && online && !refused;

  /**
   * The one sentence about these bytes, or null when there is nothing to say.
   * A file the server holds that could not be fetched is not on the other
   * device: it is on the server, and this one is offline or the server did
   * not answer (audit BUG-6). Only a device that syncs has another device for
   * the bytes to be on (review CD-03).
   */
  // A refused file is this device's own, so it is never "on the other device".
  const resend = sends && refused && !offline;
  const warning = resend
    ? "the server would not take this file"
    : missing || fetchFailed
      ? sent
        ? "not reachable now"
        : sends
          ? "still on the other device"
          : "not on this device"
      : unshowable
        ? media
          ? "will not play here"
          : "cannot show here"
        : sends && offline
          ? "offline"
          : null;

  return {
    url,
    unshowable,
    setUnshowable,
    fetching,
    bytesNow,
    warning,
    /** Only "the server would not take this file" can be answered here. */
    resend,
    sending,
  };
}

/** The little drawing of a file on its way up. */
function SendingMark() {
  return (
    <span className="mark-state attach-state" data-state="working" title="Sending to your other device" aria-label="Sending">
      <SyncMark />
    </span>
  );
}

/** "send again", for a file the server turned away. */
function SendAgain({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="meta-warn meta-putback"
      onClick={(e) => {
        e.stopPropagation();
        sendAgain(id);
      }}
    >
      send again
    </button>
  );
}

function RemoveButton({ att, onRequestRemove }: { att: Attachment; onRequestRemove: () => void }) {
  // Removing a file destroys it. The note itself is what the trash protects,
  // and taking a file off a note by hand is as deliberate an act as emptying
  // the trash — so it asks, once, and then does it.
  return (
    <button
      type="button"
      className="iconbtn"
      aria-label={`Remove ${att.name}`}
      title="Remove"
      onClick={(e) => {
        e.stopPropagation();
        onRequestRemove();
      }}
    >
      <IconClear />
    </button>
  );
}

/**
 * One picture — or a document, drawn by its first page — as a square in the
 * grid under the note's words. The tile is the picture and nothing else: no
 * name, no ×, no Save stamped over it. Tapping it opens it at the size of the
 * screen, where its name, size, Save and Remove are (`Lightbox`), the same
 * move a card makes, out of the rect it is sitting in. Anything wrong with its
 * bytes is said in words under the grid (`onNote`).
 */
function AttachmentTile({
  att,
  sends,
  describe,
  onOpenPreview,
  onNote,
  small,
}: {
  att: Attachment;
  sends: boolean;
  /** One of several in the grid, rather than a picture alone at its own shape. */
  small: boolean;
  describe?: (att: Attachment) => string;
  onOpenPreview: Open;
  onNote: (id: string, note: TileNote | null) => void;
}) {
  const image = isImage(att);
  const doc = !image && isPdf(att.mime, att.name);
  // A picture with no thumbnail has nothing to draw but its bytes.
  const near = small && Boolean(att.thumb);
  const { url, unshowable, setUnshowable, bytesNow, warning, resend, sending } = useAttachment(att, sends, near);
  const print = usePrint();
  /**
   * What the tile draws, and what tapping it opens — which for a document are
   * two different things. A picture draws its own bytes when this device has
   * them and its thumbnail until then, and opens the same. A PDF draws the
   * first page that was rendered when it was attached, but *opens* the file
   * itself, drawn page by page at the size of the screen.
   */
  const shown = image ? ((unshowable ? null : url) ?? att.thumb ?? "") : (att.thumb ?? "");
  const opens = image ? shown : url;

  useEffect(() => {
    onNote(att.id, warning ? { text: warning, resend } : null);
  }, [onNote, att.id, warning, resend]);
  useEffect(() => () => onNote(att.id, null), [onNote, att.id]);

  return (
    <button
      type="button"
      className="attach-tile"
      data-warn={warning ? true : undefined}
      aria-label={`View ${att.name}`}
      title={att.name}
      // Never takes the focus from the editor on the way down: a link typed
      // in this edit unfurls when the editor lets go, and would move the
      // square out from under the finger between the press and the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        const from = e.currentTarget.getBoundingClientRect();
        if (opens) {
          // A small square's copy is card-sized: never what Save hands over.
          onOpenPreview(att, opens, from, near ? null : url);
          return;
        }
        // A document whose bytes are not here yet: fetched on the tap.
        if (doc) {
          void bytesNow().then((href) => {
            if (href) onOpenPreview(att, href, from, href);
          });
        }
      }}
    >
      {shown ? (
        // The pixel shape goes on the element, so a lone picture's box is the
        // right height *before* it has decoded and nothing under it jumps. In
        // the grid the square decides, and the attributes are only a hint.
        <img
          className="attach-shot"
          src={shown}
          alt={describe ? describe(att) : att.name}
          width={att.width ?? undefined}
          height={att.height ?? undefined}
          ref={print.ref}
          onLoad={print.onLoad}
          // The bytes will not draw here: the thumbnail takes their place,
          // and the line under the grid says why the picture is no sharper.
          onError={() => setUnshowable(true)}
          draggable={false}
          data-doc={doc || undefined}
        />
      ) : (
        <span className="attach-kind">
          <IconFileType kind={fileIconKey(att.name, att.mime)} tier="inline" />
          <span className="attach-kind-ext mono">{fileKind(att.name, att.mime)}</span>
        </span>
      )}
      {/* A document drawn by its first page is still a document: its type
          stands in the corner so it is not taken for a photograph. */}
      {doc && shown && <span className="attach-badge mono">{fileKind(att.name, att.mime)}</span>}
      {sending && <SendingMark />}
    </button>
  );
}

/**
 * A file that is not drawn as a picture — a sound, a film, a zip, a document
 * with no first page — as a row of its own under the grid: its player where
 * it has one, then its name, its size, Save and Remove, all in reach without
 * opening anything, because nothing opens it.
 */
function AttachmentRow({
  att,
  onRequestRemove,
  sends,
}: {
  att: Attachment;
  sends: boolean;
  onRequestRemove: () => void;
}) {
  const audio = isAudio(att);
  const video = isVideo(att);
  const media = audio || video;
  const { url, unshowable, setUnshowable, fetching, bytesNow, warning, resend, sending } = useAttachment(att, sends);

  /** The browser's own save dialogue (`saveHref`). */
  async function save() {
    // A streaming address is the server's, and `download` is ignored across
    // origins — so a film is fetched whole for Save, as any other file is.
    const href = await bytesNow();
    if (!href) return;
    saveHref(href, att.name);
  }

  return (
    // A player is drawn in the same box before and after its bytes arrive —
    // `.attach-media` wraps the placeholder too — so the rows and the footer
    // under it do not move when they land.
    <div className="attach" data-media={audio ? "audio" : video ? "video" : undefined}>
      {media &&
        (url && !unshowable ? (
          <div className="attach-media">
            {audio ? (
              <audio
                className="attach-player"
                controls
                preload="metadata"
                src={url}
                aria-label={`Play ${att.name}`}
                onError={() => setUnshowable(true)}
              />
            ) : (
              <video
                className="attach-player attach-video"
                controls
                preload="metadata"
                playsInline
                src={url}
                // The frame taken when it was attached, standing in until the
                // stream has one of its own.
                poster={att.thumb ?? undefined}
                aria-label={`Play ${att.name}`}
                onError={() => setUnshowable(true)}
              />
            )}
          </div>
        ) : (
          <div className="attach-media">
            {video && att.thumb ? (
              <div className="attach-poster">
                <img className="attach-shot" src={att.thumb} alt="" draggable={false} />
                {!unshowable && (
                  <span className="media-play" aria-hidden>
                    <IconPlay tier="inline" />
                  </span>
                )}
              </div>
            ) : (
              <div className="attach-kind">
                <IconFileType kind={fileIconKey(att.name, att.mime)} tier="inline" />
                <span className="attach-kind-ext mono">{fileKind(att.name, att.mime)}</span>
              </div>
            )}
          </div>
        ))}

      <div className="attach-row mono">
        {!media && (
          <span className="attach-type" aria-hidden>
            <IconFileType kind={fileIconKey(att.name, att.mime)} tier="data" />
          </span>
        )}
        <span className="attach-name">{att.name}</span>
        <span className="attach-size">
          {media ? fileSize(att.size) : `${fileKind(att.name, att.mime)} · ${fileSize(att.size)}`}
        </span>
        {warning && <span className="meta-warn">{warning}</span>}
        {resend && <SendAgain id={att.id} />}
        {sending && <SendingMark />}
        <span className="spacer" />
        <button
          type="button"
          className="iconbtn"
          aria-label={`Save ${att.name}`}
          title="Save"
          disabled={(!url && att.path === null) || fetching}
          onClick={(e) => {
            e.stopPropagation();
            void save();
          }}
        >
          <IconDownload />
        </button>
        <RemoveButton att={att} onRequestRemove={onRequestRemove} />
      </div>
    </div>
  );
}

/** "9 pictures · 2 files · 23 MB" — what the note carries, in one line. */
export function carrying(attachments: Attachment[]): string {
  const pictures = attachments.filter(isImage).length;
  const others = attachments.length - pictures;
  const parts: string[] = [];
  if (pictures) parts.push(`${pictures} ${pictures === 1 ? "picture" : "pictures"}`);
  if (others) parts.push(`${others} ${others === 1 ? "file" : "files"}`);
  parts.push(fileSize(attachments.reduce((sum, att) => sum + (att.size || 0), 0)));
  return parts.join(" · ");
}

/**
 * The files the open note is carrying, drawn **under** its words (owner,
 * 2026-10-17): the name and the words lead, and the files follow, so a note
 * of twelve screenshots still opens on what was written about them. First one
 * line saying what is here, with Save all; then the pictures and documents as
 * a grid of small squares; then a line for each one whose bytes have something
 * to say; then every other file as a row. The picture at full size and the
 * remove confirm are the note's — this only asks for them (`onOpenPreview`,
 * `onRequestRemove`).
 */
export function NoteAttachments({
  attachments,
  tiles,
  rows,
  onRequestRemove,
  onOpenPreview,
  sendsFiles = true,
  describe,
}: {
  describe?: (att: Attachment) => string;
  /** Every file, in the note's own order — the order Save all goes through. */
  attachments: Attachment[];
  /** What opens in the viewer, in the viewer's own walking order: the grid. */
  tiles: Attachment[];
  /** Everything else, drawn as rows under the grid. */
  rows: Attachment[];
  onRequestRemove: (att: Attachment) => void;
  onOpenPreview: Open;
  /**
   * Whether there is a server this device sends files to. Without one there
   * is no "sending" and no "on your other device too" to say, so neither is
   * said. True when left out, which is what every caller meant before.
   */
  sendsFiles?: boolean;
}) {
  const downloadAll = useCallback(async () => {
    let saved = 0;
    for (const att of attachments) {
      // A film or a sound is handed over, not kept (`passingBytes`, BUG-6).
      const blob = await (isAudio(att) || isVideo(att) ? passingBytes(att) : fetchFile(att));
      // One that cannot be reached is counted, never skipped without a word.
      if (!blob) continue;
      // Each address lives `OBJECT_URL_TTL_MS` from its own click.
      saveBlob(blob, att.name);
      saved += 1;
      // Let the browser register each download before firing the next.
      await new Promise((r) => setTimeout(r, DOWNLOAD_GAP_MS));
    }
    if (saved < attachments.length) {
      const all = attachments.length;
      robotSays(
        saved === 0
          ? all === 1
            ? "Uh-oh. Couldn't save that file. It couldn't be reached."
            : "Uh-oh. Couldn't save those files. They couldn't be reached."
          : `Saved ${saved} of ${all} ${all === 1 ? "file" : "files"}. The ${all - saved === 1 ? "other" : "others"} could not be reached.`,
      );
    }
  }, [attachments]);

  /** What each tile has to say about its bytes, keyed by file. */
  const [notes, setNotes] = useState<Record<string, TileNote>>({});
  const onNote = useCallback((id: string, note: TileNote | null) => {
    setNotes((was) => {
      const old = was[id];
      if (!note) {
        if (!old) return was;
        const rest = { ...was };
        delete rest[id];
        return rest;
      }
      if (old && old.text === note.text && old.resend === note.resend) return was;
      return { ...was, [id]: note };
    });
  }, []);
  const noted = tiles.filter((att) => notes[att.id]);

  if (attachments.length === 0) return null;

  // Every file is there too: one mark for all of them, in the line that
  // counts them. A file still on its way wears its own mark until it lands.
  const allSent = sendsFiles && attachments.every((att) => att.path !== null);

  return (
    <section className="attachments" aria-label="Files">
      <div className="attach-head mono">
        <span className="attach-count">{carrying(attachments)}</span>
        {allSent && (
          <span className="mark-state attach-state" data-state="idle" title="On your other device too" aria-label="Sent">
            <SyncMark />
          </span>
        )}
        <span className="spacer" />
        {attachments.length > 1 && (
          <button
            type="button"
            className="attach-download-all mono"
            onClick={(e) => {
              e.stopPropagation();
              // A fetch that fails part-way leaves the files it reached
              // downloaded and says so only here (PLAN.md: no progress
              // state, priority low); what it must not do is reject into
              // nowhere.
              downloadAll().catch((error: unknown) => console.error("download all failed", error));
            }}
          >
            Save all
          </button>
        )}
      </div>
      {tiles.length > 0 && (
        // Only a picture alone keeps its own shape; a document's first page
        // at the whole measure would be a page of white.
        <div className="attach-grid" data-one={(tiles.length === 1 && isImage(tiles[0])) || undefined}>
          {tiles.map((att) => (
            <AttachmentTile
              key={att.id}
              att={att}
              sends={sendsFiles}
              describe={describe}
              onOpenPreview={onOpenPreview}
              onNote={onNote}
              small={tiles.length > 1}
            />
          ))}
        </div>
      )}
      {noted.length > 0 && (
        <ul className="attach-notes">
          {noted.map((att) => (
            <li key={att.id} className="attach-row mono">
              <span className="attach-name">{att.name}</span>
              <span className="meta-warn">{notes[att.id].text}</span>
              {notes[att.id].resend && <SendAgain id={att.id} />}
              <span className="spacer" />
              {/* A picture with nothing to draw has no viewer to remove it
                  from, so the way to remove it stands here. */}
              <RemoveButton att={att} onRequestRemove={() => onRequestRemove(att)} />
            </li>
          ))}
        </ul>
      )}
      {rows.map((att) => (
        <AttachmentRow key={att.id} att={att} sends={sendsFiles} onRequestRemove={() => onRequestRemove(att)} />
      ))}
    </section>
  );
}
