import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Note, UserBoard } from "../types";
import { Action } from "./shared/Action";
import { CaptureLine, type BarLine, type BusyLine } from "./CaptureLine";
import { setTwin } from "../lib/twinSaid";
import { savedWords } from "../lib/savedLinks";
import { filesSaid } from "../lib/files";
import { asChecklist, autoformat, continueList } from "../lib/autoformat";
import { fitTextarea } from "../lib/fitTextarea";
import { writeThrough } from "../lib/editText";
import { LAMP_STYLE, useLamp } from "../lib/useLamp";
import { CAPTURE_KEY, hasKeyboard } from "../lib/hotkeys";
import { writeHint } from "../lib/writeHint";
import { ENTER, OPEN_MS, animates } from "../lib/motion";
import { mascotTap } from "./mascot-element";
import { useIsPhone } from "../lib/breakpoint";
import { useVisibleHeight } from "../lib/visibleHeight";
import { BoardChooser } from "./BoardChooser";
import { FolderGlyph } from "./BoardLook";
import { Hotkey } from "./Hotkey";
import { readCaptureDraft, writeCaptureDraft } from "../store/db";
import { presetWhen, reminderPresets, type ReminderPreset } from "../lib/reminders";
import {
  IconAttachment,
  IconCheck,
  IconClear,
  IconInbox,
  IconInspiration,
  IconMenu,
  IconPencil,
  IconPlus,
  IconPriority,
  IconReminder,
  IconSave,
  IconTodo,
} from "./Icons";

/**
 * What the note about to be saved has been marked as, by hand, in the bar.
 *
 * Four optional things and nothing else — the same four the open note's
 * marks offer *after* a capture, offered once more *before* it. `board` has
 * three values because the Inbox is a real answer: `undefined` is *nothing
 * chosen, the board underneath decides* (a note written on a folder lands in
 * it, as it always has); `null` is *the Inbox, chosen*, which is the one way
 * to write a stray thought while standing in a folder without it being filed
 * there; a string is that folder. `reminder` is one of the open note's four
 * presets, kept as the preset rather than as an instant so that "in 1 hour"
 * means an hour from Save (review 2026-10-04, FX-B-06).
 */
export interface CaptureChoice {
  priority: boolean;
  todo: boolean;
  board: string | null | undefined;
  reminder: ReminderPreset | null;
}

export const NO_CHOICE: CaptureChoice = {
  priority: false,
  todo: false,
  board: undefined,
  reminder: null,
};

/**
 * Words handed to the field from outside the app — a page shared from the
 * phone, or the desktop's "Save to spår" bookmark. `taken` is called once they
 * are in the field *and* in the draft, so whoever parked them may let go.
 */
export interface IncomingWords {
  text: string;
  /** Set only for a share from the phone: where the one extra Save may file it. */
  boardOffer?: { id: string; name: string };
  taken: () => void;
}

interface Props {
  onCapture: (text: string, choice: CaptureChoice) => void;
  /**
   * Files become a note of their own, carrying whatever is in the field.
   * Resolves `true` only if a note was actually made, so the field is not
   * emptied on behalf of a capture that did not happen.
   */
  onCaptureFiles: (files: File[], text: string, choice: CaptureChoice) => Promise<boolean>;
  /** A sketch: a canvas born empty, opened with the pen already in hand. */
  onDraw: () => void;
  menuOpen: boolean;
  /**
   * The burger itself, for whoever needs to point at it. The two modes do:
   * since 2026-09-25 they are entered from a row *inside* the menu, and that
   * row is gone by the time they close, so `useRestoreFocus`'s remembered
   * element is no longer in the document and the focus would drop to the
   * body. The burger is the control the reader actually used to get there.
   */
  menuRef?: React.RefObject<HTMLButtonElement | null>;
  /**
   * How many notes are picked on the board. Above zero the burger is what
   * opens the selection's verbs rather than the menu, and it says so: it
   * inverts and carries the number, the one sign on the bar that anything is
   * selected at all. See `SelectionBar`.
   */
  selectedCount: number;
  onMenu: () => void;
  /** The user's own folders, in shelf order — what the board mark offers. */
  boards: UserBoard[];
  /** How many notes are in each, for the chooser's rows. */
  countFor?: (boardId: string) => number;
  /**
   * Whether the chooser offers its Inbox row. Only worth a row where it
   * changes something: standing on a folder, where a note would otherwise
   * be filed into it. Anywhere else the Inbox is already where the note
   * goes, and a row that does what nothing would have done is furniture.
   */
  offerInbox?: boolean;
  /**
   * The folder a note with nothing chosen will be filed into — the one being
   * stood on — or `null` where nothing chosen means the Inbox. The board mark
   * wears its glyph while nothing is chosen, outlined and unpressed, so where
   * the note is going is on the bar before Save rather than discovered after.
   */
  here?: string | null;
  /** Standing on Todos, where a capture is marked as a to-do — only the empty
   *  field's words read it (`writeHint`). */
  onTodos?: boolean;
  /** A name typed into the chooser that matched no board — makes it. */
  onCreateBoard: (name: string) => UserBoard;
  /**
   * Handed up so the capture shortcut can put the caret in this field. The bar
   * keeps its own `field` ref for everything it does itself; this one only ever
   * mirrors it, so there is still exactly one textarea and one owner of it.
   */
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
  /**
   * The Add panel, told to the app's layer stack. Handed a way to close the
   * panel while it is up and `null` once it is down — the same shape the
   * open note's `registerInner` takes — so that Escape and Back both close
   * it from wherever focus happens to be. Before this the panel answered
   * neither: its state lived here alone, the form's own key handler only knew
   * the board chooser, and Escape closed the top thing in nine places and
   * nothing in this one (2026-09-04 audit, F5).
   */
  registerLayer?: (close: (() => void) | null) => void;
  /**
   * The note that already holds these words, or an address in them, if one
   * does (`savedTwin` in `lib/savedLinks.ts`, over an index `App` keeps).
   * Asked on every change to the field; the index is built once per change
   * to the notes, never per keystroke.
   */
  findSaved?: (text: string) => Note | null;
  /**
   * The header's creature says "You saved this 3 days ago · Open" rather than
   * this bar's line (2026-10-16): the match is handed to it (`lib/twinSaid.ts`).
   * Off on a short screen, where the header folds away and the bar says it.
   */
  twinToCreature?: boolean;
  /** Opens the note `findSaved` found. */
  onOpenSaved?: (note: Note) => void;
  /**
   * A line the app has to say near the bar — the receipt for a capture that
   * landed off the screen. The bar's own line about its words wins over it
   * while there is one, because that one is about what is being written now.
   */
  line?: BarLine | BusyLine | null;
  /**
   * The undo offer, while one stands — on a short screen only, where the
   * header's creature has no band to say it in. It is a cell of the bar, after the
   * words and before the corner cells, so it covers nothing: it used to float
   * just above this corner, over the board's last card and over the menu's
   * and the + panel's bottom rows (review 2026-10-01, UX-02). The field gives
   * up the width for as long as it stands.
   */
  undo?: ReactNode;
  /**
   * Words from outside, waiting to be put in the field (review 2026-10-04,
   * FX-A-02, FX-A-03). Never saved by the bar on its own: they land unsaved,
   * under a blank first line holding the caret, and Save is the reader's.
   */
  incoming?: IncomingWords | null;
}

/**
 * Whether typing here happens on a screen keyboard — which is the app's one
 * keyboard question (`hasKeyboard` in `lib/hotkeys.ts`) turned round, not a
 * second one. It used to be its own `(pointer: coarse)` reading while the
 * drawn hint asked `(hover: hover) and (pointer: fine)`, so the app answered
 * "does this device have a keyboard" two different ways; the two agree on
 * every device either was written for and part only on one whose pointer is
 * neither coarse nor fine — a television or a kiosk — where Enter now breaks
 * the line instead of saving, and Save is the button in the corner.
 *
 * Asked at the moment it matters rather than held in state, so a tablet
 * gaining or losing a keyboard is answered afresh each keystroke. Where there
 * is no matchMedia to ask at all — jsdom, and so every test — it answers
 * "hardware keyboard", because a capture bar whose Enter never saves is a
 * broken capture bar; the drawn hint makes the opposite call for the opposite
 * reason, and `hasKeyboard` takes that as its argument.
 */
/**
 * How long the corner rests after a save before it takes a tap — long enough
 * to swallow the second half of a double tap (a phone counts one inside about
 * 300ms), short enough that nobody reaching for the menu on purpose meets it.
 */
const CORNER_REST_MS = 400;

/** How long the field rests before its draft is written (audit PERF-8). */
export const DRAFT_WRITE_MS = 250;

function screenKeyboard(): boolean {
  return !hasKeyboard(true);
}

/**
 * Anchored to the bottom edge, never floating over content (SPEC §5).
 * One field, and nothing *asked* — no title, no tag, no board you must pick.
 *
 * A textarea rather than an input, because plenty of what gets captured here is
 * more than one line and the field was silently refusing to hold it: Enter is
 * Save, so there was no way to reach a second line at all, and anything long
 * scrolled sideways inside a single row. Now Enter still saves — that is the
 * whole point of the bar — and Shift+Enter breaks the line, while the field
 * grows under your thumb up to a cap and then scrolls.
 *
 * The right-hand slot does whichever thing there is to do. With text in the
 * field that is Save; with the field empty there is nothing to save, so it is
 * the menu instead. The alternative was a permanently disabled grey slab
 * beside a permanently redundant second button, in the one corner the thumb
 * actually reaches.
 *
 * **With text in the field, four marks stand under the words** — priority,
 * to-do, board and (since review 2026-10-04, FX-B-06) a reminder — and they
 * are the whole of what a capture may be saved *as*.
 * They are offered, never asked: every one starts off, Save works without
 * touching any of them, and typing-then-Enter is exactly as fast as it was.
 * Before them, marking a note as a priority cost writing it, opening it,
 * pressing the flag and coming back — three gestures and a round trip for a
 * decision the writer had already made before the first word. Each is one
 * tap, and each is the same mark the open note carries for the same thing, so
 * nothing new has to be learned. The board mark opens the same chooser Move
 * uses, scoped to the note about to be saved; once a board is chosen the mark
 * *becomes* that board's own glyph, on. All three reset when the note is
 * saved or the field is emptied — a choice made about words that no longer
 * exist must never ride onto the next note — and none of them is part of the
 * draft that survives a reload: the words are what was at risk of being lost,
 * and a tap is cheap to make again.
 *
 * Where they stand depends on the width, and the history is the useful part.
 * First they were four bar-height cells in the right-hand corner, which made
 * a toolbar of the place meant for one act, and on a phone they moved to a
 * row *above* the field that dropped in over the words on the first
 * keystroke. Then they moved to a footer *under* the words, at its far left
 * with Save at its far right, which on a wide screen left three small glyphs
 * stranded a screen's width from the act they belong to. The owner then chose
 * one row from three mockups — the marks on the bar's own row, ahead of Save —
 * and on a desktop that is still where they stand. The marks are narrower and
 * quieter than Save — 44px cells with inline glyphs, no fill, no hairlines
 * between them — which is what keeps the corner from reading as a toolbar.
 *
 * **On a phone the words take the whole width, and the marks and Save stand
 * on a slim row under them** (owner, 2026-09-29, with the Claude app's message
 * box as the reference). The one row squeezed the field to about 210px of a
 * 390px screen, so a five-word line broke into five and the bar stood a third
 * of the screen tall — with the keyboard up, most of what was left of the
 * board. The footer is right here for the reason it was wrong on a desktop: a
 * phone is narrow, so the far left of the row is a thumb's reach from Save,
 * not a screen's width. An empty bar is still one slim row; the second row
 * opens under the words with the first letter, and opens rather than snaps
 * (`grow` below), so the line being written glides up instead of jumping.
 * The layout itself is all in the stylesheet (`.capture[data-ready]`). The ✕
 * is still not drawn on a phone: it would sit at the end of the first line,
 * exactly where a thumb lands to put the caret after the words, and it empties
 * the field and its draft with no way back.
 *
 * Plus used to focus the field — a field that is already on screen, already
 * empty and already one tap away, which on a phone did not even raise the
 * keyboard. It looked broken because it effectively was. It now opens the
 * things the bar genuinely cannot do by typing: put a file in, or start a
 * sketch.
 */
export function CaptureBar({
  onCapture,
  onCaptureFiles,
  onDraw,
  menuOpen,
  menuRef,
  selectedCount,
  onMenu,
  boards,
  countFor,
  offerInbox = false,
  here = null,
  onTodos = false,
  onCreateBoard,
  fieldRef,
  registerLayer,
  findSaved,
  twinToCreature = false,
  onOpenSaved,
  line = null,
  undo,
  incoming = null,
}: Props) {
  const [text, setText] = useState("");
  const [attaching, setAttaching] = useState(false);
  // Registered while up, withdrawn when down; the stack does the closing.
  useEffect(() => {
    if (!registerLayer) return;
    if (!attaching) {
      registerLayer(null);
      return;
    }
    registerLayer(() => setAttaching(false));
    return () => registerLayer(null);
  }, [attaching, registerLayer]);
  const [choice, setChoice] = useState<CaptureChoice>(NO_CHOICE);
  /**
   * The share's one extra offer — save these words straight into a board — set
   * only by words that arrived from the phone's share sheet, and gone with
   * them. A fifth mark beside the four, never a fifth thing asked: Save and
   * Enter still save exactly as they did.
   */
  const [shareOffer, setShareOffer] = useState<{ id: string; name: string } | null>(null);
  /** The board chooser, open over the bar. */
  const [choosing, setChoosing] = useState(false);
  /** The reminder presets, open over the bar. */
  const [reminding, setReminding] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  /**
   * One identity for the life of the bar. React detaches and reattaches a ref
   * whose *callback* changed — the old one called with `null`, the new one
   * with the element — so written inline as an arrow this ran on every commit:
   * every keystroke in the field, every toggle of the add panel, every open of
   * the menu, each briefly emptying both `field.current` and the `fieldRef`
   * handed down from `App`. The capture shortcut's
   * `captureField.current?.focus()` says nothing and does nothing if it lands
   * in one of those windows, which is a shortcut that works almost always.
   */
  const takeField = useCallback(
    (el: HTMLTextAreaElement | null) => {
      field.current = el;
      if (fieldRef) fieldRef.current = el;
    },
    [fieldRef],
  );
  const picker = useRef<HTMLInputElement | null>(null);
  /**
   * Files picked or pasted into the bar, waiting for Save (2026-10-12, owner:
   * "let user press the save"). They used to become a note the moment the
   * picker closed, so there was no way to say why the picture was kept without
   * opening the note afterwards. Now they wait as words write would: the bar's
   * line counts them and offers Remove, the words can be typed under them, and
   * Save — or Enter at a keyboard — makes the one note. In memory only, unlike
   * the words' draft: a `File` cannot go into the draft, and a reload simply
   * asks for the picture again. A drop on the window and a paste outside the
   * bar still land at once; they never touch the bar.
   */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const hasFiles = pendingFiles.length > 0;
  const ready = text.trim().length > 0 || hasFiles;
  /** Files handed over by the picker or a paste, to wait for Save. */
  function attach(files: File[]) {
    if (files.length === 0) return;
    setPendingFiles((now) => [...now, ...files]);
    setAttaching(false);
    // The caret goes to the words, so the next thing is to say why.
    field.current?.focus({ preventScroll: true });
  }

  /** The bar itself, which carries the visible height the phone's cap is
   *  measured against (`lib/visibleHeight.ts`). */
  const bar = useRef<HTMLFormElement | null>(null);
  useVisibleHeight(bar);

  /**
   * The bar's own height, gesture inset and all, as `--capture-h` on the
   * document — what a phone's board row at the foot stands on (`.app[data-
   * board-row="bottom"]` in the stylesheet). Measured rather than assumed,
   * because the bar is one slim row only while it is empty: a restored draft
   * or a held share's words grow it, and a row placed at `--bar-h` would sit
   * on top of them. Written straight onto the style, as `--visible-h` is, so
   * a growing field costs no render; taken off again when the bar goes (the
   * Sorter, About), where the stylesheet's fallback answers. Nothing is
   * written where there is no ResizeObserver — jsdom, and so every test.
   */
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const put = () => root.style.setProperty("--capture-h", `${el.offsetHeight}px`);
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--capture-h");
    };
  }, []);

  /**
   * On a phone the marks and Save open as a row under the words with the
   * first letter (the stylesheet's `.capture[data-ready]`), and the bar is
   * anchored to the floor — so the row appearing lifts the line being written
   * by its own height, 44px, mid-word. Snapped, that reads as the text
   * jumping out from under the thumb. So the row *opens*: both of its cells
   * grow from nothing on the note-opening curve, which covers most of the
   * distance in the first frames and settles, and the words glide up with it.
   * Clipped while they grow, so a glyph never pokes out below a half-open row.
   *
   * Only when the row arrives under a hand that is typing. A draft restored on
   * open arrives with its row already there, and a bar that moves on its own
   * as the app opens is the bar announcing itself. Only on a phone: on a
   * desktop the marks stand beside the words and there is no row to open.
   */
  const marks = useRef<HTMLDivElement | null>(null);
  const save = useRef<HTMLButtonElement | null>(null);
  const isPhone = useIsPhone();
  const phoneNow = useRef(isPhone);
  phoneNow.current = isPhone;
  useLayoutEffect(() => {
    if (!ready || !phoneNow.current) return;
    if (!field.current || document.activeElement !== field.current) return;
    const rows: HTMLElement[] = [];
    for (const el of [marks.current, save.current]) if (animates(el)) rows.push(el);
    const grow = rows.map((el) => {
      el.style.overflow = "hidden";
      const opening = el.animate(
        [{ height: "0px" }, { height: `${el.offsetHeight}px` }],
        { duration: OPEN_MS, easing: ENTER },
      );
      const done = () => el.style.removeProperty("overflow");
      opening.onfinish = done;
      opening.oncancel = done;
      return opening;
    });
    return () => grow.forEach((a) => a.cancel());
  }, [ready]);

  /**
   * Words already in another note — the whole of them, or an address in them —
   * said, never asked. The line is information only: Save still saves the new
   * note, Enter is untouched, and nothing waits on the answer, which is a map
   * lookup for the whole text and one per address (`lib/savedLinks.ts`). It
   * goes with the match: a field that matches nothing, or an emptied one
   * after a save, has nothing to say.
   */
  const twin = useMemo(() => (ready && findSaved ? findSaved(text) : null), [ready, findSaved, text]);
  const twinLine = useMemo<BarLine | null>(
    () =>
      twin && onOpenSaved
        ? {
            key: `saved:${twin.id}`,
            said: savedWords(twin, Date.now()),
            verb: "Open",
            act: () => onOpenSaved(twin),
          }
        : null,
    [twin, onOpenSaved],
  );
  /** The files waiting for Save, said on the bar's line, with the way to drop them. */
  const attachedLine = useMemo<BarLine | null>(
    () =>
      hasFiles
        ? {
            key: `attached:${pendingFiles.length}:${pendingFiles[0]?.name ?? ""}`,
            said: filesSaid(pendingFiles, "attached"),
            files: pendingFiles,
            verb: "Remove",
            act: () => setPendingFiles([]),
          }
        : null,
    [hasFiles, pendingFiles],
  );
  // Handed to the header's creature while it is the one saying it; taken
  // back the moment the match goes, and when the bar goes.
  useEffect(() => {
    setTwin(twinToCreature ? twinLine : null);
  }, [twinToCreature, twinLine]);
  useEffect(() => () => setTwin(null), []);
  // What is about to be saved outranks what is merely known about the words.
  const shownLine = attachedLine ?? (twinToCreature ? null : twinLine) ?? line;

  /**
   * The marks are about the words in the field, so they go when the words
   * go. Cleared by hand, saved, or backspaced to nothing — every path that
   * empties the field passes through `ready` turning false, so one effect
   * covers all of them rather than a reset beside each. The chooser closes
   * with it: a picker for a note that no longer exists has nothing to pick
   * for.
   */
  useEffect(() => {
    if (ready) return;
    setChoice(NO_CHOICE);
    setShareOffer(null);
    setChoosing(false);
    setReminding(false);
  }, [ready]);

  /**
   * The lamp: a pool of light under the caret, showing the paper's own grain
   * where it falls (DESIGN.md §2c, `.capture-lamp` in styles.css). Everything
   * about how it *looks* is in the stylesheet; the only thing that cannot be is
   * where the caret is, which no textarea will tell you and which is therefore
   * measured in a hidden mirror of the field (`lib/caret.ts`).
   *
   * The mechanics live in `lib/useLamp.ts`, shared with the editor's lamp;
   * only the knobs differ, and those are in the stylesheet.
   */
  const { lampRef: lamp, mirrorRef: mirror, lampIdle, moveLamp, wakeLamp, lampMoved } = useLamp(field);

  /**
   * What was typed here and not yet saved survives the app being closed.
   *
   * An open note has written every keystroke to this device since it was
   * built; this bar had not, so the one place in the app where writing starts
   * was the one place a sentence could be lost — to a reload, to a link that
   * took the window, or to Android reclaiming a backgrounded tab. Now the two
   * halves make the same promise (`store/db.ts`, which holds the argument for
   * where it goes and why it is a draft rather than a note).
   *
   * Nothing is announced when it comes back. A capture bar with your own
   * unfinished sentence in it explains itself, and asking "restore your
   * draft?" would be a decision at capture time, which is the one thing this
   * field may never ask for.
   */
  const touched = useRef(false);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let live = true;
    void readCaptureDraft().then((saved) => {
      if (!live) return;
      // Only if nobody has started writing in the meantime. The read is a
      // tick or two of IndexedDB and a fast thumb can beat it — and somebody
      // who has already begun a new thought must not have it replaced by an
      // old one, nor a field they just cleared refilled behind them.
      if (saved && !touched.current) setText(saved);
      setRestored(true);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * ...and it is written back as it is typed, which is the editor's own rule
   * said again rather than a second, weaker one.
   *
   * A pause of `DRAFT_WRITE_MS` rather than every keystroke (audit PERF-8):
   * one IndexedDB write per letter was work the field did not need. Nothing is
   * lost to the wait — the pending words are written at once when the page is
   * hidden or left (the moments a tab is reclaimed or reloaded) and when the
   * bar goes away, and an emptied field is written at once, so a note just
   * saved can never come back as a draft.
   *
   * Keyed on `restored` as well as on the text, so that the empty string this
   * component mounts with can never be written over the draft it is in the
   * middle of fetching — and so that the first thing typed during that gap is
   * still written the moment the fetch lands.
   *
   * One effect rather than a call beside every `setText`. Saving, capturing
   * files, clearing the field by hand and a capture that failed and kept its
   * words are four paths that all have to leave the draft in the right state,
   * and four call sites that have to agree is how one of them ends up not
   * agreeing.
   */
  const pendingDraft = useRef<string | null>(null);
  const draftTimer = useRef<number | null>(null);
  const flushDraft = useCallback(() => {
    if (draftTimer.current !== null) {
      window.clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    const pending = pendingDraft.current;
    if (pending === null) return;
    pendingDraft.current = null;
    void writeCaptureDraft(pending);
  }, []);
  useEffect(() => {
    if (!restored) return;
    pendingDraft.current = text;
    if (text === "") {
      flushDraft();
      return;
    }
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(flushDraft, DRAFT_WRITE_MS);
  }, [restored, text, flushDraft]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushDraft();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flushDraft);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flushDraft);
      flushDraft();
    };
  }, [flushDraft]);

  /** Every path that changes the field goes through here, so `touched` and the
   *  draft cannot be set by one of them and missed by another. */
  function put(next: string) {
    touched.current = true;
    setText(next);
  }
  /** The field as it is now, for code still running after an `await` — whose
   *  own `text` is the render it started in. */
  const textNow = useRef(text);
  textNow.current = text;

  /**
   * Words from outside — a shared page, the desktop bookmark — put in the
   * field unsaved (review 2026-10-04, FX-A-02, FX-A-03). A share used to save
   * itself blind, so why the page was kept was lost at the one moment it was
   * known, and filing it cost open, Move, back.
   *
   * They go under a blank first line holding the caret, so the reason can be
   * typed above the page and the marks are already offered beside Save; one
   * tap or Enter saves, and the trim drops the blank line if nothing was said.
   * Words already being written are never replaced: what arrives goes under
   * them, after an empty line, and the caret stays at the end of the reader's
   * own words. (A page that opens the app with words can therefore neither
   * save a note nor wipe one.)
   *
   * Only once the stored draft has been read, or the draft would land on top
   * of the share, or the share be dropped under the draft. And `taken` waits
   * for the draft write, so the share's parking space is emptied only once the
   * words are safe in a place that survives a reload.
   */
  const consumed = useRef<IncomingWords | null>(null);
  useEffect(() => {
    if (!restored || !incoming || consumed.current === incoming) return;
    consumed.current = incoming;
    const words = incoming.text.trim();
    if (!words) {
      incoming.taken();
      return;
    }
    setShareOffer(incoming.boardOffer ?? null);
    const held = textNow.current.trimEnd();
    const next = held.trim() ? `${held}\n\n${words}` : `\n${words}`;
    const caret = held.trim() ? held.length : 0;
    put(next);
    const el = field.current;
    if (el) {
      el.value = next;
      el.focus();
      el.setSelectionRange(caret, caret);
      fitTextarea(el);
    }
    void writeCaptureDraft(next).then(() => incoming.taken());
  }, [restored, incoming]);

  /**
   * Files land as their own note, taking anything typed with them.
   *
   * The field is cleared only once the note exists. It used to clear on the way
   * past — before the write had even started — so a capture that failed for
   * want of room took the user's typed words with it and left the bar looking
   * like it had worked.
   *
   * **And only if it still holds what went into the note.** Waiting is not
   * free after all: the first PDF of a session waits on a half-megabyte import
   * and a photograph on its thumbnail, and the field stays live throughout. A
   * sentence started in that gap was wiped by the clear, draft and marks with
   * it, when none of it had gone anywhere. What changed since the files were
   * handed over is left exactly as it is.
   */
  async function takeFiles(files: File[], said = text, marks = choice) {
    if (files.length === 0) return;
    const held = text;
    const made = await onCaptureFiles(files, marks.todo ? asChecklist(said) : said, marks);
    if (made && textNow.current === held) put("");
    setAttaching(false);
    return made;
  }

  /**
   * Save with files waiting: the files and the words go up as one note. The
   * files leave the bar at once, so a second tap cannot save them twice, and
   * come back if no note was made (a file over the limit, a full device) —
   * ahead of anything attached in the meantime.
   *
   * The words stay in the field until the note exists, so while the files are
   * still being taken in (a HEIC can take seconds) a second Enter would find
   * words and no files and save the words again as a note of their own.
   * `savingFiles` holds Save shut for that gap.
   */
  const savingFiles = useRef(false);
  async function saveWithFiles(said: string, marks = choice) {
    const files = pendingFiles;
    setPendingFiles([]);
    savingFiles.current = true;
    try {
      const made = await takeFiles(files, said, marks);
      if (!made) setPendingFiles((now) => [...files, ...now]);
    } finally {
      savingFiles.current = false;
    }
  }

  // Before paint, so the bar never draws at the wrong height for a frame —
  // including on the way back down to one row after a save.
  useLayoutEffect(() => {
    if (field.current) fitTextarea(field.current);
  }, [text]);

  // ...and when the field's width changes under the words, which the undo cell
  // does as it arrives, as its word goes and as it leaves: a narrower field
  // wraps sooner, and a height fitted to the old width would cut off a line.
  // Width only — the fit itself changes the height, and must not loop.
  useEffect(() => {
    const el = field.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitTextarea(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * ...and the light follows in the same frame the character does. Chased from
   * an ordinary effect the two land one frame apart, which at this size reads
   * as the light limping behind fast typing.
   *
   * It must run *after* the effect above and so is declared after it: React
   * runs layout effects in the order they are written, and the bar grows as it
   * fills — placed first, the pool would be measured against the height the
   * field had before this keystroke.
   */
  useLayoutEffect(() => {
    moveLamp();
  }, [text, moveLamp]);

  function submit() {
    if (savingFiles.current) return;
    const trimmed = text.trim();
    if (hasFiles) {
      void saveWithFiles(trimmed);
      return;
    }
    if (!trimmed) return;
    // To-do pressed on several lines is a list to tick (`asChecklist`); the
    // press is the asking, so nothing changes on a capture without it.
    onCapture(choice.todo ? asChecklist(trimmed) : trimmed, choice);
    put("");
  }

  /**
   * The share's offer: save these words straight into the board it names. It
   * is Save with one mark more, so files waiting in the bar go with the words
   * as they would on Save — they used to be left behind, the words filed
   * without them.
   */
  function saveTo(boardId: string) {
    if (savingFiles.current) return;
    const trimmed = text.trim();
    const marks = { ...choice, board: boardId };
    if (hasFiles) {
      void saveWithFiles(trimmed, marks);
      return;
    }
    if (!trimmed) return;
    onCapture(marks.todo ? asChecklist(trimmed) : trimmed, marks);
    put("");
  }

  /**
   * When the last save happened, for the corner it happened in. Save becomes
   * the menu (and + beside it) the moment the field empties, in the same
   * place, so the second tap of a quick double tap on Save opened the menu
   * over the board (review 2026-10-01, UX-30). For `CORNER_REST_MS` after a
   * finger on Save the two cells take no tap, and a mouse click that is the
   * second of a double click is refused by its own count; nothing is drawn differently, and a tap a
   * moment later works as it always did.
   */
  const savedAt = useRef(0);
  /** Whether the words held the caret when a finger came down on Save. */
  const typing = useRef(false);
  const cornerResting = (e: React.MouseEvent) =>
    e.detail >= 2 || Date.now() - savedAt.current < CORNER_REST_MS;

  /** Applies a programmatic edit and puts the caret back where it belongs. */
  function apply(next: { value: string; caret: number }) {
    put(next.value);
    const el = field.current;
    if (!el) return;
    el.value = next.value;
    el.setSelectionRange(next.caret, next.caret);
    fitTextarea(el);
  }

  /**
   * A board picked for the note being written. The chooser closes and the
   * caret goes back to the words — on a desktop so Enter still saves, on a
   * phone so the keyboard the chooser's own field may have taken comes back
   * to the sentence it was raised for. The text itself was never at risk:
   * it is state, not something the field is holding on the bar's behalf.
   */
  function pickBoard(id: string | null) {
    setChoice((c) => ({ ...c, board: id }));
    setChoosing(false);
    field.current?.focus();
  }

  /** Closing the chooser keeps whatever was chosen before it opened. */
  function closeChooser() {
    setChoosing(false);
    field.current?.focus();
  }

  /**
   * A reminder picked for the note being written — or taken off again, with
   * `null`. The panel closes on the pick and the caret goes back to the words,
   * as it does from the board chooser. Nothing is asked of the browser here:
   * permission to ring is asked at Save, the moment the reminder becomes real
   * (`onCapture`'s caller), exactly as the open note asks when one is set.
   */
  function pickReminder(preset: ReminderPreset | null) {
    setChoice((c) => ({ ...c, reminder: preset }));
    setReminding(false);
    field.current?.focus();
  }

  function closeReminder() {
    setReminding(false);
    field.current?.focus();
  }

  /** The four presets, named and ordered for now, as the open note offers them. */
  const presets = reminding || choice.reminder ? reminderPresets() : [];
  const reminderName = choice.reminder
    ? `Reminder: ${presets.find((p) => p.key === choice.reminder)?.label ?? ""}, ${presetWhen(choice.reminder)}`
    : "Reminder";

  // A board chosen and then taken away — the undo of making it, or a delete from
  // the shelf — is no longer a choice: the mark goes back to unasked, not on
  // with a board that is not there.
  const gone = typeof choice.board === "string" && !boards.some((b) => b.id === choice.board);
  useEffect(() => {
    if (gone) setChoice((c) => (typeof c.board === "string" ? { ...c, board: undefined } : c));
  }, [gone]);

  /** The board the mark names, if the chosen one still exists. */
  const chosen = typeof choice.board === "string"
    ? boards.find((b) => b.id === choice.board) ?? null
    : null;
  /** Where nothing chosen goes, when that is a folder rather than the Inbox. */
  const fallback =
    choice.board === undefined && here ? boards.find((b) => b.id === here) ?? null : null;
  const boardName =
    choice.board === null ? "Inbox" : chosen ? chosen.name : fallback ? fallback.name : null;

  return (
    <form
      ref={bar}
      className="capture"
      // What the stylesheet lays the bar out by: with words in the field a
      // phone gives them the whole width and puts the marks and Save on a
      // row underneath. Nothing on a desktop reads it.
      data-ready={ready || undefined}
      data-lamp-idle={lampIdle || undefined}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
        // The caret goes back to the words if Save took it anyway — a Tab
        // onto it, or a browser that focuses a pressed button regardless —
        // or if the words had it when the finger came down. Save is about to
        // be replaced by + and Menu, so focus left on it would drop to the
        // page; and on a phone the field holding it is the keyboard staying
        // up for the next line. A Save pressed with the keyboard already down
        // leaves it down (review 2026-10-04, UX-A-11).
        const el = field.current;
        if (el && (document.activeElement === save.current || typing.current)) el.focus();
        typing.current = false;
      }}
      // Escape steps out of the chooser from wherever focus is — the field,
      // a row, the chooser's own input (which stops the key itself and calls
      // cancel) — and never out of the choice already made.
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !(choosing || reminding)) return;
        e.preventDefault();
        e.stopPropagation();
        if (choosing) closeChooser();
        else closeReminder();
      }}
    >
      {/* Bottom-right like every other panel, because that is where the thumb
          is. Rows swallow mousedown so whatever is typed keeps its caret. */}
      {attaching && (
        <>
          <button
            type="button"
            className="menu-dismiss menu-dismiss-over"
            aria-label="Close add menu"
            onClick={() => setAttaching(false)}
          />
          <div className="selpanel selpanel-right selpanel-over" role="menu" aria-label="Add">
            {/* Position is the only emphasis, and nearest the thumb wins —
                attaching keeps the bottom row as the established habit; the
                sketch stands above it. */}
            <Action
              role="menuitem"
              keepFocus
              label="Draw"
              onClick={() => {
                setAttaching(false);
                onDraw();
              }}
            >
              <IconPencil />
            </Action>
            {/* One row, and it takes anything a note can carry — pictures,
                PDFs, audio, whatever. Nearest the thumb, because it is the one
                that gets used. */}
            <Action
              role="menuitem"
              keepFocus
              label="Attachment"
              onClick={() => {
                picker.current?.click();
                setAttaching(false);
              }}
            >
              <IconAttachment />
            </Action>
          </div>
        </>
      )}

      {/* The board chooser for the note being written — the same one Move
          uses, anchored to the top of the bar rather than to `--bar-h`, so it
          rides above the field however many lines it has grown to. It is a
          panel, not a field: the bar still offers exactly one place to type
          until this is opened, and it is opened by choice. */}
      {choosing && (
        <>
          <button
            type="button"
            className="menu-dismiss menu-dismiss-over"
            aria-label="Close board chooser"
            onClick={closeChooser}
          />
          <div className="capture-chooser">
            <BoardChooser
              boards={boards}
              countFor={countFor}
              showUnfiled={offerInbox}
              onUnfile={() => pickBoard(null)}
              onChoose={(b) => pickBoard(b.id)}
              onCreate={(name) => pickBoard(onCreateBoard(name).id)}
              onCancel={closeChooser}
            />
          </div>
        </>
      )}

      {/* The clock's four presets — the open note's own, in its order, each
          saying when it will ring. Bottom-right like the Add panel and the
          open note's reminder panel. No custom time and no repeat here: those
          are a second visit's worth of decision, and the open note has them. */}
      {reminding && (
        <>
          <button
            type="button"
            className="menu-dismiss menu-dismiss-over"
            aria-label="Close reminder menu"
            onClick={closeReminder}
          />
          <div className="selpanel selpanel-right selpanel-over" role="menu" aria-label="Reminder">
            {presets.map((preset) => (
              <Action
                key={preset.key}
                role="menuitemradio"
                checked={choice.reminder === preset.key}
                keepFocus
                label={preset.label}
                suffix={<>{" "}<span className="selpanel-n">{presetWhen(preset.key)}</span></>}
                onClick={() => pickReminder(preset.key)}
              >
                {choice.reminder === preset.key ? <IconCheck /> : <IconReminder tier="inline" />}
              </Action>
            ))}
            {choice.reminder && (
              <Action role="menuitem" keepFocus label="No reminder" onClick={() => pickReminder(null)}>
                <IconClear tier="inline" />
              </Action>
            )}
          </div>
        </>
      )}

      {/* The one line the bar says about a note (`CaptureLine`): on its top
          edge, over the board, so neither its arriving nor its going moves
          anything. The panels above open over it. */}
      {shownLine && <CaptureLine key={shownLine.key} line={shownLine} />}
      {/* ...and said for a reader from a region that is always mounted, since
          one minted with its words already in it is the case assistive
          technology misses (see the undo offer's words in App.tsx). */}
      <span className="sr-only" role="status" aria-live="polite">
        {shownLine?.said ?? ""}
      </span>

      {/* One picker, and deliberately no `accept`: a note carries pictures,
          PDFs, audio and anything else, and the one row has to reach all of
          it. (An `image/*` row beside it, which is what Android wants in order
          to offer the gallery rather than a list of filenames, was tried and
          withdrawn — see web/CLAUDE.md. Ctrl+V and the phone's own share sheet
          are now the short paths a photograph takes, and neither of them goes
          through a picker at all.)

          No `capture` attribute either, which would ask for the camera rather
          than for something already on the device. `multiple`, because several
          photographs are one note. */}
      <input
        ref={picker}
        type="file"
        multiple
        className="offscreen"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const picked = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          attach(picked);
        }}
      />

      <div className="capture-field">
      {/* The light, and the glass it is measured through. Both are furniture
          for the field underneath: neither is in the accessibility tree, and
          the lamp cannot catch a tap (`pointer-events: none`). The two
          durations are handed down here rather than written in the stylesheet,
          so lib/motion.ts stays the only copy of both. */}
      <div
        ref={lamp}
        className="capture-lamp"
        aria-hidden
        style={LAMP_STYLE}
      />
      <div ref={mirror} className="capture-mirror" aria-hidden />
      <textarea
        ref={takeField}
        rows={1}
        value={text}
        onChange={(e) => {
          const el = e.currentTarget;
          wakeLamp();
          // The creature taps along, a little less for a deletion.
          mascotTap((e.nativeEvent as Partial<InputEvent>).inputType?.startsWith("delete") ? 0.6 : 1);
          // Mid-composition the field holds an IME's working text, which is
          // not yet what anybody typed; rewriting it — which is what an
          // autoformat hit does — tears the composition down and can drop or
          // duplicate characters. The words are still kept and still drafted;
          // only the rules stand aside, until the composition ends. React
          // types a change event's native event as a plain `Event`; the one a
          // textarea fires is an `InputEvent` and carries the flag.
          if ((e.nativeEvent as Partial<InputEvent>).isComposing === true) {
            put(el.value);
            return;
          }
          const hit = autoformat(el.value, el.selectionStart);
          if (hit) apply(hit);
          else put(el.value);
        }}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          // Escape lets go of the field, so a keyboard has a way out of the
          // bar that is not Tab (review 2026-10-04, UX-A-01). With words in it
          // too (owner approved 2026-10-18, dogfooding): they stay, unsaved,
          // and `?` and the grid's keys work again instead of typing into
          // the draft. Never while a panel of the bar's own is open, which
          // Escape closes first. Not stopped, so a layer over the board still
          // hears it. Never while an input method is composing: there Escape
          // is the method's own, cancelling the composition (Firefox sends it
          // with `isComposing` set), and letting go of the field as well threw
          // the writer out of the box mid-word. `keyCode === 229` is the same
          // key on the older Android WebViews that never set `isComposing`.
          if (e.key === "Escape") {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (!choosing && !attaching && !reminding) el.blur();
            return;
          }
          if (e.key !== "Enter") return;
          // The Enter that commits an IME candidate is not the Enter this bar
          // means. Taken as a save, it saved the unconverted working text and
          // cleared the field — the one path in the app that can write the
          // wrong characters into a note, in the one place whose whole promise
          // is that what you typed is never lost. `keyCode === 229` is the
          // same key on the older Android WebViews that never set
          // `isComposing`.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;

          // On a hardware keyboard Enter saves — that is what this bar is for
          // — and Shift+Enter breaks the line. A screen keyboard has no
          // Shift+Enter at all, so there Enter breaks the line and Save is
          // the button in the corner, which is already what a thumb reaches
          // for. The old rule ("Enter saves, always") was written when the
          // field was one line; on a phone it saved every multi-line thought
          // mid-sentence, with no way to ever reach a second line.
          if (!e.shiftKey && !screenKeyboard()) {
            e.preventDefault();
            submit();
            return;
          }

          // A new line — and inside a list, the next item.
          if (el.selectionStart !== el.selectionEnd) return;
          const hit = continueList(el.value, el.selectionStart);
          if (!hit) return;
          e.preventDefault();
          apply(hit);
        }}
        // Ctrl+V on a screenshot is the shortest path a file can take from one
        // machine to the other: copy, paste, done — no picker, no dialogue, no
        // filename to invent. Pasted text is left entirely alone.
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (files.length === 0) return;
          e.preventDefault();
          // A clipboard carrying a picture very often carries words as well —
          // a chart copied out of a spreadsheet, an image copied from a web
          // page — and taking the picture while silently dropping the words
          // is the bar losing text somebody put on the clipboard on purpose.
          // Whatever is already in the field wins: those were typed here.
          const said = e.clipboardData?.getData("text/plain")?.trim() ?? "";
          if (said && !text.trim()) put(said);
          attach(files);
        }}
        // The caret moves for four reasons and the light has to follow all of
        // them: typing (the layout effect above), taking focus, moving the
        // caret without changing the text, and the field scrolling inside
        // itself once it has hit --capture-max. `onSelect` is the one that
        // covers arrows, clicks and drags — it fires on a collapsed selection
        // too, which is what a caret is.
        onFocus={lampMoved}
        onSelect={lampMoved}
        onScroll={lampMoved}
        placeholder={writeHint(fallback, onTodos)}
        aria-label="Write a note"
        // "done" promised the keyboard's Enter would finish; now that it
        // breaks the line on a screen keyboard, the key must say so.
        enterKeyHint={screenKeyboard() ? "enter" : "done"}
        // On for a screen keyboard, off at a hardware one (review 2026-10-01,
        // UX-14). A phone's keyboard reads spellcheck off as "no suggestions",
        // so the words it offers and its autocorrect went with it; a desktop
        // has no such keyboard and would only draw squiggles, which this app
        // has no colour for.
        spellCheck={screenKeyboard()}
      />
        {/* Sits in the top corner of the field, not in the bar, so it can
            never be mistaken for Save — which is in the bottom corner and is
            the one thing here you must not hit by accident. onMouseDown is
            swallowed so the caret stays where it was if you change your
            mind. */}
        {/* The shortcut that puts the caret here, drawn in the field it opens
            and only while the field is empty — once there are words in it the
            reader is already writing, and the hint would be sitting on top of
            what they typed. It is `pointer-events: none` in the stylesheet, so
            it never intercepts the tap that focuses the field underneath. */}
        {text.length === 0 && <Hotkey keyName={CAPTURE_KEY} />}
        {text.length > 0 && (
          <button
            type="button"
            className="field-clear"
            aria-label="Clear"
            title="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // Emptied through the editor's own edit path, so the browser's
              // Ctrl+Z inside the field brings a long unsaved draft back
              // (`lib/editText.ts`). The field has to hold focus for that.
              const el = field.current;
              if (el) {
                el.focus({ preventScroll: true });
                writeThrough(el, "", 0);
              }
              // Where the command was unavailable the value was assigned, and
              // either way the draft follows the state, as typing does.
              put("");
            }}
          >
              <IconClear tier="nav" />
          </button>
        )}
      </div>
      {undo}
      {ready ? (
        /* What the note is saved as, and Save. On a desktop they stand on the
           same row as the words, at the right, where the corner cells stand
           when the field is empty: typing the first letter swaps the two
           corner cells for these five. On a phone they are a slim row under
           the words, marks at the left and Save at the right (the stylesheet
           decides which; the order here is the same either way). The marks
           are narrower and quieter than Save — 44px cells with inline
           glyphs, no fill, no hairlines between them — so they read as one
           act with four options beside it, not as a toolbar. Each mark
           swallows mousedown so the caret stays in the words. Reachable by
           Tab from the field, in the same order. */
        <>
          <div ref={marks} className="capture-marks" role="group" aria-label="Save as">
            <button
              type="button"
              className="capture-icon capture-mark"
              aria-pressed={choice.priority}
              aria-label="Important"
              title="Important"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setChoice((c) => ({ ...c, priority: !c.priority }))}
            >
              <IconPriority on={choice.priority} tier="inline" />
            </button>
            <button
              type="button"
              className="capture-icon capture-mark"
              aria-pressed={choice.todo}
              aria-label="To-do"
              title="To-do"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setChoice((c) => ({ ...c, todo: !c.todo }))}
            >
              <IconTodo on={choice.todo} tier="inline" />
            </button>
            {/* Pressed while a board is chosen or the chooser is open — the
                one control here that is a door rather than a switch, so it
                reads as engaged for as long as the question is on screen.
                Once a board is chosen it wears that board's own mark, so the
                answer is read before the name is; the name itself is the
                hover title, since a 44px cell has no room for a word. */}
            <button
              type="button"
              className="capture-icon capture-mark"
              aria-pressed={choice.board !== undefined || choosing}
              aria-expanded={choosing}
              aria-label={boardName ? `Board: ${boardName}` : "Board"}
              title={boardName ? `Board: ${boardName}` : "Board"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setChoosing((v) => !v)}
            >
              {choice.board === null ? (
                <IconInbox on tier="inline" />
              ) : (
                // A chosen board's glyph, else the solid folder. Not chosen,
                // only where the note goes by default: the same glyph,
                // untinted, on an unpressed mark (DESIGN.md §2b tints a
                // folder's mark on the shelf and nowhere else), else the
                // outline folder.
                <FolderGlyph icon={(chosen ?? fallback)?.icon} on={chosen !== null} />
              )}
            </button>
            {/* The fourth offer (review 2026-10-04, FX-B-06): a door like the
                board mark, pressed while a preset is chosen or the presets are
                open, solid once one is. The preset and its time are the hover
                title and the name. */}
            <button
              type="button"
              className="capture-icon capture-mark"
              aria-pressed={choice.reminder !== null || reminding}
              aria-expanded={reminding}
              aria-label={reminderName}
              title={reminderName}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setReminding((v) => !v)}
            >
              <IconReminder on={choice.reminder !== null} tier="inline" />
            </button>
            {shareOffer && (
              <button
                type="button"
                className="capture-icon capture-mark"
                aria-label={`Save to ${shareOffer.name}`}
                title={`Save to ${shareOffer.name}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => saveTo(shareOffer.id)}
              >
                <IconInspiration tier="inline" />
              </button>
            )}
          </div>
          <button
            ref={save}
            type="submit"
            className="capture-save"
            aria-label="Save note"
            title="Save note"
            // Only a finger on Save starts the rest — Enter leaves nothing in
            // the corner to tap twice, and a mouse's double click is told
            // apart by its own click count (`cornerResting`).
            onPointerDown={(e) => {
              savedAt.current = e.pointerType === "mouse" ? 0 : Date.now();
              typing.current = document.activeElement === field.current;
            }}
            // Save never takes the focus from the words (review 2026-10-04,
            // UX-A-11): on a phone the field blurring is the keyboard
            // dropping, after every note. The same swallow the marks use.
            onMouseDown={(e) => e.preventDefault()}
          >
            <IconSave />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="capture-icon"
            aria-label="Add"
            title="Add"
            aria-expanded={attaching}
            onClick={(e) => {
              if (cornerResting(e)) return;
              setAttaching((v) => !v);
            }}
          >
            <IconPlus />
          </button>
          <button
            type="button"
            ref={menuRef}
            className="capture-icon capture-menu"
            aria-label={selectedCount > 0 ? `Menu, ${selectedCount} selected` : "Menu"}
            title={selectedCount > 0 ? `Menu, ${selectedCount} selected` : "Menu"}
            aria-expanded={menuOpen}
            data-selecting={selectedCount > 0 ? true : undefined}
            onClick={(e) => {
              if (cornerResting(e)) return;
              onMenu();
            }}
          >
            <IconMenu on={menuOpen} />
            {selectedCount > 0 && (
              <span className="capture-tally mono" aria-hidden="true">
                {selectedCount}
              </span>
            )}
          </button>
        </>
      )}
    </form>
  );
}
