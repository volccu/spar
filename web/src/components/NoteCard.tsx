import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Note } from "../types";
import { isCanvasIdea, SNAPSHOT_METRICS, type CanvasSnapshot } from "../lib/canvas";
import { noteName, openingLine } from "../lib/name";
import { wallFace, WALL_QUOTE_LINES } from "../lib/wall";
import {
  cardLines,
  cutDepth,
  deriveFace,
  isLinkNote,
  FILE_STRIP_LINES,
  LINK_STRIP_LINES,
  markHits,
  ROW_LINES,
  SLIP_LINES,
  wordsBesideLinks,
  type CardMetrics,
  type ChecklistItem,
} from "../lib/face";
import { goneCount, overlaySaved, previewsFor, titleAddsNothing, visiblePreviews } from "../lib/links";
import { linkRow, rowWords } from "../lib/linkRow";
import { peekLinesFor, usePeek } from "../lib/usePeek";
import { useReminderPassed, useRingMark, useTimeMark } from "../lib/clock";
import { cardName } from "../lib/cardName";
import { hasKeyboard } from "../lib/hotkeys";
import { markKeyOpen } from "../lib/keyOpen";
import { editedAt } from "../lib/versions";
import { daysLeftInTrash, trashMark } from "../lib/trash";
import { nextOccurrence, reminderDue } from "../lib/reminders";
import { useFileUrl } from "../store/useFileUrl";
import { fileIconKey, fileKind, isImage, isVideo } from "../lib/files";
import { isPdf } from "../lib/pdf";
import {
  IconCode,
  IconCut,
  IconFile,
  IconFileType,
  IconLink,
  IconMerge,
  IconPlay,
  IconPriority,
  IconReminder,
  IconTodo,
} from "./Icons";
import { SyncMark } from "./SyncMark";
import { LinkPreview } from "./LinkPreview";
import { NoteInline } from "./shared/NoteInline";
import { CardBody, drawsHit, ranksHits } from "./shared/CardBody";
import { FolderGlyph } from "./BoardLook";
import { usePrint } from "../lib/usePrint";
import { Pen } from "./shared/Pen";

/**
 * What stands inside an Inspiration tile. A dynamic import, so the wall's faces
 * cost the first paint nothing (the entry chunk's gzip ceiling,
 * `lib/buildInvariants.test.ts`): only a person who opens the board fetches it,
 * and the tile's button — the press, the hold, the keyboard — is drawn here
 * either way and never waits on it. `App` asks for the same chunk alongside the
 * wall's own, so by the time a tile mounts the module is already in memory.
 */
const WallTile = lazy(() => import("./WallTile").then((m) => ({ default: m.WallTile })));

/**
 * How long a press has to last to mean "select this".
 *
 * Exported because the board tab strip uses the same gesture for the same
 * reason (SPEC §6) and had declared its own 450 — tune one and the two stop
 * being the same gesture, which reads as one of them being broken. A
 * threshold, not motion, so it stays beside the press rather than going into
 * `lib/motion.ts` — the same call `PEEK_WAIT_MS` below makes.
 */
export const LONG_PRESS_MS = 450;

/** A held card's carry is the finger's, not the page's: no scroll under it. One
 *  function for every card, so letting go always takes off what holding put on. */
function holdPage(e: TouchEvent) {
  if (e.cancelable) e.preventDefault();
}

/**
 * A stable empty query, so a card with no search never re-reads its face.
 *
 * Exported because the board hands the same array down to every card it draws
 * (`hitTerms` in App.tsx) and a fresh `[]` per render would invalidate every
 * memo hanging off it — the identity is the whole point, so there may only be
 * one of it.
 */
export const NO_TERMS: string[] = [];

/* --- the Links board's row ---------------------------------------------------
   **This is not the rejected list/grid toggle.** web/CLAUDE.md refuses one for
   a reason that still holds: a toggle is a setting the user has to keep in
   their head, and it makes every screen two screens that have to be designed,
   measured and kept honest. Nothing here is switchable. The Links board — and
   only the Links board — draws its deck as rows, because a saved link carries
   four things at once (a picture, a title, a domain and the note's own words)
   and a ~160px phone column cannot hold four of anything. The board decides,
   the user is never asked, and there is no second view of any other board.

   **The row wears the page's picture** (owner picked mockup C, 2026-10-17): a
   64px square beside the words on a phone, and on a desktop the board becomes
   tiles in the grid's own columns with the picture across the top. It was
   taken off once, when most links had no stored picture and the column drew a
   stack of grey slabs; by 2026-10-17 most of them carry one. A link without
   one shows the link mark in the same square. The rest is unchanged: a name,
   the user's own words, and the site standing in the footer with the other
   machine data, and every row opens with a name you can read down.

   Everything else about a card is unchanged, deliberately. It is still exactly
   one `.card[data-id]` per note, still a button, still the same press, hold,
   drag, keyboard and leaving behaviour — only the geometry differs. Multi-
   select, the merge drag, `useGridReflow` and the keyboard walk all count
   elements per note, and they must go on counting one.

   How many lines of the note's own words a row shows is `ROW_LINES`, which
   lives in `lib/face.ts` beside `CARD_METRICS` because that is what it is — the
   row's `--card-lines` — and because `--row-lines` in styles.css has to agree
   with it. */

function CheckList({ items }: { items: ChecklistItem[] }) {
  return (
    <ul
      className="check-list"
      data-dim={drawsHit(items.flatMap((item) => item.segs))}
      data-ranked={ranksHits(items.flatMap((item) => item.segs))}
    >
      {items.map((item, i) => (
        <li className="check-item" data-done={item.done} key={i}>
          <span className="check-box">{item.done ? "[x]" : "[ ]"}</span>
          {/* An item's words go through the body's own inline path, so a search
              marks a hit in a to-do exactly as it does in a line of prose — and
              `**bold**` in an item is drawn rather than spelled out, which is
              what every other line of every other card face already does. Drawn
              as a bare string there was nowhere for a hit to go at all. */}
          <span className="check-text">
            <Pen>
              <NoteInline segs={item.segs} />
            </Pen>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CardFilePreview({ att }: { att: Note["attachments"][number] }) {
  const { url: local } = useFileUrl(isImage(att) ? att : null, "card");
  const [broken, setBroken] = useState<string | null>(null);
  const shot = (local !== broken ? local : null) ?? att.thumb ?? null;
  const print = usePrint();

  return (
    <div className="card-file-tile" data-image={Boolean(shot)}>
      {/* Lazy and decoded off the main thread, like the PDF viewer's pages:
          the swap from thumbnail to the full-size local bytes must never
          spend the board's own animation decoding photographs. */}
      {shot ? (
        <img
          className="card-shot"
          src={shot}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          data-doc={isPdf(att.mime, att.name) || undefined}
          ref={print.ref}
          onLoad={print.onLoad}
          onError={() => {
            // Bytes that will not decode here: the thumbnail still will.
            if (shot === local) setBroken(local);
          }}
        />
      ) : (
        <div className="card-file">
          <IconFileType kind={fileIconKey(att.name, att.mime)} tier="inline" />
          <span className="card-file-kind mono">{fileKind(att.name, att.mime)}</span>
          <span className="card-file-name">{att.name}</span>
        </div>
      )}
      {shot && isVideo(att) && (
        <span className="media-play" aria-hidden>
          <IconPlay tier="data" />
        </span>
      )}
    </div>
  );
}

/**
 * How many squares the strip under a note's words draws. Six run past the
 * widest column there is, so the strip always reaches the card's edge when the
 * note has that many; the footer's file mark carries the true count.
 */
const STRIP_FILES = 6;

/**
 * A note's files under its words, as a row of squares that runs off the card's
 * right edge and fades there, the way a cut line of text does (owner's sketch,
 * 2026-10-16). A single picture used to be stretched across the whole width
 * and cropped to a letterbox; a square crops every picture the same way, so a
 * row of them reads as a row. No "+N" over the last one: the fade says there is
 * more, and the footer says how many.
 */
function CardAttachmentStrip({ files }: { files: Note["attachments"] }) {
  const { frame, row } = useSquaresRow(Math.min(files.length, STRIP_FILES));
  return (
    <div className="card-attachment-strip" ref={frame}>
      <div className="card-strip-row" ref={row}>
        {files.slice(0, STRIP_FILES).map((att) => (
          <CardFilePreview key={att.id} att={att} />
        ))}
      </div>
    </div>
  );
}

/**
 * How many squares a card that is several files draws. Eight run past the
 * widest face there is; the footer's file mark carries the true count.
 */
const GRID_FILES = 8;

/**
 * A card that is several files and nothing else: squares, two rows of them,
 * the first one large where the face is wide (styles.css, `.card-file-grid`).
 * They used to share a two-column grid, so each tile was whatever shape six,
 * four or two of them left over, and a "+N" stood on the sixth.
 */
function CardFileGrid({ files }: { files: Note["attachments"] }) {
  const shown = Math.min(files.length, GRID_FILES);
  const { frame, row } = useSquaresRow(shown);
  return (
    <div className="card-file-grid" data-count={shown} ref={frame}>
      <div className="card-file-scroll" ref={row}>
        <div className="card-file-squares">
          {files.slice(0, GRID_FILES).map((att) => (
            <CardFilePreview key={att.id} att={att} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A row of squares that holds more than the card shows, and slides sideways
 * under a finger or a trackpad to show the rest (owner, 2026-10-16).
 *
 * `row` is the part that scrolls; `frame` stands still around it and carries
 * what the row is doing, because a fade drawn inside a scroller would scroll
 * away with the pictures:
 *
 * - `data-scrolls`: there is more than fits, so the row scrolls. Only then —
 *   a row that fits keeps the card's own `touch-action`, and a swipe across it
 *   pages the board as a swipe anywhere else on the card does. It is also what
 *   `useBoardPaging` reads (`SWIPES_ITSELF`) to leave a swipe that starts here
 *   to the row: the pictures move, the board does not.
 * - `data-over`: there are pictures past the right edge, so that edge fades.
 * - `data-before`: the row has been slid on, so the left edge fades too.
 *
 * Measured, not guessed, and written onto the nodes, like the board strip's
 * fades (`useStripOverflow`), so a scroll frame costs no render. `count` is how
 * many squares are drawn; a change re-measures.
 */
function useSquaresRow(count: number) {
  const frame = useRef<HTMLDivElement | null>(null);
  const row = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const box = frame.current;
    const el = row.current;
    if (!box || !el) return;
    const mark = () => {
      const scrolls = el.scrollWidth > el.clientWidth + 1;
      const more = scrolls && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      box.dataset.scrolls = scrolls ? "true" : "false";
      box.dataset.over = more ? "true" : "false";
      box.dataset.before = scrolls && el.scrollLeft > 1 ? "true" : "false";
    };
    mark();
    el.addEventListener("scroll", mark, { passive: true });
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    watch?.observe(el);
    return () => {
      el.removeEventListener("scroll", mark);
      watch?.disconnect();
    };
  }, [count]);
  return { frame, row };
}

/* --- the idea card's face ----------------------------------------------------
   An idea is a cover for a canvas, so its card is that canvas at card size —
   the same relationship a card has to a note. Every source note is drawn at the
   width and length it is actually set at, with its text as ghost rules: full
   ones where the line runs the width of the column, short ones where it stops
   early, gaps where the note has a blank line. That is enough to recognise a
   canvas you arranged yourself without reading a word of it.

   The line is drawn at a fraction of the leading it sits in, so a page of text
   reads as texture rather than as a solid block, and the fade to nothing at the
   40-line mark keeps one long note from shrinking everything beside it. */
const GHOST_H = 7;

function IdeaSnapshot({ snapshot }: { snapshot: CanvasSnapshot }) {
  const PAD = 36;

  const { viewBox, content } = useMemo(() => {
    const { shapes, strokes, labels, pictures } = snapshot;
    const empty = { viewBox: "0 0 260 206", content: null };
    if (shapes.length === 0 && strokes.length === 0 && labels.length === 0 && pictures.length === 0) {
      return empty;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const see = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };

    for (const shape of shapes) {
      see(shape.x, shape.y);
      see(shape.x + shape.w, shape.y + shape.h);
    }
    for (const label of labels) {
      see(label.x, label.y);
      see(label.x + label.w, label.y + label.lines.length * SNAPSHOT_METRICS.LINE_H);
    }
    for (const picture of pictures) {
      see(picture.x, picture.y);
      see(picture.x + picture.w, picture.y + picture.h);
    }
    for (const stroke of strokes) {
      for (const [px, py] of stroke.points) see(px, py);
    }

    if (!isFinite(minX)) return empty;

    const { PAD_X, PAD_Y, LINE_H } = SNAPSHOT_METRICS;
    const inset = (LINE_H - GHOST_H) / 2;

    return {
      viewBox: `${minX - PAD} ${minY - PAD} ${Math.max(120, maxX - minX + PAD * 2)} ${Math.max(
        90,
        maxY - minY + PAD * 2,
      )}`,
      content: (
        <>
          {/* Under everything, as on the canvas, where they are what is drawn on. */}
          {pictures.map((picture) => (
            <rect
              className="idea-snapshot-image"
              key={picture.id}
              x={picture.x}
              y={picture.y}
              width={picture.w}
              height={picture.h}
            />
          ))}
          {shapes.map((shape) => (
            <g key={shape.id}>
              <rect
                className="idea-snapshot-note"
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
              />
              {/* The corner square means the same here as it does on the board. */}
              {shape.priority && (
                <rect
                  className="idea-snapshot-priority"
                  x={shape.x}
                  y={shape.y}
                  width={9}
                  height={9}
                />
              )}
              {shape.lines.map((fill, i) =>
                fill === 0 ? null : (
                  <rect
                    className="idea-snapshot-line"
                    key={i}
                    x={shape.x + PAD_X}
                    y={shape.y + PAD_Y + i * LINE_H + inset}
                    width={(shape.w - PAD_X * 2) * fill}
                    height={GHOST_H}
                  />
                ),
              )}
              {shape.image && (
                <rect
                  className="idea-snapshot-image"
                  x={shape.x + PAD_X}
                  y={shape.y + PAD_Y + shape.lines.length * LINE_H + 6}
                  width={shape.image.w}
                  height={shape.image.h}
                />
              )}
            </g>
          ))}
          {labels.map((label) =>
            label.lines.map((fill, i) =>
              fill === 0 ? null : (
                <rect
                  className="idea-snapshot-line"
                  key={`${label.id}-${i}`}
                  x={label.x}
                  y={label.y + i * LINE_H + inset}
                  width={label.w * fill}
                  height={GHOST_H}
                />
              ),
            ),
          )}
          {/* Highlights under the ink, filled shapes filled, as the canvas draws them. */}
          {[...strokes.filter((s) => s.highlight), ...strokes.filter((s) => !s.highlight)].map((stroke) => {
            if (stroke.points.length < 2) return null;
            const [first, ...rest] = stroke.points;
            let d = `M ${first[0]} ${first[1]}`;
            for (const [px, py] of rest) {
              d += ` L ${px} ${py}`;
            }
            return (
              <path
                key={stroke.id}
                className="idea-snapshot-stroke"
                data-highlight={stroke.highlight || undefined}
                d={d}
                stroke={stroke.color}
                style={stroke.fill ? { fill: stroke.color } : undefined}
                strokeWidth={Math.max(2, stroke.width)}
              />
            );
          })}
        </>
      ),
    };
  }, [snapshot]);

  return (
    <div className="idea-snapshot">
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden>
        {content}
      </svg>
    </div>
  );
}

/* --- the peek ----------------------------------------------------------------
   A cut card tells you there is more and shows you none of it, which on a
   desktop — where the pointer is already resting on the card and nothing is
   being scrolled — is a question the screen could simply answer. Resting on a
   card lifts it and lets it run on down over its neighbours.

   Three rules keep it from becoming a nuisance. It waits, so sweeping the
   pointer across the board sets nothing off. It only fires for a mouse, so a
   phone never sees it. And it is bounded: three cards' worth of reading, not
   the note — opening the note is still what shows you the note.

   The wait is the whole feel of it, and it is a threshold rather than a piece
   of motion, which is why it lives here beside the long press and not in
   motion.ts. It has to be long enough that crossing a card is not an
   instruction and short enough that stopping on one is answered rather than
   considered — 380 was measurably the wrong side of that, and read as the
   screen deciding whether to bother.

   The grid does not move. `grid-auto-rows` pins every row at --card-h, so the
   card grows *out of* its row rather than stretching it, and the cards around
   it stay exactly where the eye left them. */
const PEEK_WAIT_MS = 150;
const PEEK_LINES = 24;

interface Props {
  note: Note;
  /** The rect is where the note grows from, and shrinks back into. */
  onOpen: (note: Note, from: DOMRect) => void;
  onLongPress: (note: Note) => void;
  /**
   * A right-click with a mouse: the card joins the selection and the
   * selection's panel opens at the pointer, where a desktop looks for the
   * verbs (review 2026-10-01, UX-11). Absent, or for any other pointer, a
   * right-click is the long press said the desktop way, as it always was.
   */
  onPointerMenu?: (note: Note, at: { x: number; y: number }) => void;
  onMergeDragStart: (note: Note, x: number, y: number) => void;
  onMergeDragMove: (note: Note, x: number, y: number) => void;
  onMergeDragEnd: (note: Note) => void;
  /**
   * The drag was taken away rather than finished, and nothing may be merged.
   *
   * `pointercancel` used to be wired straight to `onPointerUp`, which is the
   * *commit* path — it ends the drag, and the board merges whenever a target
   * is standing under the finger. But a cancel is the browser saying the
   * gesture is no longer the app's: it fires when the scroll the card now
   * declines (`touch-action: pan-y` in styles.css) is claimed anyway, when a
   * second finger arrives, when the window loses the pointer. Committing there
   * merged two notes, archived both sources and opened the canvas for a
   * gesture the user had abandoned — recoverable only through the 8-second
   * undo, if it was noticed at all.
   *
   * Optional, and its default is written out of the two props above rather
   * than left empty on purpose: a cancel that only cleared this card's own ref
   * would leave the *board* holding a drag nobody is dragging any more. Saying
   * "the pointer is nowhere" and then ending clears the target first, so the
   * end path has nothing to merge — correct with no change to the caller at
   * all. A caller that has a cancel of its own should pass it.
   */
  onMergeDragCancel?: (note: Note) => void;
  selecting: boolean;
  selected: boolean;
  mergeDragging: boolean;
  mergeTarget: boolean;
  /** Draw the border once: this is the note just written, or just closed. */
  trace: boolean;
  /** Lines and line width this card can actually hold. */
  metrics: CardMetrics;
  /** Whether pending attachment bytes can currently be sent. */
  online?: boolean;
  /** The canvas behind an idea card, drawn as the card's face. */
  snapshot?: CanvasSnapshot;
  /**
   * Already has a home in a folder, so All draws it as somewhere it is
   * merely also visible — the caller decides that scope, this just draws it.
   * Styling only: no change to sort order, and the priority flag (drawn from
   * `--ink` unconditionally) stays full strength regardless.
   *
   * Named `filed` and documented as "carries a currently-pinned tag, on the
   * All board", which described neither what it holds nor the board as it then
   * stood: tags are gone, and that board was called Recent for the whole life
   * of the sentence. It is called All again now — for the shelf's own reasons,
   * nothing to do with the v1 board of that name. It also collided with a local
   * `filed` further down that holds an *attachment*.
   */
  inBoard?: boolean;
  /**
   * The name of the board `inBoard` refers to, for the folder mark's title —
   * "Filed in Groceries" rather than a mark that says nothing about which
   * folder. Only read when `inBoard` is true.
   */
  boardName?: string;
  /**
   * The mark that board's owner chose for it (`UserBoard.icon`), drawn in the
   * filed mark's place so All tells Home from Work at a glance. Muted and
   * untinted like every footer mark; the folder stands in for none, for a name
   * this build does not know and until the set has loaded (`boardGlyph`).
   */
  boardIcon?: string;
  /**
   * Draw this note as a full-width row rather than as a card in the grid.
   *
   * The Links board, and nothing else — scoped by the caller exactly like
   * `inBoard`. It replaces `bareLinks`, which suppressed the note's own words
   * on that board because a ~160px phone column could not fit them beside the
   * link's title and domain. Losing what the user wrote was the wrong half to
   * give up; a row has the width to keep all of it.
   */
  row?: boolean;
  /**
   * Draw this note as a tile on the Inspiration wall — the one board with a
   * geometry of its own after Links. Same button, same press, hold, merge drag
   * and keyboard; only the interior differs, and there is no footer (a wall is
   * looked at, and the stamp, marks and counts are one tap away in the note).
   */
  wall?: boolean;
  /** This tile's place in board order — what the keyboard walks in, because the
   *  wall's DOM order is column by column. */
  pos?: number;
  /**
   * The card is standing on the Todos board, where every card is a to-do and
   * the footer's to-do mark would only repeat the board (review UI-11) — the
   * same reason the folder mark stands down on the folder you are standing on.
   */
  onTodos?: boolean;
  /**
   * The card is on the Reminders list: the footer's time slot says when the
   * reminder rings rather than how old the note is, and the clock mark is
   * drawn on every card there, however far ahead it rings (review UX-06).
   */
  reminders?: boolean;
  /**
   * Whether there is anywhere for a file to be sent — a server this device is
   * signed in to. Without one (this browser only, the demo, signed out) a file
   * waiting for the other device is waiting for nothing, and the animated
   * "sending" mark ran for ever (review UI-05). Left undefined it is true,
   * which is what every caller meant before it existed.
   */
  sendsFiles?: boolean;
  /**
   * The words the user is searching for, or nothing when no search is running.
   *
   * A card normally shows the note from its first character. While a search is
   * running it instead starts at the first line that matched and draws the
   * matched words at full ink with the rest of the face one step down, so a hit
   * two hundred lines into a long note is legible from the board rather than
   * being something you have to open the note to understand.
   */
  terms?: string[];
  /**
   * Where this card stands in the tab order, for a caller running a roving
   * tabindex over the grid — 0 for the one card the strip hands focus to, -1
   * for every other.
   *
   * A grid of bare `<button>`s is one tab stop a card, so on All with 400
   * notes there are 400 presses of Tab between the board row and the capture
   * bar: the keyboard's own way past the grid is to walk every note in it.
   * The board strip beside it has answered this for as long as it has had
   * tabs, and `lib/useGridKeyboard.ts` already owns the other half of the
   * pattern — arrows, Home/End and Enter move focus between cards from a
   * listener on the window, which keeps working whatever a card's tabindex
   * says, because `.focus()` reaches a `tabIndex={-1}` element perfectly well.
   *
   * Left undefined it is exactly what it always was — an ordinary button, its
   * own tab stop — so this prop can never make the grid unreachable on its
   * own. It is the caller taking the whole grid down to one stop that finishes
   * the job, and the caller then owns which card that is.
   */
  tabIndex?: number;
}

function NoteCardBase({
  note,
  onOpen,
  onLongPress,
  onPointerMenu,
  onMergeDragStart,
  onMergeDragMove,
  onMergeDragEnd,
  // Reads the two props destructured above it, which is the whole point of
  // the default — see `onMergeDragCancel` in Props. Never reorder these three.
  onMergeDragCancel = (dropped: Note) => {
    onMergeDragMove(dropped, -1, -1);
    onMergeDragEnd(dropped);
  },
  selecting,
  selected,
  mergeDragging,
  mergeTarget,
  trace,
  metrics,
  online = true,
  snapshot,
  inBoard = false,
  boardName,
  boardIcon,
  row = false,
  wall = false,
  pos,
  onTodos = false,
  reminders = false,
  sendsFiles = true,
  terms = NO_TERMS,
  tabIndex,
}: Props) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const mergeDraggingRef = useRef(false);
  // Subscribes to the shared clock, but only re-renders this card when the
  // words themselves change — which for most of the archive is never.
  //
  // The stamp counts from the last *edit*, not from the capture, because that
  // is the number the board is now sorted on and a card whose position and
  // whose stamp disagree is a board you cannot read. For the 237 notes that
  // have never been touched since they were written the two are the same date,
  // so nothing about the archive looks any different.
  const stamp = useTimeMark(editedAt(note));
  // On the Reminders list the same slot says when it rings instead — "" when
  // the card is anywhere else, so the hook is always called and costs nothing.
  const ring = useRingMark(reminders ? note : null);
  // A missed one-off says so in that slot on every board, in the open note's
  // overdue grammar — ink beside a 3px rule — rather than the note's age,
  // which read exactly like any other card's (review FX-B-04).
  const passed = useReminderPassed(note.reminder_at ? note : null);

  const el = useRef<HTMLButtonElement | null>(null);
  /** The tile this note is on the wall, or null on every other board. */
  const tile = useMemo(() => (wall ? wallFace(note) : null), [wall, note]);
  /** The pointer type of the last press on this card (see `onContextMenu`). */
  const pressedBy = useRef<string | null>(null);

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  /** This card is holding the page still (`holdPage`). */
  const holding = useRef(false);
  /** Let the page scroll again once a held card is let go — only if this card stopped it. */
  function releasePage() {
    if (!holding.current) return;
    holding.current = false;
    document.removeEventListener("touchmove", holdPage);
  }
  useEffect(() => releasePage, []);

  // Long-press enters multi-select (SPEC §6). Card swipe is deliberately not
  // used for anything — horizontal swipe belongs to board paging.
  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    // A pointer focus (a tap, or a click on the way to opening the note) must
    // not grow the card — see onFocus below.
    pointerFocus.current = true;
    // What pressed the card, for the right-click below: a phone's long press
    // fires `contextmenu` too, and that one must stay a long press.
    pressedBy.current = e.pointerType;
    // Only the primary button holds a card. A right-click is already the long
    // press said the desktop way and is answered whole by `onContextMenu`
    // below, so arming the timer for it only meant the same gesture being
    // answered twice — and leaving `fired` set on a card whose press never
    // ended in a click, where it waits to swallow a later one.
    if (e.button !== 0) return;
    // A selected card can still be held and carried as the whole selection.
    // Leave unselected cards to the ordinary selection click path.
    if (selecting && !selected) return;
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      // Held: from here the finger carries the card, up to the shelf as well
      // as across (`lib/shelfDrop.ts`), and a card is `pan-y` — so the page
      // must not take a vertical carry as a scroll and cancel it. Only once
      // held, as the board carry does (`useBoardPress`): before that the same
      // touch is free to be the scroll it may turn out to be.
      holding.current = true;
      document.addEventListener("touchmove", holdPage, { passive: false });
      if (!selecting) onLongPress(note);
    }, LONG_PRESS_MS);
  }

  /**
   * Walking the grid from the keyboard moves focus, not a pointer, so the
   * card that lands under it has no "hover" to grow on. Focus is the
   * keyboard's resting hand, so it answers the same question: peek the card
   * that is focused, the way a mouse resting on one does. A pointer focus is
   * skipped, and selection suppresses it exactly as the pointer version does.
   */
  function onFocus() {
    if (pointerFocus.current) {
      pointerFocus.current = false;
      return;
    }
    startPeek();
  }

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    clearTimer();
    // Swallow the click that ends a long press, or it would open the note.
    if (fired.current) {
      fired.current = false;
      return;
    }
    // Shift, Ctrl or Cmd with the click picks the card, as in mail and files
    // (review 2026-10-24, UX-07); the plain click opens it.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      dropPeek(false);
      onLongPress(note);
      return;
    }
    // The second click of a double-click has nothing to add to a card whose
    // whole action is "open this". `detail` counts the run, so this is the
    // browser's own idea of what a double-click is rather than a timer of ours
    // guessing at one. Only on the path that opens: while a selection is on, a
    // click is a *toggle*, and a run of them is somebody picking notes out
    // quickly — swallowing the second there would drop a card off a selection
    // for no reason the user could see.
    if (e.detail > 1 && !selecting) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // The sheet grows out of this rect and shrinks back into it, and by the time
    // it closes the card is back in its row — so a grown card hands over the
    // rect it is about to return to, not the one it is standing at.
    const from =
      peeking.current && typeof DOMRect === "function"
        ? new DOMRect(rect.left, rect.top, rect.width, collapsed.current)
        : rect;
    dropPeek(false);
    // A key's click carries no pointer, so `detail` is 0; a phone's tap is 1.
    // Only a device with a keyboard counts, so a screen reader's activation
    // never raises a phone's keyboard (lib/keyOpen.ts).
    markKeyOpen(e.detail === 0 && hasKeyboard(false) ? note.id : null);
    onOpen(note, from);
  }

  /**
   * Space on a focused card picks it, like Ctrl+click (review 2026-10-24,
   * UX-07); Enter still opens. The button's own click for Space is refused on
   * both halves of the press, as browsers differ on which one fires it.
   */
  function onSpace(e: React.KeyboardEvent<HTMLButtonElement>, press: boolean) {
    if (e.key !== " " || e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    e.preventDefault();
    if (!press || e.repeat) return;
    dropPeek(false);
    onLongPress(note);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!fired.current) {
      clearTimer();
      return;
    }
    e.preventDefault();
    if (!mergeDraggingRef.current) {
      mergeDraggingRef.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onMergeDragStart(note, e.clientX, e.clientY);
    }
    onMergeDragMove(note, e.clientX, e.clientY);
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    clearTimer();
    releasePage();
    pointerFocus.current = false;
    if (!mergeDraggingRef.current) return;
    mergeDraggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onMergeDragEnd(note);
  }

  /**
   * The gesture was taken away, which is the one ending that may never commit.
   *
   * This was `onPointerUp` — the same function on both events — so a drag the
   * browser cancelled arrived at `onMergeDragEnd`, which merges whenever a
   * target is set. Two notes joined, both sources archived, the canvas opened,
   * for a gesture the user never finished. `pointercancel` is reachable with a
   * finger on the board (a scroll claimed mid-drag, a second finger arriving,
   * the window losing the pointer), so this is not a theoretical branch.
   *
   * No `releasePointerCapture` here, unlike the release above: the capture is
   * implicitly released as part of firing `pointercancel`, and the pointer id
   * is no longer active by the time this runs — asking for it back throws.
   */
  function onPointerCancel() {
    clearTimer();
    releasePage();
    pointerFocus.current = false;
    if (!mergeDraggingRef.current) return;
    mergeDraggingRef.current = false;
    onMergeDragCancel(note);
  }

  // Reading a face means walking the note for tick boxes, addresses and code,
  // and it happens for every card on the board. It depends on exactly two
  // things, and `metrics` only changes when the window does.
  // Memoised like the face beside it: `previewsFor` is a regex walk over the
  // whole body, and this ran on every render of every card. The locals are
  // kept apart because the Links row names itself from the user's own words,
  // which only the local unfurl carries.
  const localLinkPreviews = useMemo(() => previewsFor(note.body), [note.body]);
  const allLinkPreviews = useMemo(
    () => overlaySaved(localLinkPreviews, note.link_previews),
    [localLinkPreviews, note.link_previews],
  );
  // The ones the owner has not put away (`hidden` on the link's stored entry).
  // The strip, its count and its lines are all drawn from these; the Links
  // row below and the card's name keep the whole list, because a row *is* the
  // note's address and a hidden preview is only a box that was put away.
  const linkPreviews = useMemo(() => visiblePreviews(allLinkPreviews), [allLinkPreviews]);
  // Read off the drawn previews, not the stored list, so an address edited
  // out of the text takes its "gone" with it.
  const gone = goneCount(linkPreviews);
  const attachmentLines = (note.attachments?.length ?? 0) > 0 ? FILE_STRIP_LINES : 0;
  // Asked of `face.ts`, which is what will actually decide. This used to be a
  // second copy of the rule, built on a wider idea of what counts as an
  // address, so a note whose only link was a bare "www." host reserved three
  // lines here for a preview that `deriveFace` then declined to draw — a card
  // three lines short with blank space in the middle of it.
  const linkFaceCandidate = linkPreviews.length > 0 && isLinkNote(note);
  /**
   * How many of the card's lines the strip of links gets, and so how many
   * links it can name.
   *
   * **Three**, as it always has been, whenever the note has words of its own to
   * print underneath — the strip may not eat the note.
   *
   * **The whole card** when it has none. A note that is ten Google Maps
   * addresses and nothing else has an empty face: `stripUrls` leaves it
   * nothing, so the three lines were the strip's ceiling and the other five
   * were blank. Now the addresses *are* the note, and the card says so
   * (2026-09-19). One line is left to the budget below, which is the minimum
   * `Math.max` enforces anyway and costs an empty face nothing.
   */
  const linkStripLines = !linkFaceCandidate
    ? 0
    : linkPreviews.length > 1 && wordsBesideLinks(note) === ""
      ? Math.max(LINK_STRIP_LINES, metrics.lines - 1)
      : LINK_STRIP_LINES;
  const reservedLines = attachmentLines > 0 ? attachmentLines : linkStripLines;
  /**
   * How many links the strip names outright.
   *
   * When there are more links than lines to put them on, the last line goes to
   * the count rather than to one more name: "+8 more" is a fact the reader can
   * act on, and a seventh name they cannot finish reading is not. A single line
   * is the floor, so a strip always names at least one link.
   */
  const shownLinks =
    linkPreviews.length > linkStripLines
      ? Math.max(1, linkStripLines - 1)
      : linkStripLines;
  /**
   * The row this note is on the Links board, or null everywhere else and for
   * a note with no link — `lib/linkRow.ts` holds the name-and-site rule.
   */
  const linkRowData = useMemo(
    () => (row ? linkRow(allLinkPreviews, localLinkPreviews) : null),
    [row, allLinkPreviews, localLinkPreviews],
  );
  const rowLink = linkRowData?.link ?? null;
  const rowName = linkRowData?.name ?? null;
  const rowSite = linkRowData?.site ?? null;
  /**
   * The page's own picture on a Links row: the one the unfurl already stored
   * with the link, never fetched for the row. Not for a preview the owner hid —
   * they put that box away, and the row would be bringing it back.
   */
  const rowPic =
    rowLink && rowLink.hidden !== true && rowLink.image?.startsWith("data:") ? rowLink.image : null;
  /**
   * The name, with the words a search matched cut out of it.
   *
   * Marked as plain text rather than through `plainInline`: `flatLine` has
   * already read the note's markup and drawn it as words, so what arrives here
   * is a finished line and a second pass over it would read an asterisk the
   * user typed as emphasis they did not.
   */
  const rowNameSegs = useMemo(
    () => (rowName === null ? [] : markHits([{ text: rowName }], terms)),
    [rowName, terms],
  );
  /**
   * How many lines of the note's own words this shape can hold. A row is set to
   * its own fixed number rather than to the card's, because its height is built
   * on that number and not on `--card-lines`; a card keeps the existing rule,
   * where a preview or an attachment strip takes its lines off the top.
   *
   * `charsPerLine` is left exactly as measured either way — `useCardMetrics`
   * reads the width off whichever shape is actually on screen, so a row's wider
   * measure is already in it.
   *
   * It asks **whether** there is a row link and never the link itself.
   * `linkPreviews` was rebuilt from the note's text on every render until it
   * was memoised (e5e7dbc), so `rowLink` was a fresh object each time, and
   * naming it here re-minted `budget` every render — which matters because
   * `budget` is the key `deriveFace` caches on. Every row on the Links board
   * re-read its whole note for addresses, tick boxes and code on every
   * render, for a shape that had not changed. The memo would cover it now;
   * the boolean is kept because the shape is all `budget` depends on.
   */
  const rowShape = Boolean(rowLink);
  const budget = useMemo<CardMetrics>(
    () =>
      wall
        ? { ...metrics, lines: WALL_QUOTE_LINES }
        : rowShape
          ? { ...metrics, lines: ROW_LINES }
          : { ...metrics, lines: Math.max(1, metrics.lines - reservedLines) },
    [metrics, reservedLines, rowShape, wall],
  );
  // `terms` arrives already memoized by App (`hitTerms`), so its identity is
  // stable until the query itself changes and every memo below can depend on
  // it directly. The default is a module-level constant for the same reason: a
  // fresh `[]` per render would invalidate all of them on every render.
  const searching = terms.length > 0;
  const idea = isCanvasIdea(note);
  /**
   * A slip: on the Todos board, a to-do whose whole text fits in `SLIP_LINES`
   * is drawn a third of a card tall (owner picked mockup B, 2026-10-17). Only
   * plain words qualify — a list, a link, a file or an idea keeps its full
   * card — and only when nothing is cut, so a slip never has more to show and
   * never peeks. `onTodos` is already off while searching.
   *
   * The character budget only picks the candidates, and it is given one line
   * more than a slip holds: it is a cautious guess (`useCardMetrics`' FILL), and
   * at two lines' worth it sent a 78-character sentence that sets in two lines
   * on a desktop column to a full card. The real test is the rendered words —
   * the effect below measures them and hands back a full card if they run past
   * `SLIP_LINES`, before the frame is painted.
   */
  const slipBudget = useMemo<CardMetrics | null>(
    () =>
      onTodos && !wall && !rowShape && !idea && (note.attachments?.length ?? 0) === 0
        ? { ...metrics, lines: SLIP_LINES + 1 }
        : null,
    [onTodos, wall, rowShape, idea, note.attachments, metrics],
  );
  const slipFace = useMemo(
    () => (slipBudget ? deriveFace(note, slipBudget, terms) : null),
    [note, slipBudget, terms],
  );
  /** The words and the measure a "does not fit" was found for; anything else is measured afresh. */
  const [slipRefused, setSlipRefused] = useState<string | null>(null);
  const slipKey = `${metrics.charsPerLine}|${note.body ?? ""}`;
  const slip =
    slipFace !== null &&
    slipFace.kind === "text" &&
    slipFace.remaining === 0 &&
    slipRefused !== slipKey;
  useLayoutEffect(() => {
    if (!slip) return;
    const body = el.current?.querySelector<HTMLElement>(".card-body");
    // Nothing laid out (a test's DOM, a card skipped off screen): keep the guess.
    if (!body || body.clientHeight === 0) return;
    if (body.scrollHeight > body.clientHeight + 1) setSlipRefused(slipKey);
  }, [slip, slipKey]);
  const flat = useMemo(
    () => (slip && slipFace ? slipFace : deriveFace(note, budget, terms)),
    [slip, slipFace, note, budget, terms],
  );
  /**
   * The name the user gave this note, if they gave it one — an idea's and a
   * plain note's alike (`lib/name.ts`). An idea draws it as a row over its
   * picture; any other card draws its own first line in the same voice.
   */
  const name = noteName(note.body);
  /** An unnamed idea's first words, drawn under its picture (`openingLine`). */
  const ideaLine = idea && !name ? openingLine(note.body) : null;
  /**
   * Whether resting on this card has anything to add. A cut note has more to
   * read; a photo is cropped to the card and has more to see. Everything else
   * is already showing all of itself, and growing it would be a move that
   * answered nothing.
   *
   * An idea is the clearest case of that. Its face is a canvas scaled to fit,
   * so a taller card is the same picture drawn larger — nothing is revealed,
   * and the drawing stretches out from under the pointer for no reason. The
   * note's own text is long enough to be cut, so the cut test alone said yes;
   * the face it would have grown is not the face the card is wearing.
   */
  const canPeek =
    !wall &&
    !idea &&
    (cutDepth(flat) > 0 ||
      // One picture, cropped to the card, has more to see. Several are squares
      // at a fixed size, and a taller card would only add empty face under them.
      (flat.kind === "file" && flat.files.length === 1 && flat.files[0].thumb !== null));
  // The handlers above reach these at event time, after this render has run.
  /**
   * How many lines the grown card may hold, and the pixels it may stand on:
   * it stops at the write bar (review UI-B-01). A long note grew without limit
   * and its fade, footer and last line sat under the bar on a laptop. Measured
   * once, as the rest completes — the card's top and the bar's top.
   */
  const [peekRoom, setPeekRoom] = useState<{ lines: number; px: number } | null>(null);
  const { peek, peeking, collapsed, pointerFocus, startPeek, dropPeek } = usePeek({
    el,
    wait: PEEK_WAIT_MS,
    selecting,
    canPeek,
    onBeforePeek: (node) => {
      const bar = document.querySelector(".capture")?.getBoundingClientRect();
      if (!bar) return setPeekRoom(null);
      const px = Math.floor(bar.top - node.getBoundingClientRect().top - 1);
      const lh = parseFloat(getComputedStyle(node).getPropertyValue("--card-lh")) || 19.5;
      // Padding 11 + 8, the gap, the 22px footer: 47; a row adds its name line,
      // and a desktop tile the picture standing over its words.
      const rowFace = rowShape ? node.querySelector<HTMLElement>(".card-row-face") : null;
      const overFace = rowFace
        ? Math.max(0, rowFace.offsetTop - parseFloat(getComputedStyle(node).paddingTop))
        : 0;
      const chrome = 47 + (rowShape ? lh : 0) + overFace;
      const resting = rowShape ? ROW_LINES : metrics.lines;
      setPeekRoom({ px, lines: peekLinesFor(px, chrome, lh, resting, PEEK_LINES) });
    },
  });
  const peekLines = peekRoom?.lines ?? PEEK_LINES;

  // A Links row is as tall as what it holds, so its grid track is `auto` and
  // would grow with it, shoving every row below down the list (review UI-24).
  // A grown row therefore hands back what it grew by as a negative bottom
  // margin: the track is sized on the margin box, so it stays at the height
  // the row was resting at and the row runs on over its neighbours, exactly
  // as a card does in the pinned grid.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !rowShape) return;
    const extra = peek ? node.offsetHeight - collapsed.current : 0;
    node.style.marginBottom = extra > 0 ? `${-extra}px` : "";
  }, [peek, rowShape, collapsed]);

  // The grown face is a second read of the same note at a taller budget. Held
  // apart from the flat one so that leaving the card does not re-read either.
  const tall = useMemo(
    () =>
      peek
        ? deriveFace(
            note,
            {
              ...metrics,
              lines: rowLink ? peekLines : peekLines - reservedLines,
            },
            terms,
          )
        : null,
    [peek, note, metrics, reservedLines, rowLink, terms, peekLines],
  );
  const face = tall ?? flat;
  /**
   * An idea is drawn as its canvas, files and all: a picture set on a sketch
   * is one thing on it among the strokes and the words, never the whole card.
   */
  const asCanvas = idea && snapshot !== undefined;
  const files = face.kind === "file" && !asCanvas ? face.files : [];
  const depth = cutDepth(face);
  const cut = depth > 0;
  // Splitting the face into lines now also reads the emphasis in each one, and
  // it happens for every line of every card on the board. It depends on the
  // face body and nothing else, so it is worth holding on to.
  const lines = useMemo(() => cardLines(face.body, terms), [face.body, terms]);
  /** The row's words, with the sentence the title already says taken off — `rowWords`. */
  const rowBody = useMemo(
    () => (linkRowData ? rowWords(linkRowData, face.body) : ""),
    [linkRowData, face.body],
  );
  const rowLines = useMemo(() => cardLines(rowBody, terms), [rowBody, terms]);

  /**
   * The picture, at the quality this device can actually reach for free.
   *
   * The thumbnail is 320px on its long edge and a desktop column runs to 323,
   * so a portrait photo blown up to fill a landscape card is visibly soft. On
   * the machine the file came from the real bytes are already in the local
   * store, which costs a read and no network at all — so the card draws those,
   * and falls back to the thumbnail on the device the file merely arrived at.
   * Deliberately "local": a board that fetched every full-size photo in it
   * would be paying for the whole grid to open one card.
   */
  const fileFace = face.kind === "file" && !asCanvas ? face.file : null;
  // Only an image has real bytes an <img> can take. A PDF's face is its first
  // page, drawn once when it was attached and carried in the note ever since —
  // there is nothing on disk to reach for and nothing sharper to reach for it
  // with, so the thumbnail is the picture rather than the stand-in for one.
  // A wall tile draws its own picture (`WallTile`), so the card does not read
  // the same bytes a second time for a face it is not wearing.
  const picture = !tile && fileFace && isImage(fileFace) ? fileFace : null;
  const { url: local } = useFileUrl(picture, "card");
  const [brokenShot, setBrokenShot] = useState<string | null>(null);
  const printShot = usePrint();
  const shot = (local !== brokenShot ? local : null) ?? fileFace?.thumb ?? null;

  /** Files this device has and the other one has not been given yet. */
  const pendingUpload = (note.attachments ?? []).some((a) => a.path === null);
  // A pending local file is not actively moving while the browser is offline.
  // Keep the problem legible as a word instead of leaving a working animation
  // running until the next connection.
  // Neither is said where nothing is ever sent: a file kept in this browser
  // only is not on its way anywhere, and not held up by being offline either.
  const sending = sendsFiles && pendingUpload && online;
  const offline = sendsFiles && pendingUpload && !online;

  // Without an explicit label the accessible name is the card's whole text —
  // which for a 15k-char wall is unusable. Announce the opening, not the mass.
  // The cut mark is drawn, so it says nothing on its own — the fact that there
  // is more has to reach the accessible name some other way.
  // A file card draws a picture and no words at all, so its name has to come
  // from the file — "FILE: Empty note" is what it would otherwise announce.
  // A named idea announces its name. That is what the name is for, and the
  // alternative is announcing the first sixty characters of a composition the
  // card is not showing.
  //
  // `lib/cardName.ts` builds it, and says in words what the footer draws.
  // How many days the trash gives this note before the next sweep destroys
  // it, on a card that is actually in the trash: nowhere else already says
  // this. The stamp says it ("29d", "today") and nothing in the footer
  // repeats it.
  const trashDays = note.status === "trashed" ? daysLeftInTrash(note) : null;
  const hasReminder = nextOccurrence(note) !== null;
  const label = cardName({
    kind: face.kind,
    idea,
    todo: note.note_type === "todo",
    name: name ?? face.title,
    body: face.body,
    items: face.kind === "checklist" ? face.items : [],
    fileName: face.file?.name ?? null,
    linkTitle: allLinkPreviews[0]?.title ?? null,
    files: files.length,
    cut,
    checkDone: face.checkDone,
    checkCount: face.checkCount,
    priority: note.priority > 0,
    reminder: !hasReminder ? "none" : passed ? "passed" : "set",
    boardName: inBoard ? (boardName ?? null) : null,
    archived: note.status === "archived",
    trashDaysLeft: trashDays,
  });

  // A reminder only earns a mark once it is close — see REMINDER_SOON_MS —
  // except on the Reminders list, where every card is there for its reminder.
  const remindingSoon = reminderDue(note);
  const overdue = passed;
  const reminderMark = remindingSoon || (reminders && hasReminder);

  const cardButton = (
    <button
      ref={el}
      type="button"
      className="card"
      // The grid measures its cards by this to work out what moved and what
      // left, so it has to be on the element that carries the position.
      data-id={note.id}
      aria-label={label}
      aria-pressed={selecting ? selected : undefined}
      data-face={face.kind}
      data-priority={note.priority}
      data-archived={note.status === "archived"}
      data-filed={inBoard}
      data-search={searching}
      data-selected={selected}
      data-peek={peek}
      data-merge-dragging={mergeDragging}
      data-merge-target={mergeTarget}
      data-idea={idea}
      data-row={Boolean(rowLink)}
      data-slip={slip || undefined}
      data-wall={wall || undefined}
      data-tile={tile?.kind}
      data-pos={wall ? pos : undefined}
      data-has-files={
        !tile && !rowLink && face.kind !== "file" && (note.attachments?.length ?? 0) > 0
      }
      // The clamp on the body, the height of a picture and the budget the face
      // was cut to are all the same number, so the grown card only has to say
      // it once and CSS follows. A row's words are clamped by --row-lines, for
      // the same reason its height is: the two shapes count different things.
      style={
        wall
          ? ({ "--card-lines": WALL_QUOTE_LINES } as CSSProperties)
          : peek
            ? rowLink
              ? ({ "--row-lines": peekLines, "--peek-room": peekRoom ? `${peekRoom.px}px` : undefined } as CSSProperties)
              : ({ "--card-lines": peekLines, "--peek-room": peekRoom ? `${peekRoom.px}px` : undefined } as CSSProperties)
            : slip
              ? ({ "--card-lines": SLIP_LINES } as CSSProperties)
              : undefined
      }
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={(e) => onSpace(e, true)}
      onKeyUp={(e) => onSpace(e, false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onFocus={onFocus}
      onBlur={() => dropPeek(true)}
      onPointerEnter={(e) => {
        // A mouse hovers. A finger and a pen "enter" on contact, which is a tap
        // — the peek must never be something a phone can trigger.
        if (e.pointerType !== "mouse") return;
        startPeek();
      }}
      onPointerLeave={() => dropPeek(true)}
      onContextMenu={(e) => {
        // Desktop right-click is the natural sibling of a long press.
        //
        // The refusal comes first and is unconditional: a card is never a
        // place the operating system's own menu is wanted — every verb it
        // offers is about a document, and this is a note. It used to sit after
        // the selection guard, and by the time a *held* right button reached
        // here the 450ms timer had already turned selection on — so holding
        // the button both picked the card out and dropped the UA menu on top
        // of the board, one gesture answered twice. Prevent, then branch.
        e.preventDefault();
        // With a mouse, the menu a desktop expects: the card is picked and
        // the selection's verbs open beside the pointer, not in a corner up
        // to a screen's width away (review 2026-10-01, UX-11). A selection
        // already running takes this card in rather than starting over.
        // `button` 2 is the mouse's own right button; the keyboard's menu key
        // sends 0 and has no pointer position to open at.
        if (onPointerMenu && pressedBy.current === "mouse" && e.button === 2) {
          dropPeek(false);
          onPointerMenu(note, { x: e.clientX, y: e.clientY });
          return;
        }
        if (selecting) return;
        dropPeek(false);
        onLongPress(note);
      }}
    >
      {tile ? (
        /* An Inspiration tile: a picture, a title card or a quote, in a button
           that is otherwise this card's. The quote's words are drawn here, with
           the card's own cut and fade, and handed in; a list of tick boxes is
           its words, and keeps them. */
        <Suspense fallback={null}>
          <WallTile tile={tile} selecting={selecting} selected={selected}>
            {face.kind === "checklist" ? (
              <CheckList items={face.items} />
            ) : (
              face.body && <CardBody lines={lines} cut={face.remaining > 0} name={name} />
            )}
          </WallTile>
        </Suspense>
      ) : rowLink ? (
        /* The Links board's row: a name, and then the note's own words at the
           full measure — about 62 characters a line where a card gets 48, which
           is the 80px the picture used to take handed back to what the user
           wrote. Nothing is split out of the note to make it: the name is read
           off the link the note already carries, exactly as the preview reads
           it. The site is in the footer, with the rest of the machine data. */
        <>
          {/* The page's picture: a square beside the words on a phone, the top
              of the tile on a desktop. The link mark stands under it, so a page
              with no picture, or one that will not decode, still says what the
              row is. */}
          <span className="card-row-pic" aria-hidden>
            <IconLink tier="nav" />
            {rowPic && (
              <img
                className="card-row-shot"
                src={rowPic}
                alt=""
                draggable={false}
                decoding="async"
                onError={(e) => {
                  e.currentTarget.hidden = true;
                }}
              />
            )}
          </span>
          <div className="card-row-face">
            <span className="card-row-title" data-dim={drawsHit(rowNameSegs)}>
              <NoteInline segs={rowNameSegs} />
            </span>
            {/* The note's own words. A checklist keeps its boxes, since that is
                what its words are. */}
            {face.kind === "checklist" ? (
              <CheckList items={face.items} />
            ) : rowBody ? (
              <CardBody lines={rowLines} cut={face.remaining > 0} />
            ) : null}
          </div>
        </>
      ) : face.kind === "file" && face.file && !asCanvas ? (
        // The picture is the card. A screenshot sent over from the other
        // machine is recognised at a glance, which is the whole reason this
        // beats hunting for the newest row in a file list.
        // A name is drawn over it the way an idea's is over its canvas —
        // naming a photograph must not trade it for a line of words.
        <>
          {name && <span className="card-idea-name">{name}</span>}
          {files.length > 1 ? (
            <CardFileGrid files={files} />
          ) : shot ? (
            // Lazy and decoded off the main thread, like the PDF viewer's
            // pages: the swap from thumbnail to the full-size local bytes must
            // never spend the board's own animation decoding photographs.
            <img
              className="card-shot"
              src={shot}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              // A document page is drawn as a negative from its top (styles.css).
              data-doc={isPdf(face.file.mime, face.file.name) || undefined}
              ref={printShot.ref}
              onLoad={printShot.onLoad}
              onError={() => {
                // Bytes that will not decode here: the thumbnail still will.
                if (shot === local) setBrokenShot(local);
              }}
            />
          ) : (
            <div className="card-file">
              <IconFileType kind={fileIconKey(face.file.name, face.file.mime)} tier="nav" />
              <span className="card-file-kind mono">
                {fileKind(face.file.name, face.file.mime)}
              </span>
              <span className="card-file-name">{face.file.name}</span>
            </div>
          )}
          {files.length <= 1 && shot && isVideo(face.file) ? (
            // A film's frame: the play mark stands in the top corner, clear
            // of the footer the bottom one would sit on.
            <span className="media-play media-play-top" aria-hidden>
              <IconPlay tier="data" />
            </span>
          ) : null}
        </>
      ) : face.kind === "checklist" ? (
        // A named list keeps its boxes, with the name over them in the same
        // voice; the face spent one line fewer on items to leave it room. A
        // title line the user wrote above the boxes stands in the same place.
        <>
          {(name ?? face.title) && <span className="card-idea-name">{name ?? face.title}</span>}
          <CheckList items={face.items} />
        </>
      ) : idea && snapshot ? (
        // An idea card is a picture of a canvas, so unlike every other card it
        // shows none of the note's words — which is exactly why the name has
        // to be drawn here explicitly. Without it a shelf of ideas is a shelf
        // of grey miniatures, and the only way to tell one from another is to
        // open all of them. Unnamed, nothing is drawn: a row reading "Idea"
        // over a picture of an idea is a label, and cards carry no labels.
        <>
          {name && <span className="card-idea-name">{name}</span>}
          <IdeaSnapshot snapshot={snapshot} />
          {/* Unnamed, the picture alone left a merge's two notes as two grey
              boxes and a number — and the sources are archived, so this card is
              their only trace on the board (review UX-A-09). It carries the
              note's own first words, one line, never a label of the app's. */}
          {!name && ideaLine && <span className="card-idea-line">{ideaLine}</span>}
        </>
      ) : (
        <div className={face.kind === "link" ? "card-link-face" : undefined}>
          {face.body && <CardBody lines={lines} cut={face.remaining > 0} name={name} />}
          {face.kind === "link" && linkPreviews.length > 0 && (
            linkPreviews.length === 1 ? (
              /* One address gets the picture. It is the shape the app has
                 always drawn for a saved link and the one case where an
                 og:image is worth 58px of a card: there is a single page
                 behind this note and this is what it looks like. */
              <div className="card-link-previews">
                <LinkPreview
                  preview={linkPreviews[0]}
                  compact
                  untitled={titleAddsNothing(linkPreviews[0], localLinkPreviews[0], face.body)}
                />
              </div>
            ) : (
              /* Several addresses get a ledger, one line each, no pictures
                 — the same rule the Links board arrived at for the same
                 reason (`web/CLAUDE.md`): ten links from one site draw ten
                 identical grey slabs, and the slab sits in the strongest
                 position on the row holding the weakest thing on it.

                 Name first, because that is what makes the left edge
                 readable, and the site behind it in mono. `title` is the
                 user's own words for that link where they wrote any
                 (`nameFor` in `lib/links.ts`), the page's og:title once one
                 has been fetched, and the domain when there is neither — in
                 which case the site beside it is the same word, so it is
                 dropped rather than printed twice.

                 The last line is spent on the count when there are more
                 links than lines, because "+8 more" is the fact the reader
                 needs and an eighth name they cannot see is not. */
              <ul
                className="card-link-list"
                style={{ "--card-link-lines": linkStripLines } as CSSProperties}
              >
                {linkPreviews.slice(0, shownLinks).map((preview) => (
                  <li className="card-link-line" key={preview.href}>
                    <span className="card-link-name">{preview.title}</span>
                    {preview.title !== preview.domain && (
                      <span className="card-link-site mono">{preview.domain}</span>
                    )}
                  </li>
                ))}
                {linkPreviews.length > shownLinks && (
                  <li className="card-link-more mono">
                    +{linkPreviews.length - shownLinks} more
                  </li>
                )}
              </ul>
            )
          )}
        </div>
      )}

      {/* Not on a row: the strip is three card lines tall and a row's height is
          built on a different count entirely, so it would be the one thing on
          the Links board that broke the uniform row. The footer's file mark
          still says the note is carrying something, which is the job it already
          has on every card that shows its words. */}
      {!tile && !rowLink && face.kind !== "file" && (note.attachments?.length ?? 0) > 0 && (
        <CardAttachmentStrip files={note.attachments} />
      )}

      {/* A wall tile has no footer: a wall is looked at, and the stamp, the marks
          and the counts are one tap away in the note. */}
      {!tile && (
        <>
          {/* The tick lives here, in the row that already carries machine data,
              rather than in a header row of its own. */}
          <div className="card-foot mono" data-cut={cut} data-overdue={overdue || undefined}>
            {/* The site, on a Links row, at the leading edge of the one row that
                already carries machine data — mono beside mono, so the domains
                line up down the whole board on the footer's own rule. It cost a
                19.5px line box of its own above the words before, for 10.5px of
                text, which is the trade this board was built the wrong way round
                on. Never on a card: everywhere else the domain is in the face. */}
            {rowSite && <span className="card-row-domain">{rowSite}</span>}
            {/* Every mark in the row, in one box. The footer is a fixed 22px
                band with an unbounded number of things competing for it, and the
                stamp is the one child that may never be squashed or clipped — so
                the marks are gathered into a box of their own, and that box is
                what runs out of room and clips when a mark-heavy note meets a
                narrow column. The row then has exactly two children, the marks
                and the stamp, and the stamp survives whatever the marks do. */}
            <span className="card-marks">
              {selecting && <span className="card-tick">{selected ? "[x]" : "[ ]"}</span>}
              {/* Priority, and it moved here from the card's own top-left corner.
                  The corner was right for the 9px square it used to be — furniture
                  scale, belonging to the card the way the card's rules do — and is
                  wrong for a glyph, which floating over the first line is exactly
                  the "element placed near the text" the square was flush in the
                  corner to avoid. The footer is where this app already keeps every
                  mark that says something about a note, at the one tier they are all
                  drawn at, on a band that runs across every card on the board — so
                  it is still scanned in one sweep, and it can never collide with a
                  word. Leading edge, ahead of what the note merely contains: it is
                  the only thing in this row that is a decision somebody made. */}
              {note.priority > 0 && (
                <span className="card-priority" title="Marked important">
                  <IconPriority on tier="data" />
                </span>
              )}
              {/* And beside it, the other thing somebody decided about this note:
                  that it is a to-do. Same tier, same full ink, same leading corner
                  of the row, for the same reason the flag is there — these two are
                  the only marks in the footer that report a *choice* rather than
                  something the note merely contains.

                  `note_type` and deliberately not `isTodoNote`. The shelf's Todos
                  board and the open note's toggle both ask the wider predicate,
                  which also says yes to a note whose every line is a tick box —
                  and on a card that note is already *drawing* its boxes at full
                  size, so a mark for it would be the footer repeating the face.
                  That is the rule this row already keeps for the tick-box mark
                  itself. What is left is the case nothing else on the card can
                  say: a note marked as a to-do whose words are ordinary prose.
                  And never on the Todos board, which already says it of every
                  card on it. */}
              {note.note_type === "todo" && !onTodos && (
                <span className="card-todo" title="Marked as a to-do">
                  <IconTodo on tier="data" />
                </span>
              )}
              <span className="cut-mass">
                {depth !== 0 && <IconCut depth={depth} />}
              </span>
              {/* A note that shows its words still has to say it is carrying
                  something — the same job, and the same shape of mark, the link
                  count already does. Not drawn on a card that *is* the file. */}
              {/* A card that is several files shows the first few as squares and
                  fades the rest, so it counts them here too. */}
              {face.fileCount > 0 && (face.kind !== "file" || face.fileCount > 1) && (
                <span className="card-link">
                  <IconFile tier="data" />
                  {face.fileCount > 1 && <span className="link-n">{face.fileCount}</span>}
                </span>
              )}
              {face.linkCount > 0 && (
                <span className="card-link">
                  <IconLink />
                  {face.linkCount > 1 && <span className="link-n">{face.linkCount}</span>}
                </span>
              )}
              {/* A link whose page answered 404 or 410 the last time it was
                  asked (`LinkPreview.gone`, re-asked monthly by the unfurl hook).
                  A word and not a mark, beside the link mark it is about: a mark
                  can say a thing is on, and this is a thing that failed, which is
                  why `offline` is a word too. On the Links board's row it lands in
                  the same footer, beside the site. Counted only past one, like
                  every count in this row — "2 gone" on a note of ten links. */}
              {gone > 0 && (
                <span className="card-sync-word mono" title="The page is no longer there">
                  {gone > 1 ? `${gone} gone` : "gone"}
                </span>
              )}
              {/* What is in the note, said in the row that already carries machine
                  data. Both of these are routinely below the cut — the card face is
                  eight lines and a list of things to do often starts on the tenth —
                  so the board can otherwise show you nothing about them at all.

                  A tick box is the characters `[ ]` everywhere else in this app, so
                  it is the characters here too — but only while no box is drawn on
                  the face (`boxesShown`): a titled list or a note whose boxes are
                  in view gets the bare count, like the list face. Code has no such word and takes the
                  icon set's.

                  The count beside the box is progress — `done/total`, "4/9" — in
                  the machine face like every other count here. It is drawn on a
                  card that *is* the list as well, without the `[ ]`: the boxes are
                  right there at full size, so the characters would be the footer
                  repeating the face, but the face shows the first eight items and
                  says nothing about how far through all of them you are. Both
                  numbers are the face's own (`checkCount`, `checkDone`), one walk
                  over one definition of a box, so the fraction and the boxes
                  drawn above it cannot disagree. It lives in the marks box and not
                  beside the stamp, so on a narrow card it is a mark that clips and
                  never the stamp that moves. */}
              {face.checkCount > 0 && (
                <span
                  className={face.boxesShown ? "card-link card-progress" : "card-link card-boxes"}
                  title={`${face.checkDone} of ${face.checkCount} ticked`}
                >
                  {!face.boxesShown && "[ ]"}
                  <span className="link-n">{`${face.checkDone}/${face.checkCount}`}</span>
                </span>
              )}
              {face.codeInside && (
                <span className="card-link">
                  <IconCode />
                </span>
              )}
              {/* A reminder only earns a mark once it is close (REMINDER_SOON_MS) —
                  three weeks of clock icons on every card that has ever had a
                  reminder set would be exactly the noise "a mark only earns its
                  place" exists to prevent. What it says once it does earn one is
                  inside the note, which is still what shows you the note. On the
                  Reminders list every card earns it, and the stamp beside it
                  says when it rings rather than how old the note is. */}
              {reminderMark && (
                <span
                  className="card-link"
                  title={
                    overdue
                      ? "This reminder has passed"
                      : remindingSoon
                        ? "Reminder due soon"
                        : "Reminder set"
                  }
                >
                  <IconReminder />
                </span>
              )}
              {/* A file that has not reached the other device yet says so on the
                  board, not only inside the note — the board is where you look to
                  know whether you can shut the laptop. The same mark the sync state
                  uses, because it is the same fact. */}
              {sending && (
                <span
                  className="mark-state"
                  data-state="working"
                  title="Sending to your other device"
                >
                  <SyncMark />
                </span>
              )}
              {/* The count says what the idea was composed from. A sketch was
                  composed from nothing — it is a canvas born empty — so it has no
                  count to claim and the mark stands down. */}
              {idea && (note.merged_from?.length ?? 0) > 0 && (
                <span className="idea-mark" title={`Idea from ${note.merged_from?.length} notes`}>
                  <IconMerge tier="data" />
                  <span>{note.merged_from?.length}</span>
                </span>
              )}
              {offline && <span className="card-sync-word mono">offline</span>}
              {/* Where this note lives, on the boards where that is otherwise
                  unknown (All, search, Archive) — said by the folder's own mark
                  in the row that already carries every other fact about a note,
                  rather than by dimming the card and dashing its rules to report a
                  fact about filing (`data-filed` still drives that styling change;
                  see styles.css). No hue: this mark is `--muted` like every other
                  one here, whatever tint the folder carries on its own tab. */}
              {inBoard && (
                <span className="card-filed" title={boardName ? `Filed in ${boardName}` : "Filed"}>
                  <FolderGlyph icon={boardIcon} tier="data" />
                </span>
              )}
            </span>
            <span className="card-time">
              {overdue ? "passed" : ring || (trashDays !== null ? trashMark(trashDays) : stamp)}
            </span>
          </div>
        </>
      )}

      {/* Four strokes, drawn as two paths from the top-left corner: one along
          the top and down the right, one down the left and along the bottom,
          meeting at the bottom-right. Mounted only while it plays, so the
          animation starts from the beginning every time. */}
      {trace && (
        <span className="trace" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </span>
      )}
    </button>
  );

  // The Links board's row is the one card with an address of its own to open
  // (review FX-A-01, SPEC §13): the site name in its footer is a link, so the
  // page is one tap away where it used to be two. An anchor cannot stand inside
  // a button, so it is the button's **sibling** in a wrapper, laid over the
  // footer's site text; the rest of the row still opens the note. It stands
  // down while a selection runs, when a tap on the row means "pick it".
  if (!rowLink) return cardButton;
  return (
    <div className="card-row-wrap">
      {cardButton}
      {!selecting && rowSite && (
        <a
          className="card-row-site"
          href={rowLink.href}
          target="_blank"
          rel="noopener"
          aria-label={`Open ${rowSite}`}
          title={`Open ${rowSite}`}
          style={{ "--row-site-ch": Math.min(rowSite.length, 22) } as CSSProperties}
        />
      )}
    </div>
  );
}

export const NoteCard = memo(NoteCardBase);
