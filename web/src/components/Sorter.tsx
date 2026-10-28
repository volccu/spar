import { ARCHIVE_KEY, isTypingTarget, useHasKeyboard } from "../lib/hotkeys";
import { useIsPhone } from "../lib/breakpoint";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { leftByHand } from "../lib/emptiedByHand";
import type { Note, UserBoard } from "../types";
import { useModeLayer } from "../lib/useModeLayer";
import { canKeepOnLinks, filePatch, isTodoNote, linksPatch } from "../lib/boards";
import { wordsBesideLinks } from "../lib/face";
import { overlaySaved, previewsFor } from "../lib/links";
import { presetReminder, presetWhen, reminderPresets, type ReminderPreset } from "../lib/reminders";
import { Action } from "./shared/Action";
import { KeyCaps } from "./Hotkey";
import { linkRows, rowWords } from "../lib/linkRow";
import { parseBlocks } from "../lib/blocks";
import { offsetAtPoint } from "../lib/caret";
import { fieldOffset, fieldValue } from "../lib/editText";
import { fitTextarea } from "../lib/fitTextarea";
import { renumberLists } from "../lib/reorder";
import { FolderGlyph } from "./BoardLook";
import { PileEdge } from "./PileEdge";
import { SorterTally } from "./SorterTally";
import { tidiedUp, type Tally } from "../lib/mascotMoments";
import { NewBoardName } from "./NewBoardName";
import { tintOf } from "../lib/boardLook";
import {
  IconArchive,
  IconCheck,
  IconClear,
  IconDelete,
  IconFolder,
  IconInbox,
  IconLink,
  IconOpenNote,
  IconPlus,
  IconPriority,
  IconReminder,
  IconRestore,
  IconStepBack,
  IconStepOn,
  IconTodo,
} from "./Icons";

/**
 * What was decided about one note in the pile — one per position, not one per
 * tap, so walking **Back** and answering again replaces the old answer instead
 * of counting twice. "Left" is the note left exactly as it was: the summary
 * counts it because a run where nothing moved is still a run you did.
 */
type Verdict = "left" | "moved" | "archived" | "binned" | "reminded";

/**
 * One position's answer, and what the note held before **any** answer here
 * touched it — so Back-then-Leave can put it back exactly (review 2026-10-01,
 * UX-03). `before` holds only the fields the answers wrote, and it is the
 * *first* answer's: answering again over an answer keeps the original state,
 * because that is where Leave has to return the note to.
 */
/** A note the run put in the trash, and the status it had before (bughunt 2026-10-15). */
export interface Binned {
  id: string;
  status: Note["status"];
}

interface Entry {
  verdict: Verdict;
  id: string;
  before: Partial<Note>;
}

/**
 * Whether an answer still holds on the note as it is now. An answer the undo
 * mark has since reversed, or one that changed nothing (archiving a note on
 * the Archive board), does not — the note is where it was, which is a left
 * note whatever was pressed. Read off the live note, so the summary and Put
 * back can only ever report what is true.
 */
/** What `note` holds in the fields `patch` is about to write. */
function heldBefore(note: Note, patch: Partial<Note>): Partial<Note> {
  const out: Partial<Note> = {};
  for (const field of Object.keys(patch) as (keyof Note)[]) {
    (out as Record<string, unknown>)[field] = note[field] ?? null;
  }
  return out;
}

/** The earlier answer, said in the head of the face. */
function verdictWords(entry: Entry, live: Note, boards: UserBoard[]): string {
  const what =
    entry.verdict === "archived"
      ? "Archived"
      : entry.verdict === "binned"
        ? "Deleted"
        : entry.verdict === "reminded"
          ? "Reminder set"
          : live.board_id
            ? `Moved to ${boards.find((b) => b.id === live.board_id)?.name ?? "a board"}`
            : live.note_type === "link"
              ? "Moved to Links"
              : "Moved to Inbox";
  return `${what} · Leave puts it back`;
}

function stands(entry: Entry, live: Note | undefined): boolean {
  if (entry.verdict === "left" || !live) return false;
  return (Object.keys(entry.before) as (keyof Note)[]).some(
    (field) => (live[field] ?? null) !== (entry.before[field] ?? null),
  );
}

/**
 * How many places the foot draws directly, before it falls back to a Move row.
 *
 * A phone draws two to a row, five rows of them, so ten — the owner's own pick
 * of a Tidy up whose folders fill the lower half (2026-10-24, layout A; it was
 * two rows, review 2026-10-01, PL-02). A wide window lists them down a column
 * of their own beside the note (`directWide`). A shelf that fits is drawn as
 * buttons; only one that does not goes behind the row — except on a phone,
 * which keeps its busiest ten as buttons (`splitPlaces`, review 2026-10-13,
 * UX-02).
 */
const DIRECT_PHONE = 10;
const DIRECT_WIDE = 6;

/** Whether `places` destinations (the Inbox row and the folders) fit in two
 *  rows, so each is one tap with nothing opened first. */
export function fitsBeneath(places: number, phone: boolean, height?: number): boolean {
  if (phone) return places <= DIRECT_PHONE;
  return places <= (height ? directWide(height) : DIRECT_WIDE);
}

/**
 * How many places a wide window draws directly: as many rows of three as half
 * the window's height holds, less the three rows that are always there (New
 * board, Archive with Delete, and Links) — never fewer than the old six.
 * A desktop with eight boards used to get one Move row and 600px of nothing
 * above it (review 2026-10-04, UX-A-02). The phone's bound stays four.
 */
export function directWide(height: number): number {
  const rows = Math.floor((height * 0.5) / 45) - 3;
  return Math.max(DIRECT_WIDE, rows * 3);
}

/** A place a note can be sent that is not Archive or Delete: the Inbox, or one
 *  of the user's folders. Numbered from one, in the order it is drawn. */
export type Place = { kind: "inbox" } | { kind: "folder"; board: UserBoard };

/**
 * A phone with more places than `fitsBeneath` allows (review 2026-10-13,
 * UX-02): the `limit` that hold most notes are buttons, in shelf order, and the
 * rest wait behind the Move row. The Inbox row of a folder's pile keeps its
 * seat first. **Inspiration is drawn besides and never counted**, so it does not
 * push a folder out. Ties go to the folder earlier on the shelf. Within the
 * limit nothing is split and the shelf is drawn as it stands.
 */
export function splitPlaces(
  run: Place[],
  counts: ReadonlyMap<string, number>,
  limit: number,
): { drawn: Place[]; rest: Place[] } {
  const isInspiration = (p: Place) => p.kind === "folder" && p.board.kind === "inspiration";
  const counted = run.filter((p) => !isInspiration(p));
  if (counted.length <= limit) return { drawn: run, rest: [] };
  const used = (p: Place) => (p.kind === "inbox" ? Infinity : (counts.get(p.board.id) ?? 0));
  const keep = new Set(
    counted
      .map((p, i) => ({ p, i }))
      .sort((a, b) => used(b.p) - used(a.p) || a.i - b.i)
      .slice(0, limit)
      .map(({ p }) => p),
  );
  return {
    drawn: run.filter((p) => keep.has(p) || isInspiration(p)),
    rest: run.filter((p) => !keep.has(p) && !isInspiration(p)),
  };
}

/** Past this many notes the pile is drawn as one line filling, not a cell each. */
const PROGRESS_CELLS = 40;

/** How long a tap after an answer is ignored, so a double tap answers one note. */
const HOLD_MS = 250;

interface Props {
  /** The pile, snapshotted when the mode opened, in the board's own order.
   *  A note filed away stays in it, so the count and "3 of 12" hold still. */
  pile: Note[];
  /** The board being tidied, for the layer's own name. The mode is no longer
   *  the Inbox's alone — any board with notes on it offers this. */
  where: string;
  /** The user's folders, in shelf order — which is the order they are drawn
   *  in, and it does not move while the mode is running. See `file`. */
  boards: UserBoard[];
  /**
   * The folder being tidied, when it is one. It is left out of the
   * destinations — a note cannot be sent where it already is — and its
   * presence is what puts **Inbox** among them: from inside a folder the pile
   * has no way back out otherwise (review 2026-10-01, UX-19). Left out on the
   * Inbox, Archive, All and the other lenses, where the destinations are the
   * folders alone as they always were.
   */
  hereId?: string;
  /** How many notes are filed in a board, as the Move panel shows it. */
  countFor: (id: string) => number;
  /** `null` is the Inbox, chosen. */
  onFile: (note: Note, boardId: string | null) => void;
  /** Onto the Links board by hand (`keptOnLinks`) — offered for a note that
   *  carries an address, beside the folders. */
  onLinks: (note: Note) => void;
  onArchive: (note: Note) => void;
  /** To the trash, never destroyed — the same write every other delete in the
   *  app makes, so it is restorable for TRASH_DAYS and undoable meanwhile. */
  onDelete: (note: Note) => void;
  /**
   * Puts a note back to what it held before this run answered it — the
   * fields in `before`, those that still differ. Leave calls it on a note
   * already answered (Back, then Leave), and filing calls it first for a note
   * an earlier answer archived or binned, so the note does not end up filed
   * *and* still in the trash.
   */
  onUnsort: (note: Note, before: Partial<Note>) => void;
  /**
   * Turns the priority mark on or off on the note being shown, and leaves it
   * showing. A mark is not a destination: it says something *about* a note
   * rather than moving it, so it must not spend the one decision this screen
   * is asking for. Important-then-file is two taps and stays on one card.
   */
  onPriority: (note: Note) => void;
  /**
   * Marks the note being shown as a to-do, or takes the mark off, and leaves
   * it showing — the priority mark's twin, for the same reason: it says
   * something *about* a note rather than moving it. Filing into Todos is not
   * a destination here, so the Sorter has no other way to say it.
   */
  onTodo: (note: Note) => void;
  /**
   * Sets the reminder on the note being shown, to the instant `at`, and asks
   * this device to ring (the open note's own write, `handleSetReminder`).
   * "Remind me later" is an answer: the note stays in the Inbox — no new
   * filter — and the pile moves on (review 2026-10-04, FX-B-01).
   */
  onRemind: (note: Note, at: string) => void;
  /** Puts a whole run's worth of binned notes back at once, from the summary.
   *  The ordinary eight-second strip is still there per note; this is the one
   *  that is still reachable after the twentieth card. */
  onRestore: (binned: Binned[]) => void;
  /** Makes a folder and returns it, so the note can go straight into it. */
  onCreateBoard: (name: string) => UserBoard;
  onClose: () => void;
  /**
   * Filled with the phone's Back: it steps out of what is open inside the mode,
   * then shows the run so far, and answers true while the mode is still up.
   * False means there is nothing to step out of, and the caller closes it.
   */
  backRef?: { current: (() => boolean) | null };
  /**
   * The note's words, rewritten by hand: the open note's own `body` write
   * (`editBody`, so the screen at once and the device at the pause, undo and
   * the outbox as ever). Called as the text is typed and once more, tidied, as
   * the field is left. Only ever `body` — `raw_content` is not a field this
   * screen can reach (review 2026-10-04, FX-B-03).
   */
  onEditBody?: (note: Note, body: string) => void;
  /**
   * Opens the note being shown as the whole open note, over this screen
   * (2026-10-23, owner: "I wanted to fix a note and move on but it was not
   * possible"). The pile keeps its place underneath: the open note is a layer
   * above the mode (`LAYERS`), so Back closes it first and the same card is
   * there after. `from` is the card it grows out of.
   */
  onOpen?: (note: Note, from: DOMRect | null) => void;
  /** The open note stands over the mode: when it goes, the focus comes back here. */
  covered?: boolean;
  /**
   * Told once, as the mode closes, which notes this run left where they were
   * (the right swipe, Leave, and any answer since undone). The board keeps the
   * list for the session only and sends those notes to the back of the next
   * run, so a pile worked through in short sessions is not the same few notes
   * every time (review 2026-10-04, FX-B-02). Nothing is stored.
   */
  onLeft?: (ids: string[]) => void;
  nameMax: number;
  /** The rect of the line this was entered from — the shape it grows out of. */
  origin: DOMRect | null;
  /** Where the focus goes when it shuts. */
  restoreTo: React.RefObject<HTMLButtonElement | null>;
  /**
   * The header's creature, visiting the head band at its left end, with what it
   * says: this run's undo offers, in its speech bubble as on the board
   * (`ModeCreature`; review 2026-10-24, UX-02). The capture bar is not drawn
   * here, so the creature is where an offer is said.
   */
  creature?: ReactNode;
}

/**
 * The Sorter: one note at a time, and the folders under your thumb.
 *
 * A tool for emptying the pile, not a way of reading. The Inbox can be worked
 * through from the board itself — open a note, Move it, come back — but that is
 * three gestures and a return trip per note, which is why 237 of them never got
 * filed in the first place. Here a note is one tap from being somewhere.
 *
 * **Gestures inside this mode, and only inside it.** A mode may respend the
 * gesture budget (SPEC §6) within its own screen: on the board a horizontal
 * swipe pages boards, and here it answers the card. Nothing about board paging,
 * card long-press or card swipe changes anywhere else.
 *
 * **Swipe right leaves, swipe left bins, and that is the whole of it.** This
 * file used to say swipe-to-decide was refused outright, and the reason it
 * gave was sound but narrower than the rule it was used to justify: *with more
 * than two destinations a swipe cannot say which one it means*. Leave and bin
 * are two, they are opposite, and a hand that means one can hardly produce the
 * other. Every destination past those two — a folder, the Archive, a new
 * folder — is still a button, because there the old reasoning still holds
 * exactly. What a swipe may never do here is **file**.
 *
 * The bin is the cheap half of that trade on purpose: a left swipe writes
 * `status: "trashed"`, which is a month in the trash and an undo offer on the
 * way, not a destruction. A right swipe writes nothing at all.
 *
 * Because the gesture is spent, stepping *back* is a button (`IconStepBack` in
 * the head band) rather than a swipe the other way. It has to exist: a decision
 * you can make by flinging your thumb is a decision you can make by accident.
 *
 * The capture bar is hidden while this runs (see `App.tsx`) — you are dealing
 * with what is already here, not adding to it, and the destinations need that
 * space more. It comes back the moment the mode closes.
 *
 * Nothing here is a session. Leaving mid-pile costs nothing and whatever is
 * left stays where it was; leaving a note leaves it exactly as it is, so it
 * comes round again next time. There is no skipped-forever state to invent.
 * Reaching the *end* of the pile is the one thing that is worth a word, and it
 * gets one: see `ended` below.
 */
export function Sorter({
  pile,
  where,
  boards,
  hereId,
  countFor,
  onFile,
  onLinks,
  onArchive,
  onDelete,
  onUnsort,
  onPriority,
  onTodo,
  onRemind,
  onRestore,
  onCreateBoard,
  onClose,
  backRef,
  onEditBody,
  onOpen,
  covered = false,
  onLeft,
  nameMax,
  origin,
  restoreTo,
  creature,
}: Props) {
  const [creating, setCreating] = useState(false);
  /** How many notes each folder held when the mode opened. Read once, so the
   *  buttons a phone draws (`splitPlaces`) never move under the thumb. */
  const [counts] = useState(() => new Map(boards.map((b) => [b.id, countFor(b.id)])));
  /** When the last answer was given: the next quarter second answers nothing. */
  const answeredAt = useRef(0);
  /**
   * The pile position whose board list is open, or null. Only a shelf too big
   * for the foot has one (`fitsBeneath`): with a dozen folders drawn directly
   * they took the bottom half of the phone and left the note a strip to be
   * read through (the owner's ask, 2026-09-26), so those go behind a Move row.
   * A shelf that fits is drawn as buttons and never reaches here (PL-02).
   * Kept as a *position* rather than a flag so the list closes by itself the
   * moment the pile moves on — filing, leaving, binning, Back — with no effect
   * and no reset beside each verb.
   */
  const [choosingAt, setChoosingAt] = useState<number | null>(null);
  const [name, setName] = useState("");
  /** The pile position whose four reminder presets are open — a position, like
   *  `choosingAt`, so any answer that moves the pile on closes them. */
  const [remindingAt, setRemindingAt] = useState<number | null>(null);
  /**
   * What was decided, **by position in the pile** rather than in the order the
   * taps happened. Back-then-answer-again overwrites the slot, so the summary
   * cannot be talked into counting one note twice by a reader who changed
   * their mind — which is the whole reason Back exists.
   */
  const [log, setLog] = useState<Array<Entry | undefined>>([]);
  /** Notes whose priority mark this run turned **on**, for the summary's sake.
   *  Toggling it off again takes the id back out: the line is a report of what
   *  changed, not of what was touched. */
  const [marked, setMarked] = useState<string[]>([]);
  /** The same report for the to-do mark, kept by what the tap *did*: a note
   *  that arrived as a to-do and was switched off is not one this run made. */
  const [todoed, setTodoed] = useState<string[]>([]);
  /** Past the last card. The mode stays up and says what the run came to,
   *  rather than vanishing and leaving you to work it out from the board. */
  const [ended, setEnded] = useState(false);
  /** The way out was taken before the last card: the report says how far it got. */
  const [stopped, setStopped] = useState(false);
  /** The summary's bulk undo, once spent. */
  const [restored, setRestored] = useState(false);
  /**
   * The note whose words are open for editing, or null. A tap on the text opens
   * the field in its place (review 2026-10-04, FX-B-03). Held by id so the field
   * cannot outlive its note; `session` is what the commit needs and is read
   * from event handlers, a render later than the state.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const session = useRef<{ id: string; note: Note; base: string; last: string; caret: number | null } | null>(null);
  const {
    at,
    layerRef,
    faceRef,
    close,
    advance,
    step,
    trapTab,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  } = useModeLayer({
    count: pile.length,
    origin,
    onClose,
    restoreTo,
    // The two-answer swipe. Left is the bin, right is leave — the way round
    // every card-at-a-time screen has meant them for a decade, and the way
    // round a hand already expects. The card follows the finger and shows the
    // word for each (`useModeLayer`, review 2026-10-01, UX-08).
    // A swipe is thrown before it answers, so it is never held (`holding`): a
    // held answer would fly the card off and put it back with nothing done.
    onSwipe: (way) => {
      if (way === "left") {
        answeredAt.current = 0;
        remove();
      } else leave();
    },
    onEnd: () => setEnded(true),
  });

  /** Read at unmount, when the closed-over state would be a render old. */
  const leftNow = useRef<string[]>([]);
  /** A run seen through to the end, and what it came to: the creature hops and says it on the way out. */
  const endedWith = useRef<Tally | null>(null);
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;
  useEffect(
    () => () => {
      onLeftRef.current?.(leftNow.current);
      // The pile may have emptied the board underneath; this is when it shows.
      leftByHand("mode");
      if (endedWith.current) tidiedUp(endedWith.current);
    },
    [],
  );

  // The open note closed: the mode takes the focus back, on the same card.
  const wasCovered = useRef(covered);
  useEffect(() => {
    if (wasCovered.current && !covered) layerRef.current?.focus({ preventScroll: true });
    wasCovered.current = covered;
  }, [covered, layerRef]);

  const phone = useIsPhone();
  const keyboard = useHasKeyboard();
  /** **At the summary there is no note.** `at` rests on the last card when the
   *  pile ends, so a swipe or an arrow on the summary used to act on that
   *  card again — a left swipe binned it a second time, and a right one
   *  `leave`d it, which undoes whatever it was answered with. */
  const note = ended ? null : (pile[at] ?? null);
  const editing = note !== null && editingId === note.id;
  /** Where a note can be sent besides Archive and Delete, in the order drawn:
   *  the Inbox first when this is a folder's pile, then the folders in the
   *  shelf's own order, the folder being tidied left out. */
  const run: Place[] = [
    ...(hereId !== undefined ? [{ kind: "inbox" } as const] : []),
    ...boards
      .filter((b) => b.id !== hereId)
      .map((board) => ({ kind: "folder", board }) as const),
  ];
  const fits = fitsBeneath(run.length, phone, window.innerHeight);
  /** What the foot draws as buttons, and what waits behind the Move row. A
   *  phone that does not fit keeps its busiest folders; a wide window keeps
   *  none, as ever. */
  const { drawn, rest } = fits
    ? { drawn: run, rest: [] }
    : phone
      ? splitPlaces(run, counts, DIRECT_PHONE)
      : { drawn: [], rest: run };
  /** The order the number keys count in: the buttons, then the rest. */
  const ordered = [...drawn, ...rest];
  /** Everything is behind the Move row, as on a wide window with a big shelf. */
  const folded = drawn.length === 0 && rest.length > 0;
  // Not at the report: `at` rests on the last card, and a list left open on it
  // is not on screen, so it must not be what a press of Escape or Back closes.
  const choosing = choosingAt === at && !ended;
  const reminding = remindingAt === at && !ended;
  /** The answer this position already has and that still holds, if any. */
  const earlier = log[at];
  const decided = earlier && note && stands(earlier, note) ? earlier : null;

  // A note trashed out from under the pile — by an undo that was not this
  // run's, or from the other device — is not shown as if it were still here
  // (review 2026-10-04, UX-B-01). The run's own deletes stay: Back reaches
  // them, and the log says it was this run that binned them.
  useEffect(() => {
    if (note && note.status === "trashed" && earlier?.verdict !== "binned") advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the note only.
  }, [note?.id, note?.status]);

  function closeChoosing() {
    setChoosingAt(null);
    setCreating(false);
    setName("");
  }

  /** What the run came to, counted off the log rather than tallied as it goes
   *  — one source, so a corrected answer corrects the summary too. */
  const tally = useMemo(() => {
    const byId = new Map(pile.map((n) => [n.id, n]));
    const out = { left: 0, moved: 0, archived: 0, binned: 0, reminded: 0 };
    for (const entry of log) {
      if (!entry) continue;
      // An answer that no longer holds is a note left where it was.
      out[stands(entry, byId.get(entry.id)) ? entry.verdict : "left"] += 1;
    }
    return out;
  }, [log, pile]);
  // Only a pile seen through to its last card is celebrated: stopping early
  // shows the report so far and leaves quietly.
  endedWith.current = ended && !stopped ? tally : null;

  /** The way out. With answers given and cards left, it first shows the report so
   *  far (one more press leaves), so stopping early is as honest as finishing.
   *  The ✕, Escape and the phone's Back all come here. */
  const answered = Object.values(tally).reduce((a, b) => a + b, 0);
  const partway = !ended && answered + marked.length + todoed.length > 0;
  function showSoFar() {
    setStopped(true);
    setEnded(true);
  }
  function stop() {
    if (partway) showSoFar();
    else close();
  }
  /** One step toward the way out, the same for Escape and Back: the field being
   *  typed in first, then an open reminder list or board list, then the report so
   *  far. False when none of those is there, and the mode is simply left. */
  function stepOut(): boolean {
    if (editing) finishEditing(true);
    else if (reminding) setRemindingAt(null);
    else if (choosing) closeChoosing();
    else if (partway) showSoFar();
    else return false;
    return true;
  }
  const stepOutRef = useRef(stepOut);
  stepOutRef.current = stepOut;
  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => stepOutRef.current();
    return () => {
      backRef.current = null;
    };
  }, [backRef]);

  leftNow.current = useMemo(() => {
    const byId = new Map(pile.map((n) => [n.id, n]));
    return log
      .filter((e): e is Entry => Boolean(e))
      .filter((e) => !stands(e, byId.get(e.id)))
      .map((e) => e.id);
  }, [log, pile]);

  /** Only the notes that really are in the trash now — a binned note taken
   *  back out (Back, then Leave or a folder) is not one to put back. */
  const binned = useMemo((): Binned[] => {
    const byId = new Map(pile.map((n) => [n.id, n]));
    return log
      .filter((e): e is Entry => e?.verdict === "binned" && stands(e, byId.get(e.id)))
      // Back where each came from: binned from the Archive, back to the Archive.
      .map((e) => ({ id: e.id, status: e.before.status ?? "active" }));
  }, [log, pile]);

  /**
   * On to the next note, with the focus back on the layer — as on open, so the
   * next Enter lands on nothing. An answer given from a focused button used to
   * leave the focus on it as the pile moved on, and Enter on a focused Delete
   * then binned note after note, at key-repeat speed if held (review
   * 2026-10-04, UX-B-06). Every answer that moves the pile on comes through
   * here.
   */
  function next() {
    advance();
    layerRef.current?.focus({ preventScroll: true });
  }

  /**
   * True for a quarter second after an answer (review 2026-10-13, QA-02). The
   * next note is drawn at once under the same button, so a quick double tap
   * used to bin or file a note nobody had read. Leave is not held: it writes
   * nothing, and Back undoes it.
   */
  function holding(): boolean {
    const now = Date.now();
    if (now - answeredAt.current < HOLD_MS) return true;
    answeredAt.current = now;
    return false;
  }

  /**
   * Writes this position's answer. Every verb calls it before advancing.
   * `before` is what this answer is about to overwrite; an answer already
   * standing here keeps its own, older `before`, so the note's original state
   * is what is remembered however many times the mind is changed.
   */
  function record(verdict: Verdict, id: string, before: Partial<Note> = {}) {
    setLog((prev) => {
      const next = prev.slice();
      const was = prev[at];
      next[at] = {
        verdict,
        id,
        before:
          verdict === "left" ? {} : { ...before, ...(was && was.id === id ? was.before : {}) },
      };
      return next;
    });
  }

  /**
   * Before filing a note an earlier answer archived or binned, bring it out
   * of the Archive or the trash — filing says where the note *lives*, and a
   * note filed into a folder while still in the bin is neither, and drops out
   * of Put back besides.
   */
  function unbin(n: Note) {
    const prior = log[at];
    if (prior && prior.id === n.id && prior.before.status && prior.before.status !== n.status) {
      onUnsort(n, { status: prior.before.status });
    }
  }

  /**
   * **The destinations do not move while the mode is running.** They are the
   * shelf's own order, start to finish.
   *
   * They used to be most-recently-used, on the reasoning that the folder you
   * just filed into is the folder the next note wants too — and that reasoning
   * was right about the *want* and wrong about the *row*, because the way it
   * was granted was to move the chosen folder to the head in the same commit
   * that brought up the next note. Every row above it shifted down one under a
   * finger that was still on the glass, so filing two notes into one folder —
   * the very case the ordering existed for — meant the second tap landing on a
   * different folder, and a note the reader had not yet read going into it. The
   * bin is in that list.
   *
   * Holding the order for the length of one note only delays that by a frame;
   * the rows still move, and the same second tap still misses. So the re-sort
   * is gone rather than deferred. What is left is better than what it replaced
   * anyway: a folder sits where it sits on the shelf, in the place the reader
   * already knows it from, and filing the same folder twice is the same tap
   * twice.
   */
  function file(boardId: string | null) {
    if (!note || holding()) return;
    record("moved", note.id, heldBefore(note, filePatch(note, boardId)));
    unbin(note);
    onFile(note, boardId);
    next();
  }

  /** One of the places in `run`. */
  function fileTo(place: Place) {
    file(place.kind === "inbox" ? null : place.board.id);
  }

  /** `file`, said about Links. Counted as a move: it is one. */
  function fileLinks() {
    if (!note || holding()) return;
    record("moved", note.id, heldBefore(note, linksPatch()));
    unbin(note);
    onLinks(note);
    next();
  }

  function archive() {
    if (!note || holding()) return;
    record("archived", note.id, { status: note.status });
    onArchive(note);
    next();
  }

  /**
   * Yes, this one is fine — on to the next, having written nothing.
   *
   * This was called **Skip**, then **Keep**, and is **Leave** since
   * 2026-10-05 (review CD-07): in an app that replaces Google Keep, "Keep"
   * meant the other app, and here it meant "do nothing", so it said neither.
   * Leave says what happens — the note stays where it is — and there is no
   * skipped-forever state, so a note left alone comes round next time. The
   * right-hand swipe means it too, and a gesture and a button that do one
   * thing say one word, which is also the word the summary counts under.
   */
  function leave() {
    if (!note) return;
    // Back, then Leave: the mind was changed, so the earlier answer is undone
    // rather than merely recounted. It used to write nothing here, and the
    // note stayed archived or in the trash under a summary that called it
    // kept (review 2026-10-01, UX-03).
    if (decided) onUnsort(note, decided.before);
    record("left", note.id);
    next();
  }

  /** The note behind this one, for a hand that went too fast. Stops at the
   *  start rather than wrapping: the pile has an end at each side. */
  function back() {
    if (ended) return;
    step(-1);
  }

  /**
   * Important, or not important — and the card stays exactly where it is.
   *
   * The only control on this screen that does not advance, which is the whole
   * reason it is in the head band and not among the destinations at the foot.
   * Down there every row is a **place**, and a row that was not one is how a
   * thumb aiming for it lands in the bin instead (the 2026-09-04 audit, F13,
   * which is why Leave is up here too).
   */
  function mark() {
    if (!note) return;
    const id = note.id;
    onPriority(note);
    setMarked((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  /**
   * Remind me later: sets the reminder from one of the open note's four
   * presets and moves on. The note is not filed anywhere — it stays in the
   * Inbox and comes round again — so what is remembered is only the reminder it
   * held before, which Back-then-Leave puts back. Like filing, it brings a
   * note an earlier answer archived or binned back out first (`unbin`): a
   * reminder on a note in the trash would ring for nothing.
   */
  function remind(key: ReminderPreset) {
    if (!note || holding()) return;
    record("reminded", note.id, heldBefore(note, { reminder_at: note.reminder_at }));
    unbin(note);
    onRemind(note, presetReminder(key));
    next();
  }

  /** The whole open note, over this screen; an edit in place is ended first. */
  function openWhole() {
    if (!note || !onOpen) return;
    if (editing) finishEditing(false);
    onOpen(note, faceRef.current?.getBoundingClientRect() ?? null);
  }

  /** To-do, or not — and, like Important, the card stays where it is. */
  function markTodo() {
    if (!note) return;
    const id = note.id;
    const turningOn = !isTodoNote(note);
    onTodo(note);
    setTodoed((prev) =>
      turningOn ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((m) => m !== id),
    );
  }

  /**
   * Away, not gone — and the pile moves on, exactly as filing and archiving do.
   *
   * Throwing a note out is the commonest honest answer when you are clearing a
   * pile you imported rather than wrote, and until this row existed the Sorter
   * had no word for it: a folder you did not mean, the Archive (which keeps a
   * note whole and searchable, a different sentence entirely), or leaving the
   * mode to do it on the board — three gestures and a return trip, which is the
   * cost this whole screen exists to remove.
   *
   * **There is no confirmation here, deliberately.** The trash *is* the
   * confirmation: this is the same `status: "trashed"` write every other delete
   * in the app makes, restorable for TRASH_DAYS, and offered straight back by
   * the undo strip a note at a time. A dialog per note would make clearing the
   * pile slower than not using the Sorter at all, which would be a mode that
   * punishes you for entering it.
   */
  function remove() {
    if (!note || holding()) return;
    record("binned", note.id, { status: note.status });
    onDelete(note);
    next();
  }

  /**
   * Enter, and Enter only — the name is committed by asking for it, never by
   * walking away from it.
   *
   * This ran on **blur** as well, and blur fires before the click that took
   * the focus away: tap "New folder…", type `Recipe`, then tap the folder you
   * meant all along, and a folder called Recipe was created, this note was
   * filed into it and the pile moved on — all before the tap you actually made
   * had been dispatched. Three writes from a gesture that said "not this".
   *
   * So blur is `cancel` now (see the field). The cost is a typed name thrown
   * away by a tap outside, which is what Escape already does here and is the
   * cheap half: the name is four seconds of typing, and the other way round
   * costs a folder, a filing and the note you were about to read.
   */
  function submitName(typed: string) {
    const made = onCreateBoard(typed.trim());
    setCreating(false);
    setName("");
    if (made) file(made.id);
  }

  function cancelName() {
    setCreating(false);
    setName("");
  }

  /**
   * A tap on the words: the field opens over them, the caret where the finger
   * landed. The reader's text is the note character for character (`readAs`),
   * so a tap measured there is the field's offset too — except for a note with
   * links, whose words are drawn without the addresses: the field holds the
   * whole body, and the caret goes to the end.
   */
  function startEditing(e: React.MouseEvent<HTMLElement>) {
    if (!note || !onEditBody || editing) return;
    // A link inside the words is the link's own tap, as it is anywhere.
    if ((e.target as HTMLElement).closest("a")) return;
    const whole = shown.links.length === 0;
    const at = whole ? offsetAtPoint(e.currentTarget, e.clientX, e.clientY) : null;
    openField(at === null ? null : fieldOffset(note.body, at));
  }

  /** Opens the field over the words; a null caret goes to the end. The tap and
   *  the Enter key both come here, so they make the same edit. */
  function openField(caret: number | null) {
    if (!note || !onEditBody || editing) return;
    session.current = {
      id: note.id,
      note,
      base: note.body,
      last: note.body,
      caret,
    };
    setDraft(note.body);
    setEditingId(note.id);
  }

  /** Leaving the field — blur or Escape — commits. One call however many ways
   *  it is reached, because Escape unmounts a field that then blurs. */
  function finishEditing(refocus: boolean) {
    const s = session.current;
    if (!s) return;
    session.current = null;
    setEditingId(null);
    // The open note's own tidy, once, on a real change: a numbered list
    // counted straight again. Never on a keystroke (lib/reorder.ts).
    if (s.last !== s.base) {
      const tidied = renumberLists(s.last);
      if (tidied !== s.last) onEditBody?.(s.note, tidied);
    }
    if (refocus) layerRef.current?.focus({ preventScroll: true });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // This layer says `aria-modal`, and the page behind it is `inert` — except
    // the header, which holds the mascot and its `tabindex="0"`. So Tab off
    // the last control walked out of the mode onto a creature a screen reader
    // has been told is not there. Kept inside, the way every other layer in
    // the app keeps it.
    if (e.key === "Tab") {
      trapTab(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // One layer at a time: the field being typed in is the top thing, then an
      // open reminder list or board list. Escape ends the edit, not the mode.
      if (!stepOut()) close();
      return;
    }
    if (isTypingTarget(e.target)) return;
    // With the presets open the keys belong to them, not to the note behind.
    if (reminding) return;
    const bare = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    // The keyboard says the same two things the thumb does — right leaves, and
    // the way back is the way back. **Binning has no key**, deliberately: a
    // swipe is a deliberate movement of the whole hand and a keystroke is not,
    // and there is no undoing the twentieth press of a key you were holding.
    // The bin is a button here, as it is for every other destination.
    //
    // **Archive has one: E**, the board's own archive key (`ARCHIVE_KEY`), with
    // A kept as the older spelling (review 2026-10-04, FX-B-05; E since audit
    // 2026-10-10, UX-9). It destroys nothing — the note stays whole and
    // searchable — and is offered back a note at a time. A key that writes
    // answers once per press: a held key's repeats answer nothing, here and on
    // the numbers.
    const letter = e.key.toLowerCase();
    if (e.key === "Enter" && bare) {
      // Enter changes the note's words, the key's way to the tap on them — but
      // only when nothing that uses Enter itself has the focus: a button, a
      // link or a menu row presses, as it always does.
      const own = (e.target as HTMLElement).closest("button, a, select, summary, [role='menuitem']");
      if (!own && !e.repeat && !editing && !choosing && onEditBody && note) {
        e.preventDefault();
        openField(null);
      }
    } else if (bare && (letter === ARCHIVE_KEY || letter === "a")) {
      e.preventDefault();
      if (!e.repeat) archive();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      leave();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    } else if (/^[1-9]$/.test(e.key) && bare) {
      // A number picks the place in that position, the Inbox and the folders
      // only — the same one tap, for a hand that is on the keys, and it works
      // while the list is folded behind Move too (review 2026-10-04, UX-A-02).
      // Delete has no number, for the reason the bin has no key; Archive has
      // its letter.
      const place = ordered[Number(e.key) - 1];
      if (place) {
        e.preventDefault();
        if (!e.repeat) fileTo(place);
      }
    }
  }

  const thumb = note?.attachments?.find((att) => att.thumb)?.thumb ?? null;

  /*
   * A note's addresses, named rather than printed. A saved link arrived here
   * as a line of raw URL — the least readable thing a note can hold, on the
   * one screen whose whole job is recognising a note fast enough to place it.
   * Each link is named the way the Links board names a row (`linkRows`), with
   * its site beside it, and the words are what the card itself draws beside
   * links (`wordsBesideLinks`). With one link, the sentence its name was
   * taken from comes off the words (`rowWords`), as on the Links board, so it
   * is not said twice. A note with no link is drawn exactly as before.
   */
  const shown = useMemo(() => {
    const body = note?.body ?? "";
    const locals = previewsFor(body);
    if (!note || locals.length === 0) return { links: [], words: body };
    const rows = linkRows(overlaySaved(locals, note.link_previews), locals);
    const words = rows.length === 1 ? rowWords(rows[0], body) : body;
    return { links: rows, words: wordsBesideLinks({ ...note, body: words }) };
  }, [note]);

  /** A place, as a row of the foot: the number that picks it, on a keyboard
   *  only, then its mark and its name. No count (review 2026-10-13, UI-04):
   *  beside the key it read as two numbers in one voice. */
  function placeRow(place: Place, i: number) {
    const hint = keyboard && i < 9 ? <KeyCaps label={String(i + 1)} /> : null;
    if (place.kind === "inbox") {
      return (
        <button key="inbox" type="button" className="sorter-dest" onClick={() => fileTo(place)}>
          {hint}
          <IconInbox tier="inline" />
          <span className="sorter-dest-name">Inbox</span>
        </button>
      );
    }
    const { board } = place;
    return (
      <button
        key={board.id}
        type="button"
        className="sorter-dest"
        style={tintOf(board)}
        onClick={() => fileTo(place)}
      >
        {hint}
        {/* A destination's own mark: whatever the folder chose, or the
            folder itself. The Sorter is the one screen that is a wall of
            destination rows, and it drew the same generic folder on every one
            of them while the shelf, the drawer and the open note all drew the
            mark the user picked — so the screen where recognising a folder
            before reading its name matters most was the screen where it could
            not be done. `DESIGN.md` §2b keeps a folder's *tint* to the shelf;
            it says nothing against its **mark**, which is the app reporting
            what a board is. Its tint is on the mark too since 2026-10-05
            (review GD-02), set on the row as `--board-tint` exactly as the
            Move list does. */}
        <FolderGlyph icon={board.icon} />
        <span className="sorter-dest-name">{board.name}</span>
      </button>
    );
  }

  /** Making a folder from here and filing straight into it: the field takes
   *  the button's place and Enter commits. */
  function newBoardRow(wide: boolean) {
    const own = wide ? "sorter-dest sorter-dest-wide" : "sorter-dest";
    return creating ? (
    <span className={own + " sorter-dest-new"}>
      <IconPlus tier="inline" />
      <NewBoardName
        value={name}
        max={nameMax}
        cancelIfEmpty
        onChange={setName}
        onCreate={submitName}
        onCancel={cancelName}
      />
    </span>
  ) : (
    <button
      type="button"
      className={own}
      onClick={() => {
        setName("");
        setCreating(true);
      }}
    >
      <IconPlus tier="inline" />
      <span className="sorter-dest-name">New board…</span>
    </button>
  );
  }

  /** A held Enter or Space on a focused foot row repeats; the first press
   *  answered, and the focus has gone back to the layer since (`next`), but a
   *  repeat still in flight must not answer the note after it. */
  const noRepeat = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
  };

  const archiveRow = (
    <button type="button" className="sorter-dest" onClick={archive} onKeyDown={noRepeat}>
      {keyboard && <KeyCaps label={ARCHIVE_KEY.toUpperCase()} />}
      <IconArchive tier="inline" />
      <span className="sorter-dest-name">Archive</span>
    </button>
  );

  // The bin at the same tier the other destination rows draw at — a
  // destination row is a row, whatever is at the end of it. No key, and no
  // hint of one.
  const deleteRow = (
    <button type="button" className="sorter-dest" onClick={remove} onKeyDown={noRepeat}>
      <IconDelete tier="inline" />
      <span className="sorter-dest-name">Delete</span>
    </button>
  );

  /** Back one note. On a phone a mark in the head band; on a wide window a
   *  word beside Leave, under the note, where the mouse already is. Disabled,
   *  not removed, at the start of the pile, so nothing beside it moves. */
  const backButton = (
    <button
      type="button"
      className={phone ? "sorter-done" : "sorter-done sorter-done-word"}
      aria-label="Back one note"
      title={phone ? "Back one note" : undefined}
      disabled={at === 0}
      onClick={back}
    >
      <IconStepBack />
      {!phone && <span className="sorter-word">Back</span>}
      {!phone && keyboard && <KeyCaps label="←" />}
    </button>
  );

  /** Leave: the note stays where it is and the next one comes. On a phone it
   *  is the first of the three answers on the floor, as far from Delete as the
   *  row allows; on a wide window it stands beside Back under the note. */
  const leaveButton = phone ? (
    <button type="button" className="sorter-dest sorter-leave" onClick={leave} onKeyDown={noRepeat}>
      <IconStepOn />
      <span className="sorter-dest-name">Leave</span>
    </button>
  ) : (
    <button type="button" className="sorter-skip mono" onClick={leave}>
      Leave
      {keyboard && <KeyCaps label="→" />}
    </button>
  );

  /** What can be said about the note without sending it anywhere: open it,
   *  flag it, make it a to-do, remind me. Under the note's words, each with
   *  its word, because they are about the note (layout A, 2026-10-24). */
  const tools = (
    <div className="sorter-tools">
      {/* Not an answer: the whole note, to fix and come back to this same
          card. The words' own tap still edits in place. */}
      {onOpen && (
        <button type="button" className="sorter-tool" aria-label="Open note" onClick={openWhole}>
          <IconOpenNote />
          <span className="sorter-word">Open</span>
        </button>
      )}
      {/* One name, on or off — `aria-pressed` carries which (review
          2026-10-04, CD-02). It leaves the card where it is. */}
      <button
        type="button"
        className="sorter-tool"
        aria-label="Important"
        aria-pressed={Boolean(note?.priority)}
        onClick={mark}
      >
        <IconPriority on={Boolean(note?.priority)} tier="inline" />
        <span className="sorter-word">Important</span>
      </button>
      {/* Drawn from `isTodoNote`, the one definition the shelf and the open
          note's mark read too. */}
      <button
        type="button"
        className="sorter-tool"
        aria-label="To-do"
        aria-pressed={note ? isTodoNote(note) : false}
        onClick={markTodo}
      >
        <IconTodo on={note ? isTodoNote(note) : false} />
        <span className="sorter-word">To-do</span>
      </button>
      {/* Remind me later: an answer that does not file — the four presets of
          the open note, then the next note. */}
      <button
        type="button"
        className="sorter-tool"
        aria-label="Remind me later"
        aria-haspopup="menu"
        aria-expanded={reminding}
        onClick={() => setRemindingAt(reminding ? null : at)}
      >
        <IconReminder on={Boolean(note?.reminder_at)} tier="inline" />
        <span className="sorter-word">Remind</span>
      </button>
    </div>
  );

  const count = (
    <span className="sorter-at mono">
      {ended ? "Done" : `${Math.min(at + 1, pile.length)} of ${pile.length}`}
    </span>
  );

  /** How far through the pile, drawn: a cell a note while they fit, else one
   *  line filling. A picture of the count beside it, so hidden from a reader. */
  const progress = !ended && pile.length > 1 && (
    <span className="sorter-progress" aria-hidden>
      {pile.length <= PROGRESS_CELLS ? (
        pile.map((_, i) => (
          <span
            key={i}
            className="sorter-progress-cell"
            data-at={i < at ? "done" : i === at ? "here" : undefined}
          />
        ))
      ) : (
        <span
          className="sorter-progress-fill"
          style={{ inlineSize: `${((at + 1) / pile.length) * 100}%` }}
        />
      )}
    </span>
  );

  return (
    <div
      ref={layerRef}
      // A wide window stands the note and the places side by side (layout A).
      className={phone ? "sorter" : "sorter sorter-side"}
      role="dialog"
      aria-modal="true"
      aria-label={`Tidy up ${where}`}
      // Focusable so the layer can hold the focus itself on open — see the
      // mount effect. Never in the tab order: Tab walks the controls inside.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // The swipe is the card's and a finger in the text field is selecting or
      // placing a caret, never answering (FX-B-03).
      onTouchStart={editing ? undefined : onTouchStart}
      onTouchMove={editing ? undefined : onTouchMove}
      onTouchEnd={editing ? undefined : onTouchEnd}
      onTouchCancel={editing ? undefined : onTouchCancel}
    >
      {/* Where you are, and the way out. The controls that are not a place
          a note can go are not with the places: on a wide window they stand
          under the note, on a phone the note's own four stand under it and
          Leave is the first of the three answers on the floor (layout A,
          2026-10-24; they were the head band's second row). */}
      <div className="sorter-head">
        {/* The creature stands here as it does in the header, its bubble beside
            it, and on a wide window the count at the far end of the same row. */}
        <div className="sorter-head-row">
          {creature}
          {!phone && count}
          {!phone && progress}
          {phone && !ended && backButton}
        </div>
        {/* A phone gives the creature's words the count's room: the count and
            the pile drawn stand on a row of their own under it. */}
        {phone && (
          <div className="sorter-pile-row">
            {count}
            {progress}
          </div>
        )}
        {/* The way out stands where every full-screen exit does, the header
            cog's spot (`.sorter-exit`, review 2026-10-24, UI-02). */}
        <button
          type="button"
          className="sorter-done sorter-exit"
          aria-label="Stop tidying up"
          title="Stop tidying up"
          onClick={stop}
        >
          <IconClear />
        </button>
      </div>

      {ended ? (
        /* What the run came to, and the one way back that outlives an
           eight-second strip. The mode does not simply vanish at the end of
           the pile any more: twenty cards in, nobody can say what they did to
           the first three, and "the board looks different now" is not an
           answer. Deliberately a report and not a celebration (DESIGN.md §1) —
           counted lines in the machine face, no total, no praise. */
        <div className="sorter-end" ref={faceRef}>
          <p className="sorter-end-head">
            {stopped
              ? `${answered} of ${pile.length} done`
              : // Every note left where it was is not a job finished: say what happened (review 2026-10-24, UX-12).
                tally.left === pile.length
                ? `Went through ${pile.length}. None filed.`
                : pile.length === 1
                ? "1 note done"
                : `All ${pile.length} done`}
          </p>
          <SorterTally
            lines={[
              ["Left", tally.left],
              ["Moved", tally.moved],
              ["Archived", tally.archived],
              ["Deleted", tally.binned],
              ["Reminded", tally.reminded],
              ["Important", marked.length],
              ["To-do", todoed.length],
            ]}
          />
        </div>
      ) : (
        <div className="sorter-body">
          <div className="sorter-main">
            {/* The note, as much of it as there is room for. This screen is for
                deciding where something goes; a tap on the words opens them for
                editing in place (review 2026-10-04, FX-B-03), and everything else
                about the note is one tap away on the board as it always was.

                The card is the thing the finger carries: the wrapper follows a
                swipe, and the two words are drawn in its corners for as long as it
                is held, coming up as it goes (`useModeLayer`, UX-08). They are
                decoration for the hand — the buttons say the same things — so
                they are hidden from a reader. */}
            <div className="sorter-card" ref={faceRef}>
              <span className="sorter-cue sorter-cue-keep" data-cue aria-hidden>
                Leave
              </span>
              <span className="sorter-cue sorter-cue-away" data-cue aria-hidden>
                Delete
              </span>
              <div className="sorter-note">
                {/* The open note's own reading column, centred, so a long line is not
                    1400px of text on a desktop (review 2026-10-01, UI-14). */}
                <div className="sorter-read">
                  {/* What this note was already answered with, while that answer
                      holds — Back is how a reader reaches it, and the screen has to
                      say what Leave will now undo. */}
                  {decided && <p className="sorter-was mono">{verdictWords(decided, note!, boards)}</p>}
                  {thumb && <img className="sorter-shot" src={thumb} alt="" />}
                  {!editing && shown.links.length > 0 && (
                    <ul className="sorter-links">
                      {shown.links.map((row, i) => (
                        <li key={`${i}-${row.link.href}`} className="sorter-link">
                          <span className="sorter-link-name">{row.name}</span>
                          {row.site && <span className="sorter-link-site mono">{row.site}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {editing ? (
                    <textarea
                      ref={(el) => {
                        const s = session.current;
                        if (el && s && s.caret !== -1) {
                          // Once, on arrival: focus, the caret where the tap was
                          // (the end when it could not be measured), the height.
                          const at = s.caret ?? el.value.length;
                          s.caret = -1;
                          el.focus({ preventScroll: true });
                          el.setSelectionRange(at, at);
                          fitTextarea(el);
                        }
                      }}
                      className="sorter-text sorter-edit"
                      // One row, not the textarea's default two: a one-line note
                      // stays one line when tapped (see the open note's editor).
                      rows={1}
                      aria-label="Note text"
                      value={fieldValue(draft)}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        setDraft(value);
                        fitTextarea(e.currentTarget);
                        const s = session.current;
                        if (!s) return;
                        s.last = value;
                        onEditBody?.(s.note, value);
                      }}
                      onBlur={() => finishEditing(false)}
                    />
                  ) : (
                    shown.words && (
                      <p
                        className="sorter-text"
                        data-editable={onEditBody ? "" : undefined}
                        onClick={startEditing}
                      >
                        {readAs(shown.words)}
                      </p>
                    )
                  )}
                </div>
              </div>
            </div>
            <PileEdge after={pile.length - at - 1} />
            {tools}
            {!phone && (
              <div className="sorter-nav">
                {backButton}
                {leaveButton}
              </div>
            )}
          </div>

          {/* The places. A shelf that fits (`fitsBeneath`) is drawn **as
              buttons**, so filing is one tap — the Inbox first when this is a
              folder's pile, the folders in the shelf's own order (see `file`
              for why they never move), then a new board; Archive and Delete
              stand apart at the end, Delete last, the one nobody should reach
              by accident. Links, which only some notes can go to, is a wide row
              at the top. A shelf too big goes behind one Move row and comes up
              in the same band only when asked for; the list scrolls rather than
              eating the note. On a wide window this is a column beside the
              note; on a phone a grid on the floor. */}
          {choosing ? (
            <div className="sorter-to sorter-to-boards" role="group" aria-label="Move to a board">
              <div className="sorter-to-list">
                <button
                  type="button"
                  className="sorter-dest sorter-dest-wide"
                  onClick={closeChoosing}
                >
                  <IconClear />
                  <span className="sorter-dest-name">Cancel</span>
                </button>
                {/* Links first, where the chooser elsewhere puts it: the one
                    place here that is not a folder of the user's. */}
                {folded && note && canKeepOnLinks(note) && (
                  <button type="button" className="sorter-dest" onClick={fileLinks}>
                    <IconLink tier="inline" />
                    <span className="sorter-dest-name">Links</span>
                  </button>
                )}
                {rest.map((place, i) => placeRow(place, drawn.length + i))}
                {newBoardRow(false)}
              </div>
            </div>
          ) : (
            <div className={folded ? "sorter-to" : "sorter-to sorter-to-direct"}>
              <div className="sorter-to-list">
                {!folded && note && canKeepOnLinks(note) && (
                  <button type="button" className="sorter-dest sorter-dest-wide" onClick={fileLinks}>
                    <IconLink tier="inline" />
                    <span className="sorter-dest-name">Links</span>
                  </button>
                )}
                {drawn.map(placeRow)}
                {rest.length === 0 ? (
                  newBoardRow(true)
                ) : (
                  <button
                    type="button"
                    className="sorter-dest sorter-dest-wide"
                    onClick={() => setChoosingAt(at)}
                  >
                    <IconFolder />
                    <span className="sorter-dest-name">Move to a board…</span>
                  </button>
                )}
              </div>
              <div className="sorter-to-end">
                {phone && leaveButton}
                {archiveRow}
                {deleteRow}
              </div>
            </div>
          )}
        </div>
      )}

      {/* The clock's four presets, the open note's own in its order, each saying
          when it will ring: bottom-right under the thumb, like the capture
          bar's. No custom time and no repeat here — the open note has them. */}
      {reminding && note && (
        <>
          <button
            type="button"
            className="menu-dismiss menu-dismiss-over"
            aria-label="Close reminder menu"
            onClick={() => setRemindingAt(null)}
          />
          <div className="selpanel selpanel-right selpanel-over" role="menu" aria-label="Reminder">
            {reminderPresets().map((preset) => (
              <Action
                key={preset.key}
                role="menuitem"
                keepFocus
                label={preset.label}
                suffix={
                  <>
                    {" "}
                    <span className="selpanel-n">{presetWhen(preset.key)}</span>
                  </>
                }
                onClick={() => remind(preset.key)}
              >
                <IconReminder tier="inline" />
              </Action>
            ))}
          </div>
        </>
      )}

      {ended && (
        <div className="sorter-to">
          {binned.length > 0 && !restored && (
            /* The whole run's deletes, at once. The ordinary strip is still
               offered per note and is still the first answer; this is the one
               that has not expired by the twentieth card. "Put back" is the
               app's word for leaving the trash, here as on the Trash board. */
            <button
              type="button"
              className="sorter-dest"
              onClick={() => {
                onRestore(binned);
                setRestored(true);
              }}
            >
              <IconRestore tier="inline" />
              <span className="sorter-dest-name">Put back {binned.length}</span>
            </button>
          )}
          <button type="button" className="sorter-dest" onClick={close}>
            <IconCheck />
            <span className="sorter-dest-name">Done</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The note's words as the open note reads them (DESIGN.md §8: "set exactly as
 * it is read anywhere else"). A `# ` line — the note's name, or a `## ` part —
 * is the open note's heading: the hashes a muted mark, the words at the
 * heading's stroke. Printed as prose, "# Start here" opened the pile on a raw
 * line of markup while its card said the same line as a name (review
 * 2026-10-01 follow-up). Every character is still drawn and nothing else is
 * read differently; fenced code only, never a guess, because there is no
 * editor here to correct one.
 */
function readAs(words: string): ReactNode {
  const blocks = parseBlocks(words, false);
  if (!blocks.some((block) => block.kind === "heading")) return words;
  return blocks.map((block, i) =>
    block.kind === "heading" ? (
      <Fragment key={i}>
        {block.lead}
        {block.prefix}
        <span className="sorter-heading">
          <span className="note-mark">{block.marker}</span>
          {block.words}
        </span>
        {block.tail}
      </Fragment>
    ) : (
      <Fragment key={i}>{block.text}</Fragment>
    ),
  );
}
