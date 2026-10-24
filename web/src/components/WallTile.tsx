import { useState, type ReactNode } from "react";
import { useFileUrl } from "../store/useFileUrl";
import { fileKind, isImage, isVideo } from "../lib/files";
import type { WallFace } from "../lib/wall";
import { usePrint } from "../lib/usePrint";
import { IconPlay } from "./Icons";

/**
 * What stands inside an Inspiration tile's card button. The button itself —
 * press, hold, drag, selection, the keyboard — is `NoteCard`'s and is unchanged;
 * a tile is a card wearing another face (`web/CLAUDE.md`, "The Inspiration
 * wall"). A picture keeps its own tones even when the tile is selected: the
 * stylesheet inverts the ground and the words, never the photograph.
 *
 * Reached through a dynamic import (`NoteCard`), so the wall's faces cost the
 * first paint nothing: only an account that opens Inspiration ever fetches them.
 */
interface Props {
  tile: WallFace;
  selecting: boolean;
  selected: boolean;
  /** The quote card's words, already drawn by the card (same cut, same fade). */
  children?: ReactNode;
}

function PictureTile({ tile }: { tile: Extract<WallFace, { kind: "picture" }> }) {
  // The grid reads this device's own bytes where it has them and the thumbnail
  // where it does not, and never reaches across the network (`useFileUrl`).
  const att = tile.from === "file" && isImage(tile.att) ? tile.att : null;
  const { url } = useFileUrl(att, "card");
  // Bytes this browser cannot draw step down to the thumbnail, and a thumbnail
  // that will not draw either leaves the tile's own ground — never a broken box.
  const [failed, setFailed] = useState<readonly string[]>([]);
  const candidates = tile.from === "file" ? [url, tile.att.thumb] : [tile.link.image];
  const src = candidates.find((c): c is string => Boolean(c) && !failed.includes(c as string)) ?? "";
  // A picture that arrives late comes up out of the dark; one already here does not.
  const print = usePrint();
  return (
    <>
      <div className="wall-pic" style={{ aspectRatio: `1 / ${tile.ratio}` }}>
        {src && (
          <img
            className="wall-img"
            src={src}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            ref={print.ref}
            onLoad={print.onLoad}
            onError={() => setFailed((was) => [...was, src])}
          />
        )}
        {tile.from === "file" && tile.more > 0 && <span className="wall-more mono">+{tile.more}</span>}
        {((tile.from === "link" && tile.video) || (tile.from === "file" && isVideo(tile.att))) && (
          <span className="wall-play" aria-hidden>
            <IconPlay tier="inline" />
          </span>
        )}
      </div>
      {tile.caption && <span className="wall-caption">{tile.caption}</span>}
      {tile.from === "link" && <span className="wall-site mono">{tile.site}</span>}
    </>
  );
}

export function WallTile({ tile, selecting, selected, children }: Props) {
  return (
    <>
      {selecting && <span className="wall-tick mono">{selected ? "[x]" : "[ ]"}</span>}
      {tile.kind === "picture" ? (
        <PictureTile tile={tile} />
      ) : tile.kind === "title" ? (
        <div className="wall-title">
          <span className="wall-title-name">{tile.title}</span>
          {tile.site && <span className="wall-site mono">{tile.site}</span>}
        </div>
      ) : children ? (
        children
      ) : tile.file ? (
        /* No words and nothing to draw: the first file's name and kind, in the
           machine voice, so the tile is not an empty box. */
        <div className="wall-file">
          <span className="wall-file-name mono">{tile.file.name}</span>
          <span className="wall-file-kind mono">
            {fileKind(tile.file.name, tile.file.mime)}
            {tile.more ? ` +${tile.more}` : ""}
          </span>
        </div>
      ) : null}
    </>
  );
}
