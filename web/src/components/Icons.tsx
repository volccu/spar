/**
 * The app's marks — Heroicons, imported one SVG component at a time.
 *
 * Every glyph is a deep per-icon import (`@heroicons/react/24/outline/XIcon`),
 * never a barrel import of the set. The package is `sideEffects: false` and
 * each icon is its own module, so the bundle carries exactly the marks below
 * and nothing else.
 *
 * Three rules hold the set together:
 *
 *   Outline is the resting state. A mark only goes solid to say the control is
 *   *on* — priority set, archived, menu open. That is the same "inverted means
 *   engaged" grammar the rest of the chrome uses, said in the icon itself.
 *
 *   Three sizes, and the tier is a prop, never a hard-coded width:
 *     nav    24px — bar controls. What you navigate and act with.
 *     inline 20px — controls inside a row or a panel, beside their own label.
 *     data   14px — footer marks that sit on a monospace baseline. They are
 *                   typography, not targets: `.card-foot` is a fixed 20px box
 *                   with 6px of padding, so 14 is the largest mark that fits
 *                   without every card on the board growing.
 *
 *   Weight is mapped, not inherited. Heroicons draws a 1.5 stroke on a 24 grid;
 *   scaled into a 20 or 14 box that stroke thins out and the mark goes lighter
 *   than the text beside it. Each tier sets `--icon-stroke` in *user units* so
 *   the rendered stroke lands back at 1.5px, and `--icon-weight` scales it with
 *   the font-weight of whatever it is standing next to (see styles.css).
 *
 * Two marks have no Heroicon and are drawn here to match one: `IconCut`, the
 * level of text still under the card's cut, and the sync mark in SyncMark.tsx.
 * Both follow the same 24 grid, 1.5 stroke and round caps as the imported set.
 *
 * Eighteen more are drawn for a different reason — they *do* have Heroicons,
 * and these are those exact drawings cut into their own subpaths so a part of
 * each can move under the pointer. See the "marks whose parts move" note
 * further down; the drawings are unchanged, only the number of nodes they
 * arrive in is.
 *
 * The solid variants are not among them. A mark goes solid to say a control is
 * on, and the solid set is a different drawing — one filled shape, with no
 * parts to take hold of. So an engaged mark does not answer the pointer, which
 * is the right way round anyway: it is already saying something.
 */

import Cog6ToothIcon from "@heroicons/react/24/outline/Cog6ToothIcon";
import ArrowDownTrayIcon from "@heroicons/react/24/outline/ArrowDownTrayIcon";
import ArrowUpTrayIcon from "@heroicons/react/24/outline/ArrowUpTrayIcon";
import CalendarDaysIcon from "@heroicons/react/24/outline/CalendarDaysIcon";
import CubeIcon from "@heroicons/react/24/outline/CubeIcon";
import DocumentTextIcon from "@heroicons/react/24/outline/DocumentTextIcon";
import FilmIcon from "@heroicons/react/24/outline/FilmIcon";
import IdentificationIcon from "@heroicons/react/24/outline/IdentificationIcon";
import InformationCircleIcon from "@heroicons/react/24/outline/InformationCircleIcon";
import MusicalNoteIcon from "@heroicons/react/24/outline/MusicalNoteIcon";
import PhotoIcon from "@heroicons/react/24/outline/PhotoIcon";
import PresentationChartBarIcon from "@heroicons/react/24/outline/PresentationChartBarIcon";
import TableCellsIcon from "@heroicons/react/24/outline/TableCellsIcon";
import ArrowDownIcon from "@heroicons/react/24/outline/ArrowDownIcon";
import ArrowLeftIcon from "@heroicons/react/24/outline/ArrowLeftIcon";
import ArrowRightIcon from "@heroicons/react/24/outline/ArrowRightIcon";
import ArrowRightOnRectangleIcon from "@heroicons/react/24/outline/ArrowRightOnRectangleIcon";
import ArrowTopRightOnSquareIcon from "@heroicons/react/24/outline/ArrowTopRightOnSquareIcon";
import ArrowUpIcon from "@heroicons/react/24/outline/ArrowUpIcon";
import ArrowUturnLeftIcon from "@heroicons/react/24/outline/ArrowUturnLeftIcon";
import ArrowsPointingOutIcon from "@heroicons/react/24/outline/ArrowsPointingOutIcon";
import CalendarIcon from "@heroicons/react/24/outline/CalendarIcon";
import ScissorsIcon from "@heroicons/react/24/outline/ScissorsIcon";
import ChevronLeftIcon from "@heroicons/react/24/outline/ChevronLeftIcon";
import ChevronRightIcon from "@heroicons/react/24/outline/ChevronRightIcon";
import CheckIcon from "@heroicons/react/24/outline/CheckIcon";
import ClipboardIcon from "@heroicons/react/24/outline/ClipboardIcon";
import ClockIcon from "@heroicons/react/24/outline/ClockIcon";
import CodeBracketIcon from "@heroicons/react/24/outline/CodeBracketIcon";
import PlayIcon from "@heroicons/react/24/outline/PlayIcon";
import DocumentIcon from "@heroicons/react/24/outline/DocumentIcon";
import DocumentPlusIcon from "@heroicons/react/24/outline/DocumentPlusIcon";
import HandRaisedIcon from "@heroicons/react/24/outline/HandRaisedIcon";
import PencilIcon from "@heroicons/react/24/outline/PencilIcon";
import SunIcon from "@heroicons/react/24/outline/SunIcon";
import ShareIcon from "@heroicons/react/24/outline/ShareIcon";
import SpeakerWaveIcon from "@heroicons/react/24/outline/SpeakerWaveIcon";
import SpeakerXMarkIcon from "@heroicons/react/24/outline/SpeakerXMarkIcon";
import Squares2X2Icon from "@heroicons/react/24/outline/Squares2X2Icon";
import RectangleStackIcon from "@heroicons/react/24/outline/RectangleStackIcon";

import type { FileIconKey } from "../lib/files";

import ArrowPathIcon from "@heroicons/react/24/outline/ArrowPathIcon";
import ArrowPathRoundedSquareIcon from "@heroicons/react/24/outline/ArrowPathRoundedSquareIcon";
import DocumentMinusIcon from "@heroicons/react/24/outline/DocumentMinusIcon";

import ArchiveBoxSolid from "@heroicons/react/24/solid/ArchiveBoxIcon";
import ArrowPathSolid from "@heroicons/react/24/solid/ArrowPathIcon";
import Bars3Solid from "@heroicons/react/24/solid/Bars3Icon";
import Bars3BottomLeftSolid from "@heroicons/react/24/solid/Bars3BottomLeftIcon";
import CheckCircleSolid from "@heroicons/react/24/solid/CheckCircleIcon";
import ClockSolid from "@heroicons/react/24/solid/ClockIcon";
import FlagSolid from "@heroicons/react/24/solid/FlagIcon";
import FolderSolid from "@heroicons/react/24/solid/FolderIcon";
import InboxSolid from "@heroicons/react/24/solid/InboxIcon";

/** nav = a control on a bar, inline = a control in a row, data = a footer mark. */
type Tier = "nav" | "inline" | "data";

interface IconProps {
  /** Filled rather than outlined — used for the state a control is *in*. */
  on?: boolean;
  /** Override the mark's default tier. Only the file mark needs it: it is a
      panel control in the note and a footer mark on the card. */
  tier?: Tier;
}

type Glyph = (props: { className?: string; "aria-hidden"?: boolean }) => React.ReactNode;

/**
 * One mark, at one tier. The className is the entire styling surface — size and
 * stroke are CSS, so a tier can be retuned in one place rather than in sixteen
 * components.
 */
export function mark(Glyph: Glyph, tier: Tier) {
  return <Glyph className={`icon icon-${tier}`} aria-hidden />;
}

/**
 * A mark drawn here rather than imported, at one tier.
 *
 * Same box, same grid, same caps and joins the imported set is drawn with, so
 * a drawing that lands here is indistinguishable from one that came out of the
 * package. `stroke-width` is deliberately absent: `.icon` in styles.css sets
 * the mapped stroke and the children inherit the computed value, which is the
 * same route the imported marks take once their own attribute is overridden.
 */
function drawn(tier: Tier, parts: React.ReactNode) {
  return (
    <svg
      className={`icon icon-${tier}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
    >
      {parts}
    </svg>
  );
}

/* --- marks whose parts move ------------------------------------------------
   A mark answers the pointer by moving one of its own parts — the trash lid
   tips open, the folder's flap swings, the plus turns. Heroicons draws every
   glyph as a *single* <path>: several disconnected subpaths inside one `d`,
   one node in the DOM, and therefore nothing for CSS to take hold of. So the
   marks below are drawn here instead, from that same path data cut at its own
   subpath boundaries and nothing else.

   Cut, not redrawn. Every subpath keeps its commands exactly as the package
   wrote them; the only edit is that a subpath's leading *relative* move (`m`,
   which starts wherever the previous subpath happened to end) becomes the
   absolute `M` of the point it was already starting from. Nothing is
   reshaped, rescaled or re-simplified, so every one is pixel-identical to the
   imported drawing at rest — which matters well beyond the shelf, since most
   of these also stand in the open note, the capture bar and the insert panel,
   where nothing animates and the mark simply has to be the mark.

   The stroke order changes (the lid's fragments have to be adjacent to be
   grouped) and cannot show: every subpath is the same opaque `currentColor`
   stroke at the same width, so where two overlap they paint the same pixels
   in either order.

   The motion itself is entirely in styles.css, under "nav marks answer the
   pointer" — these components only name the parts. */

/**
 * The bin, with its lid as a part that can be taken hold of.
 *
 * The lid is not one shape in this drawing: it is five fragments of rim plus
 * the handle, which is why they are grouped rather than classed one by one.
 * What stays behind is the can — its two walls, its floor and the two streaks
 * down the inside.
 */
export function IconDelete({ tier = "nav" }: IconProps) {
  return drawn(
    tier,
    <>
      <path d="M14.74 9l-.346 9" />
      <path d="M9.606 18L9.26 9" />
      <path d="M19.228 5.791L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79" />
      <g className="icon-trash-lid">
        <path d="M19.228 5.79c.342.052.682.107 1.022.166" />
        <path d="M19.228 5.79a48.108 48.108 0 0 0-3.478-.397" />
        <path d="M3.75 5.955c.34-.059.68-.114 1.022-.165" />
        <path d="M4.772 5.79a48.11 48.11 0 0 1 3.478-.397" />
        <path d="M15.75 5.393v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916" />
        <path d="M15.75 5.393a48.667 48.667 0 0 0-7.5 0" />
      </g>
    </>,
  );
}

/**
 * A cross, and the whole cross is the part that moves.
 *
 * Nothing here needed splitting for its own sake — the group exists only so
 * the turn has something to sit on that is *inside* the viewBox, where a
 * transform is measured in the same 24 units the drawing is.
 */
function PlusMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <g className="icon-plus-glyph">
      <path d="M12 4.5v15" />
      <path d="M19.5 12h-15" />
    </g>,
  );
}

/** The same trick as the plus, on the mark that dismisses rather than adds. */
function ClearMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <g className="icon-clear-glyph">
      <path d="M6 18L18 6" />
      <path d="M6 6l12 12" />
    </g>,
  );
}

/** The tray, and the lip across its middle — the part a note drops behind. */
function InboxMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M2.25 13.838V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
      <path
        className="icon-inbox-lip"
        d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859"
      />
    </>,
  );
}

/**
 * Four cells, each its own square already — the one mark in the set that
 * arrived pre-separated and needed no thought about where to cut it.
 */
function RecentMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path
        className="icon-recent-cell icon-recent-cell-1"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Z"
      />
      <path
        className="icon-recent-cell icon-recent-cell-2"
        d="M13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Z"
      />
      <path
        className="icon-recent-cell icon-recent-cell-3"
        d="M3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Z"
      />
      <path
        className="icon-recent-cell icon-recent-cell-4"
        d="M13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
      />
    </>,
  );
}

/** The ring, and the tick inside it — the tick is what gets re-struck. */
function TodoMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z" />
      <path className="icon-todo-tick" d="M9 12.75L11.25 15L15 9.75" />
    </>,
  );
}

/** Two halves of one chain, which is the only mark whose parts move apart. */
function LinkMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path
        className="icon-link-lower"
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757"
      />
      <path
        className="icon-link-upper"
        d="M18.675 11.689l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
      />
    </>,
  );
}

/** The page, and the corner folded off it. */
function DocumentMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      <path
        className="icon-file-fold"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25"
      />
    </>,
  );
}

/**
 * The folder, and the front panel's own top edge.
 *
 * That edge is the whole of the flap in this drawing — a folder here is a body
 * with a rule laid across it, not two shapes — so the rule is what opens.
 */
function FolderMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M13.06 6.31l-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
      <path
        className="icon-folder-flap"
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75"
      />
    </>,
  );
}

/**
 * A picture, framed — the Inspiration board's own mark. Hand-drawn on the 24
 * grid with the imported set's caps and joins; the sun is the part that answers
 * the pointer (it lifts, as the archive's lid does), so the shelf's one built-in
 * place has a hover of its own.
 */
function InspirationMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M3.75 5.25A1.5 1.5 0 0 1 5.25 3.75h13.5a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V5.25Z" />
      <path d="M3.75 16.5l4.5-4.5l3.75 3.75l2.25-2.25l6 6" />
      <circle className="icon-inspo-sun" cx="15.75" cy="8.25" r="1.5" />
    </>,
  );
}

/**
 * The box, its slot, and the lid across the top.
 *
 * The lid lifts straight off rather than tipping, which is the whole reason
 * this mark and the trash do not read as the same gesture said twice: one is
 * hinged and one is lifted, which is also what the two objects actually do.
 */
function ArchiveMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5" />
      <path d="M10 11.25h4" />
      <path
        className="icon-archive-lid"
        d="M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
      />
    </>,
  );
}

/** Three bars, staggered — the app menu's, whose lines are all one length. */
function BarsMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path className="icon-bars-line icon-bars-line-1" d="M3.75 6.75h16.5" />
      <path className="icon-bars-line icon-bars-line-2" d="M3.75 12h16.5" />
      <path className="icon-bars-line icon-bars-line-3" d="M3.75 17.25h16.5" />
    </>,
  );
}

/** The same three, cut ragged on the right — the shelf's own burger. */
function BarsLeftMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path className="icon-bars-line icon-bars-line-1" d="M3.75 6.75h16.5" />
      <path className="icon-bars-line icon-bars-line-2" d="M3.75 12h16.5" />
      <path className="icon-bars-line icon-bars-line-3" d="M3.75 17.25H12" />
    </>,
  );
}

/** The handle, and the lens that does the looking. */
function SearchMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M21 21l-5.197-5.197" />
      <path
        className="icon-search-lens"
        d="M15.803 15.803A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </>,
  );
}

/**
 * A door with an arrow through it, twice — the two are the same drawing
 * mirrored, and the arrow is the part that travels. It travels the way it
 * points, which is the only rule needed to tell the pair apart in motion.
 */
function SignOutMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15" />
      <g className="icon-signout-arrow">
        <path d="M12 9l-3 3" />
        <path d="M9 12l3 3" />
        <path d="M9 12h12.75" />
      </g>
    </>,
  );
}

function SignInMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15" />
      <g className="icon-signin-arrow">
        <path d="M18.75 15l3-3" />
        <path d="M21.75 12l-3-3" />
        <path d="M21.75 12H9" />
      </g>
    </>,
  );
}

/**
 * An arrow that went down and turns back up: Heroicons' `ArrowUturnUpIcon`,
 * cut into its head and its shaft. It was a tray with an arrow rising out of
 * it — the same drawing as Import from Google Keep in the menu, so Put back
 * and Import were one mark for two verbs (review 2026-10-01, UX-24). A turn
 * back is what putting back is, and it points up where Undo's points left.
 */
function RestoreMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <g className="icon-restore-arrow">
      <path d="M9 9l6-6" />
      <path d="M15 3l6 6" />
      <path d="M15 3v12a6 6 0 0 1-12 0v-3" />
    </g>,
  );
}

/**
 * A flag: a pole, and the banner flying from it.
 *
 * This was a square for as long as the app has had a priority, and a square is
 * a shape rather than a word — it says "marked" only to somebody who has
 * already been told what the mark means. A flag says it by itself, which is
 * what lets the same drawing stand on a card as well as in the bar: planted,
 * come back to this one.
 *
 * The pole is three fragments rather than one line, because the package draws
 * it as three — above the banner, below it, and behind it — and this file cuts
 * imported paths at their own subpath boundaries rather than tidying them. The
 * banner is the part that moves, so it is the part that gets a name.
 */
function PriorityMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M3 3v1.5" />
      <path d="M3 21v-6" />
      <path d="M3 15V4.5" />
      <path
        className="icon-priority-banner"
        d="M3 15l2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5"
      />
    </>,
  );
}

/**
 * Two sheets, the front one drawn in two pieces — its right-and-bottom edges
 * and its top-and-left edges arrive as separate subpaths, so the group is what
 * makes them one sheet again and the thing that can be slid onto the other.
 */
function MergeMark({ tier }: { tier: Tier }) {
  return drawn(
    tier,
    <>
      <path d="M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25" />
      <g className="icon-merge-front">
        <path d="M16.5 8.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-1.5" />
        <path d="M16.5 8.25h-6a2.25 2.25 0 0 0-2.25 2.25v6" />
      </g>
    </>,
  );
}

export function IconBack({ tier = "nav" }: IconProps) {
  return mark(ArrowLeftIcon, tier);
}

/** The flag that marks a priority note, filled once the priority is set. */
export function IconPriority({ on, tier = "nav" }: IconProps) {
  return on ? mark(FlagSolid, tier) : <PriorityMark tier={tier} />;
}

export function IconArchive({ on, tier = "nav" }: IconProps) {
  return on ? mark(ArchiveBoxSolid, tier) : <ArchiveMark tier={tier} />;
}

/** Out of the bin, back to the grid — a turn back, not a tray (see RestoreMark). */
export function IconRestore({ tier = "nav" }: IconProps) {
  return <RestoreMark tier={tier} />;
}

/**
 * The offer to take the last action back. The arrow turning on itself is the
 * mark every editor uses for it, which is the point: the undo button no longer
 * carries a word, and a glyph that has to be learned would cost more than the
 * word did.
 */
export function IconUndo({ tier = "nav" }: IconProps) {
  return mark(ArrowUturnLeftIcon, tier);
}

/**
 * The eraser, for the drawing screen. Heroicons has none, so it is drawn here
 * on the same 24 grid with the same round caps: a block tipped on its corner,
 * with the line where the rubber ends and the case begins.
 */
export function IconEraser({ tier = "nav" }: IconProps) {
  return drawn(
    tier,
    <g transform="rotate(-45 12 12)">
      <rect x="3.5" y="7.75" width="17" height="8.5" rx="1.5" />
      <path d="M10.5 7.75v8.5" />
    </g>,
  );
}

/**
 * Which way a folder travels on the shelf, drawn for the shelf that is actually
 * on screen.
 *
 * The shelf has two shapes — a horizontal strip on a desktop, a vertical drawer
 * on a phone (`web/CLAUDE.md`) — so a folder moving "one step towards the
 * Inbox" travels left in one of them and up in the other. `BoardMenu` names the
 * row after the direction the reader will actually see it move, and these are
 * the same branch said in the mark: a left arrow beside "Move up" would be the
 * app describing a shelf it is not currently drawing.
 *
 * `vertical` is not a device test of its own — it is `useIsPhone`, handed down,
 * which is the app's single definition of which shape is on screen.
 */
export function IconMoveEarlier({ vertical, tier = "inline" }: IconProps & { vertical: boolean }) {
  return mark(vertical ? ArrowUpIcon : ArrowLeftIcon, tier);
}

export function IconMoveLater({ vertical, tier = "inline" }: IconProps & { vertical: boolean }) {
  return mark(vertical ? ArrowDownIcon : ArrowRightIcon, tier);
}

/**
 * Out of an idea, back to the board. Deliberately the arrow *leaving an
 * enclosure* rather than the one that means "restore": a note taken off a
 * canvas was never in a bin, and it is going back to where it always was.
 */
export function IconRelease({ tier = "inline" }: IconProps) {
  return mark(ArrowRightOnRectangleIcon, tier);
}

/**
 * Un-merge: every note in an idea back out to the board at once. The arrows
 * going apart to the four corners — the whole composition coming undone —
 * where `IconRelease` beside it is one note stepping out of the enclosure.
 */
export function IconUnmerge({ tier = "inline" }: IconProps) {
  return mark(ArrowsPointingOutIcon, tier);
}

/**
 * New note from selection — the words picked out, cut from this note into a
 * new one. Scissors, because that is the act: nothing is copied and nothing is
 * lost, the text is cut in two.
 */
export function IconSplit({ tier = "inline" }: IconProps) {
  return mark(ScissorsIcon, tier);
}

/**
 * Today's date, into the text at the caret. The plain calendar, not the one
 * with days drawn on it — that one is already a file's type (`calendar` in
 * `FILE_MARKS`), and a mark means one thing here.
 */
export function IconDate({ tier = "inline" }: IconProps) {
  return mark(CalendarIcon, tier);
}

/**
 * One file along, in the full-screen viewer.
 *
 * A chevron and not an arrow, and the difference is the app's own: an arrow
 * here means *move this thing* — a folder earlier on the shelf, a note out of
 * a canvas — while nothing moves when you walk to the next photograph in a
 * note. The chevron is the mark for the thing beside this one, which is all
 * these two say.
 */
export function IconStepBack({ tier = "inline" }: IconProps) {
  return mark(ChevronLeftIcon, tier);
}

export function IconStepOn({ tier = "inline" }: IconProps) {
  return mark(ChevronRightIcon, tier);
}

/**
 * How much of the note is still under the cut: one, two or three stacked rules,
 * filling from the bottom up like a level. It replaced "+1.4k", which was exact
 * and meaningless — a character count is not an amount of reading.
 *
 * Drawn rather than imported, because "an amount still to read" is not a thing
 * a general icon set has a word for. Same 24 grid and same round caps as the
 * set it stands in, so it reads as one of them.
 */
export function IconCut({ depth }: { depth: 1 | 2 | 3 }) {
  // Bottom row first, so one line sits on the baseline and three fill upward.
  const rows = [18, 12, 6].slice(0, depth);
  return (
    <svg
      className="icon icon-data"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
    >
      {rows.map((y) => (
        <path key={y} d={`M3 ${y}h18`} />
      ))}
    </svg>
  );
}

/** Clear the field. */
export function IconClear({ tier = "inline" }: IconProps) {
  return <ClearMark tier={tier} />;
}

/** Put something in, at the caret. A cross, not a chevron: this adds. */
export function IconInsert() {
  return <PlusMark tier="nav" />;
}

/**
 * The clipboard, and — while the words are on it — a filled tick. A panel
 * control on a code block, and a verb in the strip under the open note.
 *
 * The strip under a note used to say "copied" in words beside this mark, and
 * the words are gone from it: an icon on its own is what the strip is now. So
 * the receipt has to be carried by the drawing, which is the set's existing
 * grammar said once more — outline is resting, solid is on.
 */
export function IconCopy({ on, tier = "inline" }: IconProps = {}) {
  return on ? mark(CheckCircleSolid, tier) : mark(ClipboardIcon, tier);
}

/** The share sheet — the meta row's way out to other apps. */
export function IconShare({ tier = "data" }: IconProps = {}) {
  return mark(ShareIcon, tier);
}

/** Read aloud. `on` is the voice going, and the mark is then the way to stop it. */
export function IconSpeak({ on, tier = "data" }: IconProps = {}) {
  return mark(on ? SpeakerXMarkIcon : SpeakerWaveIcon, tier);
}

/**
 * Untick all: every ticked box in a list turned back to an open one. The
 * arrow going round a square — the box, back to where it started — which is
 * the reusable list's whole shape: the same shopping, every week. A cousin of
 * `IconRepeat`'s arrow and deliberately not the same drawing, since a
 * reminder coming round again and a list being reset are different acts.
 */
export function IconUntick({ tier = "inline" }: IconProps = {}) {
  return mark(ArrowPathRoundedSquareIcon, tier);
}

/**
 * Clear done: the ticked items taken out of the note's text. A page with a
 * line struck off it, which is what happens to the note — not the bin, which
 * would say the note itself was going, and not scissors, which beside Copy
 * would read as "cut to the clipboard".
 */
export function IconClearDone({ tier = "inline" }: IconProps = {}) {
  return mark(DocumentMinusIcon, tier);
}

export function IconCheck() {
  return mark(CheckIcon, "inline");
}

export function IconAttachment() {
  return mark(DocumentPlusIcon, "inline");
}

/**
 * Save: an arrow up, the note going up onto the board above the bar — the
 * shape a message box's send button has. It was a page with a down arrow,
 * which reads as "download" (review 2026-10-01, UX-30); a tick would have
 * stood beside the to-do mark's own tick box and said "done".
 */
export function IconSave() {
  return mark(ArrowUpIcon, "nav");
}

export function IconSearch() {
  return <SearchMark tier="inline" />;
}

/** Settings, at the header's far right (2026-10-12, owner) and on the menu's
 *  row when the header is folded away. The same cog the menu row wore. */
export function IconSettings({ tier = "nav" }: IconProps) {
  return mark(Cog6ToothIcon, tier);
}

export function IconSignIn() {
  return <SignInMark tier="inline" />;
}

export function IconSignOut() {
  return <SignOutMark tier="inline" />;
}

export function IconMerge({ tier = "inline" }: IconProps = {}) {
  return <MergeMark tier={tier} />;
}

/**
 * Take every card on the board at once — the selection panel's Select all row,
 * and the mark beside Ctrl/Cmd+A.
 *
 * The set's own grid of four squares, because what the row takes is *the
 * grid*: not a folder, not a pile, not a tick — the thing on screen, all of
 * it. A circled tick was the obvious alternative and is refused, because a
 * solid circled tick is already spoken for twice over here (`IconCopy`'s
 * receipt and `IconTodo`'s on state), and a mark that means "done" cannot also
 * mean "everything".
 */
export function IconSelectAll({ tier = "inline" }: IconProps = {}) {
  return mark(Squares2X2Icon, tier);
}

export function IconMenu({ on }: IconProps) {
  return on ? mark(Bars3Solid, "nav") : <BarsMark tier="nav" />;
}

/**
 * The shelf of boards, opened as a drawer down the left of a phone.
 *
 * Deliberately *not* the same three even bars `IconMenu` wears. The app menu
 * lives in the bottom-right corner and this lives in the top-left, and on a
 * phone both are on screen at once — two identical burgers, forty pixels
 * apart in reading order, promising the same thing and opening different
 * places. The ragged-left cut is still unmistakably a burger, and it is a
 * short line under two long ones: a *list*, stacked to the left, which is what
 * this opens and which way it comes in from.
 *
 * Solid while the drawer is open, following the set's one state rule — outline
 * is resting, filled means the control is on.
 *
 * Inline, not nav: it stands in the board row beside the board's own mark and
 * the search mark, both of which are inline, and the row's height is set by
 * the tallest thing in it. A 24 here would have grown the row by four pixels
 * on a phone and nowhere else.
 */
export function IconBoards({ on, tier = "inline" }: IconProps) {
  return on ? mark(Bars3BottomLeftSolid, tier) : <BarsLeftMark tier={tier} />;
}

/** A footer mark on the card, counting the addresses the note carries. */
export function IconLink({ tier = "data" }: IconProps) {
  return <LinkMark tier={tier} />;
}

/**
 * A footer mark on the card: there is code in this note.
 *
 * The angle brackets, because that is what the thing is called everywhere else
 * and the fences themselves say nothing at 14px. Its sibling mark — the one for
 * tick boxes — is *not* a glyph, and deliberately: a tick box in this app is the
 * characters `[ ]`, so the footer writes the characters. Code has no such word,
 * so it takes the set's.
 */
export function IconCode({ tier = "data" }: IconProps) {
  return mark(CodeBracketIcon, tier);
}

/** A link's picture that is a video: the mark drawn over its corner on the wall. */
export function IconPlay({ tier = "inline" }: IconProps) {
  return mark(PlayIcon, tier);
}

export function IconPlus({ tier = "nav" }: IconProps) {
  return <PlusMark tier={tier} />;
}

/**
 * Something to take hold of: the grip on a list item you can drag.
 *
 * Drawn rather than imported, like the other two. Heroicons has no handle —
 * `Bars2` is the closest and it is a *menu*, which is exactly the wrong promise
 * to make about a thing you are meant to grab. Six dots is the shape everything
 * draggable has used for thirty years, and it is the one mark in the app where
 * being conventional is the whole point: nobody should have to discover it.
 *
 * Same 24 grid as the imported set, but filled rather than stroked — a dot with
 * a 1.5px outline is a ring, and six rings is a texture, not a grip.
 */
export function IconGrip() {
  const dots = [
    [9, 6],
    [15, 6],
    [9, 12],
    [15, 12],
    [9, 18],
    [15, 18],
  ];
  return (
    <svg
      className="icon icon-data"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      focusable={false}
    >
      {dots.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={1.7} />
      ))}
    </svg>
  );
}

/** A file. A panel control in the note, a footer mark on the card. */
export function IconFile({ tier = "inline" }: IconProps) {
  return <DocumentMark tier={tier} />;
}

/**
 * The mark for a file with no picture to show, one per family. The mark only
 * names the family — a musical note, a film strip, a table — and the extension
 * text drawn beside it still says exactly what the file is; the icon is never
 * asked to tell a .7z from a .tar.gz. Subject drawings rather than a page with
 * a badge, because that is the vocabulary this set actually has: Heroicons
 * draws no file-type family, and its Document* icons are all actions *on* a
 * document.
 *
 * The cube for an archive, not the archive box — that box already means
 * "archive this note" everywhere in this app, and one drawing may not say two
 * things on the same screen. The plain page is the fallback: a file, nothing
 * more.
 */
const FILE_MARKS: Record<FileIconKey, Glyph> = {
  image: PhotoIcon,
  document: DocumentTextIcon,
  audio: MusicalNoteIcon,
  video: FilmIcon,
  sheet: TableCellsIcon,
  slides: PresentationChartBarIcon,
  code: CodeBracketIcon,
  archive: CubeIcon,
  calendar: CalendarDaysIcon,
  contact: IdentificationIcon,
  file: DocumentIcon,
};

export function IconFileType({ kind, tier = "nav" }: { kind: FileIconKey; tier?: Tier }) {
  return mark(FILE_MARKS[kind], tier);
}

/** Saving a file out of a note — and the whole archive out of the app. */
export function IconDownload() {
  return mark(ArrowDownTrayIcon, "inline");
}

/** The viewer's way out to the page a picture came from. */
export function IconOpenSite() {
  return mark(ArrowTopRightOnSquareIcon, "inline");
}

/** The viewer's way to the note behind the tile. */
export function IconOpenNote() {
  return mark(DocumentTextIcon, "inline");
}

/**
 * Bringing an archive in from Google Keep — the tray the export's arrow comes
 * down into, with the arrow going up out of the device and into the app. The
 * same pair of marks every file picker in every operating system uses for the
 * two directions, so it says which way the notes travel without a word.
 */
export function IconImport() {
  return mark(ArrowUpTrayIcon, "inline");
}

/**
 * The public demo's sample notes, on the empty Inbox's first offer: a stack of
 * cards, which is what pressing it puts on the board. Only the demo's build
 * reaches it (`demo/SampleOffer.tsx`), so in every other build it is shaken out
 * with the offer.
 */
export function IconSamples() {
  return mark(RectangleStackIcon, "inline");
}

/** The About page: what spår is, and how it was made. */
export function IconAbout() {
  return mark(InformationCircleIcon, "inline");
}

/**
 * The Inbox board: everything captured and not yet filed — the landing board.
 *
 * The set's own tray, and deliberately not a second folder: a folder is
 * somewhere you put things, and this is the pile they arrive in. It is the mark
 * that has to read as "in", so it is the one the whole icon set draws for it
 * rather than anything invented here.
 */
/** `on` is the capture bar's "this note is going to the Inbox, chosen by hand"
 *  — a decision the mark reports the way every other engaged mark does. */
export function IconInbox({ on, tier = "inline" }: IconProps) {
  return on ? mark(InboxSolid, tier) : <InboxMark tier={tier} />;
}

/** The All board (`kind: "recent"`, which is the name it had): every active
 *  note, newest edit first — the safety net, whatever a note is or isn't filed
 *  into. */
export function IconRecent() {
  return <RecentMark tier="inline" />;
}

/** The Todos board tab, and the open note's Todo-toggle mark (solid when
 *  this note is currently marked as one — hand-set, never guessed). */
export function IconTodo({ on, tier = "inline" }: IconProps) {
  return on ? mark(CheckCircleSolid, tier) : <TodoMark tier={tier} />;
}

/** A folder board tab, and the Move mark that files a note into one. */
/** `on` is a folder chosen for a note that is still being written (the
 *  capture bar's board mark): solid, by the set's own grammar. A folder that
 *  wears a mark of its own draws that mark instead and has no solid cut. */
export function IconFolder({ on, tier = "inline" }: IconProps) {
  return on ? mark(FolderSolid, tier) : <FolderMark tier={tier} />;
}

/** The Inspiration board's tab, its chooser row and every place its name is drawn. */
export function IconInspiration({ tier = "inline" }: IconProps) {
  return <InspirationMark tier={tier} />;
}

/** A footer mark on the card: a reminder is due soon, or has passed. `on` is
 *  a reminder chosen for a note still being written (the capture bar's clock
 *  mark): solid, by the set's own grammar, as the board mark's folder is. */
export function IconReminder({ on, tier = "data" }: IconProps) {
  return mark(on ? ClockSolid : ClockIcon, tier);
}

/**
 * How often a reminder comes round again — the arrow that goes back to where
 * it started, beside the clock that says when.
 *
 * Filled while that rule is the one in force, outline while it is merely on
 * offer: the set's existing grammar, the same one `IconCopy` and `IconPriority`
 * speak, and here it is what lets three rows in one panel say which of them
 * this reminder is actually on.
 */
export function IconRepeat({ on, tier = "inline" }: IconProps) {
  return mark(on ? ArrowPathSolid : ArrowPathIcon, tier);
}

/** A folder's screen switch: its notes keep the screen lit while open. */
export function IconScreenOn({ tier = "inline" }: IconProps) {
  return mark(SunIcon, tier);
}

/** The canvas's draw tool: annotate the idea directly, rather than move it. */
export function IconPencil({ tier = "inline" }: IconProps) {
  return mark(PencilIcon, tier);
}

/** The canvas's move tool: pan the sheet, the resting state beside Draw. */
export function IconHand({ tier = "inline" }: IconProps) {
  return mark(HandRaisedIcon, tier);
}

/** A text label dropped onto a canvas — the same lines-of-text drawing
 *  `IconBoards` wears, reused rather than imported a second time, standing
 *  for a different job here: "add words to this canvas". */
export function IconText({ tier = "inline" }: IconProps) {
  return <BarsLeftMark tier={tier} />;
}
