import { useCallback, useEffect, useState } from "react";
import type { Attachment } from "../types";
import { fetchFile } from "../store/attachments";
import { COPIED_MS, useCopied } from "../lib/clipboard";
import { canShare, shareNote } from "../lib/share";
import { useReadAloud } from "../lib/speech";
import { IconCopy, IconShare, IconSpeak } from "./Icons";
import { ListVerbs, type ListRewrite } from "./ListVerbs";

/**
 * The open note's verbs — copy, share, read aloud, and on a list with ticked
 * boxes untick all and clear done — at the right-hand end of the footer under
 * the text. Always rendered, so the read-aloud hook lives as
 * long as the note does and closing the note is what silences it; it draws
 * nothing when there is nothing to copy, share or read.
 */
export function NoteVerbs({
  text,
  attachments,
  onListRewrite,
  ticked = 0,
}: {
  /** The text on screen — the note's `draft`, so an unsaved sentence goes too. */
  text: string;
  /** The note's files, which Share sends with the words. */
  attachments: Attachment[];
  /**
   * Untick all and Clear done (`ListVerbs`), drawn ahead of the three while
   * the text holds a ticked box. Undefined where a list may not be rewritten
   * from here — a note in the trash, or one whose words are in conflict with
   * a newer copy — and then neither is drawn.
   */
  onListRewrite?: (rewrite: ListRewrite) => void;
  /** How many boxes in the text are ticked — see `ListVerbs` for why the
   *  caller counts rather than this row. */
  ticked?: number;
}) {
  // What Copy takes is the text on screen — `draft`, not `note.body` — so a
  // sentence typed and not yet committed is on the clipboard too. The bar
  // above stays at six marks (web/CLAUDE.md); Copy is a footer mark on the
  // meta row, which is where the note says things *about* itself.
  const [copiedNote, copyNote] = useCopied();
  // Share and Read aloud sit on the same row, and each is drawn only where
  // the browser can do it: desktop Firefox has no share sheet, and a browser
  // with no voices has nothing to read with. A mark that does nothing is a
  // lie, and Copy is right there for the first case.
  const shareable = canShare();
  const [shareFailed, setShareFailed] = useState(false);
  const { available: speakable, speaking, toggle: toggleSpeech } = useReadAloud();
  useEffect(() => {
    if (!shareFailed) return;
    const t = window.setTimeout(() => setShareFailed(false), COPIED_MS);
    return () => window.clearTimeout(t);
  }, [shareFailed]);

  /** Whether the note has words to copy, share or read aloud. */
  const hasWords = text.trim() !== "";

  /**
   * The words and the files, to the share sheet. The files are read from this
   * device where it has them, which is quick enough to stay inside the tap's
   * permission to open the sheet; one that has to come from the server may
   * outlast it, and the browser's refusal then shows as "could not share" rather
   * than as nothing. A file that cannot be reached at all is left out.
   */
  const shareNow = useCallback(async () => {
    const files = (
      await Promise.all(
        attachments.map(async (att) => {
          const blob = await fetchFile(att);
          return blob ? new File([blob], att.name, { type: att.mime || blob.type }) : null;
        }),
      )
    ).filter((f): f is File => f !== null);
    return shareNote(text, files);
  }, [attachments, text]);

  if (!(hasWords || (shareable && attachments.length > 0))) return null;

  return (
    <span className="meta-verb-row">
      {/* The list's two verbs, first. At the leading end of the row because
          the row is pinned to the right edge: added on the left they leave
          copy, share and read exactly where a hand already finds them, and
          they come and go with the ticked boxes without moving anything. */}
      {onListRewrite && (
        <ListVerbs done={ticked} className="meta-verb" onRewrite={onListRewrite} />
      )}
      {hasWords && (
      <button
        type="button"
        className="meta-verb"
        data-on={copiedNote}
        aria-label={copiedNote ? "Copied" : "Copy note text"}
        title={copiedNote ? "Copied" : "Copy"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void copyNote(text)}
      >
        <IconCopy on={copiedNote} tier="inline" />
      </button>
      )}
      {shareable && (
        <button
          type="button"
          className="meta-verb"
          data-on={shareFailed}
          aria-label={shareFailed ? "Could not share" : "Share note"}
          title={shareFailed ? "Could not share" : "Share"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            void shareNow().then((outcome) => {
              if (outcome === "failed") setShareFailed(true);
            })
          }
        >
          <IconShare tier="inline" />
          {/* The one word left in the strip, and it is a failure — which
              is the rule the app already keeps for `offline` and
              `still on the other device`: a mark can say a thing is on, it cannot say
              a thing refused. */}
          {shareFailed && <span>could not share</span>}
        </button>
      )}
      {speakable && hasWords && (
        <button
          type="button"
          className="meta-verb"
          data-on={speaking}
          aria-pressed={speaking}
          aria-label={speaking ? "Stop reading" : "Read note aloud"}
          title={speaking ? "Stop" : "Read aloud"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleSpeech(text)}
        >
          <IconSpeak on={speaking} tier="inline" />
        </button>
      )}
    </span>
  );
}
