import type { Board } from "../types";
import { emptyBoardHint, emptyBoardTitle, type WaitingElsewhere } from "../lib/boards";
import type { MascotState } from "./mascot-element";
import { Mascot } from "./Mascot";
import { Spinner } from "./Spinner";
import { IconImport, IconSearch } from "./Icons";
import { DEMO } from "../lib/demo";
import { DemoEmptyWords } from "../demo/SampleOffer";
import { BoardIcon } from "./BoardLook";
import { useWakeOnEmptied } from "../lib/emptiedByHand";

interface Props {
  /** A store with nothing in it while the first sync is still running. */
  fetching: boolean;
  /** Still nothing here, and the first sync failed or is offline: the notes
   *  have not arrived, which is not the same as there being none. */
  notArrived?: boolean;
  searching: boolean;
  /** How many words the search is matching on — one word that found nothing
   *  is answered differently from several. */
  searchWords?: number;
  /** The search holds a quoted phrase: its words must stand together, in order. */
  searchQuoted?: boolean;
  remindersOpen: boolean;
  headerMood: MascotState;
  /**
   * The header's creature is saying something (`Speech.tsx`). It cannot speak
   * from up there while it is asleep down here — there is only ever one — so
   * for as long as the bubble stands it comes up to the header to say it, and
   * its place here is kept so nothing on the board moves.
   */
  speaking?: boolean;
  board: Board;
  /** Nothing was ever written here — the one empty Inbox that has achieved nothing. */
  freshArchive: boolean;
  /** Never-filed notes parked outside the pile after "Leave them". */
  oldNotesOut: number;
  /**
   * The way in for somebody arriving from Google Keep — offered on the one
   * empty board that has nothing behind it: the Inbox of an archive nothing has
   * ever been written in (`freshArchive`). See the offer below.
   */
  onImportKeep?: () => void;
  /**
   * Unfiled notes waiting on Todos and Links instead of the Inbox
   * (`waitingElsewhere`). An empty Inbox with any says so, and offers the way
   * there (review UX-B-02).
   */
  waiting?: WaitingElsewhere;
  onGoTo?: (kind: "todos" | "links") => void;
  /**
   * Where an empty search's note may be instead (audit 2026-10-10, UX-1): how
   * many trashed notes the query would match, and — when the search is
   * narrowed to a board — how many outside it. Trashed notes are never
   * results; this only says that they are there, and offers the way.
   */
  missed?: SearchMissed;
  onGoToTrash?: () => void;
  onSearchEverywhere?: () => void;
  /** Tapping the "Did you mean" offer searches that word. */
  onSearchWord?: (word: string) => void;
}

export interface SearchMissed {
  inTrash: number;
  outside: number;
  /** The board the search is narrowed to, or null. */
  scope: string | null;
  /** A word the notes really hold, one letter from what was typed (`didYouMean`). */
  didYouMean?: string | null;
}

const MISSED_NONE: SearchMissed = { inTrash: 0, outside: 0, scope: null };

/** "1 match is" / "3 matches are" — the one sentence an empty search may add. */
function matchesAre(n: number): string {
  return n === 1 ? "1 match is" : `${n} matches are`;
}

/**
 * What an empty search says when the note is somewhere it did not look: in
 * the Trash, or outside the board it was narrowed to. Null when neither.
 */
export function missedLine({ inTrash, outside, scope }: SearchMissed): string | null {
  const away = outside > 0 && scope ? `${matchesAre(outside)} outside ${scope}` : null;
  const binned = inTrash > 0 ? `${matchesAre(inTrash)} in the Trash` : null;
  if (away && binned) return `${away}, and ${binned.replace(/ (is|are) in/, " in")}.`;
  if (away) return `${away}.`;
  if (binned) return `${binned}.`;
  return null;
}

const NONE_WAITING: WaitingElsewhere = { todos: 0, links: 0 };

/**
 * What the deck shows when there is nothing to show: the fetching spinner on
 * a new device, or the empty state with the mascot and the board's own words.
 * Lifted out of `App.tsx` as markup only: seven props, no state, no effects.
 */
export function EmptyBoard({
  fetching,
  notArrived = false,
  searching,
  searchWords = 0,
  searchQuoted = false,
  remindersOpen,
  headerMood,
  speaking = false,
  board,
  freshArchive,
  oldNotesOut,
  onImportKeep,
  waiting = NONE_WAITING,
  onGoTo,
  missed = MISSED_NONE,
  onGoToTrash,
  onSearchEverywhere,
  onSearchWord,
}: Props) {
  const missedSaid = searching && !remindersOpen ? missedLine(missed) : null;
  const onTheBoard = board.kind === "inbox" && !searching && !remindersOpen;
  const offerKeep = freshArchive && onTheBoard && onImportKeep;
  // Where a list or a bare link went, when that is why the Inbox is empty —
  // only while nothing is held outside it, whose own sentence comes first.
  const goTo = onTheBoard && !freshArchive && oldNotesOut === 0 && onGoTo ? onGoTo : null;
  const lost = notArrived && !searching && !remindersOpen;
  const hint = emptyBoardHint(board, oldNotesOut, freshArchive, waiting, lost);
  const mascotShown = !fetching && !searching && !remindersOpen;
  const wake = useWakeOnEmptied(mascotShown);
  return (
    fetching ? (
      /* A store with nothing in it while the first sync is still
         running is a new device fetching its archive, not an empty
         archive. "Nothing here yet — write something" at that moment
         reads as the notes being gone, which is the scariest sentence
         this app can say. `working` implies a session, so this can
         never show in device-only mode.

         `serverAnswered` is what ends it. Without it the test is only
         "empty and syncing", which stays true on every later poll of
         an account that is *actually* empty — so a new user's first
         screen went back to promising notes that do not exist, every
         tick, forever. Once a tick has come round clean this device
         has its answer: an empty store now means an empty archive,
         and the words below say so. Before that first answer nobody
         knows, and the spinner is the honest thing to show. */
      <div className="empty empty-loading mono" role="status">
        <Spinner />
        Fetching your notes
      </div>
    ) : (
    <p className="empty">
      {/* An empty board is a place you have arrived at, and the mascot
          belongs to the place. A search that found nothing is a mode,
          not a place — you are still standing on the board underneath
          it — so the drawing stays out of it.

          The same creature as the header's, in the same precedence:
          `empty` is only what is left once nothing is in flight and
          the connection is up, which is why it reads the header's
          resolved state rather than running a second set of timers
          half a render out of step with it. Both are drawings you can
          prod, and neither is the voice — the live region up in the
          header is.

          And it is the *same* creature, not a second one: while this is
          drawn the header's is away, gone in a puff of smoke, and this one
          simply is there; the header's comes home out of another puff when
          the board fills (2026-09-29 and 2026-10-12, the owner's asks).
          Nothing here arranges that — the
          element does, from its own registry — so this stays markup. */}
      {mascotShown &&
        (speaking ? (
          <span className="empty-mascot-gap" aria-hidden />
        ) : (
          <Mascot state={headerMood === "idle" ? "empty" : headerMood} wake={wake} />
        ))}
      {/* Headed with the place's own name (`emptyBoardTitle`, review
          UI-28), and the line under it says what this zero means. An
          empty Inbox is not an absence — it is the thing you were
          working towards, so its line says "Nothing to tidy".

          Unless nothing was ever written here (`freshArchive`), which
          is the one empty Inbox that has achieved nothing: "Everything
          is filed" would be the app's opening line to a new user, and
          it would be false in both halves. The mascot, the heading and
          the one italic line underneath are unchanged — this is the
          same empty state with true words in it, not a welcome screen.

          It is only *finished*, though, if there is nothing being held
          outside it. After "Leave them" there are a couple of hundred
          never-filed notes parked out of the pile and nothing on screen
          ever mentions them again, so an empty Inbox reads as
          everything being dealt with — which is the one thing it must
          not say while that is false. `oldNotesOut` is the same number
          the menu row quotes, so the two sentences cannot drift. */}
      {/* An empty reminders list is the normal state, not a failure,
          and it says so plainly rather than apologising. The words are
          inline here beside search's, not in `emptyBoardHint`, for the
          reason that hint takes a `Board`: this is a mode, and there
          is no board to hand it. */}
      <strong>
        {remindersOpen
          ? "No reminders"
          : searching
            ? "No matches"
            : emptyBoardTitle(board, lost)}
      </strong>
      {remindersOpen
        ? "Nothing waiting. Set one in a note."
        : searching
          ? // What `searchNotes` actually does: every word typed must appear
            // in the note, and a word matches anywhere, even inside another.
            // It used to say "word beginnings", which it never was. One word
            // has no fewer to try, so it is told the other thing that helps:
            // a shorter form matches inside more words (review UX-27).
            // Unless the note is somewhere search did not look (UX-1): then
            // that is the answer, and the offers below are the way there.
            missedSaid ??
            // A "Did you mean" offer is the advice; the generic hint does not
            // stand beside it.
            (missed.didYouMean
            ? null
            : searchQuoted
            ? "Words in quotes must stand together in a note, in that order."
            : searchWords === 1
            ? "Try a shorter form of the word."
            : "Try fewer words. A note has to contain every word you type.")
          : // The public demo's build adds a sentence and its sample notes to
            // the fresh Inbox (`demo/SampleOffer.tsx`). `DEMO` is a literal, so
            // in every other build this folds to the line below and nothing of
            // the demo is left in the bundle.
            DEMO
            ? <DemoEmptyWords hint={hint} fresh={freshArchive && board.kind === "inbox"} />
            : hint}
      {/* The way to the board a list or a bare link went to (review UX-B-02):
          the hint above names it, and this is the same sentence's other half,
          drawn as the empty Inbox's other offers are. */}
      {searching && !remindersOpen && missed.didYouMean && onSearchWord && (
        <button type="button" className="empty-offer" onClick={() => onSearchWord(missed.didYouMean!)}>
          <IconSearch />
          Did you mean {missed.didYouMean}?
        </button>
      )}
      {missedSaid && missed.outside > 0 && missed.scope && onSearchEverywhere && (
        <button type="button" className="empty-offer" onClick={onSearchEverywhere}>
          <BoardIcon kind="recent" />
          Search everything
        </button>
      )}
      {missedSaid && missed.inTrash > 0 && onGoToTrash && (
        <button type="button" className="empty-offer" onClick={onGoToTrash}>
          <BoardIcon kind="trash" />
          Go to Trash
        </button>
      )}
      {goTo && waiting.todos > 0 && (
        <button type="button" className="empty-offer" onClick={() => goTo("todos")}>
          <BoardIcon kind="todos" />
          Go to Todos
        </button>
      )}
      {goTo && waiting.links > 0 && (
        <button type="button" className="empty-offer" onClick={() => goTo("links")}>
          <BoardIcon kind="links" />
          Go to Links
        </button>
      )}
      {/* The one offer an empty board makes, and only here: an Inbox with
          nothing ever written in it, which is exactly the screen somebody
          arriving from Keep with years of notes lands on. It is the menu's
          own row said once more, under the same name and with the same mark —
          an action keeps its name everywhere it is offered — below the words
          rather than instead of them. The first note written, or imported,
          takes it away for good, so it cannot become a nag: there is no
          dismissing it because there is nothing to dismiss.

          It was set in the machine face, muted caps in a hairline box, and
          the owner found it cheap (2026-09-29). It is not the machine
          speaking: it is the other half of the sentence above it — "write in
          the bar below, or bring your notes with you" — so it is now said in
          that sentence's own face. It stays the quieter of the two offers
          where the demo adds one (`.empty-offer-first`): writing is the way
          in, and importing is the way in for somebody who already has notes. */}
      {offerKeep && (
        <button type="button" className="empty-offer" onClick={onImportKeep}>
          <IconImport />
          Import from Google Keep
        </button>
      )}
      {/* The demo says where the notes are once, under the offers — as the
          desktop header does — rather than as a second sentence in the first
          line (review GD-10), and as a sentence of advice, not a machine
          string (review UI-18). Folded away in every
          other build. */}
      {DEMO ? (
        freshArchive && onTheBoard ? <span className="empty-stamp advice">Your notes stay in this browser</span> : null
      ) : null}
    </p>
    )
  );
}
