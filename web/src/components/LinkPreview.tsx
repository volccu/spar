import type { LinkPreviewData } from "../lib/links";
import { leaveForLink } from "../lib/returnState";
import { IconLink } from "./Icons";

interface Props {
  preview: LinkPreviewData;
  compact?: boolean;
  interactive?: boolean;
  /** The card already says these words above the box: show the site and the address only. */
  untitled?: boolean;
}

/**
 * The square face of a link: its Open Graph picture when one was fetched and
 * stored, the link mark when there is none.
 *
 * Local to the preview. It was exported for the Links board's rows, which drew
 * this same square at the head of every row until the row became a ledger line
 * with no picture on it at all: most pages carry no `og:image`, so what that
 * column actually drew was a stack of identical grey slabs in the position the
 * eye lands on first. The picture is enrichment: a preview that never unfurled,
 * or whose image fails to decode, still leaves the mark standing.
 */
function LinkThumb({ preview }: { preview: LinkPreviewData }) {
  return (
    <span className="link-preview-thumb" aria-hidden>
      <IconLink tier="inline" />
      {preview.image?.startsWith("data:") && (
        <img
          className="link-preview-image"
          src={preview.image}
          alt=""
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
}

function Content({ preview, compact, untitled }: { preview: LinkPreviewData; compact: boolean; untitled: boolean }) {
  return (
    <>
      <LinkThumb preview={preview} />
      <span className="link-preview-copy">
        <span className="link-preview-domain mono">
          {preview.domain}
          {/* The page answered 404 or 410 the last time it was asked
              (`LinkPreview.gone`). Said as a word, in the machine voice
              beside the site, because it is a failure and a failure here is
              a word — the rule that keeps `offline` one. The title and the
              picture stay: they are still the best account of what the link
              was. Not on a card's compact preview, whose footer already
              says it (`NoteCard`), so a card never says it twice. */}
          {!compact && preview.gone && <span className="link-preview-gone"> · gone</span>}
        </span>
        {!untitled && <strong className="link-preview-title">{preview.title}</strong>}
        {preview.description && (
          <span className="link-preview-description">{preview.description}</span>
        )}
        <span className="link-preview-url">{preview.href}</span>
      </span>
    </>
  );
}

/** A local-first unfurl: it never needs a remote metadata request to render. */
export function LinkPreview({ preview, compact = false, interactive = false, untitled = false }: Props) {
  const className = `link-preview${compact ? " link-preview-compact" : ""}${
    interactive ? " link-preview-interactive" : ""
  }`;
  if (interactive) {
    return (
      <a
        className={className}
        href={preview.href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => leaveForLink(e, preview.href)}
      >
        <Content preview={preview} compact={compact} untitled={untitled} />
      </a>
    );
  }
  return (
    <div className={className} aria-hidden>
      <Content preview={preview} compact={compact} untitled={untitled} />
    </div>
  );
}
