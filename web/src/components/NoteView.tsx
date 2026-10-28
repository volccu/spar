import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { Attachment, Note, ReminderRepeat, UserBoard } from "../types";
import { fitTextarea } from "../lib/fitTextarea";
import { fieldOffset, fieldValue, writeThrough } from "../lib/editText";
import { useKeyOpen } from "../lib/keyOpen";
import { closeMorph, openMorph, vanishMorph } from "../lib/sheetMotion";
import { offsetAtPoint } from "../lib/caret";
import { LAMP_STYLE, useLamp } from "../lib/useLamp";
import { useFileUrl } from "../store/useFileUrl";
import { canPreview, isImage } from "../lib/files";
/* Deliberately NOT lazy-loaded, unlike the idea canvas. It is under 4kB, and
   it registers its own close upward (`register`) so Back reaches past the note
   to the picture without a second history entry. Behind a lazy boundary there
   is a window where the picture is open in state but not yet mounted, and a
   Back in that window dismisses the note instead — a real race on a slow
   phone, bought for about a kilobyte. */
import { Lightbox } from "./Lightbox";
import { MIN_WORKING_MS, SyncMark } from "./SyncMark";
import { mergedPreviews } from "../lib/links";
import { ARCHIVE_KEY, BOLD_KEY, FLAG_KEY, ITALIC_KEY, MOVE_KEY, hasKeyboard } from "../lib/hotkeys";
import { cycleTab } from "../lib/focusTrap";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { useVisibleHeight } from "../lib/visibleHeight";
import { hangFrom, underOf, type UnderAnchor } from "../lib/pointerAnchor";
import { daysLeftInTrash } from "../lib/trash";
import { canKeepOnLinks, folderIds, isFiled, isTodoNote, keptOnLinks } from "../lib/boards";
import { doneCount, parseBlocks } from "../lib/blocks";
import { CodeBands } from "./CodeBands";
import type { ListRewrite } from "./ListVerbs";
import {
  onSelectedLines,
  cutSelection,
  F_BOLD,
  F_EM,
  insertInline,
  insertOnOwnLine,
  markLine,
  pickRange,
  wrapWith,
  type Format,
} from "../lib/format";
import { hitScrollTop } from "../lib/face";
import { noteName, withNoteName } from "../lib/name";
import { writtenDate } from "../lib/when";
import { useReadingPosition } from "../lib/useReadingPosition";
import { useHeldWhile } from "../lib/useHeldWhile";
import { renumberLists } from "../lib/reorder";
import { timeToFrame } from "../lib/speed";
import { editedAt, wasEdited } from "../lib/versions";
import { copyText, useCopied } from "../lib/clipboard";
import { autoformat, continueList } from "../lib/autoformat";
import { useFullDate, useTimeWords, useUntouchedSince } from "../lib/clock";
import type { PushState } from "../store/push";
import {
  animates,
  CLOSE_MS,
  finishOnce,
  VANISH_MS,
} from "../lib/motion";
import { useNoteSwiping } from "../lib/useNoteSwiping";
import { useNoteDrop } from "../lib/useNoteDrop";
import { AttachRefsContext, useAttachMarkers } from "../lib/useAttachMarkers";
import {
  IconArchive,
  IconBack,
  IconBoards,
  IconDelete,
  IconFolder,
  IconInsert,
  IconPriority,
  IconReminder,
  IconRestore,
  IconTodo,
} from "./Icons";
import { BoardChooser } from "./BoardChooser";
import { FolderGlyph } from "./BoardLook";
import { Dialog } from "./Dialog";
import { LinkPreviewList } from "./LinkPreviewList";
import { NoteAttachments } from "./NoteAttachments";
import { ReminderPanel, useReminderLine } from "./ReminderPanel";
import { NoteReader } from "./NoteReader";
import { CODE_BLOCK, InsertPanel, type Insert } from "./InsertPanel";
import { NoteNameRow } from "./NoteNameRow";
import { NoteVerbs } from "./NoteVerbs";
import { NoteMenu } from "./NoteMenu";

interface Props {
  note: Note;
  /** Where the card sat when it was tapped, so the note can grow out of it. */
  origin: DOMRect | null;
  /** Set by the app to ask for the closing animation; onClosed ends the layer. */
  closing: boolean;
  onClosed: () => void;
  onClose: () => void;
  onEditBody: (id: string, body: string) => void;
  /**
   * Save the body only if the note still holds the body this editor's draft
   * grew out of — the third argument is that base, not a clock. See
   * `editBodyIfBase` in `store/useNotes.ts` for why the stamp was the wrong
   * thing to compare in both directions.
   */
  onEditBodyIfBase?: (id: string, body: string, expectedBody: string) => boolean;
  onSetStatus: (id: string, status: Note["status"]) => void;
  /**
   * The user emptied this note and the layer is closing on nothing.
   *
   * Reported rather than acted on here, because what happens next is the
   * board's business: the note goes to the trash like any other delete, with
   * the same undo and the same mark. See handleEmptied in App.tsx.
   */
  onEmptied?: (id: string) => void;
  onTogglePriority: (note: Note) => void;
  /** `refs`: the numbers the files' `[image 2]` markers were written with, by position. */
  onAttach: (id: string, files: File[], refs?: number[]) => void;
  onDetach: (id: string, attachmentId: string) => void;
  /**
   * Puts the note's files in this order — the viewer's "Use as cover" moves a
   * picture first, which is the one its card and its wall tile wear.
   */
  onReorderFiles?: (id: string, attachments: Note["attachments"]) => void;
  /**
   * The words this device has read inside the note's pictures, by attachment
   * id (`store/imageText.ts`) — what a picture is described as to a screen
   * reader, beside its name. Left out, a picture is described by its name.
   */
  pictureTexts?: ReadonlyMap<string, string>;
  /**
   * Hands the app a way to close whatever is open *inside* the note — today
   * that is a picture at full screen. Back closes the top thing on screen, and
   * the app owns the one history entry that means "something is open", so it
   * has to be able to reach in. Called with null when there is nothing inside.
   */
  registerInner: (close: (() => void) | null) => void;
  /** Writes reminder_at through the same path every other field uses, so it
   *  rides the existing outbox and version clock (lib/versions.ts) for free. */
  onSetReminder?: (id: string, at: string | null) => void;
  /** Writes `reminder_repeat`, the rule the anchor repeats on (migration
   *  0020). Separate from `onSetReminder` because they are two acts: one picks
   *  a time, the other says how often. Clearing the reminder clears the rule
   *  too, and that half lives with the clearing, not here. */
  onSetRepeat?: (id: string, repeat: ReminderRepeat | null) => void;
  /** Whether a reminder set here will actually sound on this device, and if
   *  not, why — see store/push.ts. "on" is the only state that rings. */
  pushStatus?: PushState;
  /** Whether a file kept here has a server to be sent to (`NoteAttachments`). */
  sendsFiles?: boolean;
  /** Turns this device on for reminders. Offered from the reminder panel when
   *  it is off but could still be switched on. */
  onEnableRing?: () => void;
  /** Turns this device off again. The other half of onEnableRing: switching
   *  reminders on was a one-way door, which is not a switch. */
  onDisableRing?: () => void;
  /** The user's own folder boards — store/useBoards.ts. Feeds the Move
   *  mark's chooser, the same list the multi-select Move panel offers. */
  boards?: UserBoard[];
  /** How many notes are currently filed in each — purely informational. */
  countFor?: (boardId: string) => number;
  /** Files this note into a board, or takes it off one (null). */
  onMove?: (id: string, boardId: string | null) => void;
  /** Puts this note on the Links board by hand (`keptOnLinks`). */
  onLinks?: (id: string) => void;
  /** A name typed into the Move chooser that matched nothing — makes a new
   *  board and returns it, so the caller can file into it immediately. */
  onCreateBoard?: (name: string) => UserBoard;
  /** The Todo-toggle mark: sets or clears this note's hand-set `note_type`.
   *  Never guessed — see CLAUDE.md's Enrichment section. */
  onToggleTodo?: (note: Note) => void;
  /**
   * Untick all or Clear done has rewritten this note's list and the new body
   * is saved — the board offers it back through the ordinary undo, with the
   * body it was and the body it now is. Reported rather than pushed from here
   * because the undo stack is the board's (`store/useUndo.ts`).
   */
  onListRewritten?: (id: string, before: string, after: string, message: string) => void;
  /**
   * Puts link previews away (`hide`) or brings them back, by address. The
   * note's text is not touched: the board writes the flag onto the links'
   * entries in `link_previews` and offers one undo
   * (`setPreviewsHidden` in `App.tsx`).
   */
  onHidePreviews?: (id: string, hrefs: string[], hide: boolean) => void;
  /** The ordered notes a horizontal swipe can move through — the board the
   *  grid is showing, in its own order. A note opened from the canvas or a
   *  notification is not among them, and has nothing to swipe to. */
  siblings?: Note[];
  /** Where `note` sits in `siblings`, or -1 when it isn't there. */
  siblingIndex?: number;
  /** Opens the sibling at this index, in place of this note. */
  onOpenSibling?: (index: number) => void;
  /** Which side this note arrived from, so it can travel in on the same
   *  gesture that sent the last one away: 1 = the next note (swiped left),
   *  -1 = the previous (swiped right), 0 = opened from its own card. */
  enterFrom?: -1 | 0 | 1;
  /**
   * Opens the shelf of boards over the note — the phone's drawer, the same one
   * the board row's burger opens — so reaching another board does not cost a
   * Back first. Undefined where there is no drawer to open (a desktop, where
   * the strip is the shelf), and then the mark is not drawn at all.
   */
  onOpenShelf?: () => void;
  /** Whether that drawer is standing open over the note: the mark goes solid,
   *  the set's own "on", exactly as the board row's burger does. */
  shelfOpen?: boolean;
  /** The note's burger, so the drawer can hand the focus back to it. */
  shelfMark?: React.RefObject<HTMLButtonElement | null>;
  /**
   * Something of the app's own stands over the whole note — the drawer, the
   * folder menu or Look sheet opened from it, a confirm dialog. Those take
   * their own keys, so the note's Escape and Ctrl+Enter stand down: Escape
   * means the top thing, and the note is not it.
   */
  covered?: boolean;
  /**
   * The board changed under the note while it was open, so the card it grew
   * out of is not where it is going back to: it fades where it stands rather
   * than shrinking into a rect that now holds some other note, or nothing.
   * A flag of its own rather than clearing `origin`, which the opening is
   * keyed on and would replay.
   */
  closesElsewhere?: boolean;
  /**
   * What the search running when this note was opened matched on
   * (`searchTerms`), or nothing. The note opens with its first hit in view
   * and the hits marked, the way the card that led here marked them — until
   * the first tap into the text. See "Search" in web/CLAUDE.md.
   */
  searchTerms?: readonly string[];
  /**
   * New note from selection: the board makes a note of `moved`, filed where
   * this one is, and offers one undo for both halves — `before` and `after`
   * are this note's body either side of the cut, which is what that undo
   * checks and restores. Answers whether the note was made; the cut is only
   * taken out of this note once it has been, so a refusal loses nothing.
   */
  onSplit?: (id: string, moved: string, before: string, after: string) => boolean;
}

/** No search: one shared empty list rather than a fresh `[]` per render. */
const NO_TERMS: readonly string[] = [];

/** A selection the insert panel may act on: the offsets, and the text they
 *  are offsets into, so a note that changed underneath is caught. */
interface Picked {
  text: string;
  from: number;
  to: number;
}

/**
 * The open note's own layers, **top first** — the note's half of `LAYERS` in
 * `lib/useLayerStack.ts`, and the same idea. Which panel is on top, whether
 * any is up, and closing the top one are all read off this list, so Escape,
 * Back, Ctrl+Enter, the Ctrl+Shift verbs and the swipe cannot disagree. They
 * used to be spelled out by hand in each of those places, which is how Move
 * was once missed (see `cornerPanelUp`).
 *
 * The order is how they stand when two are up together. By touch they cannot
 * be, since every panel lays a dismiss layer over the sheet; from the keyboard
 * they can, since Tab cycles the whole sheet under a corner panel.
 *
 * - The picture and the remove question are dialogs of their own over the
 *   whole sheet: each answers Escape and traps Tab itself. The picture hands
 *   Back its own animated close as well (`register` on `Lightbox`).
 * - Move, the reminder and the insert panel stand in the bottom-right corner.
 * - The right-click menu is lowest: opening it closes the corner panels.
 */
const PANELS = [
  { id: "picture", dialog: true, ownBack: true, corner: false },
  { id: "remove", dialog: true, ownBack: false, corner: false },
  { id: "move", dialog: false, ownBack: false, corner: true },
  { id: "remind", dialog: false, ownBack: false, corner: true },
  { id: "insert", dialog: false, ownBack: false, corner: true },
  { id: "menu", dialog: false, ownBack: false, corner: false },
] as const satisfies readonly PanelSpec[];

interface PanelSpec {
  id: string;
  /** A dialog of its own: it answers Escape and traps Tab, and the note's
   *  handlers stand aside for it rather than reaching past it. */
  dialog: boolean;
  /** Hands Back its own close (`registerInner`) instead of the note's. */
  ownBack: boolean;
  /** Stands in the bottom-right corner. */
  corner: boolean;
}

type Panel = (typeof PANELS)[number];
type PanelId = Panel["id"];

/** The panel Escape and Back both close: the first one up, or null. */
function topPanel(up: Record<PanelId, boolean>): Panel | null {
  return PANELS.find((p) => up[p.id]) ?? null;
}

/**
 * Edits `body`. `raw_content` is never touched — it is the original capture,
 * kept forever, and it is not something the interface offers to show you.
 *
 * The note is read first and edited on touch. Reading mode exists so links can
 * be live, boxes can be ticked and code can be copied: a textarea can hold none
 * of those. Both modes are set identically, so the swap is invisible and the
 * caret lands where the finger did.
 */
export function NoteView({
  note,
  origin,
  closing,
  onClosed,
  onClose,
  onEditBody,
  onEditBodyIfBase,
  onSetStatus,
  onEmptied,
  onTogglePriority,
  onAttach,
  onDetach,
  onReorderFiles,
  pictureTexts,
  registerInner,
  onSetReminder,
  onSetRepeat,
  pushStatus = "on",
  sendsFiles = true,
  onEnableRing,
  onDisableRing,
  boards = [],
  countFor,
  onMove,
  onLinks,
  onCreateBoard,
  onToggleTodo,
  onListRewritten,
  onHidePreviews,
  siblings = [],
  siblingIndex = -1,
  onOpenSibling,
  enterFrom = 0,
  onOpenShelf,
  shelfOpen = false,
  shelfMark,
  covered = false,
  closesElsewhere = false,
  searchTerms = NO_TERMS,
  onSplit,
}: Props) {
  const at = siblingIndex;
  const [draft, setDraft] = useState(note.body);
  // The conflict notice's own Copy, kept apart from the note's so the two
  // never flash "copied" for each other. Same hook, same 1200ms, same word.
  const [copiedMine, copyMine] = useCopied();
  // A note with nothing in it has nothing to read — open straight into typing.
  // A note carrying a file has plenty to look at even with no words, though,
  // and throwing the keyboard up over the picture is the opposite of what
  // opening it was for.
  const [editing, setEditing] = useState(
    () => note.body.trim() === "" && (note.attachments ?? []).length === 0,
  );
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Whether the text has been tapped into since the note opened. The search
  // hits the note opened with are about the query, and the query is behind
  // you the moment you start writing: marked words would dim the page being
  // written on, and they would come back on every return to the reader. So
  // the first tap ends them for as long as this note stays open.
  const tappedIn = useRef(false);
  if (editing) tappedIn.current = true;
  const hitTerms = tappedIn.current ? NO_TERMS : searchTerms;
  // Whether this note has held words at any point while the layer was open.
  // The emptiness check below is armed by it, so a note the user typed into
  // and then emptied counts as emptied even when the original capture was
  // empty too. StrictMode is guarded separately, by `closeAsked` below.
  const hadWords = useRef(false);
  if (draft.trim() !== "") hadWords.current = true;
  const lastSavedBody = useRef(note.body);
  /**
   * The body as this stretch of editing found it: set when the note opens, on
   * every commit, and whenever a newer copy from elsewhere is taken in. It is
   * what `commit` asks "did anything change here?" of — see there for why that
   * question can no longer be put to `note.body`.
   */
  const committedBody = useRef(note.body);
  const [editConflict, setEditConflict] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  /**
   * The lamp, turned down (DESIGN.md §2c, `.editor-lamp` in styles.css).
   *
   * The same pool of light the capture bar has, following the caret through
   * the same measurement (`lib/caret.ts`) — a third dimmer and a good deal
   * tighter, because reading and writing a note happen in the same place at
   * the same size and the light may only ever be a mark that the words have
   * become editable, never a state the page enters.
   *
   * The mechanics are the capture bar's, in `lib/useLamp.ts`; only the knobs
   * differ, and those are in the stylesheet.
   */
  const { lampRef, mirrorRef, lampIdle, moveLamp, wakeLamp, lampMoved } = useLamp(editorRef);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  // The glass the keyboard leaves, as `--visible-h` on the sheet: on a phone
  // the sheet stands that tall so the marks at its foot ride above the
  // keyboard (review UX-A-10), and every panel in it stops at that height
  // (review QA-03).
  useVisibleHeight(sheetRef);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  // Whatever had focus before the sheet opened is handed back on close.
  useRestoreFocus();
  const parts = () => ({ bar: barRef.current, body: bodyRef.current });
  const caretRef = useRef<number | null>(null);
  // What was selected, last time anything was. Kept separately from caretRef,
  // which is consumed the moment the editor opens.
  //
  // The whole range and not just the caret, because a phone is where this
  // matters and a phone is what breaks it. Tapping the insert panel can blur
  // the field, and a blurred field on Android collapses its selection — so
  // "select three words, tap +, tap B" arrived here as a caret with nothing
  // between its ends and laid down an empty "****" beside the words it was
  // supposed to wrap. On a desktop nothing blurs and this is never consulted.
  const lastRange = useRef<[number, number] | null>(null);
  /**
   * True while a programmatic edit is being written into the field.
   *
   * `writeThrough` edits through the browser's own command so the undo stack
   * survives, and that command fires an input event like any other edit —
   * which React delivers to `onChange`, which would then run the formatting
   * rules over the output of the rule that has just run.
   */
  const applying = useRef(false);
  // Which mark the note is collapsing into, if it is leaving rather than
  // closing. Set in the same batch as onClose(), so the exit effect sees both.
  const [exit, setExit] = useState<"trash" | "archive" | "restore" | null>(null);
  const [inserting, setInserting] = useState(false);
  /**
   * The right-click menu (`NoteMenu`), where the pointer was, and the words
   * picked out at that moment — read on the click, because opening a panel can
   * take the browser's highlight with it before a row is pressed.
   */
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; picked: Picked | null } | null>(
    null,
  );
  /** What pressed the sheet last: only a mouse's right-click opens the menu —
   *  a finger's long press fires `contextmenu` too, and is text selection. */
  const pressedBy = useRef<string | null>(null);
  const [removeRequest, setRemoveRequest] = useState<Attachment | null>(null);
  /** The reminder picker, anchored bottom-right like every other panel here. */
  const [reminderPicking, setReminderPicking] = useState(false);
  /** The Move mark's board chooser, anchored the same corner. */
  const [moving, setMoving] = useState(false);
  /**
   * With a mouse, the reminder panel hangs under the line it is about and the
   * Move chooser under its mark (review UI-A-03), as a folder's menu hangs
   * under its tab: each trip to the bottom-right corner was 320–370px of
   * travel away from the click and back. The corner is a thumb's answer, so
   * a touch screen keeps it. Read from the mark when the panel opens.
   */
  const [panelAnchor, setPanelAnchor] = useState<UnderAnchor | undefined>(undefined);
  const moveMark = useRef<HTMLButtonElement | null>(null);
  const stampMark = useRef<HTMLButtonElement | null>(null);
  const plusMark = useRef<HTMLButtonElement | null>(null);
  /**
   * Which mark opened the corner panel that is up, so the focus can go back
   * to it when the panel closes (review UX-B-05). The + is not on screen while
   * a panel is, so it is named rather than held: the one it goes back to is
   * the one drawn again as the panel leaves. Insert's own Set reminder row
   * keeps the + as the opener of the reminder panel that replaces it.
   */
  const panelOpener = useRef<"plus" | "move" | "stamp" | null>(null);
  /**
   * Which of the note's openable files is being looked at, and the box the
   * layer grew out of.
   *
   * The file's id — not the attachment itself, which would be a stale copy of
   * a row the note may have re-synced underneath, and not its place in
   * `openable` either. That was an index, and a sync that added or removed a
   * file anywhere before it moved every place after it, so the picture on
   * screen was silently swapped for its neighbour. The place is found again
   * on every render (`lookingAt`), and that is what the viewer's walk counts.
   * `seed` is what the row had already drawn when it was tapped — kept so the
   * layer opens on the same pixels the row was showing rather than on a
   * thumbnail for the frame it takes to ask the store again.
   */
  const [lightbox, setLightbox] = useState<{
    id: string;
    origin: DOMRect;
    seed: { id: string; src: string; url: string | null };
  } | null>(null);
  // Which of the note's own layers are up, and the one on top (`PANELS`).
  const panelsUp: Record<PanelId, boolean> = {
    picture: Boolean(lightbox),
    remove: Boolean(removeRequest),
    move: moving,
    remind: reminderPicking,
    insert: inserting,
    menu: Boolean(noteMenu),
  };
  const top = topPanel(panelsUp);
  /** Closes one of the note's layers, at once. */
  const closePanel = useCallback((id: PanelId) => {
    if (id === "picture") setLightbox(null);
    else if (id === "remove") setRemoveRequest(null);
    else if (id === "move") setMoving(false);
    else if (id === "remind") setReminderPicking(false);
    else if (id === "insert") setInserting(false);
    else setNoteMenu(null);
  }, []);
  // A panel is up in the bottom-right corner — the insert panel, the reminder
  // picker or the Move chooser. One predicate, so the focus can go back to the
  // mark that opened it; a future panel in that corner is a row in `PANELS`
  // marked `corner`, and inherits the rule.
  const cornerPanelUp = PANELS.some((p) => p.corner && panelsUp[p.id]);
  // The way back from a corner panel: to the mark that opened it, but only
  // when the focus went with the panel. A caret still in the editor (the +
  // and the stamp keep it there for a tap) is left where it is.
  const panelWasUp = useRef(false);
  useLayoutEffect(() => {
    if (cornerPanelUp) {
      panelWasUp.current = true;
      return;
    }
    if (!panelWasUp.current) return;
    panelWasUp.current = false;
    const which = panelOpener.current;
    panelOpener.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const mark =
      which === "plus" ? plusMark.current : which === "move" ? moveMark.current : stampMark.current;
    mark?.focus({ preventScroll: true });
  }, [cornerPanelUp]);
  // The swipe stands down while the finger is busy elsewhere — the editor (a
  // horizontal drag there is text selection, not paging), any of the note's
  // panels, or the sheet itself closing.
  const swipeFrozen = editing || top !== null || Boolean(exit) || closing;
  const { onTouchStart, onTouchMove, onTouchEnd } = useNoteSwiping({
    // The body, not the sheet — the header must not travel with the drag.
    // See openMorph below for the entrance half of the same rule.
    targetRef: bodyRef,
    canPrev: at > 0,
    canNext: at >= 0 && at < siblings.length - 1,
    frozen: swipeFrozen,
    onPrev: () => onOpenSibling?.(at - 1),
    onNext: () => onOpenSibling?.(at + 1),
  });
  // One input, and it states no `accept`, so it reaches anything a note can
  // carry. The `image/*` twin that stood beside it — the only way to make
  // Android offer the gallery rather than a list of filenames — is withdrawn;
  // a photograph now arrives by Ctrl+V or from the phone's share sheet, and
  // neither goes through a picker at all.
  const pickerRef = useRef<HTMLInputElement | null>(null);
  // The reader's blocks. Only the reader draws them (and the grip and the drag
  // it carries read them), so while the textarea is up they are held as they
  // were rather than re-parsed on every keystroke; leaving the editor parses
  // the finished text once.
  const heldBlocks = useRef<ReturnType<typeof parseBlocks>>([]);
  const blocks = useMemo(
    () => (editing ? heldBlocks.current : parseBlocks(draft)),
    [draft, editing],
  );
  heldBlocks.current = blocks;
  // The ticked boxes, for Untick all and Clear done in the strip under the
  // text — counted off the same held blocks, so typing costs no second parse.
  const ticked = useMemo(
    () => blocks.filter((b) => b.kind === "check" && b.done).length,
    [blocks],
  );
  // Memoised on the note's own array rather than recomputed: `?? []` mints a
  // fresh empty array every render for the 232 notes that carry no file, and
  // `downloadAll` (NoteAttachments.tsx) depends on this — so without it that callback took a
  // new identity on every keystroke in the editor.
  const attachments = useMemo(() => note.attachments ?? [], [note.attachments]);
  const imageAttachments = attachments.filter(isImage);
  const fileAttachments = attachments.filter((att) => !isImage(att));
  /**
   * The files the viewer can open, in the order the note draws them — pictures
   * first, then the rest, which is exactly how the rows are laid out above. It
   * is the list the full-screen layer walks, so it has to be the same list, in
   * the same order: an index into it is what "which one am I looking at" means.
   */
  const openable = [...imageAttachments, ...fileAttachments].filter(canPreview);
  /** A picture's description: its name, then the start of the words read inside it. */
  const describe = (att: Attachment): string => {
    const words = pictureTexts?.get(att.id)?.replace(/\s+/g, " ").trim();
    if (!words) return att.name;
    return `${att.name}: ${words.length > 160 ? `${words.slice(0, 159)}…` : words}`;
  };

  const lookingAt = lightbox ? openable.findIndex((x) => x.id === lightbox.id) : -1;
  const looking = lookingAt >= 0 ? openable[lookingAt] : null;
  // The same reach the row itself makes: opening a file is asking for the file.
  const { url: lookingUrl } = useFileUrl(looking, "any");
  const seed = lightbox && looking && lightbox.seed.id === looking.id ? lightbox.seed : null;
  // A file removed on the other device while its picture is open takes the
  // layer with it — there is nothing left to show. Any *other* file coming or
  // going leaves it exactly where it is.
  useEffect(() => {
    if (lightbox && !looking) setLightbox(null);
  }, [lightbox, looking]);

  /** A row asking for the size of the screen: which file, and what it had
   *  already drawn for it. */
  function openPreview(a: Attachment, src: string, origin: DOMRect, downloadUrl: string | null) {
    if (!openable.some((x) => x.id === a.id)) return;
    setLightbox({ id: a.id, origin, seed: { id: a.id, src, url: downloadUrl } });
  }
  // Read from the body as editing found it, never from the draft mid-typing.
  // A URL half-typed — `https://e` already matches — would drop a ~90px box
  // in under the line being written and take it away again on a backspace.
  // They catch up when the editor closes, which is when the reader swaps back
  // in anyway. `committedBody` also moves
  // when a copy from elsewhere is taken in, so a sync is still drawn.
  const previewBody = editing ? committedBody.current : draft;
  const linkPreviews = useMemo(
    () => mergedPreviews(previewBody, note.link_previews),
    [previewBody, note.link_previews],
  );

  /**
   * The save mark: the sync drawing, saying that what is being typed is on its
   * way out of this window.
   *
   * Every keystroke writes to the local store before the character is on
   * screen — that is the 90% path and it is not what this reports. What it
   * reports is the *rest* of the journey: the edit goes into the outbox and
   * leaves for the other device behind the words, which is exactly the fact
   * `SyncMark` already draws on a note on its way up and on a file being
   * uploaded. So it is the same mark saying the same thing in the one place it
   * was missing, rather than a new indicator with a meaning of its own.
   *
   * It is held for `MIN_WORKING_MS`, one whole turn of the animation, from the
   * last edit rather than the first: a burst of typing is one span of parting
   * and closing, not one per character, and a gesture cut off halfway through
   * reads as a twitch. When the countdown runs out the nodes are back together
   * and what is left is the single dot — which is what "saved" looks like
   * everywhere else in this app.
   */
  const [saving, setSaving] = useState(false);
  const savingFor = useRef<number | undefined>(undefined);
  const markSaving = useCallback(() => {
    setSaving(true);
    window.clearTimeout(savingFor.current);
    savingFor.current = window.setTimeout(() => setSaving(false), MIN_WORKING_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(savingFor.current), []);

  const persistBody = useCallback(
    (body: string): boolean => {
      timeToFrame("type");
      // `lastSavedBody` is the version this draft descends from, which is the
      // whole question a conflict is asking. Reading the stamp off `note`
      // instead made the guard exactly one keystroke deep.
      const saved = onEditBodyIfBase
        ? onEditBodyIfBase(note.id, body, lastSavedBody.current)
        : (onEditBody(note.id, body), true);
      if (!saved) {
        setEditConflict(true);
        return false;
      }
      lastSavedBody.current = body;
      setEditConflict(false);
      markSaving();
      return true;
    },
    [note.id, onEditBody, onEditBodyIfBase, markSaving],
  );

  /**
   * The edit clash's two answers (audit 2026-10-10, UX-5). Until now the notice
   * was a dead end: typing refused, closing threw the words away.
   *
   * **Show the newer one** drops the words on screen and takes the other
   * device's — the same take-in the effect below does when nothing was typed.
   * **Keep mine** writes the words on screen over the newer copy, on purpose:
   * the one write the guard refuses to make by itself.
   */
  const showNewer = useCallback(() => {
    lastSavedBody.current = note.body;
    committedBody.current = note.body;
    draftRef.current = note.body;
    setDraft(note.body);
    setEditConflict(false);
  }, [note.body]);
  const keepMine = useCallback(() => {
    const mine = draftRef.current;
    onEditBody(note.id, mine);
    lastSavedBody.current = mine;
    setEditConflict(false);
    markSaving();
  }, [note.id, onEditBody, markSaving]);

  const commit = useCallback(() => {
    // A newer copy arrived while this note was being edited. Never put the old
    // words back over it when the layer closes.
    if (editConflict) return;
    // "Did anything change?" is asked of `committedBody`, never of `note.body`.
    // Every keystroke is already saved, and the app hands the saved body
    // straight back down as the note — so by the time the editor blurred,
    // `note.body` *was* the draft, this returned on every commit, and in the
    // real app no numbered list was ever counted straight. (The tests passed
    // because their parent never fed the save back in.)
    if (draftRef.current === committedBody.current) return;
    // The one moment a numbered list may be counted straight again: the user
    // has finished and the reader is about to come back. Never on a keystroke
    // — see the note at the top of lib/reorder.ts — and deliberately only on a
    // commit that carries a real change, so that merely opening a note and
    // closing it again can never rewrite a line or pull the card to the top of
    // the board.
    const tidied = renumberLists(draftRef.current);
    committedBody.current = tidied;
    if (tidied !== draftRef.current) {
      draftRef.current = tidied;
      setDraft(tidied);
    }
    // Written only when something is unsaved. After a renumber something is;
    // otherwise every keystroke was saved as it was typed, and writing the same
    // words a second time would wake the sync for nothing.
    if (tidied !== lastSavedBody.current) persistBody(tidied);
  }, [editConflict, persistBody]);

  /**
   * Writes the name field into the text, as its first line. Onto `draft`, not
   * `note.body`, so words typed and not yet committed are kept under it; and
   * saved at once like a keystroke, with `committedBody` moved along so closing
   * the note does not count this as an edit still to be tidied.
   */
  function nameNote(name: string) {
    const next = withNoteName(draftRef.current, name);
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraft(next);
    if (persistBody(next)) committedBody.current = next;
  }

  // Commit on unmount so a back-gesture or Escape never loses an edit. Held in
  // a ref and run with an empty dep list on purpose: keyed on `commit` itself,
  // the cleanup would also fire every time note.body changed, writing the same
  // text a second time and waking the sync for nothing.
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Whether the user asked for this layer to close. StrictMode's simulated
  // mount/unmount/remount runs the cleanup below without `closing` ever having
  // been true, so the emptiness check cannot fire against a note the moment it
  // opens — and the note closed onto a mark was given an explicit status, which
  // is a decision, not a walk-away. Only a plain close asks the check at all.
  const closeAsked = useRef(false);
  useEffect(() => {
    if (closing) closeAsked.current = true;
  }, [closing]);

  /**
   * A note with nothing left in it is not a note, and goes to the trash.
   *
   * Asked once, at the moment the layer is really gone — never on a keystroke
   * and never on a blur, the same restraint renumbering shows. Cutting every
   * character out and pausing has to leave the note under the caret alone, or
   * the app deletes the thing you are in the middle of retyping; it is only
   * once you have walked away from an empty note that it counts as thrown out.
   *
   * Four things stop it, and each is a note that is not actually empty:
   * words it still holds; a file, which is the note's whole content on a file
   * card; sources, because an idea with its name cut off still holds the notes
   * merged into it and binning it would strand them; and an edit conflict,
   * where the other device's copy — not this empty draft — is the truth.
   */
  const emptiedRef = useRef<() => void>(() => {});
  emptiedRef.current = () => {
    if (!closeAsked.current || exit !== null) return;
    if (draftRef.current.trim() !== "") return;
    // Words it still holds are caught above; this is words it once held.
    // `hadWords` only reaches back into this open session, so a note that was
    // emptied, trashed and undone arrives empty and would otherwise never be
    // binned again. `raw_content` is the immutable original and outlives
    // sessions, so the two together cover every note the user actually emptied
    // — while a note that genuinely arrived with nothing (StrictMode's dev
    // remount, an imported empty) still cannot be binned just by opening it.
    const everWorded = hadWords.current || (note.raw_content ?? "").trim() !== "";
    if (!everWorded) return;
    if (editConflict) return;
    if ((note.attachments ?? []).length > 0) return;
    if ((note.merged_from ?? []).length > 0) return;
    if (note.status === "trashed") return;
    onEmptied?.(note.id);
  };

  useEffect(
    () => () => {
      commitRef.current();
      emptiedRef.current();
    },
    [],
  );

  // Local edits update the parent immediately. A different body means another
  // device won while this editor still had unsaved words on screen.
  useEffect(() => {
    if (note.body === lastSavedBody.current) return;
    if (draftRef.current === lastSavedBody.current) {
      lastSavedBody.current = note.body;
      // Taken in, not edited here: closing the note must neither count it
      // straight nor write it back.
      committedBody.current = note.body;
      setDraft(note.body);
      setEditConflict(false);
    } else {
      setEditConflict(true);
    }
  }, [note.body]);

  // Reopening a long note puts you back where you were reading it, and the
  // place is written down once as it closes — see lib/useReadingPosition.ts.
  const readAt = useReadingPosition(note.id, note.body.length, bodyRef, draftRef);

  /**
   * ...unless the note was opened from a search, and then it opens where the
   * words are. The card already started at the match (`shiftToMatch`); the
   * note used to start at its top, so a hit two screens down was found on the
   * board and lost again the moment it was opened.
   *
   * Declared after `useReadingPosition`, so it runs after the remembered place
   * is put back and gets the last word only when that place does not show the
   * hit (`hitScrollTop`). The same reasoning as the reading position for doing
   * it before the first paint rather than as a scroll: a note that opens and
   * then travels is a target you wait for, so it does not travel at all.
   */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    // For several words, the line holding the most of them (`data-best`,
    // `bestLine` in lib/face.ts), where the card opened too — not the first
    // hit of any one word, which could be two screens above the answer.
    const hit =
      body?.querySelector<HTMLElement>('.reader [data-best="true"]') ??
      body?.querySelector<HTMLElement>('.reader [data-hit="true"]');
    if (!body || !hit) return;
    const box = hit.getBoundingClientRect();
    const top = box.top - body.getBoundingClientRect().top + body.scrollTop;
    const reader = hit.closest<HTMLElement>(".reader");
    const line = reader ? parseFloat(getComputedStyle(reader).lineHeight) : NaN;
    const to = hitScrollTop(
      top,
      box.height,
      body.scrollTop,
      body.clientHeight,
      Number.isFinite(line) ? line : box.height,
    );
    if (to === null) return;
    body.scrollTop = to;
    readAt.current = to;
    // On open only, like the reading position it follows: `readAt` is a ref
    // from useReadingPosition and never changes identity.
  }, [readAt]);

  // Focus moves into the sheet on open and comes back out on close — the
  // same pattern Lightbox.tsx and Dialog.tsx already use for their own layers.
  // A separate effect from the open animation below: this one runs once, on
  // mount, and must not restart every time `origin` changes. Declared before
  // the effect that focuses the editor when a note opens straight into
  // typing (further down, keyed on `editing`), so that effect's focus() call
  // — running later in the same commit — is the one that wins when both fire
  // on the same mount.
  useLayoutEffect(() => {
    backRef.current?.focus();
  }, []);

  // Opened by a key, a note with words opens ready to type (lib/keyOpen.ts).
  useKeyOpen(note.id, draftRef, bodyRef, caretRef, () => setEditing(true));

  // Open out of the card on the way in — or in from the side, for a note
  // reached by swiping.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!animates(el)) return;
    const a = openMorph(el, parts(), origin, enterFrom);
    return () => a.cancel();
  }, [origin, enterFrom]);

  // …and back into it on the way out — or down into a mark, if the note is
  // leaving rather than closing. The app keeps the layer mounted until
  // onClosed, so this is the only thing deciding when the note is really gone.
  useEffect(() => {
    if (!closing) return;
    const el = sheetRef.current;
    if (!animates(el)) {
      onClosed();
      return;
    }
    const a = exit
      ? vanishMorph(el, parts())
      : closeMorph(el, parts(), closesElsewhere ? null : origin);
    // A tab put in the background never fires onfinish. The layer must not be
    // able to strand itself over the grid, so time it out regardless.
    return finishOnce(a, onClosed, (exit ? VANISH_MS : CLOSE_MS) + 140);
  }, [closing, exit, origin, closesElsewhere, onClosed]);

  /** Archive, delete and put-back all end the note the same way: change the
   *  status now, then let the sheet collapse into the mark for it. */
  function leave(status: Note["status"], mark: "trash" | "archive" | "restore") {
    setExit(mark);
    onSetStatus(note.id, status);
    onClose();
  }

  /**
   * Keeps Tab inside the sheet, the same trap Lightbox.tsx and Dialog.tsx
   * already run for their own layers.
   *
   * Stands aside for the picture and the remove-attachment confirm (`dialog`
   * in `PANELS`): both are their own nested `role="dialog"` with a complete
   * trap of their own, and bubbling would otherwise have both handlers
   * fighting over the same Tab keystroke against two different focusable
   * lists. The insert, reminder and move panels are not separate dialogs, only
   * anchored rows inside this one, so Tab is meant to keep cycling through the
   * whole sheet while any is open.
   */
  function onSheetKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    if (top?.dialog) return;

    cycleTab(e, sheetRef.current);
  }

  /**
   * Ctrl/Cmd+Shift+E, M and F in the open note: archive, Move, Important
   * (review 2026-10-04, FX-A-05) — the board's bare E, M and F, which here
   * would be typing. The same three marks the header carries, the same paths
   * and undo. Stands down under any panel for Ctrl+Enter's reason (below), and
   * archiving ends the note as the mark does (`leave`). The latest verbs are
   * read through a ref so the listener is registered once per panel state.
   */
  const noteKeys = useRef<(key: string) => void>(() => {});
  noteKeys.current = (k) => {
    if (k === ARCHIVE_KEY) {
      if (note.status === "trashed") return;
      if (note.status === "archived") leave("active", "restore");
      else leave("archived", "archive");
    } else if (k === MOVE_KEY) {
      // A move takes a trashed note out of the Trash (audit UX-2).
      if (onMove) setMoving(true);
    } else if (k === FLAG_KEY) {
      if (note.status !== "trashed") onTogglePriority(note);
    }
  };

  /**
   * The note's keys on the window, in one listener: Escape, Ctrl/Cmd+Enter and
   * the Ctrl/Cmd+Shift verbs above never share a keystroke, and all three ask
   * the same question first — what of the note's own is on top (`PANELS`).
   *
   * **Escape** steps out of one layer at a time — the panel first, the note last.
   *
   * **The key is settled before the panel is**, which is the whole shape of
   * this handler and was the bug in it. Written the other way round it asked
   * *which panel is open* first and *which key was pressed* only at the end,
   * so while the Move chooser, the reminder panel or the insert panel was
   * open **every** keystroke closed it and was cancelled. Two of those panels
   * hold a field you type into — the board chooser's "search or new board"
   * (`BoardChooser.tsx`) and the reminder's own date and time — so from the
   * open note a board could not be searched for, named or created, and a
   * custom reminder time could not be typed at all. The first letter shut the
   * panel.
   *
   * `App.tsx`'s own Escape listener has always had this the right way round,
   * which is why the identical chooser worked from the multi-select panel and
   * not from here. One rule, said the same way in both places.
   *
   * **Ctrl/Cmd+Enter** is "done": commit the words and close the note, back to the
   * board it was opened from. Escape already ends the note the same way — this
   * is the same exit under the hand that is already typing, the shape every
   * other text box on the machine has meant by it for years.
   *
   * It sits on the window rather than on the textarea because the sheet is not
   * only a textarea: the note can be read as well as written, and the focus can
   * be on the chrome. One key, one meaning, wherever inside the note it is
   * pressed. The editor's own `onKeyDown` already lets Ctrl+Enter past — its
   * Ctrl branch only claims B and I — so nothing has to be taken from it here.
   *
   * `commit` is called through its ref for the reason the unmount commit is:
   * keyed on the callback itself, the listener would re-register on every
   * keystroke. Committing here rather than leaving it to the unmount is what
   * lets a numbered list be counted straight before the sheet collapses into
   * the card, instead of a frame after.
   *
   * It stands down while any panel is open — the picture, the remove confirm,
   * the board chooser, the reminder panel, the insert list. Those hold fields
   * of their own and Enter belongs to whatever is being typed into them;
   * stepping out of a panel is Escape's job, one layer at a time.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // The drawer, or whatever it opened, stands over the whole note and
      // takes its own keys. The note is not the top thing.
      if (covered) return;
      if (e.key === "Escape") {
        // The picture and the remove question are on top and close
        // themselves. Escape means the top thing.
        if (top?.dialog) return;
        if (top) {
          e.preventDefault();
          closePanel(top.id);
          return;
        }
        onClose();
        return;
      }
      if (e.key === "Enter") {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        if (top) return;
        e.preventDefault();
        commitRef.current();
        onClose();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== ARCHIVE_KEY && k !== MOVE_KEY && k !== FLAG_KEY) return;
      if (top) return;
      e.preventDefault();
      noteKeys.current(k);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePanel, covered, onClose, top]);

  // Back closes the same layer Escape does, through the one history entry the
  // app keeps for the note (`registerInner`). The picture hands up its own
  // animated close instead.
  useEffect(() => {
    if (top?.ownBack) return;
    if (!top) {
      registerInner(null);
      return;
    }
    const id = top.id;
    registerInner(() => closePanel(id));
    return () => registerInner(null);
  }, [closePanel, registerInner, top]);

  // Before paint, so the caret is already in place when the editor appears.
  //
  // And the page stays where it was. The textarea arrives shorter than the
  // reader it replaces and only grows in `fitTextarea`, so for that moment the
  // body is shorter than its scroll position and the browser clamps it: a tap
  // near the end of a long note, scrolled down, threw the text up and the
  // caret left the finger. `readAt` still holds the position from before the
  // swap — scroll events are delivered a frame later, never inside this commit
  // — so it is put back here, and the focus is told not to scroll either.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!editing || !el) return;
    fitTextarea(el);
    if (bodyRef.current) bodyRef.current.scrollTop = readAt.current;
    el.focus({ preventScroll: true });
    const at = caretRef.current ?? el.value.length;
    caretRef.current = null;
    el.setSelectionRange(at, at);
    // `readAt` is a ref from useReadingPosition and never changes identity.
  }, [editing, readAt]);

  /**
   * ...and the light follows in the same frame the character does. Chased from
   * an ordinary effect the two land a frame apart, which reads as the light
   * limping behind fast typing.
   *
   * Declared *after* the effect above and so run after it, because React runs
   * layout effects in the order they are written: the editor grows as it fills
   * and takes its caret from `caretRef` on the way in, and a pool measured
   * before either had happened would be measured against the wrong box.
   */
  useLayoutEffect(() => {
    if (!editing) return;
    moveLamp();
  }, [draft, editing, moveLamp]);

  /**
   * Applies a programmatic edit and puts the caret back where it belongs.
   *
   * Through `writeThrough`, which keeps the browser's own undo stack alive —
   * assigning `el.value` resets it, and this app has given Ctrl+Z inside an
   * open note *to* the browser (`App.tsx` stands its own listener down), so
   * every autoformat and every Enter that continued a list was silently taking
   * undo away from the one surface that had been promised it.
   */
  function apply(next: { value: string; caret: number }) {
    setDraft(next.value);
    // Do not leave the only copy of a keystroke in component state until blur:
    // mobile browsers can suspend or kill a tab without sending it first.
    persistBody(next.value);
    const el = editorRef.current;
    if (!el) return;
    // The value is controlled, so write it through before moving the caret —
    // React will land on the same string a tick later and leave it alone.
    applying.current = true;
    try {
      writeThrough(el, next.value, next.caret);
    } finally {
      applying.current = false;
    }
    fitTextarea(el);
  }

  function startEditing(e: React.MouseEvent<HTMLDivElement>) {
    const at = offsetAtPoint(e.currentTarget, e.clientX, e.clientY);
    // Counted in the rendered note, which is the stored note character for
    // character, carriage returns and all; the field counts without them.
    caretRef.current = at === null ? null : fieldOffset(draftRef.current, at);
    setEditing(true);
  }

  /**
   * Puts something in at the caret, on a line of its own.
   *
   * The caret is read from the editor when there is one and from `caretRef`
   * when there isn't — opening the panel does not take focus (the rows swallow
   * mousedown), but a note being *read* has no caret at all, so an insert from
   * reading mode lands at the end and starts editing there.
   */
  function insert(item: Insert, chosen?: Picked | null) {
    const el = editorRef.current;
    const value = fieldText();
    if (chosen && chosen.text !== value) return;
    const [picked, sto] = chosen ? [chosen.from, chosen.to] : range();

    // With a selection, a tick box boxes each selected line and a code block
    // fences them (`onSelectedLines`), rather than inserting an empty one.
    const onLines = picked !== sto ? onSelectedLines(item.label, value, picked, sto) : null;
    if (onLines) {
      const { value: next, caret } = onLines;
      setInserting(false);
      if (el) {
        apply({ value: next, caret });
        el.focus({ preventScroll: true });
        return;
      }
      setDraft(next);
      // The same write its twin below makes, and it was missing here. Every
      // other path that changes the text saves it in the same breath — that
      // is what makes a tab Android kills mid-sentence cost at most one
      // character — and this branch left a whole selection turned into tick
      // boxes sitting in React state until the note happened to be blurred or
      // closed. Reachable from reading mode, where `lastRange` still holds a
      // selection made before the editor was tapped out of.
      persistBody(next);
      caretRef.current = caret;
      setEditing(true);
      return;
    }

    const remembered = lastRange.current?.[1] ?? null;
    const at = el
      ? el.selectionEnd
      : remembered !== null && remembered <= value.length
        ? remembered
        : value.length;
    // A row with no fixed text is today's date, worked out now and put into
    // the line rather than onto one of its own — see `INSERTS`.
    const { value: next, caret } =
      item.text === null
        ? insertInline(value, at, writtenDate(new Date()))
        : insertOnOwnLine(value, at, item.text, item.caret);

    setInserting(false);
    if (el) {
      apply({ value: next, caret });
      el.focus({ preventScroll: true });
      return;
    }
    // Not editing yet: hand the caret to the effect that opens the editor.
    setDraft(next);
      persistBody(next);
    caretRef.current = caret;
    setEditing(true);
  }

  /* --- formatting what is already written -----------------------------------
     The text maths — wrapping, marking a line, boxing and inserting — is in
     lib/format.ts, as plain text in and text out. What is left here is reading
     the field and the selection, and writing the answer back. ------------- */

  /**
   * The note as the field counts it — the string every selection offset
   * belongs to, and so the one every edit below is computed against. The field
   * itself while it is open; otherwise the note in the field's line endings,
   * because that is where `lastRange` was recorded. Against `draft`, a note
   * stored with "\r\n" took each offset one character early per line above it
   * — see `fieldValue` in lib/editText.ts.
   */
  function fieldText(): string {
    return editorRef.current?.value ?? fieldValue(draftRef.current);
  }

  /** The selection, or the caret twice — from the editor, or from memory.
   *  See `pickRange` in lib/format.ts for when memory wins. */
  function range(): [number, number] {
    const el = editorRef.current;
    return pickRange(
      fieldText().length,
      lastRange.current,
      el ? [el.selectionStart, el.selectionEnd] : null,
    );
  }

  /* --- new note from selection ----------------------------------------------
     Merge's inverse: the words picked out of this note go into a note of their
     own, filed where this one is, and are taken out of here. One undo puts
     both halves back (`splitNote` in lib/useIdeaVerbs.ts). The text maths — what moves,
     and how the join left behind is tidied — is `cutSelection`. -------------- */

  /**
   * The selection the panel would split, or null.
   *
   * Only a selection the user can see right now. With the editor open that is
   * the field's own, through `range()` — which already knows the one case a
   * phone's blur collapses it. With the note being *read* it is the page's own
   * selection inside the reader, counted in the reader's text (which is the
   * note character for character) and turned into the field's offsets. What
   * it deliberately does not read while reading is `lastRange`: that is a
   * selection from an editing session that has ended, which is no longer
   * highlighted anywhere, and a row offering to cut out words nobody can see
   * would be the one way this could take the wrong ones.
   */
  function selectionNow(): Picked | null {
    const text = fieldText();
    if (editorRef.current) {
      const [from, to] = range();
      return from !== to ? { text, from, to } : null;
    }
    const reader = bodyRef.current?.querySelector(".reader");
    const sel = window.getSelection?.();
    if (!reader || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const picked = sel.getRangeAt(0);
    if (!reader.contains(picked.startContainer) || !reader.contains(picked.endContainer)) {
      return null;
    }
    const lead = document.createRange();
    lead.selectNodeContents(reader);
    lead.setEnd(picked.startContainer, picked.startOffset);
    const start = lead.toString().length;
    const end = start + picked.toString().length;
    const from = fieldOffset(draftRef.current, start);
    const to = fieldOffset(draftRef.current, end);
    return from !== to ? { text, from, to } : null;
  }

  /**
   * The selection as the + found it, read on the press rather than the click.
   * On a phone the press is the last moment it is certainly still there:
   * whatever the tap does to focus happens between the two.
   */
  const pressedWith = useRef<Picked | null>(null);
  /** What the open panel's split row will act on — null draws no row. */
  const [splitting, setSplitting] = useState<Picked | null>(null);

  function openInserts(e: React.MouseEvent) {
    // A click from the keyboard (`detail` 0) had no press of its own, so what
    // is held is left over from some earlier press that never became a click.
    const pressed = e.detail > 0 ? pressedWith.current : null;
    pressedWith.current = null;
    // Asked once, here, whether the pick is worth a row: a selection of
    // spaces or of the whole note has nothing to split.
    const picked = pressed ?? selectionNow();
    setSplitting(picked && cutSelection(picked.text, picked.from, picked.to) ? picked : null);
    setInserting(true);
  }

  function splitOut(at: Picked | null) {
    setInserting(false);
    setSplitting(null);
    // A stale copy is never cut up: the other device's text is the truth.
    if (!at || !onSplit || editConflict) return;
    const value = fieldText();
    // The note moved under the open panel (a sync). The offsets belong to a
    // text that is no longer there, so nothing is cut rather than the wrong
    // words.
    if (value !== at.text) return;
    const cut = cutSelection(value, at.from, at.to);
    if (!cut) return;
    // Counted straight at once, the way a commit would count it on the way
    // out: the split is a finished decision, not a keystroke, and the undo
    // has to know the exact text this leaves behind or a renumber on close
    // would make the note look overtaken and the undo would stand down.
    const rest = renumberLists(cut.rest);
    // The new note first. Only once it exists do the words leave this one, so
    // a refusal leaves the note exactly as it was.
    if (!onSplit(note.id, cut.moved, lastSavedBody.current, rest)) return;
    lastRange.current = null;
    const el = editorRef.current;
    if (el) {
      apply({ value: rest, caret: cut.caret });
      el.focus({ preventScroll: true });
    } else {
      setDraft(rest);
      persistBody(rest);
    }
    committedBody.current = rest;
  }

  /**
   * Bold, italic or heading over the selection — the field's own, or `at`, a
   * pick read earlier (the right-click menu's). A pick taken from a text that
   * has since changed is refused rather than marking the wrong words.
   */
  function applyFormat(fmt: Format, at?: Picked | null) {
    const value = fieldText();
    if (at && at.text !== value) return;
    const [from, to] = at ? [at.from, at.to] : range();
    const hit =
      fmt.mode === "wrap" ? wrapWith(value, from, to, fmt.mark) : markLine(value, from, fmt.mark);
    setInserting(false);
    // A rewrite that would put marks in the text the reader cannot draw is
    // refused whole: no write, no clock, and the selection stays where it was.
    if (!hit) return;
    setDraft(hit.value);
    persistBody(hit.value);

    const el = editorRef.current;
    if (!el) {
      // Reading rather than editing: hand the caret to the effect that opens
      // the editor, the same way an insert from reading mode does.
      caretRef.current = hit.to;
      setEditing(true);
      return;
    }
    // Controlled value, so write it through before moving the selection — React
    // lands on the same string a tick later and leaves it alone. A *range* and
    // not a caret: wrapping a selection must leave it selected, or bolding then
    // italicising the same phrase means picking it out twice.
    el.focus({ preventScroll: true });
    applying.current = true;
    try {
      writeThrough(el, hit.value, hit.from, hit.to);
    } finally {
      applying.current = false;
    }
    fitTextarea(el);
  }

  /**
   * A right-click inside the note, with a mouse: the note's own menu at the
   * pointer, the board's right-click said inside the note (`NoteMenu`).
   *
   * The browser's menu is left alone where it has something the note does
   * not: on a link (open in a new tab, copy the address), on a picture or a
   * player (save it), in a field that is not the note's text (the name
   * field), and whenever Shift is held — the way back to it on purpose. A
   * finger's long press is never taken: on a phone it is text selection.
   */
  function openNoteMenu(e: React.MouseEvent<HTMLElement>) {
    if (e.shiftKey || e.button !== 2 || pressedBy.current !== "mouse") return;
    if (covered || closing || exit) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("a[href], img, video, audio, input, select")) return;
    e.preventDefault();
    openMenuAt({ x: e.clientX, y: e.clientY });
  }

  function openMenuAt(at: { x: number; y: number }) {
    for (const p of PANELS) if (p.corner) closePanel(p.id);
    setNoteMenu({ ...at, picked: selectionNow() });
  }

  /** A row of the menu: the menu goes first, then the act — so an act that
   *  opens a panel of its own opens it alone. */
  function fromMenu(act: () => void) {
    return () => {
      setNoteMenu(null);
      act();
    };
  }

  /** A tick or a dropped item, from the reader: a decision, not a keystroke,
   *  so it saves at once. */
  function rewrite(next: string) {
    setDraft(next);
    persistBody(next);
  }

  /**
   * Untick all or Clear done — one decision about the whole list, saved at
   * once like a tick, and offered back like an archive.
   *
   * Applied to the text as it stands now (`draftRef`), not as the strip last
   * drew it: the press took the focus, so an open editor has already blurred
   * and committed, and that commit may have counted a numbered list straight.
   * `committedBody` moves with it, as a name does, so closing the note
   * afterwards does not count this as an edit still to be tidied. Nothing is
   * offered back if the write was refused — a newer copy is on the other
   * device, the conflict notice is up, and an undo would be reversing
   * something that never landed.
   */
  function rewriteList({ run, notice }: ListRewrite) {
    const before = draftRef.current;
    const after = run(before);
    if (after === before) return;
    const done = doneCount(before);
    draftRef.current = after;
    setDraft(after);
    if (!persistBody(after)) return;
    committedBody.current = after;
    onListRewritten?.(note.id, before, after, notice(done));
  }

  const archived = note.status === "archived";
  const trashed = note.status === "trashed";
  const marks = useAttachMarkers({ attachments, root: bodyRef, attach: (files, refs) => onAttach(note.id, files, refs), text: fieldText, write: apply });
  const drop = useNoteDrop((files) => marks.attachAt(files, editorRef.current ? range()[1] : undefined));
  /**
   * The stamp counts from the last edit, because that is what the board is
   * ordered on and what you were about to ask. The capture date does not
   * disappear — a note you wrote in March and revised this morning is two
   * facts, and the sheet has room for both — but it stops being the headline,
   * and it is dropped entirely on the same day it was written, where printing
   * it twice says nothing.
   */
  const edited = editedAt(note);
  const changed = wasEdited(note);
  const when = useTimeWords(edited);
  const born = useFullDate(note.created_at);
  const lastly = useFullDate(edited);
  const untouched = useUntouchedSince(edited);
  // Both rows above the text are decided once per stretch of editing. The
  // first keystroke in an old note stamps it edited, which brought "written …"
  // in over the caret (~28px); typing `# ` on line one names the note, which
  // took the NAME row out from under it (~25px). Anything above the words may
  // change while they are being read, never while they are being written.
  const showWritten = useHeldWhile(changed && lastly !== born, editing);
  const offerName = useHeldWhile(!trashed && noteName(draft) === null, editing);
  // Where the note lives, for the same row — a deleted or not-yet-synced
  // board resolves to nothing rather than a broken label, so this stays
  // undefined and simply isn't rendered.
  const board = note.board_id ? boards.find((b) => b.id === note.board_id) : undefined;
  const boardName = board?.name;
  // The board's own mark, beside its name — the glyph it wears on the shelf,
  // or the folder that is every board's default. `boardGlyph` returns null
  // until the icon set has loaded, which is the same brief fallback the shelf
  // itself draws.
  const boardMark = board ? <FolderGlyph icon={board.icon} tier="data" /> : null;

  // What the timestamp row says, and what it means when it is tapped — see
  // `useReminderLine` in ReminderPanel.tsx.
  const { reminderAt, overdue, reminderLine, reminderMain, reminderCaveat } = useReminderLine(
    note,
    pushStatus,
  );
  // What the toggle draws is **effective membership** — is this note on the
  // Todos board — not the raw field. Read off `note_type` alone, the one
  // control that governs Todos appeared to do nothing for exactly the notes
  // most likely to be there: a note whose every line is a tick box is on Todos
  // by its own text with `note_type` still null, so the mark drew *off* and
  // offered to "mark as to-do" a note already sitting on the board. Pressing it
  // flipped the label and moved nothing, twice over.
  //
  // `isTodoNote` is the one definition the shelf reads too, so the mark and the
  // board can no longer say different things about the same note.
  const isTodo = isTodoNote(note);

  return (
    <div
      className="sheet" data-closing={closing || undefined}
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label="Note"
      tabIndex={-1}
      onKeyDown={onSheetKeyDown}
      // A picture on the clipboard belongs to *this* note, wherever in the
      // sheet the focus happens to be — in the editor, in the reader, or on
      // the sheet itself after a tap on the chrome. So the handler sits on the
      // whole layer rather than on the textarea, which is the element that
      // does not exist while the note is being read.
      //
      // Pasted text is left completely alone: with no files on the clipboard
      // this does nothing at all and the browser inserts the characters as it
      // always has. Taking the event (`preventDefault`) is also what tells the
      // window-level handler in App to stand down, so a screenshot pasted here
      // attaches to the open note instead of also landing as a new one.
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        // A clipboard can carry both — cells copied out of a spreadsheet are a
        // picture of the cells *and* the cells as text — and taking the event
        // for the file took the words with it. Into an open editor they still
        // go: at the caret, through the same undoable write every other edit
        // makes, in the line endings a native paste would have left. A note
        // being read has no caret to put words at, so there the file is all
        // that is taken, as before.
        const el = editorRef.current;
        const text =
          el && e.target === el ? fieldValue(e.clipboardData.getData("text/plain")) : "";
        if (el && text !== "") {
          const from = el.selectionStart;
          apply({
            value: el.value.slice(0, from) + text + el.value.slice(el.selectionEnd),
            caret: from + text.length,
          });
        }
        marks.attachAt(files, el ? range()[1] : undefined);
      }}
      // A file dragged onto the open note belongs to this note (`useNoteDrop`).
      {...drop.handlers}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Marks, not words. Six actions on one note is still a vocabulary
          small enough to learn once, and the labels were spending a third of
          the bar on text you read exactly twice. */}
      {drop.over && (
        <div className="dropzone mono" aria-hidden>
          <span>Drop to add to this note</span>
        </div>
      )}
      <div className="sheet-bar" ref={barRef}>
        <button
          ref={backRef}
          type="button"
          className="iconbtn"
          aria-label="Close note"
          title="Back"
          onClick={onClose}
        >
          <IconBack />
        </button>
        {/* The shelf, from inside the note. The note covers the board row, so
            the burger that reaches another board was under it and every trip
            was Back first. This opens the same drawer over the note. It sits
            with Back, before the spacer, because both say where you are rather
            than doing something to this note — the six in the corner are still
            the six verbs — and because the drawer comes in from this edge.
            Drawn wherever the app hands it a drawer to open — every width,
            since the desktop gained the drawer too. */}
        {onOpenShelf && (
          <button
            ref={shelfMark}
            type="button"
            className="iconbtn"
            aria-label="Boards"
            title="Boards"
            aria-expanded={shelfOpen}
            onClick={onOpenShelf}
          >
            <IconBoards on={shelfOpen} tier="nav" />
          </button>
        )}
        {/* What is being written is being saved. Drawn only while the editor
            is open — a note being *read* is not being written to, and a mark
            reporting on nothing is furniture. It is a state, not a verb, so it
            sits before the spacer with Back rather than among the six marks in
            the corner, and it is a `<span>`: there is nothing here to press.
            See `markSaving` for what the two states mean. */}
        <span className="spacer">
          {/* Inside the spacer, so arriving can never push the marks. */}
          {editing && (
            <span
              className="mark-state save-state"
              data-state={saving ? "working" : "idle"}
              title={saving ? "Saving" : "Saved"}
              aria-hidden
            >
              <SyncMark />
            </span>
          )}
        </span>
        {/* The six marks' own box (five, with Back on the near side). On a
            desktop it is no box at all (`display: contents`) and the marks
            stand in the bar as they always have. On a phone it stands at the
            bottom edge, where the thumb is, and rides above the keyboard
            (owner approved 2026-10-05, review UX-A-10); Back stays top-left. */}
        <div className="sheet-marks">
        {/* Insert is an ordinary mark in the bar, not a button floating over
            the words: first in the box, so it is the empty left end of a
            phone's bottom bar and stands beside the flag on a desktop. */}
        <button
          ref={plusMark}
          type="button"
          className="iconbtn sheet-plus"
          aria-label="Insert"
          title="Insert"
          onPointerDown={() => {
            pressedWith.current = selectionNow();
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            panelOpener.current = "plus";
            openInserts(e);
          }}
        >
          <IconInsert />
        </button>
        {/* A note in the Trash is offered Put back and Move, not marks for a
            note in use: Important, To-do and a reminder stand down, as they do
            in the selection panel (audit 2026-10-10, UX-2). */}
        {!trashed && (
        <button
          type="button"
          className="iconbtn"
          data-on={note.priority > 0}
          aria-pressed={note.priority > 0}
          aria-label="Important"
          title="Important"
          onClick={() => onTogglePriority(note)}
        >
          <IconPriority on={note.priority > 0} />
        </button>
        )}
        {onToggleTodo && !trashed && (
          <button
            type="button"
            className="iconbtn"
            data-on={isTodo}
            aria-pressed={isTodo}
            // One name whichever way it stands; `aria-pressed` says which
            // (review 2026-10-04, CD-02).
            aria-label="To-do"
            title="To-do"
            onClick={() => onToggleTodo(note)}
          >
            <IconTodo on={isTodo} tier="nav" />
          </button>
        )}
        {onMove && (
          <button
            ref={moveMark}
            type="button"
            className="iconbtn"
            data-on={moving}
            aria-pressed={moving}
            aria-label="Move to a board"
            title="Move"
            onClick={() => {
              panelOpener.current = "move";
              setPanelAnchor(hangFrom(moveMark.current));
              setMoving(true);
            }}
          >
            <IconFolder tier="nav" />
          </button>
        )}
        <button
          type="button"
          className="iconbtn"
          data-on={archived}
          aria-label={archived ? "Unarchive" : "Archive"}
          title={archived ? "Unarchive" : "Archive"}
          onClick={() =>
            archived ? leave("active", "restore") : leave("archived", "archive")
          }
        >
          <IconArchive on={archived} />
        </button>
        {/* Delete moves to the trash — the note stays whole for a month. */}
        <button
          type="button"
          className={trashed ? "iconbtn iconbtn-worded" : "iconbtn"}
          aria-label={trashed ? "Put back" : "Delete"}
          title={trashed ? "Put back" : "Delete"}
          onClick={() =>
            trashed ? leave("active", "restore") : leave("trashed", "trash")
          }
        >
          {trashed ? <><IconRestore /><span className="mono">Put back</span></> : <IconDelete />}
        </button>
        </div>
      </div>

      {/* Anchored bottom-right like every other panel in the app, because that
          is where the thumb is — even though what it acts on is up in the
          text. Every row swallows mousedown so the caret survives the tap. */}
      {inserting && (
        <InsertPanel from={plusMark} reminderSet={Boolean(reminderAt)}
          onFormat={applyFormat}
          onSplit={onSplit && splitting ? () => splitOut(splitting) : undefined}
          onAttach={() => {
            marks.remember(editorRef.current ? range()[1] : null); pickerRef.current?.click();
            setInserting(false);
          }}
          onReminder={trashed ? undefined : () => {
            setInserting(false);
            setPanelAnchor(hasKeyboard(false) ? underOf(stampMark.current) : undefined);
            setReminderPicking(true);
          }}
          onInsert={insert}
          onClose={() => setInserting(false)}
        />
      )}

      {noteMenu && (
        <NoteMenu
          at={noteMenu}
          picked={noteMenu.picked !== null}
          important={note.priority > 0}
          todo={isTodo}
          archived={archived}
          trashed={trashed}
          reminderSet={Boolean(reminderAt)}
          onFormat={editConflict ? undefined : (fmt) => fromMenu(() => applyFormat(fmt, noteMenu.picked))()}
          onCodeBlock={editConflict ? undefined : fromMenu(() => insert(CODE_BLOCK, noteMenu.picked))}
          onCopyPicked={fromMenu(() => {
            const at = noteMenu.picked;
            if (at) void copyText(at.text.slice(at.from, at.to));
          })}
          onSplit={
            onSplit &&
            !editConflict &&
            noteMenu.picked &&
            cutSelection(noteMenu.picked.text, noteMenu.picked.from, noteMenu.picked.to)
              ? fromMenu(() => splitOut(noteMenu.picked))
              : undefined
          }
          // The strip's Copy: the words on screen, unsaved ones too, and not
          // offered on a note with no words.
          onCopy={draft.trim() !== "" ? fromMenu(() => void copyText(draft)) : undefined}
          onImportant={trashed ? undefined : fromMenu(() => onTogglePriority(note))}
          onTodo={onToggleTodo && !trashed ? fromMenu(() => onToggleTodo(note)) : undefined}
          // The panels a row opens hang from the pointer, where the menu was,
          // as they hang under their own marks with a mouse (review UI-A-03).
          onReminder={
            onSetReminder && !trashed
              ? fromMenu(() => {
                  panelOpener.current = "stamp";
                  setPanelAnchor({ left: noteMenu.x, top: noteMenu.y });
                  setReminderPicking(true);
                })
              : undefined
          }
          onDelete={fromMenu(() => (trashed ? leave("active", "restore") : leave("trashed", "trash")))}
          onArchive={fromMenu(() => (archived ? leave("active", "restore") : leave("archived", "archive")))}
          onMove={
            onMove
              ? fromMenu(() => {
                  panelOpener.current = "move";
                  setPanelAnchor({ left: noteMenu.x, top: noteMenu.y });
                  setMoving(true);
                })
              : undefined
          }
          onReopen={openMenuAt}
          onClose={() => setNoteMenu(null)}
        />
      )}

      {/* Reached by tapping the timestamp row, or by "Set reminder" in the
          insert menu above (the stamp row alone turned out to be a control
          nobody found) — same panel shape either way. Setting a time here
          only ever writes reminder_at — see the comment on onSetReminder
          above and lib/reminders.ts. */}
      {reminderPicking && (
        <ReminderPanel
          note={note}
          anchor={panelAnchor}
          pushStatus={pushStatus}
          onSetReminder={onSetReminder}
          onSetRepeat={onSetRepeat}
          onEnableRing={onEnableRing}
          onDisableRing={onDisableRing}
          onClose={() => setReminderPicking(false)}
        />
      )}

      {/* The note collapses onto this, so the gesture ends on its reason.
          Drawn at the middle of the screen, inside the shrinking clip. */}
      {exit && (
        <span className="sheet-mark" aria-hidden>
          {exit === "trash" ? (
            <IconDelete />
          ) : exit === "archive" ? (
            <IconArchive on />
          ) : (
            <IconRestore />
          )}
        </span>
      )}

      {/* Off-screen rather than hidden: a display:none input cannot be opened
          by script in every browser, and this one has to be. */}
      <input
        ref={pickerRef}
        type="file"
        multiple
        className="offscreen"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const picked = Array.from(e.currentTarget.files ?? []);
          // Cleared so picking the same file twice in a row still fires.
          e.currentTarget.value = "";
          if (picked.length > 0) marks.attachAt(picked);
        }}
      />

      <div
        className="sheet-body"
        ref={bodyRef}
        onPointerDownCapture={(e) => {
          pressedBy.current = e.pointerType;
        }}
        onContextMenu={openNoteMenu}
        data-conflict={editConflict || undefined}
        // Copied out rather than read back on the way out — see the effect
        // above. Nothing is stored here; this is one number in a ref.
        onScroll={(e) => {
          readAt.current = e.currentTarget.scrollTop;
        }}
      >
        <div className="sheet-meta mono">
          {/* The facts read first — where the note came from, what it is part
              of, whether it is on its way out. The date lives in the footer
              under the words, beside the verbs (see .sheet-verbs) — and so, as
              of now, does the board this note is filed in: it is the same kind
              of fact as the date, and the footer is where the note's own facts
              are read once the words have been. */}
          {showWritten && <span>written {born}</span>}
          {/* Underlined, so it is a control: it is the worded Put back, beside
              the fact that makes it worth pressing. It was underlined and did
              nothing — a link that went nowhere — while the bar's Put back was
              an unworded mark (review 2026-10-01, UX-24). */}
          {trashed && (
            <button
              type="button"
              className="meta-warn meta-putback"
              onClick={() => leave("active", "restore")}
            >
              in trash — {daysLeftInTrash(note)}d left · put back
            </button>
          )}
          {/* On a length, not on the array: an idea that was un-merged or
              dissolved keeps `merged_from: []`, and opens here as the plain
              note it now is — "merged from 0" is a fact about nothing. */}
          {(note.merged_from?.length ?? 0) > 0 && (
            <span>idea · merged from {note.merged_from?.length}</span>
          )}
          {note.merged_into && <span>part of an idea</span>}
        </div>

        {/* The name, offered where it will be drawn: straight above the text,
            because once written it *is* the text's first line, set as its
            heading. So it is offered only to a note that has none — a named
            note shows its name in the reader, and a tap on it edits it like
            any other line. Said the way an unnamed idea says "Idea" in the
            canvas bar: the display face, in capitals, in muted, and a button.
            Drawn whether the text is being read or typed into: hidden while
            typing, it would pull the text up a row the moment a tap opened the
            editor, and the caret would no longer sit under the finger that
            placed it. Not in the trash. Above the conflict notice rather than
            under it, because nothing may come between that notice and the
            words it is about. */}
        <NoteNameRow offer={offerName} current={noteName(draft)} onName={nameNote} />

        {/*
            A newer copy of this note arrived while these words were being
            edited, so they were not saved — and until now the app said so in
            the row of short mono facts above, where `.mono` shouts it in
            tracked capitals beside "324 CHARS", and offered nothing back.

            It is not a fact about the note like "in trash — 12d left". It is
            an event that happened to the words on screen, so it is stated
            over the foot of the sheet while they are read — floating, not in
            the column, because it arrives mid-typing and in the column it
            pushed the words down under the caret — and in the
            app's one error grammar: full ink beside a 3px ink rule
            (DESIGN.md §3 and §6), which `.signin-error` and `.meta-overdue`
            already carry. No colour; an error is not a red thing here.

            **And it hands the words back.** The conflict rule itself does not
            move — a stale copy must never stamp on the newer one, so `commit`
            still refuses — but refusing to save is not the same as being
            entitled to throw the sentence away without a way to keep it. Copy
            takes `draft`, exactly as the note's own Copy verb below does, and
            says "copied" for the same `COPIED_MS`.

            `role="status"` because it appears while the user is looking at the
            text rather than at this line: a changed message that is not a live
            region is one nobody is told about. */}
        {editConflict && (
          <div className="sheet-conflict" role="status">
            <p className="sheet-conflict-said">
              This note changed on another device. The words below were not saved
              over it.
            </p>
            <button
              type="button"
              className="sheet-conflict-verb mono"
              data-on={copiedMine}
              aria-label={copiedMine ? "Copied your version" : "Copy your version of this note"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void copyMine(draft)}
            >
              {copiedMine ? "copied" : "copy your version"}
            </button>
            {/* The two ways out of it (audit 2026-10-10, UX-5), each a choice
                the person makes, never one the app makes for them: take the
                other device's words, or put these over them on purpose. */}
            <button
              type="button"
              className="sheet-conflict-verb mono"
              onMouseDown={(e) => e.preventDefault()}
              onClick={showNewer}
            >
              show the newer one
            </button>
            <button
              type="button"
              className="sheet-conflict-verb mono"
              onMouseDown={(e) => e.preventDefault()}
              onClick={keepMine}
            >
              keep mine
            </button>
          </div>
        )}

        {editing ? (
          <div className="editor-field" data-lamp-idle={lampIdle || undefined}>
          {/* The light, and the glass it is measured through. Both are
              furniture for the words underneath: neither is in the
              accessibility tree, and the lamp cannot catch a tap
              (`pointer-events: none`). The durations are handed down here
              rather than written in the stylesheet, so lib/motion.ts stays the
              only copy of both. */}
          <div
            ref={lampRef}
            className="editor-lamp"
            aria-hidden
            style={LAMP_STYLE}
          />
          <div ref={mirrorRef} className="editor-mirror" aria-hidden />
          <CodeBands text={fieldValue(draft)} />
          <textarea
            ref={editorRef}
            className="editor"
            // Not the default two rows: a one-line note grew a line when tapped.
            rows={1}
            // In the field's own line endings (`fieldValue`). A note stored with
            // "\r\n" handed over as it stands differs from what the field
            // reports, and React, comparing the two on every render, writes the
            // value back in — which in a browser throws the selection away.
            // The stored body is untouched until something edits it.
            value={fieldValue(draft)}
            onChange={(e) => {
              const el = e.currentTarget;
              // `writeThrough` edits the field with the browser's own command,
              // which fires an input event of its own. Everything about that
              // edit is already done — the draft is set and persisted — so
              // taking it a second time here would run `autoformat` over the
              // result of the rule that has just run.
              if (applying.current) return;
              wakeLamp();
              // Mid-composition the field holds an IME's working text, which is
              // not yet what anybody typed. Rewriting it — which is what an
              // autoformat hit does — tears the composition down and can drop
              // or duplicate characters. The value is still kept and still
              // persisted; only the rules stand aside, until `compositionend`.
              // React types a change event's native event as a plain `Event`;
              // the one a textarea fires is an `InputEvent` and carries the
              // flag.
              if ((e.nativeEvent as Partial<InputEvent>).isComposing === true) {
                setDraft(el.value);
                persistBody(el.value);
                fitTextarea(el);
                return;
              }
              const hit = autoformat(el.value, el.selectionStart);
              if (hit) apply(hit);
              else {
                setDraft(el.value);
                 persistBody(el.value);
              }
              fitTextarea(el);
            }}
            onKeyDown={(e) => {
              // Ctrl+B and Ctrl+I, which every text field on the machine has
              // meant for thirty years and a textarea means nothing by. Unlike
              // Ctrl+Z there is nothing here to stand aside for.
              if ((e.ctrlKey || e.metaKey) && !e.altKey) {
                const key = e.key.toLowerCase();
                const fmt = key === BOLD_KEY ? F_BOLD : key === ITALIC_KEY ? F_EM : null;
                if (fmt) {
                  e.preventDefault();
                  applyFormat(fmt);
                }
                return;
              }
              if (e.key !== "Enter" || e.shiftKey) return;
              // The Enter that commits an IME candidate is not an Enter that
              // means anything to a list. Swallowed here, it blocked the
              // commit and laid a fresh marker around text still being
              // composed. `keyCode === 229` is the same key on the older
              // Android WebViews that never set `isComposing`.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              const el = e.currentTarget;
              if (el.selectionStart !== el.selectionEnd) return;
              const hit = continueList(el.value, el.selectionStart);
              if (!hit) return;
              e.preventDefault();
              apply(hit);
            }}
            onBlur={() => {
              commit();
              setEditing(false);
            }}
            // The caret moves for four reasons and the light has to follow all
            // of them: typing (the layout effect above), taking focus, moving
            // the caret without changing the text, and — for the rare note long
            // enough to do it — the field scrolling inside itself. `onSelect`
            // is the one that covers arrows, clicks and drags, and it fires on
            // a collapsed selection too, which is what a caret is.
            onFocus={lampMoved}
            onScroll={lampMoved}
            onSelect={(e) => {
              lastRange.current = [
                e.currentTarget.selectionStart,
                e.currentTarget.selectionEnd,
              ];
              lampMoved();
            }}
            // On for a screen keyboard, off at a hardware one — the capture
            // bar's rule (CaptureBar.tsx, review 2026-10-01, UX-14). A phone's
            // keyboard takes spellcheck off to mean no suggestions at all.
            spellCheck={!hasKeyboard(true)}
            aria-label="Note text"
          />
          </div>
        ) : (
          <AttachRefsContext.Provider value={marks.refs}><NoteReader
            blocks={blocks}
            text={draft}
            textRef={draftRef}
            terms={hitTerms}
            onRewrite={rewrite}
            onStartEditing={startEditing}
            onFocusEdit={() => setEditing(true)}
          /></AttachRefsContext.Provider>
        )}

        {/* Under the words (owner, 2026-10-17): the name and the text lead and
            what came with them follows, so a note of twelve screenshots still
            opens on what was written. Hiding a preview is a write to the note,
            which the trash does not take: it would restamp `updated_at`. */}
        <LinkPreviewList
          previews={linkPreviews}
          onHide={
            onHidePreviews && !trashed
              ? (href) => onHidePreviews(note.id, [href], true)
              : undefined
          }
          onShowHidden={
            onHidePreviews && !trashed
              ? (hrefs) => onHidePreviews(note.id, hrefs, false)
              : undefined
          }
        />
        <NoteAttachments
          attachments={attachments}
          tiles={openable}
          rows={fileAttachments.filter((att) => !canPreview(att))}
          onRequestRemove={setRemoveRequest}
          onOpenPreview={openPreview}
          sendsFiles={sendsFiles}
          describe={describe}
        />

        {/* The note's footer, under the text, where a reader's hand is once
            they have read it: the date — and the tap target for a reminder —
            on the left, and the verbs copy, share, read on the right. The same
            shape a message carries under itself in a chat. Copy and read are
            drawn only on a note with words; share also on a note with files,
            since a photograph with no words is still something to send. The
            date always shows, because the note always has one. */}
        <div className="sheet-verbs mono" role="group" aria-label="Note actions">
          {/* The facts — the stamp and the board — in a box of their own, so
              the verbs have a fixed place: always the right end of the first
              line. When the facts are too long for one line they wrap inside
              this box, under each other; they used to wrap the verbs instead,
              which then dropped to a line of their own on the left on some
              notes and sat on the date line on others (review 2026-10-01,
              UI-17). */}
          <div className="sheet-facts">
          {/* The same stamp that has always said when this was edited, now the
              tap target for a reminder too — reusing what is here rather than a
              fifth mark on the bar above. Once a reminder is set it takes the
              stamp over completely, in the same relative-time grammar; clearing
              it (from the picker) or the time simply passing both bring the
              edit-time framing back, except that overdue is its own state and
              gets a word first.

              A clock stands in front of the words, in the row's own muted tone.
              Without it the stamp was 12px of muted text with no underline, no
              border and no glyph — a caption, and the app's only in-place way
              to schedule anything was a control nobody found (2026-09-04
              audit, F4). The glyph says "this is about time" in the same mark
              the reminder panel's rows wear; the box behind it is 44px tall
              (`.meta-stamp`) so a thumb can hit what the glyph now offers. */}
          <button
            ref={stampMark}
            type="button"
            className="meta-stamp"
            // In the Trash the stamp is only a date: no reminder is set from
            // there (audit 2026-10-10, UX-2).
            disabled={trashed}
            aria-haspopup={trashed ? undefined : "menu"}
            aria-expanded={trashed ? undefined : reminderPicking}
            aria-label={
              trashed
                ? undefined
                : reminderAt
                  ? `${reminderLine}. Change or clear the reminder.`
                  : "Set a reminder"
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (!reminderPicking) {
                panelOpener.current = "stamp";
                setPanelAnchor(hasKeyboard(false) ? underOf(stampMark.current) : undefined);
              }
              setReminderPicking((v) => !v);
            }}
          >
            {!trashed && <IconReminder tier="data" />}
            <span className="meta-stamp-words">
              {reminderMain ? (
                <>
                  <span className={overdue ? "meta-overdue" : "meta-when"}>{reminderMain}</span>
                  {/* Advice, not a machine fact: the reading face (CD-05). */}
                  {reminderCaveat && <>{" "}<span className="advice">{reminderCaveat}</span></>}
                </>
              ) : (
                <>
                  {/* How long ago comes first, because that is the question. The
                      exact day follows it while both are worth saying; past a
                      week `when` is null and the date stands alone rather than
                      being printed twice. */}
                  {when && (
                    <span className="meta-when">{changed ? `edited ${when}` : when}</span>
                  )}
                  {untouched ? <span className="advice">{untouched}</span> : <span className="meta-date">{lastly}</span>}
                </>
              )}
            </span>
          </button>
          {/* Where the note lives, between the date and the verbs — read after
              the one and before the other, which is the order the row is
              scanned in. It sat in the meta row above the text until now; that
              row is read *before* the note, and where a note is filed is not
              something you need to know in order to start reading it. It is
              the same kind of fact as the stamp beside it, so it keeps the
              stamp's company rather than standing on its own line.

              It carries the folder's own glyph and the folder's name, and no
              tint — DESIGN.md §2b lets a folder colour its mark on the shelf
              and nowhere else, and this is the app reporting, not the shelf.
              It sits in `.sheet-facts` with the stamp, and that box taking the
              slack is what keeps the verbs pinned to the right edge. */}
          {board && (
            <span className="meta-board" title={`Filed in ${boardName}`}>
              {boardMark}
              in {boardName}
            </span>
          )}
          </div>
          <NoteVerbs
            text={draft}
            attachments={attachments}
            // Not in the trash, where the note is on its way out rather than
            // in use, and not while the words on screen are in conflict with a
            // newer copy — a rewrite there could not be saved.
            onListRewrite={trashed || editConflict ? undefined : rewriteList}
            ticked={ticked}
          />
        </div>

        {/* The empty space under the strip, and the way into the note from
            it: a tap lands the caret at the end, which is what the reader's
            own 60dvh of blank space used to do before it was moved here.
            Nothing is drawn, so it stays out of the accessibility tree —
            the reader above it is the labelled way in. */}
        <div
          className="sheet-rest"
          aria-hidden
          onClick={() => {
            const el = editorRef.current;
            if (el) {
              el.focus();
              el.setSelectionRange(el.value.length, el.value.length);
              return;
            }
            // Null is "the end" — see the read of caretRef when editing opens.
            caretRef.current = null;
            setEditing(true);
          }}
        />
      </div>

      {/* Last, so it sits over the sheet and its bar. It registers its own
          close with the app, which is how Back reaches past the note to the
          thing actually on top without a second history entry. */}
      {lightbox && looking && (
        <Lightbox
          att={looking}
          src={lookingUrl ?? seed?.src ?? looking.thumb ?? ""}
          origin={lightbox.origin}
          register={registerInner}
          onClose={() => setLightbox(null)}
          downloadUrl={lookingUrl ?? seed?.url ?? null}
          at={lookingAt}
          count={openable.length}
          onStep={(next) => {
            const to = openable[next];
            if (to) setLightbox((was) => (was ? { ...was, id: to.id } : was));
          }}
          alt={describe(looking)}
          // One layer at a time: the picture goes, and the note asks.
          onRemove={() => { flushSync(() => setLightbox(null)); setRemoveRequest(looking); }}
          isCover={attachments[0]?.id === looking.id}
          onCover={
            onReorderFiles && note.status !== "trashed"
              ? () => onReorderFiles(note.id, [looking, ...attachments.filter((a) => a.id !== looking.id)])
              : undefined
          }
        />
      )}

      {removeRequest && (
        <Dialog
          title="Remove attachment?"
          message={`Remove ${removeRequest.name} from this note?`}
          confirmLabel="Remove attachment"
          destructive
          onConfirm={() => {
            const attachment = removeRequest;
            setRemoveRequest(null);
            onDetach(note.id, attachment.id);
          }}
          onCancel={() => setRemoveRequest(null)}
        />
      )}

      {/* The Move mark's chooser — the same BoardChooser the multi-select
          Move panel uses, so filing one note looks and behaves exactly like
          filing a selection of them. */}
      {moving && onMove && (
        <button type="button" className="menu-dismiss menu-dismiss-over" aria-label="Close board chooser" onClick={() => setMoving(false)} />
      )}
      {moving && onMove && (
        <BoardChooser
          boards={boards}
          countFor={countFor}
          under={panelAnchor}
          over
          // `isFiled`, not `board_id !== null`. "Unfiled" means *no board*,
          // and every one of the 241 imported notes carries no such field at
          // all — read strictly, `undefined !== null` is true, so the one row
          // that takes a note off its board was being offered for notes that
          // were not on one. One definition, shared with the board, the card's
          // filed mark and the Sorter's pile (`lib/boards.ts`).
          // Handed the folders that exist, as the board asks it: a note whose
          // folder was deleted is in the Inbox, and offering it the Inbox row
          // would be offering it the place it already is. An empty list is a
          // list not read yet, not a shelf with no folders on it.
          // A note put on Links by hand is not in the Inbox either, so the
          // row that brings it back is offered to it too.
          showUnfiled={
            isFiled(note, boards && boards.length > 0 ? folderIds(boards) : undefined) ||
            keptOnLinks(note)
          }
          onUnfile={() => {
            onMove(note.id, null);
            setMoving(false);
          }}
          onLinks={
            onLinks && canKeepOnLinks(note)
              ? () => {
                  onLinks(note.id);
                  setMoving(false);
                }
              : undefined
          }
          onChoose={(b) => {
            onMove(note.id, b.id);
            setMoving(false);
          }}
          onCreate={(name) => {
            if (!onCreateBoard) return;
            const created = onCreateBoard(name);
            onMove(note.id, created.id);
            setMoving(false);
          }}
          onCancel={() => setMoving(false)}
        />
      )}
    </div>
  );
}
