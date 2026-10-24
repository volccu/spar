import { useState } from "react";
import { hiddenCount, visiblePreviews, type LinkPreviewData } from "../lib/links";
import { IconClear } from "./Icons";
import { LinkPreview } from "./LinkPreview";

/** How many previews the open note draws before the rest wait behind a row. */
export const PREVIEWS_SHOWN = 3;

interface Props {
  /** Every preview the note draws, hidden ones included (`mergedPreviews`). */
  previews: LinkPreviewData[];
  /** Puts one preview away. Absent where a write is not on offer (the trash):
   *  the buttons are then not drawn at all. */
  onHide?: (href: string) => void;
  /** Brings the given previews back — every hidden one, in one press. */
  onShowHidden?: (hrefs: string[]) => void;
}

/**
 * The stack of previews above the open note's text.
 *
 * A long note of links used to stack one box per link at the top, and the
 * words started a screen down. So at most `PREVIEWS_SHOWN` are drawn and a row
 * says how many more there are ("Show 5 more", which opens them for as long as
 * the note stays open — the state is this component's and is never stored), and
 * each box carries a button that puts it away. Hidden is a flag on the link's
 * entry in `link_previews`, never a change to the text: the address stays in
 * the note, live. A last row says how many are hidden and brings them all
 * back.
 *
 * The button is a **sibling** of the link, never inside it — a button inside an
 * anchor is invalid, and a press would also follow the link.
 */
export function LinkPreviewList({ previews, onHide, onShowHidden }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (previews.length === 0) return null;
  const visible = visiblePreviews(previews);
  const shown = expanded ? visible : visible.slice(0, PREVIEWS_SHOWN);
  const behind = visible.length - shown.length;
  const hidden = hiddenCount(previews);
  return (
    <div className="link-previews">
      {shown.map((preview) => (
        <div className="link-preview-item" key={preview.href}>
          <LinkPreview preview={preview} interactive />
          {onHide && (
            <button
              type="button"
              className="iconbtn link-preview-hide"
              aria-label={`Hide preview of ${preview.domain}`}
              title="Hide preview"
              onClick={() => onHide(preview.href)}
            >
              <IconClear />
            </button>
          )}
        </div>
      ))}
      {behind > 0 && (
        <button type="button" className="link-previews-row mono" onClick={() => setExpanded(true)}>
          Show {behind} more
        </button>
      )}
      {hidden > 0 && onShowHidden && (
        <button
          type="button"
          className="link-previews-row mono"
          onClick={() =>
            onShowHidden(previews.filter((preview) => preview.hidden === true).map((preview) => preview.href))
          }
        >
          {hidden} hidden · show
        </button>
      )}
    </div>
  );
}
