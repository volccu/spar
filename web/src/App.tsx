import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BOARD_NAME_MAX,
  boardViewKey,
  buildBoards,
  canKeepOnLinks,
  canMoveBoard,
  canScopeSearch,
  countForBoard,
  filePatch,
  folderIds,
  homeBoard,
  INBOX_ALL,
  INBOX_ASK_MIN,
  INSPIRATION_MARK,
  INSPIRATION_NAME,
  isBuiltIn,
  isFilable,
  isFiled,
  isTodoNote,
  keepsScreenOn,
  keptOnLinks,
  linksPatch,
  matchesBoard,
  neverFiledCount,
  notesForBoard,
  orderedBoards,
  placesOf,
  shelfRun,
  shouldAdoptInspiration,
  TRASH_BOARD,
  waitingElsewhere,
} from "./lib/boards";
import { useWakeLock } from "./lib/useWakeLock";
import { boardTint, tintOf } from "./lib/boardLook";
import { closeToSweep, sortTrash, TRASH_DAYS, TRASH_WARN_DAYS } from "./lib/trash";
import { didYouMean, hasPhrase, searchNotes, searchTerms, trashMatches } from "./lib/search";
import { useReturnSpot } from "./lib/useReturnSpot";
import { useNotes } from "./store/useNotes";
import { useCanvases } from "./store/useCanvases";
import { useBoards } from "./store/useBoards";
import { useRecentSearches } from "./store/useRecentSearches";
import { usePdfTexts } from "./store/pdfText";
import { useImageTexts } from "./store/imageText";
import { useLinkUnfurl } from "./store/useLinkUnfurl";
import { deleteAccount, useAuth } from "./store/useAuth";
import { useSync } from "./store/useSync";
import { disablePush } from "./store/push";
import { useReminders } from "./store/useReminders";
import { useUndo, type Undo } from "./store/useUndo";
import { useKeyboardUndo } from "./lib/useKeyboardUndo";
import { useMoveKey } from "./lib/useMoveKey";
import { useAccount } from "./store/useAccount";
import { hasStoredSession } from "./store/session";
import { RUNTIME_CONFIG } from "./store/backend/config";
import { DEMO, loadSamples, offerSampleStore } from "./lib/demo";
import { syncFailedMessage, syncWords } from "./lib/serverWords";
import { purgeEverything, unsentWorkCount } from "./store/db";
import { useDialogs } from "./store/useDialogs";
import { useCardMetrics } from "./lib/useCardMetrics";
import { useGridContents } from "./lib/useGridContents";
import { useHeldMove } from "./lib/useHeldMove";
import { useFirstDeal, useGridReflow, type Leaving } from "./lib/useGridReflow";
import { focusSlot, inReadingOrder, useGridKeyboard } from "./lib/useGridKeyboard";
import {
  animates,
  CLOSE_MS,
  ENTER,
  EXIT,
  OPEN_MS,
  stopAnimations,
  TRACE_MS,
} from "./lib/motion";
import { CarryTag } from "./components/CarryTag";
import { markFor, Vanish, type Ghost, type Mark } from "./components/Vanish";
import {
  IconBoards,
  IconClear,
  IconPlus,
  IconReminder,
  IconSearch,
  IconSettings,
  IconStepBack,
  IconStepOn,
} from "./components/Icons";
import { NO_TERMS, NoteCard } from "./components/NoteCard";
/**
 * The idea canvas is split out of the startup bundle.
 *
 * It is the app's largest component and it pulls `lib/canvas.ts` in behind
 * it, none of which is on the 90% path — open, scan, capture, edit, find. The
 * PDF viewer set this precedent (`lib/pdf.ts`), with one deliberate difference:
 * that chunk is *excluded* from precaching because it is half a megabyte, while
 * this one stays precached. The store is local-first, so opening an idea with
 * no connection has to keep working; splitting it is about what the browser has
 * to parse and execute on every start, not about what it downloads once.
 */
const CanvasSheet = lazy(() =>
  import("./components/CanvasSheet").then((m) => ({ default: m.CanvasSheet })),
);

/**
 * Two more layers that are never on the first paint, split out for the same
 * reason the canvas is: what the browser has to parse before it can draw the
 * grid. Filing a pile and ticking a pile are both deliberate detours — nobody
 * opens the app to do either — and each already animates its own way in, so
 * there is no fallback to draw.
 *
 * **Why these two and not the picture viewer**, which is the same shape and
 * stays eager on purpose (`NoteView.tsx` says so at its import): `Lightbox`
 * registers its own close *upward*, so Back reaches past the note to the
 * picture, and behind a lazy boundary there is a window where the picture is
 * open in state and not yet mounted — a Back in that window dismisses the note
 * instead. These two register nothing: Back reads the layer table, which holds
 * `sorting` and `ticker` as this file's own state, so it closes them whether
 * or not their code has arrived yet.
 *
 * **And why not `BoardLook`**, which is the same kind of detour: its module
 * also exports `boardGlyph` and `useBoardIcons`, and the strip and the shelf
 * both draw a folder's mark on the first paint, so the file is in the entry
 * chunk whatever its sheet does. Splitting those two out is what would let it
 * follow, and it has not been done.
 */
const Sorter = lazy(() => import("./components/Sorter").then((m) => ({ default: m.Sorter })));
const Ticker = lazy(() => import("./components/Ticker").then((m) => ({ default: m.Ticker })));
// The colophon and the export behind it: opened a handful of times in the life
// of the app, so neither the page nor the zip writer rides on the first paint.
const About = lazy(() => import("./components/About").then((m) => ({ default: m.About })));
// Settings (2026-10-11, owner approved), lazy for the same reason: the export,
// the speed report and its own marks ride in with it, never on the first paint.
const Settings = lazy(() => import("./components/Settings").then((m) => ({ default: m.Settings })));
// The Inspiration wall and the faces of its tiles: only the one board draws
// them, so neither rides on the first paint. The wall asks for the tile chunk
// with its own, so by the time a tile mounts it is already in memory (`NoteCard`
// reaches the same module); like every other chunk both are precached, and the
// board opens offline.
// The wall's viewer is reached the same way and for the same reason: nobody is
// in it at first paint, and `Lightbox` is already in the note sheet's chunk.
const WallViewer = lazy(() =>
  import("./components/WallViewer").then((m) => ({ default: m.WallViewer })),
);
const Wall = lazy(() =>
  Promise.all([import("./components/Wall"), import("./components/WallTile")]).then(([m]) => ({
    default: m.Wall,
  })),
);
// The Keep import, and the zip reader and Keep parser behind it: used once or
// twice in the life of an archive, so none of it rides on the first paint.
const KeepImport = lazy(() =>
  import("./components/KeepImport").then((m) => ({ default: m.KeepImport })),
);
// Its other half: a spår download, read back in (audit DATA-4 / UX-3). Same
// layer, same reason to stay off the first paint.
const SparImport = lazy(() =>
  import("./components/SparImport").then((m) => ({ default: m.SparImport })),
);
// The spår server's sign-in form. Only a build that reads `/config.json` can
// be pointed at a spår server at all, so every other build carries none of it:
// the literal `false` there drops the import along with the chunk.
const PasswordSignIn = RUNTIME_CONFIG
  ? lazy(() => import("./components/PasswordSignIn").then((m) => ({ default: m.PasswordSignIn })))
  : null;
/**
 * The open note, and everything only it reaches — the editor, the insert panel,
 * the reminder panel, read-aloud and the picture viewer (which stays *inside*
 * this chunk, statically imported by `NoteView`, for the Back reason given
 * above). It was the largest thing on the entry chunk and is on no first paint:
 * the board is. It is asked for as soon as the browser is idle after the first
 * paint (`prefetchNoteView`, below), so by the time a card is tapped the module
 * is already in memory and the sheet opens exactly as it did — and like every
 * other chunk it is precached, so it opens offline.
 */
const loadNoteView = () => import("./components/NoteView");
const NoteView = lazy(() => loadNoteView().then((m) => ({ default: m.NoteView })));
function prefetchNoteView(): () => void {
  const run = () => void loadNoteView().catch(() => {
    /* offline and not yet cached: the tap that opens a note asks again */
  });
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 200);
  return () => window.clearTimeout(id);
}
// The menu, the selection's verbs and a board's own menu: drawn only after a
// gesture, so off the first paint and fetched at idle (`components/lazyPanels`).
import { BoardMenu, MenuPanel, prefetchPanels, SelectionBar } from "./components/lazyPanels";
// Reached only when a different account signs in over unsent work — never on
// the first paint of an ordinary open, so it stays off the entry chunk.
const HeldWork = lazy(() =>
  import("./components/HeldWork").then((m) => ({ default: m.HeldWork })),
);
// The questions the app stops to ask, fetched the first time one is asked: no
// ordinary open asks anything, so the first paint carries none of them (the
// entry-chunk ceiling in `buildInvariants.test.ts`; audit 2026-10-10, SEC-2).
const Overlays = lazy(() =>
  import("./components/Overlays").then((m) => ({ default: m.Overlays })),
);
import { CaptureBar } from "./components/CaptureBar";
import { Spinner } from "./components/Spinner";
import { StorageBanners } from "./components/StorageBanners";
import { SearchSuggest } from "./components/SearchSuggest";
import { Mascot } from "./components/Mascot";
import { ModeCreature } from "./components/ModeCreature";
import { UndoOffer } from "./components/UndoOffer";
import { EmptyBoard } from "./components/EmptyBoard";
import { timeToFrame } from "./lib/speed";
import { useMascotState, useSyncAnnouncement } from "./lib/mascotState";
import { useServerAnswered } from "./lib/serverAnswered";
import { SignIn } from "./components/SignIn";
import { Stopped } from "./components/ErrorBoundary";
import type { Note } from "./types";
import { canvasSnapshot, createSnapshotCache, isCanvasIdea, SKETCH_SEED } from "./lib/canvas";
import { withPreviewsHidden } from "./lib/links";
import { BoardIcon, BoardLook, useBoardIcons } from "./components/BoardLook";
import { NewBoardName } from "./components/NewBoardName";
import { Shelf } from "./components/Shelf";
// Only a phone's carry ever draws it, so it stays off the first paint.
const ShelfDrop = lazy(() => import("./components/ShelfDrop").then((m) => ({ default: m.ShelfDrop })));
import { Count } from "./components/Count";
import { HeaderWords } from "./components/HeaderWords";
import { reminderReceipt, useSpeech } from "./lib/useSpeech";
import { createWithUndo } from "./lib/madeBoardUndo";
import { useMascotMoments } from "./lib/useMascotMoments";
import { emptiedTrash } from "./lib/mascotMoments";
import { headerWords } from "./lib/headerWords";
import { useIsPhone, useIsShort } from "./lib/breakpoint";
import { useSetting } from "./lib/settings";
import { useReachable } from "./lib/useOnline";
import { useCapture } from "./lib/useCapture";
import { useSorterVerbs } from "./lib/useSorterVerbs";
import { movedWords, putBackWords } from "./lib/movedWords";
import { leftToBack, useModePiles } from "./lib/useModePiles";
import { useStripOverflow } from "./lib/useStripOverflow";
import { useIdeaVerbs } from "./lib/useIdeaVerbs";
import { coveredAbove, useLayerStack, type OpenLayers } from "./lib/useLayerStack";
import { useSelectionVerbs } from "./lib/useSelectionVerbs";
import { useFolderVerbs } from "./lib/useFolderVerbs";
import { cardSlot, handFocusToCard, useFocusHandBack } from "./lib/useFocusHandBack";
import { useLandedLine } from "./lib/useLandedLine";
import { takeLaunchIntent, takeLaunchText } from "./lib/launch";
import { useBoardPaging } from "./lib/useBoardPaging";
import { useBoardScroll } from "./lib/useBoardScroll";
import { useMergeDrag } from "./lib/useMergeDrag";
import { useFollowSeat } from "./lib/useFollowSeat";
import { useBoardPress } from "./lib/useBoardPress";
import { notesWithReminders } from "./lib/reminders";
import {
  CAPTURE_KEY,
  HELP_KEY,
  hotkeyTitle,
  SEARCH_KEY,
  SELECT_ALL_KEY,
  SETTINGS_KEY,
  useHasKeyboard,
  isTypingTarget,
} from "./lib/hotkeys";
import { nowIso } from "./lib/when";
import { viewerEntries } from "./lib/wall";
import { useAppUpdate } from "./lib/useAppUpdate";
import { showInboxBadge } from "./lib/appBadge";
import { Hotkey } from "./components/Hotkey";

/** A selection with one note picked, or unpicked if it already was. */
function toggled(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/**
 * How long signing out waits for this browser's push subscription to be let
 * go before it signs out anyway.
 *
 * The row is removed through the session that is about to end, so it has to go
 * first — and a server that does not answer must not be able to hold the
 * sign-out hostage to a courtesy. Three seconds is past an ordinary round trip
 * on a phone and short enough that the menu still reads as having done
 * something.
 */
const PUSH_RELEASE_MS = 3_000;

/**
 * How many characters of a board's name the desktop strip shows before the
 * ellipsis (`.board-tab-name`'s `max-width: 16ch`), so only a cut name carries
 * the whole of itself as a hover title.
 */
const TAB_NAME_FITS = 16;

export default function App() {
  const {
    notes,
    loading,
    localVersion,
    applyRemote,
    applyUploaded,
    create,
    createWithFiles,
    importNotes,
    attachTo,
    detach,
    editBody,
    editBodyIfBase,
    update,
    setStatus,
    togglePriority,
    bulkUpdate,
    merge,
    destroy,
    storageError,
    loadFailed,
    retryStorage,
  } = useNotes();
  const {
    folders,
    canvasVersion,
    storageError: canvasStorageError,
    retryStorage: retryCanvasStorage,
    applyRemoteCanvases,
    ensureForIdea,
    importCanvases,
    moveItem,
    itemAt,
    removeItem,
    restoreItem,
    addStroke,
    removeStroke,
    restoreStrokes,
    resizeItem,
    setImageWidth,
    addText,
    editText,
    removeText,
  } = useCanvases();
  // The user's own folder boards — real boards, not saved filters (SPEC §6).
  // A note is filed into one directly, from the Move mark or the Move panel.
  const {
    boards: userBoards,
    storedBoards,
    nameOf,
    inspiration,
    adoptInspiration,
    shelfOrder,
    hideBoard,
    inboxSince,
    setInboxSince,
    prefsReady,
    storageError: boardsStorageError,
    retryStorage: retryBoardsStorage,
    createBoard,
    editBoards,
    renameBoard,
    removeBoard,
    restoreBoard,
    placeBoard,
    setBoardLook,
    setBoardAwake,
    boardsAt,
    boardsDirty,
    sinceDirty,
    boardsVersion,
    applyRemoteBoards,
    applyMergedBoards,
    yieldInboxSince,
    boardsBase,
    clearBoardsDirty,
  } = useBoards();
  const {
    session,
    ready,
    sent,
    error,
    busy: signingIn,
    signIn,
    verifyCode,
    signOut,
    resetSent,
    syncConfigured,
    method,
    signup,
    signInWithPassword,
    signUp,
  } = useAuth();
  const { recentSearches, rememberSearch } = useRecentSearches();
  // Who this browser's notes belong to, whether sync may start, and whether
  // the device is on its way to somebody else — store/useAccount.ts.
  const {
    deviceOnly,
    ownerReady,
    ownerError,
    held,
    clearAnyway,
    stayOnThisDevice,
    offerSignIn: leaveDeviceOnly,
  } =
    useAccount(session?.user?.id ?? null);
  // Whether a file kept here has anywhere to go: a server, signed in to, from
  // a device that syncs. Without one the "sending" mark has nothing to send
  // to and must not be drawn (review UI-05).
  const sendsFiles = syncConfigured && Boolean(session) && !deviceOnly;
  // A session that ended on a device that holds notes keeps the board, with one
  // line saying so, instead of the sign-in wall (review QA-06): the wall made
  // the notes and any unsent work look gone. The line's button asks for the
  // wall; a device with nothing on it still opens onto the wall.
  const signedOut = syncConfigured && ready && !session && !deviceOnly;
  const holdsNotes = !loading && notes.length > 0;
  const [signInAsked, setSignInAsked] = useState(false);
  // Settings' Sign in and the "this device only" link open the sign-in screen
  // in one tap, not the banner that asks for a second.
  const offerSignIn = () => {
    leaveDeviceOnly();
    setSignInAsked(true);
  };
  // A sign-in that went through spends the ask, so a session that lapses later
  // gets the banner, not the whole screen.
  if (session && signInAsked) setSignInAsked(false);
  const [unsentHere, setUnsentHere] = useState(0);
  useEffect(() => {
    if (!signedOut || !holdsNotes) return;
    let live = true;
    unsentWorkCount().then(
      (n) => live && setUnsentHere(n),
      (error: unknown) => console.error("could not count unsent work", error),
    );
    return () => {
      live = false;
    };
  }, [signedOut, holdsNotes, notes]);

  // The note that is open, if any. Declared here, above the sync loop,
  // because the loop waits longer between uploads while one is being typed
  // into (`typing` below).
  const [openId, setOpenId] = useState<string | null>(null);
  const {
    state: syncState,
    busy: syncBusy,
    lastError: syncError,
    syncedAt,
    syncNow,
    held: heldNotes,
    retryHeld,
    keepHeldLocal,
    pulledOnce,
  } = useSync({
    // Not before the local read is in: a tick started against an empty
    // `notes` pushed nothing and pulled against nothing, a round trip racing
    // the archive to the screen for no reason.
    //
    // `prefsReady` for the same reason one step further out. `useBoards` keeps
    // its "there is an unsent change here" flags in IndexedDB and reads them on
    // mount; until that read lands both flags are false, and `applyRemote`'s
    // guard — which exists precisely to stop the server's folder list
    // overwriting a local one that has not gone up yet — reads them. A tick
    // whose prefs pull landed first would apply the server's list over a
    // folder made in the previous session, and write it to disk. It has always
    // been improbable (this gate already waits on two other reads and a
    // network round trip) and it costs nothing to make impossible.
    enabled: Boolean(session) && ownerReady && !loading && prefsReady,
    typing: openId !== null,
    notes,
    applyRemote,
    applyUploaded,
    localVersion,
    canvas: { folders, version: canvasVersion, applyRemote: applyRemoteCanvases },
    prefs: {
      // The list as stored, lens order and all — sync carries the row whole.
      boards: storedBoards,
      inboxSince,
      at: boardsAt,
      dirty: boardsDirty,
      sinceDirty,
      version: boardsVersion,
      applyRemote: applyRemoteBoards,
      base: boardsBase,
      applyMerged: applyMergedBoards,
      yieldSince: yieldInboxSince,
      clearDirty: clearBoardsDirty,
    },
  });
  const online = useReachable(syncState);
  // Three stores, one banner: a note, a canvas or the folder list that is on
  // screen and not yet on disk is the same fact whichever store refused it,
  // and Try again asks all three.
  const unsaved = storageError ?? canvasStorageError ?? boardsStorageError;
  const retryUnsaved = () =>
    void Promise.all([retryStorage(), retryCanvasStorage(), retryBoardsStorage()]);

  // The creature in the header, and the words that do its talking. Both
  // mascots read the same resolver; only the board's one may ever be `empty`.
  // A tick retrying a failure is not drawn as a walk: the failure stands until
  // a tick comes round clean (review CD-01, `useSync`).
  const headerMood = useMascotState({ busy: syncBusy && syncState !== "error", online });
  const announcement = useSyncAnnouncement(headerMood, syncState === "error", sendsFiles);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * Search asked to look only in the board it was opened on (`canScopeSearch`
   * says which boards offer it). Off every time search opens: "everything" is
   * what search means, and a scope left on from last time would be a search
   * that silently misses notes.
   */
  const [searchScoped, setSearchScoped] = useState(false);
  /**
   * The Reminders mode: every note carrying a `reminder_at`, in the grid, as
   * a timeline.
   *
   * **It is search's shape, deliberately, and it is not a board.** A reminder
   * is a *time*, and a time is not a place a note lives — one more row on the
   * shelf would blur what the shelf says (the user's places, one hairline,
   * the app's own boards). So this is a
   * mode: it is reached from the menu, it borrows the grid and the board row
   * for as long as it runs, it leaves the board underneath exactly where it
   * was, and it gives both back when it closes. Everything that follows —
   * `visible`, the header count, the frozen paging, the board row's slot, what
   * a capture says for itself — is the same clause search already has, said
   * once more beside it.
   *
   * It is deliberately **not** in `coveredOtherThanSearch` and not in
   * `gridCovered`: like search, it does not cover the grid, it changes what
   * the grid holds. The arrows still walk the cards and Ctrl+A still takes
   * what is on screen, which here is the reminders. Unlike search it puts no
   * caret anywhere, so there is not even the field's reason to stand down.
   */
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The About page (`components/About.tsx`), a layer over everything. */
  const [aboutOpen, setAboutOpen] = useState(false);
  // Where the About page opens: at the top from the menu, at its list of
  // keys from `?`.
  const [aboutAt, setAboutAt] = useState<"top" | "keys">("top");
  /** Settings (`components/Settings.tsx`), a layer of About's kind, from the
   *  menu's first row or Ctrl/Cmd+comma. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The Keep import (`components/KeepImport.tsx`), a layer of About's kind,
   *  from the menu or the empty Inbox of an archive nothing was written in. */
  const [keepOpen, setKeepOpen] = useState(false);
  /** Which import the layer holds: Google Keep's, or a spår download's. */
  const [importFrom, setImportFrom] = useState<"keep" | "spar">("keep");
  // About, Settings and the imports each take a button to hand the focus back
  // to, and none is named: they open from a menu row, a key or the header's
  // cog, so the focus goes back to whatever had it (`useRestoreFocus`'s
  // fallback). One ref that stays empty, rather than one each that nothing
  // ever filled.
  const noOpener = useRef<HTMLButtonElement | null>(null);
  // Settings is the exception: it always goes back to its cog, a key opened it
  // or not (the card a key started from is `inert` when the layer leaves).
  const cogBtn = useRef<HTMLButtonElement | null>(null);
  // The open note's module, fetched once the board has painted (see
  // `loadNoteView`). Never before: it would compete with the first paint.
  useEffect(() => {
    if (loading) return;
    const note = prefetchNoteView();
    const panels = prefetchPanels();
    return () => {
      note();
      panels();
    };
  }, [loading]);
  // A newer build waiting for the word, and the way to take it
  // (lib/useAppUpdate.ts) — the header's Update button.
  const { updateReady, applyUpdate } = useAppUpdate();
  // Which side the open note arrived from, so a note reached by swiping
  // travels in on the same gesture that sent the last one away — see
  // NoteView's enterFrom. Everything that opens a note for another reason
  // resets it to 0, the grow-out-of-a-card motion.
  const [enterFrom, setEnterFrom] = useState<-1 | 0 | 1>(0);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  // Where the note came from, and whether it is on its way back there. The
  // layer stays mounted through `closing` so the shrink has something to run
  // on; NoteView calls onClosed when the animation is actually over.
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  // Whether the board changed under the open note since it opened: NoteView's `closesElsewhere`.
  const [closesElsewhere, setClosesElsewhere] = useState(false);
  const [closing, setClosing] = useState(false);
  /**
   * Open a note by its id — the four setters every way in sets together.
   *
   * `from` is the card it grows out of, or null for no card (a tapped
   * reminder, a reopened spot, a note beside the last one); `enter` is the
   * side it travels in from, 0 for the grow-out-of-a-card motion. `closing` is
   * cleared every time: it stays true until NoteView reports back, so a note
   * opened while the last one was mid-close would otherwise mount with the
   * exit already asked for, and close itself on the spot. One place, because
   * the copies of this block were five and one of them had lost that setter.
   * All four are state setters, so this never changes.
   */
  const openById = useCallback(
    (id: string, from: DOMRect | null = null, enter: -1 | 0 | 1 = 0) => {
      setOrigin(from);
      setClosing(false);
      setEnterFrom(enter);
      setOpenId(id);
    },
    [],
  );
  const [selected, setSelected] = useState<string[]>([]);
  // The Move chooser: a second face the selection panel wears, not a second
  // panel. It lives here rather than as local state inside SelectionBar
  // because Back has to be able to step out of it before it steps out of the
  // selection — see the layer table below (`lib/useLayerStack.ts`).
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  // Leaving the selection — by any path — leaves the chooser with it. It
  // would otherwise still be showing itself the next time something gets
  // selected, in whatever state a previous move session left in it.
  // (Reads `selected.length` rather than the `selecting` const below, which
  // is declared later in this component and would not yet be in scope here.)
  // The panel goes with it too: it is the menu's face for a selection, and
  // with nothing picked the same `menuOpen` would put the ordinary menu on
  // screen instead — a different panel appearing where a verb was just
  // tapped. Every verb closes it explicitly before acting (below, `then`);
  // this catches the paths that end a selection from elsewhere — Escape, the
  // Delete key, Back.
  useEffect(() => {
    if (selected.length === 0) {
      setMoving(false);
      setMoveError(null);
      setMenuOpen(false);
    }
  }, [selected]);
  const moveKey = useMoveKey({ selected, setSelected, setMoving, setMoveError, setMenuOpen });
  // The board tab's own long-press/right-click menu — Rename or Delete —
  // and whether it has swapped into the rename field. Mirrors `moving`
  // above: state lives here so Back can step out of it before the menu.
  const [boardMenu, setBoardMenu] = useState<{
    id: string;
    name: string;
    /** Under the strip tab it came from, on a desktop (review UI-15). */
    anchor?: { left: number; top: number };
  } | null>(null);
  /** Which folder is being dressed, by id. Null when the sheet is shut. */
  const [boardLookId, setBoardLookId] = useState<string | null>(null);
  const [boardRenaming, setBoardRenaming] = useState(false);
  // The "+" tab's own new-board field, open or not.
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  // The shelf of boards standing up as a drawer, which is what it is on a
  // phone (components/Shelf.tsx). Never open on a desktop, where the strip
  // shows the whole shelf at once and there is nothing to reveal.
  const [shelfOpen, setShelfOpen] = useState(false);

  /**
   * The Sorter: the Inbox, one note at a time, with the folders under your
   * thumb (`components/Sorter.tsx`).
   *
   * The pile is a snapshot of ids taken when it opens, not a live read of the
   * Inbox — a note filed away leaves the board immediately, and a pile that
   * shrank under you would renumber "3 of 12" on every tap and slide the next
   * note into the slot you were still looking at. Skipped notes are simply left
   * alone, so they come round again next time; there is no skipped-forever
   * state.
   */
  const [sortingIds, setSortingIds] = useState<string[] | null>(null);
  /** The notes the last Tidy up run left where they were — this session only,
   *  never stored (review 2026-10-04, FX-B-02). */
  const leftLastRun = useRef<ReadonlySet<string>>(new Set());
  const [sorterOrigin, setSorterOrigin] = useState<DOMRect | null>(null);
  const sorting = sortingIds !== null;

  /**
   * The Ticker: the Todos board, one list at a time, with every box a button
   * (`components/Ticker.tsx`).
   *
   * The Sorter's arrangement exactly — a snapshot of ids rather than a live
   * read, so a list that empties under you does not renumber "3 of 12" and
   * slide the next one into the slot you were still looking at.
   */
  const [tickingIds, setTickingIds] = useState<string[] | null>(null);
  const [tickerOrigin, setTickerOrigin] = useState<DOMRect | null>(null);
  const ticker = tickingIds !== null;

  // Undo has to read the notes as they are at the moment it runs, not as they
  // were when its listener was registered. Same reason for the stack and for
  // the reversal itself: the Ctrl+Z listener is registered once, and would
  // otherwise close over the first render's copy of both, forever.
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Whether this device rings, a tapped notification opening its note, the
  // open note's reminder writes, and the shade's Later and Done
  // (store/useReminders.ts).
  const {
    pushStatus,
    setPushStatus,
    handleSetReminder,
    handleSetRepeat,
    enableRing,
    disableRing,
    askToRing,
  } = useReminders({
    update,
    notesRef,
    loading,
    syncConfigured,
    deviceOnly,
    pulledOnce,
    onOpen: openById,
  });
  // The stack itself lives in store/useUndo.ts; what stays here is only what a
  // reversal should *look* like, which is the board's business and not the
  // stack's. Wired up further down, once `update` and `leaveMark` exist.
  // Cards on their way out: a still of each one, pinned where it stood.
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  // The card that was just written or just closed, which draws its own border
  // once so you can see where the thing you were holding ended up.
  const [traceId, setTraceId] = useState<string | null>(null);
  // The questions the app stops to ask, and the order they dismiss in —
  // store/useDialogs.ts. What each answer *does* stays here.
  const {
    fileNotice,
    destroyRequest,
    dissolveRequest,
    deleteBoardRequest,
    dialogOpen,
    showFileNotice,
    closeFileNotice,
    askToDestroy,
    closeDestroy,
    askToDissolve,
    closeDissolve,
    askToDeleteBoard,
    closeDeleteBoard,
    backlogRequest,
    askAboutBacklog,
    closeBacklog,
    signOutQuestion,
    askAboutSignOut,
    closeSignOut,
    dismissTopDialog,
  } = useDialogs();
  // The sign-out question belongs to a signed-out device; a session that comes
  // back (signed in again, another tab) takes it away unanswered.
  // Keyed on who is signed in, not on `signedOut`: the question is asked the
  // moment the sign-out answers, which can be before the session has gone.
  const signedInAs = session?.user?.id ?? null;
  useEffect(() => {
    if (signedInAs) closeSignOut();
  }, [signedInAs, closeSignOut]);
  /**
   * Where the notes leaving the board are going, set by the action that is
   * about to move them and spent by `onLeave` the moment it draws them.
   *
   * Null is the resting state and means "nobody asked for this", which is a
   * real answer rather than a missing one: the grid can lose cards to a board
   * definition settling or a pull from the other device, and neither is
   * something this screen should report as though you had just done it.
   */
  const leaveMark = useRef<Mark | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  /** The write box, so the capture shortcut can put the caret in it. */
  const captureField = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);

  const [grid, setGrid] = useState<HTMLElement | null>(null);
  const boardTabs = useRef<Array<HTMLButtonElement | null>>([]);
  /** The board row's burger — the phone's whole left side, the desktop's first
   *  mark — so closing the drawer hands the focus back to it. */
  const shelfMark = useRef<HTMLButtonElement | null>(null);
  /** The open note's own burger, which opens the same drawer over the note. */
  const noteShelfMark = useRef<HTMLButtonElement | null>(null);
  /**
   * Where the drawer hands the focus back: whichever burger is still on
   * screen, the note's first. One stable object, read at the moment the drawer
   * shuts — never a ref swapped between renders, because `useRestoreFocus`
   * restores whenever the ref it was given changes, and swapping from the
   * note's burger to the board row's as the note closed would move the focus
   * while the drawer was still sliding out.
   */
  const shelfReturn = useMemo<React.RefObject<HTMLButtonElement | null>>(
    () => ({
      get current() {
        const inNote = noteShelfMark.current;
        return inNote?.isConnected ? inNote : shelfMark.current;
      },
    }),
    [],
  );
  // Which shape the board shelf takes. A strip and a drawer are two different
  // structures rather than one laid out twice, so the branch is made in JS —
  // rendering both and hiding one would put two sets of tabs, and two elements
  // carrying each `board-tab-*` id, into the accessibility tree at once.
  const isPhone = useIsPhone();
  /**
   * Where the phone's board row stands: the top, as ever, or at the foot on
   * the capture bar, for the thumb (Settings' `boardRow`, 2026-10-11, owner
   * approved). A desktop's strip is always at the top, and so is a short
   * screen's row, which carries the folded header's creature in its left
   * cell (`@media (max-height: 500px)`).
   */
  const boardRowAt = useSetting("boardRow");
  const isShort = useIsShort();
  const rowAtFoot = isPhone && !isShort && boardRowAt === "bottom";
  /**
   * The write field holds the caret — on a phone, the keyboard is up. Read
   * from focus events on the document rather than from the bar, because the
   * one thing it decides is whether the row at the foot stands down, and the
   * row is App's. Only the field itself counts: a tap on Attach or Menu takes
   * the focus too, and the row must not vanish as the menu opens.
   */
  const [writing, setWriting] = useState(false);
  useEffect(() => {
    if (!rowAtFoot) {
      setWriting(false);
      return;
    }
    const field = () => captureField.current;
    setWriting(Boolean(field()) && document.activeElement === field());
    const onIn = (e: FocusEvent) => setWriting(e.target === field());
    const onOut = (e: FocusEvent) => {
      if (e.target === field()) setWriting(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [rowAtFoot]);
  /**
   * Whether there is a key to press. Asked once here for the whole board,
   * because the search field is an `<input>` and so is named by its own
   * `aria-label` and by nothing standing beside it — the drawn `.kbd` next to
   * it is `aria-hidden`, so this is the only way the shortcut reaches a reader
   * who cannot see the box. `Hotkey` asks the same predicate for itself.
   */
  const keyboard = useHasKeyboard();
  /**
   * The capture bar's burger.
   *
   * It was a ref at the mode line on the board until 2026-09-25, when that
   * line moved into the menu (the owner's ask). Two things still need to
   * point somewhere: a mode grows out of the control that opened it, and it
   * hands the focus back to that control when it closes. The menu row is
   * gone by the time either happens — it unmounts with the panel — so the
   * rect is taken from the row at the moment of the tap and passed up, and
   * the focus goes back to the burger, which is the control that is still
   * there and the one the reader actually pressed to get here.
   */
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  /** The board row's search mark, which search hands the focus back to. */
  const searchBtn = useRef<HTMLButtonElement | null>(null);
  // Where the focus goes when a mode, the open note or search closes
  // (lib/useFocusHandBack.ts).
  useFocusHandBack({ modeUp: sorting || ticker, openId, searchOpen, menuBtn, searchBtn, settingsOpen, aboutOpen, cog: cogBtn });
  // `prefsReady`, because until the folder list has been read the Inbox cannot
  // tell a folder that is gone from one it has not been told about yet — and
  // the list is empty for a render on every start (`isFiled`).
  const boards = useMemo(
    () => buildBoards(userBoards, inboxSince, prefsReady, shelfOrder, inspiration),
    [userBoards, inboxSince, prefsReady, shelfOrder, inspiration],
  );
  // A board hidden in Settings is off the shelf, and Inspiration hidden is off
  // every chooser too; its notes stay filed (`knownFolders` still names it).
  const trashHidden = shelfOrder.hidden.includes("trash");
  const shownInspiration = shelfOrder.hidden.includes("inspiration") ? null : inspiration;
  /** The folders that exist, once that is known: the set the Inbox was just
   *  handed, for everything else here that asks `isFiled`. */
  const knownFolders = useMemo(
    () => (prefsReady ? folderIds(placesOf(userBoards, inspiration)) : undefined),
    [prefsReady, userBoards, inspiration],
  );
  /**
   * The user's folders in the order the shelf draws them — the same order
   * `buildBoards` lays out, read off the one function that defines it.
   *
   * **Every list of folders the app offers reads this**, not `userBoards`: the
   * shelf, the reorder rows in `BoardMenu`, and all four board choosers (the
   * selection's Move, the Sorter's destinations, the capture bar's mark, and
   * the open note's Move). The choosers used to take the raw array, which
   * agrees with the shelf only for as long as `position` happens to equal its
   * own index — and `moveBoard` was written defensively for the day it does
   * not. It is also the order the choosers list every folder in, so on the
   * raw array the folder somebody deliberately moved to the front could
   * stand anywhere.
   *
   * Inspiration comes last, dressed with its own mark (`placesOf`): it is a
   * place a note is filed into, so every chooser lists it and none needs a
   * second path for it.
   */
  const folderOrder = useMemo(
    () => placesOf(orderedBoards(userBoards), shownInspiration),
    [userBoards, shownInspiration],
  );
  const trashIndex = boards.length;
  const searching = query.trim().length > 0;
  /**
   * The query as the *grid* sees it: handed over at low priority, so the field
   * draws each character at once and the search over the archive runs in a
   * render the next character can interrupt.
   *
   * **The first character too** (review 2026-10-04, QA-01). It used to be the
   * exception — the live query stood in while the deferred copy was empty —
   * which made the swap from board to results urgent: every card re-rendered
   * inside the keystroke, and the letter itself waited 370–530ms on a slow
   * phone before it was drawn. Now the grid keeps showing the board until the
   * results are ready (`gridSearching` is read off the deferred copy), so the
   * board never flashes empty and the field never waits. Leaving search is the
   * same in reverse: the results stay until the board is ready.
   */
  const gridQuery = useDeferredValue(query);
  /** Whether the *grid* is showing results — `searching`, a render behind. */
  const gridSearching = gridQuery.trim().length > 0;
  const selecting = selected.length > 0;

  // Moving along the shelf of boards — the deck that follows the finger, the
  // throw, and the arrival (lib/useBoardPaging.ts). Frozen while searching or
  // selecting: the gesture budget spends a horizontal swipe on paging, and it
  // cannot also mean something else (SPEC §6).
  const { boardIndex, goToBoard, stayOnBoard, deckRef, onTouchStart, onTouchMove, onTouchEnd } =
    useBoardPaging({
      lastIndex: trashIndex,
      swipeLast: trashHidden ? trashIndex - 1 : undefined,
      // The Sorter spends the horizontal swipe on its own pile, inside its own
      // screen. Frozen here so the board underneath cannot page along with it.
      // The Reminders mode freezes it for search's reason: a mode that leaves
      // its own navigation live invites you to page boards mid-mode and then
      // wonder which of the two things you are looking at.
      frozen: searching || remindersOpen || selecting || sorting || ticker,
      // On a phone the shelf is the next thing along past the first board, so
      // the swipe that walks the shelf keeps walking and opens the drawer. On a
      // desktop the strip is already on screen and there is nothing to open, so
      // no handler goes in and the near end stays a dead end.
      onPullPastStart: isPhone ? () => setShelfOpen(true) : undefined,
    });

  const inTrash = boardIndex === trashIndex;
  const board = inTrash ? TRASH_BOARD : boards[boardIndex];
  // Each board keeps its own place in the one scroller, and the tab you are
  // on takes you to the top of it (lib/useBoardScroll.ts). Owned by nobody
  // while a mode has borrowed the grid, so nothing a search scrolls is written
  // down against the board underneath it.
  const scrollOwner = gridSearching || remindersOpen ? null : board.id;
  const {
    onScroll: onBoardScroll,
    remembered,
    remember: rememberScroll,
    toTop,
  } = useBoardScroll({ scrollRef, deckRef, owner: scrollOwner });
  /**
   * A selection belongs to the board it was made on, and does not travel.
   *
   * The verbs the panel offers are the board's: on the Trash they are Restore
   * and Delete, everywhere else they are Archive, Move, Merge and the rest.
   * Carrying a selection across that boundary offered the wrong ones and they
   * worked — two notes picked in the Trash and then tapped over to the Inbox
   * could be Archived straight back out of the bin, or merged into an idea
   * that archived its sources out of it, with no card on screen inverted to
   * say what was selected.
   *
   * The guard used to be written at each place a board could change and only
   * in the direction that led into the Trash, which is three lists describing
   * one fact and missed both the way out and the ordinary tabs. It is one rule
   * here instead, keyed on the board's identity so it fires for every way the
   * board under you can change — including the one no handler is standing next
   * to, the board being deleted on the other device. `useLayoutEffect` because
   * a selection bar that survives one painted frame on the wrong board is
   * exactly the confusion this is here to prevent.
   */
  useLayoutEffect(() => {
    setSelected([]);
  }, [board.id]);
  /**
   * Nor does it outlive the mode it was made in. A note picked in a search or
   * in the Reminders list is usually not on the board underneath, and once the
   * mode closed the selection stayed with nothing inverted on screen — the
   * panel's verbs and the Delete key then acted on notes the user could not
   * see: search an archived note, pick it, ✕ ✕, Delete, and it was in the
   * trash. `visible` narrowing is answered below; this is the mode going.
   */
  const modeOpen = searchOpen || remindersOpen;
  useLayoutEffect(() => {
    if (!modeOpen) setSelected((prev) => (prev.length === 0 ? prev : []));
  }, [modeOpen]);

  // The seat follows the board you are on when the shelf changes under it,
  // not the number naming it (lib/useFollowSeat.ts).
  useFollowSeat({ boards, boardIndex, stayOnBoard });
  /**
   * The Links board draws its deck as full-width rows rather than as cards in
   * the grid — one row per note, same element, same behaviour, only the
   * geometry differs. See the block comment above `ROW_LINES` in `NoteCard`:
   * this is a property of that one board, not a view the user can switch, and
   * "no list/grid toggle" still stands.
   *
   * Searching leaves it off, and so does the Reminders mode. Both are modes
   * over every board at once, and neither one's list is the Links board
   * however many links are in it.
   */
  const rows = !gridSearching && !remindersOpen && board.kind === "links";
  /**
   * The Todos board lets a short to-do stand as a slip, a third of a card tall
   * (`SLIP_LINES` in `lib/face.ts`; owner picked mockup B, 2026-10-17). The grid
   * then counts its rows in thirds and a full card spans three of them. Off
   * while searching and in the Reminders mode, for the reason `rows` is.
   */
  const slips = !gridSearching && !remindersOpen && board.kind === "todos";
  /**
   * The Inspiration board draws a wall rather than the uniform grid — the one
   * board with a geometry of its own after Links (`web/CLAUDE.md`). Like the
   * Links rows, search and the Reminders mode leave it off: they are modes over
   * every board and their list is not the wall however many pictures it holds.
   */
  const wall = !gridSearching && !remindersOpen && board.kind === "inspiration";
  // Measured from a rendered card, so it has to be re-measured when the shape
  // on screen changes: a row's words run the width of the list, a card's run
  // the width of a column.
  const cardMetrics = useCardMetrics(grid, `${board.kind}:${rows}:${wall}`);
  /** The query names a folder you already made — offered above the results. */
  const matchedBoard = useMemo(() => {
    if (!searching) return null;
    const q = query.trim().toLowerCase();
    return folderOrder.find((b) => b.name.toLowerCase() === q)?.name ?? null;
  }, [searching, query, folderOrder]);
  /**
   * Leaving search remembers what was typed, as a chip for next time.
   * Every path that used to close the row by hand (`setSearchOpen(false)`
   * beside `setQuery("")`) goes through this instead, so there is one place
   * that decides a search was "used" rather than five that have to agree.
   */
  const closeSearch = useCallback(() => {
    // **Only a query that found something is remembered.** The row commits
    // whatever is in the field on every close, so a half-typed word abandoned
    // with Escape became a permanent chip offered back for the life of the
    // device — and a chip that found nothing the first time cannot help
    // anybody the second, by construction. `foundRef` rather than `visible`
    // because this is declared above it, and it is the same value: the search
    // is live, so what the grid is holding at the moment it closes is what
    // this query found.
    if (foundRef.current > 0) rememberSearch(query);
    setQuery("");
    setSearchOpen(false);
    setSearchScoped(false);
  }, [query, rememberSearch]);
  /** How many notes the query on screen is holding, for the line above. */
  const foundRef = useRef(0);
  /**
   * Going to stand on a board leaves whatever mode was over it.
   *
   * Search and the Reminders list are the two, they are mutually exclusive on
   * screen, and every path that lands the user on a board has to end both —
   * a tab, a drawer row, the keyboard's shelf walk, the menu's Trash row, the
   * menu's way back from "Leave them". Written once here rather than as a
   * second `setRemindersOpen(false)` beside each of the six `closeSearch()`
   * calls, which is exactly the shape that drifts.
   */
  const leaveMode = useCallback(() => {
    closeSearch();
    setRemindersOpen(false);
  }, [closeSearch]);
  /** The folder whose look is being edited, or null. Read out of `userBoards`
   *  by id rather than snapshotted, so the sheet shows what it just wrote. */
  const lookBoard = useMemo(
    () => userBoards.find((b) => b.id === boardLookId) ?? null,
    [userBoards, boardLookId],
  );
  /**
   * Whether the icon sets the folders' marks come from are here yet.
   *
   * Each set is a chunk of its own (`BoardLook.tsx`), and an archive whose
   * folders all wear the default folder never fetches a byte of either. A board
   * with a mark of its own fetches that mark's set — Lucide for anything chosen
   * now, Heroicons only while a board still wears an older mark — and the
   * shelf redraws when it lands; until then every folder draws the folder,
   * which is exactly what a board with no mark draws forever.
   */
  const iconsReady = useBoardIcons(userBoards.map((b) => b.icon));
  /**
   * The notes as the *board* sees them: the same list, handed over at low
   * priority (`useDeferredValue`).
   *
   * Every keystroke in an open note changes `notes`, and everything the board
   * derives from it — the counts along the strip, what the grid holds, the two
   * piles, the reminders, the idea miniatures — was recomputed at the same
   * urgency as the keystroke itself, for a grid that is behind a full-screen
   * sheet. Keyed on this instead, React draws the character first and does the
   * board's work in a render it may interrupt and restart when the next
   * character arrives, so a burst of typing costs the board one pass at the
   * pause rather than one per letter. The open note, the selection and
   * everything else that turns an id back into a note still read `notes`
   * (`noteById`) — they are what the person is looking at.
   *
   * **Only while a note is open.** A deferred value starts out as the value it
   * had before, so on the first paint it would hand the board an empty archive
   * for a frame — an empty board flashed, and anything that *decides* from a
   * count (the first-open question, `neverFiled` below) would decide on
   * nothing. With the sheet closed the board is what is on screen and takes
   * `notes` directly; opening a note switches over at a moment the two agree.
   */
  const deferredNotes = useDeferredValue(notes);
  const gridNotes = openId ? deferredNotes : notes;

  /** How much is in each board — one pass over the notes, shared by the strip,
   *  the drawer and the header row. */
  const counts = useMemo(
    // `countForBoard`, never `notesForBoard(...).length`: this asks every
    // board how much it holds on every note change — every keystroke in an
    // open note included — and sorting each answer in order to read its length
    // off it was 6.8ms of that on a 401-note archive, against 0.32ms for the
    // filter alone. See the note on `countForBoard`.
    () => boards.map((b) => countForBoard(gridNotes, b)),
    [gridNotes, boards],
  );
  // The Inbox's count on the app's icon, where the platform draws one
  // (`lib/appBadge.ts`, review PL-12). `counts[0]` is the Inbox tab's own
  // number, so the two cannot disagree; zero clears it.
  const inboxCount = counts[0] ?? 0;
  useEffect(() => showInboxBadge(inboxCount), [inboxCount]);
  // Trash hangs off the end of the shelf rather than inside `boards`, so it
  // counts separately — see TRASH_BOARD.
  const trashCount = useMemo(
    () => gridNotes.reduce((n, note) => (note.status === "trashed" ? n + 1 : n), 0),
    [gridNotes],
  );
  // The one warning the month-long sweep gets — every other destructive path
  // in the app carries an undo strip, a confirm dialog or a Vanish mark, and
  // the sweep runs silently on open with none of them. A standing fact at the
  // top of the Trash board, not a toast: this is not an offer with a
  // countdown, it is what is about to happen regardless.
  const trashWarnCount = useMemo(() => closeToSweep(gridNotes).length, [gridNotes]);

  /**
   * Every note carrying a reminder, overdue first and then soonest next —
   * `notesWithReminders` is the one definition of both the list and its order.
   *
   * Derived whether or not the mode is open, because the menu row quotes its
   * length: the count in the panel and the list it opens then cannot disagree,
   * and the commonest answer ("none") is given without opening anything. It is
   * one filter over the notes, on the same pass every other count here makes.
   */
  const reminding = useMemo(() => notesWithReminders(gridNotes), [gridNotes]);

  /**
   * The words inside every PDF this device has read, for search to match
   * (`store/pdfText.ts`). Read at idle, a few seconds after opening, one
   * document at a time; until a document has been read, search simply does
   * not see inside it. Fed the board's deferred notes so typing into an open
   * note asks it nothing.
   */
  const documentTexts = usePdfTexts(gridNotes);
  /**
   * The words in screenshots and photographs, read on this device the same way
   * (`store/imageText.ts`), joined to the documents' under one map: search is
   * handed attachment ids and does not care which kind of file spoke.
   */
  const pictureTexts = useImageTexts(gridNotes);
  const pdfTexts = useMemo(() => {
    if (pictureTexts.size === 0) return documentTexts;
    if (documentTexts.size === 0) return pictureTexts;
    return new Map([...documentTexts, ...pictureTexts]);
  }, [documentTexts, pictureTexts]);

  /**
   * The board search is confined to, or null for everywhere. The board under
   * the search row does not change while it is open — paging is frozen — so
   * this is the board the search was opened on, and only one `canScopeSearch`
   * allows.
   */
  const scopeBoard = searchScoped && canScopeSearch(board) ? board : null;
  /**
   * What search looks through: the board's own notes when scoped — what the
   * board draws, by `matchesBoard`, the one definition of that — and the whole
   * archive otherwise. Filtered once per scope or note change, not per
   * keystroke.
   */
  const searchPool = useMemo(
    () => (scopeBoard ? gridNotes.filter((n) => matchesBoard(n, scopeBoard)) : gridNotes),
    [gridNotes, scopeBoard],
  );

  /**
   * What the grid is holding. A mode wins over the board underneath it, and
   * the two modes are mutually exclusive — opening either ends the other.
   */
  const visible = useMemo(() => {
    if (remindersOpen) return reminding;
    if (gridSearching) return searchNotes(searchPool, gridQuery, undefined, pdfTexts);
    const held = notesForBoard(gridNotes, board);
    // The Trash is ordered by when each note was deleted, newest first
    // (`sortTrash`), never by the last edit: a note binned this morning whose
    // text was last touched in 2019 must not sink to the bottom.
    if (board.kind === "trash") return sortTrash(held);
    return held;
  }, [gridNotes, gridQuery, board, gridSearching, remindersOpen, reminding, searchPool, pdfTexts]);
  /**
   * Where a search that found nothing would have found something (audit
   * 2026-10-10, UX-1): in the Trash, which search never reads, or outside the
   * board it was narrowed to. Asked only on an empty answer, so a search that
   * finds things pays nothing for it. Trashed notes are still never results.
   */
  const searchMissed = useMemo(() => {
    if (!gridSearching || remindersOpen || visible.length > 0) return undefined;
    return {
      inTrash: trashMatches(gridNotes, gridQuery, pdfTexts).length,
      outside: scopeBoard ? searchNotes(gridNotes, gridQuery, undefined, pdfTexts).length : 0,
      scope: scopeBoard?.name ?? null,
      didYouMean: didYouMean(searchPool, gridQuery, pdfTexts),
    };
  }, [gridSearching, remindersOpen, visible.length, gridNotes, gridQuery, pdfTexts, scopeBoard, searchPool]);
  /**
   * Everything on screen, picked out at once — the selection panel's Select all
   * row and Ctrl/Cmd+A, which are one verb said twice.
   *
   * **The scope is `visible` and nothing wider.** On a board that is the board;
   * in a search it is the results. It is the only scope the user can actually
   * see, and it is what "all" means when the word is read off a screen: the
   * whole archive is not on that screen, and a key that quietly picked out two
   * hundred and ninety-one notes — a fifth of them archived, none of them
   * looked at — would be a way to lose an afternoon in one keystroke. Every
   * verb in the panel then acts on the pile, so the scope has to be the one
   * the user was already reading.
   *
   * `visible` is handed over through a ref for the same reason `useGridKeyboard`'s verbs are
   * is: the keyboard listener is registered once, and would otherwise pick out
   * whatever was on the board at the moment it was registered, for ever.
   *
   * An empty board does nothing rather than entering selection mode on nothing
   * — `selecting` is `selected.length > 0`, so a panel of verbs with no notes
   * under them cannot be drawn anyway, and a key that appears to do nothing is
   * better than one that opens something empty.
   */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  foundRef.current = gridSearching ? visible.length : 0;
  const { headerCount, fieldCount } = headerWords({
    selecting, selected: selected.length, remindersOpen, shown: visible.length, gridSearching, isPhone,
  });
  const selectAll = useCallback(() => {
    const ids = visibleRef.current.map((n) => n.id);
    if (ids.length === 0) return;
    setSelected(ids);
  }, []);
  /**
   * A selection is never wider than what is on screen, for the same reason
   * Select all is not: every verb acts on the pile, so the pile has to be the
   * one the user can see. The screen can narrow under a selection without the
   * board or the mode changing at all — a query cleared back to the board, a
   * query retyped, a note archived or filed on the other device — and a picked
   * note that left it is let go. `visible` whole, never `deck`: a board still
   * filling in has the rest of its notes on screen a moment later.
   */
  useLayoutEffect(() => {
    if (selected.length === 0) return;
    const here = new Set(visible.map((n) => n.id));
    if (selected.every((id) => here.has(id))) return;
    setSelected((prev) => prev.filter((id) => here.has(id)));
  }, [visible, selected]);
  /**
   * The words the results are matched on, handed to every card so it can start
   * at the match and mark it. The same `searchTerms` the ranking uses, so a
   * card can never mark a word the search did not actually match on.
   *
   * **Empty comes back as `NO_TERMS`, the one shared array `NoteCard` already
   * keeps for exactly this.** A fresh `[]` is a new identity every time, and
   * this memo is keyed on the query, so every keystroke — including the ones
   * that leave search entirely, and including the whole time no search is
   * running at all — handed every card on the board a *different* empty array
   * and re-derived its face, its lines and its cut against a query that had
   * not changed. Keyed on `query` alone, too: `searching` is `query` asked a
   * question, so listing it named the same change twice.
   */
  const hitTerms = useMemo(() => {
    const terms = searchTerms(gridQuery);
    return terms.length > 0 ? terms : NO_TERMS;
  }, [gridQuery]);
  /** Where a note is filed, wherever a card is drawn somewhere that fact is
   *  not already obvious from standing on the board itself. */
  const boardNameById = useMemo(
    () => new Map(folderOrder.map((b) => [b.id, b.name])),
    [folderOrder],
  );
  /** A folder's chosen mark by id, for a filed card's footer (review GD-05). */
  const boardIconById = useMemo(
    () => new Map(folderOrder.map((b) => [b.id, b.icon])),
    [folderOrder],
  );

  /**
   * The archive by id, built once per change.
   *
   * Five things here turn an id back into a note — the Sorter's pile, the
   * selection, the open note, the open canvas's idea and the undo stack — and
   * each was doing it with `notes.find`, a walk of the whole archive per id.
   * Select all on 401 notes is 160,000 comparisons for one of them, redone on
   * every note change. One map, several readers.
   */
  const noteById = useMemo(() => {
    const byId = new Map<string, Note>();
    for (const note of notes) byId.set(note.id, note);
    return byId;
  }, [notes]);

  // What the menu offers to tidy or tick here, and the pile each open mode
  // is working through (lib/useModePiles.ts).
  const { inboxPile, modeEntry, pile, ticking } = useModePiles({
    board,
    searching,
    remindersOpen,
    gridNotes,
    visible,
    noteById,
    sortingIds,
    tickingIds,
  });

  /**
   * The one question this change has to ask, and it asks it once.
   *
   * 237 of the 241 imported notes have never been filed. Left alone, the Inbox
   * opens at 237 on the morning this ships, which is not a landing page, it is a
   * bill. So on the first open after the Inbox arrives the app asks whether that
   * pile is the Inbox or a backlog to leave alone — and neither answer moves,
   * archives or deletes a single note. One stored date carries both (`INBOX_ALL`):
   * the whole pile, or only what has been written since today.
   *
   * Three things have to be true before it may ask, and all three are about not
   * asking a question that is already answered:
   *
   *   the notes are loaded, or the count it quotes is wrong;
   *   this device's own preferences have been read (`prefsReady`) — `inboxSince`
   *     is `null` for a render on every start, and `null` is also what "never
   *     answered" looks like;
   *   and the server has actually been heard from, or is known never to answer
   *     (device-only, or a build with no sync configured), so a second device
   *     takes the answer already given on the first rather than asking again.
   *
   * **That last one used to read `!session`, and it cost the user their folders.**
   * "No session" was meant as "device-only, so there is nobody to ask" — but it is
   * equally true of every second spent *on the sign-in screen*, before the session
   * arrives. On a browser whose local store had been cleared, that is a device
   * holding no folders and no answer and no way of knowing either is wrong: this
   * effect answered the question itself, silently (the pile read 0, which is under
   * `INBOX_ASK_MIN`), and the answer stamped the whole preferences row — the
   * *empty* folder list included — as a local change. Signing in eleven seconds
   * later turned sync on, saw a change queued, and pushed that empty list over the
   * real one. Four folders, gone from the server, wiped by a device that had never
   * had them. `boardSync.ts` now also refuses to upload a folder list nobody here
   * touched, which is the second half of the same fix; this is the first.
   *
   * Under `INBOX_ASK_MIN` there is no bill to present, so nothing is asked and
   * the whole pile simply *is* the Inbox — written down as `INBOX_ALL` rather
   * than left unanswered, or the question would appear months later, about
   * notes that by then are the user's ordinary working pile.
   */
  // Read off `notes`, never the deferred copy: the first-open question decides
  // from this number, and a decision must not be taken on a lagging list.
  const neverFiled = useMemo(() => neverFiledCount(notes, knownFolders), [notes, knownFolders]);
  const asked = useRef(false);
  // `idle` and nothing else: it is the one state meaning a whole tick came round
  // without failing, so what is on screen is the server's own answer. "Not off
  // and not working" would let `error` and `offline` through, which are exactly
  // the ticks that learned nothing.
  const heardFromServer = Boolean(session) && syncState === "idle";
  const firstSyncDone = deviceOnly || !syncConfigured || heardFromServer;

  /**
   * The same fact, latched, for the words on an empty board rather than for a
   * question asked once. `firstSyncDone` above is momentary by design and that
   * is right for the question; drawn on every render it would flicker, because
   * sync ticks. See `lib/serverAnswered.ts`.
   */
  const serverAnswered = useServerAnswered({ heardFromServer, deviceOnly, syncConfigured });

  // Inspiration is adopted once the account's own list is known: not before the
  // preferences are read, the notes are in, and a whole sync tick has come round
  // clean — the same three things the first-open question waits for, for the
  // same reason (a device that has heard nothing pushing a list over the real
  // one). `adoptedInspiration` is the session's one try.
  const adoptedInspiration = useRef(false);
  useEffect(() => {
    if (adoptedInspiration.current) return;
    if (!shouldAdoptInspiration({ prefsReady, loading, firstSyncDone, stored: storedBoards })) return;
    adoptedInspiration.current = true;
    adoptInspiration();
  }, [prefsReady, loading, firstSyncDone, storedBoards, adoptInspiration]);

  useEffect(() => {
    if (asked.current) return;
    if (loading || !prefsReady || !firstSyncDone) return;
    if (inboxSince !== null) return;
    if (neverFiled < INBOX_ASK_MIN) {
      asked.current = true;
      setInboxSince(INBOX_ALL);
      return;
    }
    // A question about the Inbox is asked on the Inbox, with the pile in
    // view, and not on the first paint of wherever the app happened to open —
    // a policy demanded before the user has seen a single note is the wrong
    // first thing to see (2026-09-04 audit, F10). The app opens onto the
    // Inbox, so for most opens these are the same moment; when it restores
    // another board, the question waits for the pile it is about.
    if (board.kind !== "inbox") return;
    asked.current = true;
    askAboutBacklog(neverFiled);
  }, [
    askAboutBacklog,
    board.kind,
    firstSyncDone,
    inboxSince,
    loading,
    neverFiled,
    prefsReady,
    setInboxSince,
  ]);

  /**
   * How many never-filed notes the answer to that question is holding *outside*
   * the Inbox — 0 whenever nothing is being held, which is every state except
   * "Leave them" still in force.
   *
   * One value, two readers, and that is the point of lifting it: the menu's
   * *Bring in the old notes* row offers the way back, and the Inbox's own empty
   * state says the pile is there at all. Worked out twice they would be free to
   * disagree, and the number is the whole content of both sentences.
   *
   * `counts[0]` is the Inbox, which is the one thing `buildBoards` pins to
   * index 0 and the reason it must stay there.
   */
  const oldNotesOut = useMemo(
    () => (inboxSince !== null && inboxSince !== INBOX_ALL ? neverFiled - counts[0] : 0),
    [inboxSince, neverFiled, counts],
  );

  /**
   * Nothing in the store, and the store is known to be the whole of it.
   *
   * The Inbox's zero is an achievement everywhere except here, and this is the
   * one place the app can tell the difference — see `emptyBoardHint`. Every
   * note counts, trashed ones included: an archive whose whole contents are in
   * the bin has been written in, and telling that user nothing has been
   * written yet would be the second false sentence rather than a fix for the
   * first.
   */
  const freshArchive =
    (DEMO
      ? // In the public demo a visitor's first move is a "test" note, deleted:
        // counting the trash there hid the sample notes for good behind it, so
        // the demo counts only what is in use (review UX-A-03).
        !notes.some((n) => n.status !== "trashed")
      : notes.length === 0) && serverAnswered;

  /** Unfiled notes waiting on Todos and Links rather than the Inbox, for the
   *  empty Inbox's words (review UX-B-02). Only worked out while it is empty. */
  const waiting = useMemo(
    () => {
      if (board.kind !== "inbox" || counts[0] !== 0) return undefined;
      // A board hidden in Settings is not offered as the place a note waits.
      const waits = waitingElsewhere(notes, boards[0]);
      const shown = (kind: string) => boards.some((b) => b.kind === kind);
      return { todos: shown("todos") ? waits.todos : 0, links: shown("links") ? waits.links : 0 };
    },
    [board.kind, counts, notes, boards],
  );

  // The way back from a link that took the window (lib/useReturnSpot.ts).
  useReturnSpot({
    openId,
    board,
    scrollRef,
    loading,
    prefsReady,
    boards,
    trashIndex,
    goToBoard,
    remember: rememberScroll,
    // The notification-open shape: by id, no origin rect — there is no card
    // on screen to grow out of when the shell has only just rebooted.
    onReopen: (id) => openById(id),
  });

  /**
   * The canvas each idea card draws as its face.
   *
   * Built from the notes rather than from the folder record, because the folder
   * record is the one thing here that does not travel: a layout lives on the
   * device that arranged it, so an idea that arrived by sync has no folder on
   * this phone and had been falling through to its own text. The snapshot falls
   * back to the layout the canvas would build on first open, which is what the
   * phone will in fact see when it opens it.
   */
  // Each idea's miniature is remembered until something it draws changes
  // (`createSnapshotCache`), so a keystroke in one note rebuilds at most the
  // ideas holding that note, and every other idea card keeps the same
  // `snapshot` object — which is what lets `memo(NoteCard)` skip them.
  const snapshotCache = useRef<ReturnType<typeof createSnapshotCache> | null>(null);
  snapshotCache.current ??= createSnapshotCache();
  const snapshots = useMemo(() => {
    const cache = snapshotCache.current!;
    // The canvases by the note they belong to, so the walk below is a lookup
    // rather than a scan of every folder for every idea on the board.
    const canvasFor = new Map<string, (typeof folders)[number]>();
    for (const folder of folders) canvasFor.set(folder.idea_id, folder);
    const out = new Map<string, ReturnType<typeof canvasSnapshot>>();
    for (const note of notes) {
      if (!isCanvasIdea(note)) continue;
      out.set(note.id, cache.get(note, canvasFor.get(note.id), noteById));
    }
    cache.keepOnly(new Set(out.keys()));
    return out;
  }, [notes, folders, noteById]);

  const openNote = openId ? (noteById.get(openId) ?? null) : null;
  // A note destroyed elsewhere (another tab or device emptying the trash)
  // while it is open here: its sheet is gone, so its layer must go too, or the
  // board stays inert behind a sheet that will never close. Set during render,
  // as React allows for state that follows other state.
  // Not before the first pull, which is what brings in a note opened from a
  // reminder that this device has not seen yet.
  if (openId && !openNote && !loading && (pulledOnce || !sendsFiles)) {
    setOpenId(null);
    setClosing(false);
  }
  // A recipe read with floury hands: a note filed in a folder that asked for
  // it holds the screen on while it is open (`UserBoard.awake`, set from the
  // folder's menu), released the moment it closes. The Ticker's own lock is
  // separate and unaffected. Silent where the browser refuses.
  useWakeLock(keepsScreenOn(openNote, boards));
  const openCanvas = canvasId
    ? (folders.find((folder) => folder.id === canvasId) ?? null)
    : null;
  // The note the open canvas belongs to, read once — both the sheet's `idea`
  // prop and its opening tool are questions about this note.
  const openCanvasIdea = openCanvas
    ? (noteById.get(openCanvas.idea_id) ?? null)
    : null;
  const selectedNotes = useMemo(
    () =>
      selected
        .map((id) => noteById.get(id))
        .filter((n): n is Note => Boolean(n)),
    [selected, noteById],
  );
  /**
   * The selection as a set, because the grid asks it once per card. Select all
   * on a full board made that `selected.includes(note.id)` an O(n²) walk over
   * the ids, on every render of the board.
   */
  const selectedIds = useMemo(() => new Set(selected), [selected]);

  /**
   * The Inspiration wall's viewer — a layer over the board, not over a note, so
   * it is on the covered list and takes Back itself. It registers its animated
   * close here (`registerWall`), exactly as the picture over an open note does
   * through `registerInner`, and Back is answered the way `innerClose` is: `true`.
   * The layer is not gone when Back is pressed — it stays mounted for the whole of
   * its close animation — so the one history entry is put straight back, and it
   * is taken off again, once, when the layer unmounts and nothing is open any
   * more. Reporting `false` instead left the app to find that out a frame later
   * and push the entry back then, a push and a pop on a layer that was still up.
   */
  const [wallView, setWallView] = useState<{ id: string; origin: DOMRect } | null>(null);
  const wallClose = useRef<(() => void) | null>(null);
  const registerWall = useCallback((close: (() => void) | null) => {
    wallClose.current = close;
  }, []);
  const closeWallView = useCallback(() => setWallView(null), []);

  /**
   * The capture bar's Add panel, on the layer stack. The bar owns the panel's
   * state and registers a way to close it while it is up (`registerLayer`),
   * exactly as the open note registers the picture over itself: the app
   * never asks whether the panel is open, only whether there is something to
   * close. It is not on the covered lists above because it is not a layer the
   * grid sits under — it is a menu over the bar with a scrim behind it — but
   * it is a thing Back and Escape have to close, and until it was here neither
   * did: Back walked out of the app, and Escape did nothing (audit F5).
   */
  const addClose = useRef<(() => void) | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const registerAdd = useCallback((close: (() => void) | null) => {
    addClose.current = close;
    setAddOpen(Boolean(close));
  }, []);

  const closeNote = useCallback(() => setClosing(true), []);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  // A board reached from under the open note — the drawer's arrow-key walk,
  // say — leaves the note's card behind on the board it came from. A drawer
  // row sets this itself, in the same batch as the close (the Shelf's
  // `onChoose`), because NoteView's closing effect runs before this one and
  // would already be shrinking into the old card.
  //
  // Keyed on the board's id, not on `boardIndex`. The index is a seat on the
  // shelf and moves without the board moving: a folder reordered from the
  // drawer's own menu, or a folder arriving by sync, shifts every seat after it
  // (`stayOnBoard` follows the board across), and the card the note grew out of
  // was still right there — so the note faded instead of shrinking into it.
  useEffect(() => {
    if (openIdRef.current) setClosesElsewhere(true);
  }, [board.id, searchOpen, remindersOpen]);

  // Link previews: every link the archive holds gets asked about once, and
  // what comes back is written into the note. The whole of it lives in
  // `store/useLinkUnfurl.ts`; it touches nothing on the board and the board
  // reads nothing from it.
  useLinkUnfurl({ notes, signedIn: Boolean(session), update, wallBoardId: inspiration?.id ?? null });
  const undoLastRef = useRef<() => Undo | null>(() => null);
  /**
   * Closing a sketch that gained nothing takes it back out of existence — to
   * the trash, never destroyed. A Draw note is created before anything is
   * drawn, so backing straight out would otherwise leave a blank card on the
   * board that the user never wrote. Held in a ref because the check reads
   * state (`folders`) that must be current at close time, not at the render
   * that built the closer.
   */
  const sweepSketch = useRef<(canvasId: string) => void>(() => {});
  /**
   * Closing the idea canvas, from its Close button or Escape (review
   * 2026-10-04, UX-A-05): a sketch that gained nothing is swept, and focus goes
   * back to the idea's own card — as a closed note returns it to its card —
   * so a keyboard user is not dropped on the page body. Nothing to focus (the
   * idea was dissolved, or is on another board) leaves focus where it falls.
   * Reads the canvas through a ref so the Escape listener is registered once.
   */
  const closeCanvasRef = useRef<() => void>(() => {});
  const closeCanvas = () => closeCanvasRef.current();
  /** The canvas goes the way its Back takes it: a sketch that gained nothing
   *  is swept on the way (`sweepSketch`). */
  const dropCanvas = () => {
    if (!canvasId) return;
    sweepSketch.current(canvasId);
    setCanvasId(null);
  };
  // Stable, because NoteView keys its exit animation on it — a fresh identity
  // every render would restart the shrink instead of letting it finish.
  const noteClosed = useCallback(() => {
    setTraceId(openIdRef.current);
    setOpenId(null);
    setClosing(false);
    setClosesElsewhere(false);
  }, []);
  /**
   * A way to close whatever the open note has put on top of itself — today a
   * picture at full screen. Back closes the top thing on screen, and the top
   * thing is not always the layer the app itself is tracking.
   */
  const innerClose = useRef<(() => void) | null>(null);
  const settingsBack = useRef<(() => boolean) | null>(null);
  const sorterBack = useRef<(() => boolean) | null>(null);
  const registerInner = useCallback((close: (() => void) | null) => {
    innerClose.current = close;
  }, []);
  /** A folder's menu closes, and a rename half-typed in it goes with it. */
  const closeBoardMenu = () => {
    setBoardMenu(null);
    setBoardRenaming(false);
  };
  /** The new-board field opens empty, and closes taking its name with it —
   *  the strip's and the drawer's alike. */
  const startNewBoard = () => {
    setNewBoardName("");
    setCreatingBoard(true);
  };
  /** The drawer's row, and the board a new name has just made. */
  function chooseBoard(i: number) {
    // Chosen from inside an open note, the note closes on the way.
    // Onto the board it was opened from it shrinks back into its
    // card, as Back does; onto any other that card is not there, so
    // it fades where it stands. Set in this batch, before the close.
    // A note opened from a canvas grew out of a capsule on it, and
    // the canvas is about to go, so that card is not there either.
    // Either way the board comes back as it was left, never sent to
    // the top: the card the note shrinks into is where it was.
    const covered = Boolean(openIdRef.current) || Boolean(canvasId);
    if (openIdRef.current) {
      if (i !== boardIndex || searchOpen || remindersOpen || canvasId) {
        setClosesElsewhere(true);
      }
      closeNote();
    }
    // The canvas is full screen. Left open, it stood over the board
    // that was just chosen and the choice appeared to do nothing — so
    // it closes the way a canvas Back closes it, sketch sweep and all.
    dropCanvas();
    leaveMode();
    if (covered || !backToTop(i)) goToBoard(i);
  }
  const cancelNewBoard = () => {
    setCreatingBoard(false);
    setNewBoardName("");
  };
  /**
   * What is on top, and what Back and Escape close: one table,
   * `lib/useLayerStack.ts` (audit 2026-10-10, CODE-6). This says which layers
   * are up and how each one closes; the order, what each does to the board
   * behind it (the two `inert`s, the lists the grid's keys read) and who
   * answers Escape are the table's. Back and Escape used to walk two lists of
   * their own here, and with a selection under a folder's menu they closed
   * different things.
   *
   * A Back closer answers `true` when it closed something *inside* a layer
   * that is still up — the picture over the note, a face the selection wears,
   * the drawer over the note — so the one history entry goes straight back
   * (`useDismissOnBack`). `below` is whether anything else is open under it.
   */
  const openLayers: OpenLayers = {
    dialog: dialogOpen,
    add: addOpen,
    wall: Boolean(wallView),
    picture: () => Boolean(innerClose.current),
    look: Boolean(boardLookId),
    boardMenu: Boolean(boardMenu),
    newBoardInDrawer: creatingBoard && shelfOpen,
    drawer: shelfOpen,
    note: Boolean(openId),
    canvas: Boolean(canvasId),
    newBoardOnStrip: creatingBoard && !shelfOpen,
    sorter: sorting,
    ticker,
    about: aboutOpen,
    settings: settingsOpen,
    import: keepOpen,
    moveChooser: moving,
    selectionPanel: menuOpen && selecting,
    selection: selecting,
    menu: menuOpen && !selecting,
    search: searchOpen,
    reminders: remindersOpen,
  };
  const {
    coveredOtherThanSearch,
    gridCovered,
    inertBoard,
    inertRow,
    verbKeysWait,
    onEscape: onLayerEscape,
    openKey: layersUp,
  } = useLayerStack({
    open: openLayers,
    back: {
      // Which dialog wins over which is useDialogs' rule, not this one's.
      dialog: () => {
        dismissTopDialog();
        return false;
      },
      // Over everything else, scrim and all; search is under it, most often.
      add: (below) => {
        addClose.current?.();
        return below;
      },
      // Back plays the viewer's own animated close and answers true: the layer
      // is still on screen until that ends, so the entry goes straight back
      // and is spent when it unmounts. A viewer whose chunk has not arrived
      // registered nothing to animate: it simply goes, and says so.
      wall: () => {
        if (wallClose.current) {
          wallClose.current();
          return true;
        }
        setWallView(null);
        return false;
      },
      picture: () => {
        innerClose.current?.();
        return true;
      },
      // Opening the Look sheet *closes* the folder's menu it came from, so
      // with no note under it there is only the board left: false.
      look: () => {
        setBoardLookId(null);
        return Boolean(openIdRef.current);
      },
      // A face something else wears, not a layer of its own: true, or the
      // next Back would walk out of the app instead of clearing what is under.
      boardMenu: () => {
        closeBoardMenu();
        return true;
      },
      newBoardInDrawer: () => {
        setCreatingBoard(false);
        return true;
      },
      // A layer of its own over the board; over the note, the note is still
      // open underneath.
      drawer: () => {
        setShelfOpen(false);
        return Boolean(openIdRef.current);
      },
      // The same shrink back into the card as the Back button, not a cut:
      // the note stays mounted until the animation reports finished.
      note: () => {
        setClosing(true);
        return false;
      },
      canvas: () => {
        dropCanvas();
        return false;
      },
      newBoardOnStrip: () => {
        setCreatingBoard(false);
        return true;
      },
      // Leaving the Sorter mid-pile leaves the rest where it was: there is no
      // session to abandon. Back first steps out of what is open inside it and
      // shows the run so far, as the ✕ does; a press on that report leaves.
      // The Ticker, About and the import on its terms.
      sorter: () => {
        if (sorterBack.current?.()) return true;
        setSortingIds(null);
        return false;
      },
      ticker: () => {
        setTickingIds(null);
        return false;
      },
      about: () => {
        setAboutOpen(false);
        return false;
      },
      // A phone's section steps back to the list first, as Escape does.
      settings: () => {
        if (settingsBack.current?.()) return true;
        setSettingsOpen(false);
        return false;
      },
      import: () => {
        setKeepOpen(false);
        return false;
      },
      // The Move chooser and the panel are faces the selection wears: true,
      // and the next Back clears the selection.
      moveChooser: () => moveKey.cancel(),
      selectionPanel: () => {
        setMenuOpen(false);
        return true;
      },
      selection: () => {
        setSelected([]);
        return false;
      },
      menu: () => {
        setMenuOpen(false);
        return false;
      },
      search: () => {
        closeSearch();
        return false;
      },
      reminders: () => {
        setRemindersOpen(false);
        return false;
      },
    },
    escape: {
      // The idea canvas closes like the open note does, focus handed back to
      // its card (review UX-A-05) — but not while a label is being typed
      // (its own Escape ends the edit), and not when a layer inside the
      // canvas, its menu, has already taken the key.
      canvas: (e) => {
        if (e.defaultPrevented || isTypingTarget(e.target)) return;
        e.preventDefault();
        closeCanvasRef.current();
      },
      // Search and the Reminders mode take the board row and nothing else;
      // the field's own handler has already stopped the key when the caret is
      // in it, and this is for focus anywhere else on the row — the ✕ beside
      // the field, most often (2026-09-04 audit, F5).
      search: (e) => {
        e.preventDefault();
        closeSearch();
      },
      reminders: (e) => {
        e.preventDefault();
        setRemindersOpen(false);
      },
    },
  });

  // The grid closes its own gaps, and tells us what left so it can be drawn
  // going. Keyed on the view: paging boards replaces every card at once, and
  // that has its own motion — sliding them all from the last board's slots
  // would be noise, not information. Search is the same, once per keystroke.
  const viewKey = remindersOpen
    ? "reminders"
    : gridSearching
      ? `q:${gridQuery.trim()}`
      : boardViewKey(board);
  /**
   * How much of `visible` is actually mounted right now. A freshly paged-to
   * board renders a screenful first and the rest after the slide-in, so the
   * commit that has to land between slide-out and slide-in stays small — see
   * `useGridFill`. Everything that *reads* the board keeps reading `visible`
   * whole (select-all, sibling navigation, the counts); only the cards in the
   * DOM go through `deck`.
   *
   * Keyed on the board's *identity*, not on `viewKey` whole: the Inbox's
   * `since` half arrives from prefs a beat after boot and changes again when
   * the first-open question is answered, and neither of those is a paging —
   * the first would quietly re-chunk the boot render the exemption in
   * `useGridFill` exists to keep whole.
   */
  const fillKey = remindersOpen
    ? "reminders"
    : gridSearching
      ? `q:${gridQuery.trim()}`
      : board.id;
  // What of `visible` is mounted as cards: the fill, then the growth — see
  // `lib/useGridContents.ts`. Whole when the board has a place to come back to
  // (`useBoardScroll` above).
  const { deck, setDeckEnd, wantsEnd } = useGridContents(
    fillKey,
    visible,
    remembered(scrollOwner) > 0,
    scrollRef,
    openId,
  );
  /**
   * The one card the grid hands the keyboard, so Tab crosses the board in one
   * press instead of four hundred.
   *
   * Every card is a real `<button>`, which made a board of 401 notes 401 tab
   * stops between the board row and the capture bar — the strip beside it has
   * always used a roving tabindex for exactly this, and `lib/useGridKeyboard`
   * has always owned the arrows, which is the other half of the pattern.
   *
   * An **id**, not an index: the deck is filtered, paged, searched and
   * re-ordered under it constantly, and an index would follow the seat rather
   * than the card — the same fault the shelf's own seat had. It falls back to
   * the first card whenever the remembered one is not on screen, which covers
   * nothing focused yet, the board paged, a search run, and the note trashed.
   */
  const [rovingId, setRovingId] = useState<string | null>(null);
  const rovingCardId =
    rovingId !== null && deck.some((n) => n.id === rovingId) ? rovingId : (deck[0]?.id ?? null);
  // Over what is mounted, not what the board holds — the reflow hook measures
  // the DOM, and a signature promising cards that are not there yet would
  // leave its baseline missing them, to be "discovered" as arrivals later.
  const signature = useMemo(() => deck.map((n) => n.id).join(","), [deck]);
  const onLeave = useCallback((gone: Leaving[]) => {
    // A note deleted from the open note already collapses into its mark on the
    // sheet. Playing the card's version of it underneath would be two shrinking
    // objects saying one thing.
    if (openIdRef.current) return;
    // The mark is a one-shot, set by the action that is about to take the note
    // off the board and spent here. Nothing pending means nothing the user did
    // caused this, and a disappearance nobody asked for is not an event to
    // announce — the grid still closes its gap, it just does it quietly. Held
    // rather than spent, the last action's mark stood permanently ready to
    // explain the next unattributed leave with whatever happened to have
    // happened last, and at startup that was the `"trash"` it was initialised
    // with: every note on the board could be reported as deleted by a race
    // nobody ran.
    const mark = leaveMark.current;
    leaveMark.current = null;
    if (!mark) return;
    setGhosts(gone.map((g) => ({ ...g, mark })));
  }, []);
  const clearGhosts = useCallback(() => setGhosts([]), []);
  // While the view is still filling, the fill's own commit must not read as
  // a hundred arrivals — folding the fill state into the key makes the moment
  // the rest lands a view change (reset, no animation) rather than an event.
  useFirstDeal(grid, loading, notes.length, serverAnswered);
  useGridReflow(
    grid,
    // Keyed on how many are in, while not all are: the fill landing, or the
    // deck growing by a page, is a new view (reset) rather than a hundred
    // arrivals. A capture or a trash leaves the count alone and still slides.
    deck.length < visible.length ? `${viewKey}#${deck.length}` : viewKey,
    signature,
    onLeave,
  );

  // Focus follows the reveal: opening search should mean you can already type.
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  // The trace draws itself once and then has nothing left to say. Clearing it
  // also means capturing the same note twice re-runs it, rather than the
  // second one silently doing nothing because the id never changed.
  useEffect(() => {
    if (!traceId) return;
    const t = window.setTimeout(() => setTraceId(null), TRACE_MS);
    return () => window.clearTimeout(t);
  }, [traceId]);

  /**
   * Whether the board under the bar is a place a capture is filed by — not
   * while search, the Reminders mode or the drawer has the grid, which are
   * layers over a board rather than a place you are standing — and the folder
   * that is, if it is one. One value for the capture paths, the sketch and the
   * bar's mark, which each used to write it out.
   */
  const filing = !searchOpen && !remindersOpen && !shelfOpen;
  const here = filing && isFilable(board) ? board.id : null;

  // What the bar says after a capture, and where its tap goes: lib/useLandedLine.ts.
  const { landed, findSaved, openSaved, barLine } = useLandedLine({
    remindersOpen,
    query,
    board,
    boards,
    notes,
    notesRef,
    visible,
    setTraceId,
    leaveMode,
    goToBoard,
    scrollRef,
    toTop,
    ensureForIdea,
    setCanvasId,
    openById,
  });

  // The share's Inspiration offer files through `sortFile`, which is built far
  // below this hook — so it is reached by a ref.
  const fileOfferedRef = useRef<(id: string, boardId: string) => void>(() => {});

  // Every door a note comes in by — the bar, a drop, a paste and the share
  // sheet — and the size limit they all ask (lib/useCapture.ts). The share is
  // collected only once the preferences are read, so Inspiration, the target
  // of its offer, is known if it exists on this device.
  const { withinLimit, takeFiles, dropping, capture, incoming, offer: offerWords, heldLine } = useCapture({
    filing,
    here,
    board,
    userBoards: folderOrder,
    loading: loading || !prefsReady,
    create,
    createWithFiles,
    showFileNotice,
    setTraceId,
    landed,
    // A capture that carries a reminder is told back, with the time, and can be
    // taken back (`pushUndo` is built below; this runs only on a capture).
    onReminder: (made) => {
      askToRing();
      pushUndo(reminderReceipt(made));
    },
    inspiration: shownInspiration ? { id: shownInspiration.id, name: INSPIRATION_NAME } : null,
    fileOffered: (id, boardId) => fileOfferedRef.current(id, boardId),
  });

  /**
   * The stack lives in `store/useUndo.ts`; what it hands back here is what a
   * reversal should look like on the board.
   *
   * `onReverting` runs before the patches do, because the mark the cards shrink
   * into has to come from where they are *going*: a reversal can take a card
   * off the board as easily as put one back — undoing "Put back 3" sends them
   * to the trash again — so reading it from whatever the last action left
   * behind would point the wrong way.
   */
  const { undos, offer, pushUndo: offerNow, undoLast } = useUndo({
    notesRef,
    update,
    onReverting: (live) => {
      const to = live.find((s) => s.revert.status)?.revert.status;
      if (to) {
        leaveMark.current = markFor(to);
      }
      // One note coming back says which one it is; twelve saying it at once is
      // just a flickering board. Same rule the capture trace already follows.
      if (live.length === 1) setTraceId(live[0].id);
    },
    // Merge leaves its new note open; putting the sources back has to close it.
    // An entry made inside the open note or the Ticker (`inPlace`) — Untick
    // all, Clear done — is reversed there too, and the screen stays up.
    onReverted: (entry) => {
      if (entry.inPlace) return;
      setOpenId(null);
      setCanvasId(null);
      setClosing(false);
    },
  });
  undoLastRef.current = undoLast;

  // A move made from the open note waits here until the note closes
  // (`lib/useHeldMove.ts`); every other offer goes through `pushUndo`.
  const { holdMove, pushUndo } = useHeldMove(offerNow, openId);
  // The newest undo entry that existed when Tidy up or Tick off opened. An
  // offer at or before it was made somewhere else — loading the samples, a
  // delete just before — and is not the mode's to show beside a note (review
  // 2026-10-04, UX-B-01; Tick off too, audit 2026-10-10, UX-6). It stays on
  // the stack, so Ctrl+Z still reaches it.
  const modeFloor = useRef<number | null>(null);
  if (!sorting && !ticker) modeFloor.current = null;
  else if (modeFloor.current === null) modeFloor.current = undos[0]?.key ?? 0;
  /* --- Ctrl+Z ---------------------------------------------------------------
     Deliberately only on the board. Editing a note is a plain text box, so
     Ctrl+Z inside one is the browser's own undo working exactly as it does
     everywhere else, and taking that away to offer a worse copy of it would be
     a poor trade. Two scopes, no overlap.

     Shift+Z is let through untouched: there is no redo. Redo is only meaningful
     if nothing has happened since the undo, and on an app where the other
     device can act at any moment there is no way to know that — see the guard
     on UndoStep. */
  useKeyboardUndo({ openId: openIdRef, undoLast: undoLastRef, grid });

  /* --- opened to write, from outside the app --------------------------------
     The manifest's one launcher shortcut lands on `?do=capture`, meaning the
     user pressed "New note" rather than the app's own icon. Everything it can
     ask for is already true — the app opens on the Inbox, and the bar is
     anchored to the bottom of it — so the whole of honouring it is the caret.

     It runs after **every** commit rather than on mount, and the ref is what
     makes that cheap. The field is not on screen on the first commit of every
     open: a cold start with no stored session paints a loading state and then
     possibly sign-in, and the bar arrives with the board afterwards. Firing
     once on mount would spend the intent on a screen that has no field in it.
     The alternative — waiting on the several conditions that decide which of
     those three screens is up — would be those conditions written down twice,
     and the second copy is the one that goes stale. */
  const wantsCapture = useRef<boolean | null>(null);
  useEffect(() => {
    if (wantsCapture.current === null) {
      wantsCapture.current = takeLaunchIntent() === "capture";
      // `?do=capture&text=` (the browser bookmark, review 2026-10-04, FX-A-03):
      // the words wait in the write field, unsaved, and the bar focuses them.
      const words = takeLaunchText();
      if (words) offerWords(words);
    }
    if (!wantsCapture.current || !captureField.current) return;
    wantsCapture.current = false;
    captureField.current.focus();
  });

  /* --- reaching the two verbs from the keyboard -----------------------------
     Capture is always on screen, so its key is a convenience. Search is
     revealed rather than resident, so without a key the app's primary verb —
     the reason it is opened at all — cannot be reached without hunting for a
     mark to click. Both are drawn beside the thing they open (`Hotkey`), or
     they are shortcuts for whoever wrote them.

     They stand down inside a field, exactly as Ctrl+Z does: Ctrl+K while
     typing a note must not throw the caret out of the note and into search.
     **The write field is the one field they work from** (review 2026-10-04,
     UX-A-01): after a capture the caret stays there, so standing down in it
     meant Ctrl+K after every save did nothing — or let the browser send the
     query to its own search. Its words are state, not something the field
     holds, so leaving it for search keeps them. They also stand down while a
     layer is up, for the same reason the grid's own keys do — a dialog is
     asking a question and this is not the moment to open something behind it.
     Which layers those are is the table's `verbKeys` column
     (`lib/useLayerStack.ts`): it used to be a hand-kept list here that missed
     About, Settings, the import and the wall. The menu, the drawer and what it
     opens, search and the Reminders mode are not on it — the keys put those
     away on the way, and both keys put away the same ones. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== SEARCH_KEY && key !== CAPTURE_KEY) return;
      if (isTypingTarget(e.target) && e.target !== captureField.current) return;
      if (verbKeysWait) return;
      e.preventDefault();
      // Both branches close the same things, and for the same reason. Ctrl+E
      // used to clear only the menu, so with the phone's drawer open it put the
      // caret in a field *behind* the drawer: what you typed was invisible, and
      // Escape then closed the drawer rather than the thing you were typing
      // into.
      setMenuOpen(false);
      setShelfOpen(false);
      setBoardMenu(null);
      setBoardLookId(null);
      if (key === SEARCH_KEY) {
        // Already open is already answered: put the caret back in the field
        // rather than closing what the user just asked for.
        setRemindersOpen(false);
        setSearchOpen(true);
        searchInput.current?.focus();
        return;
      }
      captureField.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [verbKeysWait]);

  /* --- Ctrl+A: everything on the board --------------------------------------
     The panel's Select all row and this are the same verb, and the key is the
     half that makes 3.1 worth anything: moving forty notes back to the Inbox
     is not a feature if picking forty notes means forty taps.

     It works whether or not a selection already exists. With none it enters
     selection mode with everything picked, which is what the key means in
     every other application — a selection is not a mode you have to be in
     first for "select all" to have a meaning.

     `preventDefault` on the board, so the browser's own select-all does not
     run underneath it. Nothing is lost by taking the key: this app turns the
     text selection colour off entirely (`web/CLAUDE.md`), so a browser
     select-all over the grid highlights nothing you can see, and the panel's
     Copy row is how a selection's words actually leave the app.

     The guard is the one every other shortcut here carries. It stands down
     inside anything being typed into — a Ctrl+A while writing a note must
     select that note's text and never touch the board, which is the same
     trade Ctrl+Z makes with the browser's own undo — and it stands down under
     every layer over the grid. `moving` is on that list too, though it is not
     on `gridCovered`: the board chooser is asking which board *this* selection
     goes to, and the answer must not arrive against a selection that grew
     underneath the question. Search is the one thing it does not stand down
     for, because search does not cover the grid — see `coveredOtherThanSearch`.
     -------------------------------------------------------------------------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== SELECT_ALL_KEY) return;
      if (isTypingTarget(e.target)) return;
      if (coveredOtherThanSearch || moving) return;
      e.preventDefault();
      selectAll();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coveredOtherThanSearch, moving, selectAll]);

  /** Every way into Settings — the header's cog, the folded header's menu row
   *  and Ctrl+, — leaves search and the Reminders mode on the way in. */
  const openSettings = useCallback(() => {
    setMenuOpen(false);
    leaveMode();
    setSettingsOpen(true);
  }, [leaveMode]);

  /* --- Ctrl+,: Settings --------------------------------------------------------
     The key desktop apps open their preferences with (2026-10-11, owner
     approved). Ctrl+K's guards: it stands down in a field and under every
     layer, and it leaves search and the Reminders mode on the way in, as the
     menu's own row does. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key !== SETTINGS_KEY) return;
      if (isTypingTarget(e.target) && e.target !== captureField.current) return;
      if (coveredOtherThanSearch) return;
      e.preventDefault();
      openSettings();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coveredOtherThanSearch, openSettings]);

  /* --- ?: every key, written down -------------------------------------------
     The About page lists every shortcut the app answers to (`lib/shortcuts.ts`),
     and `?` opens it scrolled to that list. No modifier, which is why it is
     the one shortcut here that stands down for a selection as well as for
     anything being typed into or any layer: a bare key is easy to press by
     accident, and the selection's panel is the thing in hand. It leaves
     search and the Reminders mode on the way in, exactly as the menu's own
     About row does. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== HELP_KEY || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (coveredOtherThanSearch || selecting) return;
      e.preventDefault();
      leaveMode();
      setAboutAt("keys");
      setAboutOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coveredOtherThanSearch, selecting, leaveMode]);

  /**
   * Escape closes the top thing, whatever has focus: the same layer Back
   * closes, read off the same table (`lib/useLayerStack.ts`). Layers with a
   * field or a focus trap of their own — a dialog, the open note, the modes,
   * the menu — take the key themselves, and this listener stands down for
   * them rather than reaching past to whatever is underneath. It is for the
   * rest, and for focus that has wandered off a panel onto the body or a card
   * behind it (2026-09-04 audit, F5).
   *
   * Registered again whenever a layer opens or closes, as it always was, so
   * it stays behind the listeners the layers themselves register on the way
   * in.
   */
  useEffect(() => {
    window.addEventListener("keydown", onLayerEscape);
    return () => window.removeEventListener("keydown", onLayerEscape);
  }, [onLayerEscape, layersUp]);

  /* --- the grid from the keyboard -------------------------------------------
     Desktop only in practice, and built on real focus rather than on a private
     idea of a cursor: the cards are already buttons, so Enter and Space open
     them for free, the browser scrolls them into view for free, and the focus
     ring is drawn by :focus-visible, which never fires for a tap. All this
     adds is the arrows, which move focus by one card or by one row, and Delete.

     The row width is read from the grid's own computed columns rather than
     guessed — it is 2 on a phone and however many fit on a desktop.

     Multi-select is deliberately not a reason to stand down. It is the one
     layer that leaves the grid on screen and in charge, and Delete is the key
     you reach for once you have picked out five notes — see the branch below,
     where a selection is what Delete means whenever there is one. That is
     exactly why the guard reads `gridCovered` and not "any layer is up": the
     two differ by the selection and by the Reminders mode, and both of those
     are things that leave the grid in charge, which is what the arrows and
     Delete want. The difference is stated once, in the layer table
     (`grid: "leaves"` in `lib/useLayerStack.ts`).

     Everything else *does* stand it down. This used to name three layers of
     its own — the open note, the menu and search — and so it stayed live under
     the canvas, the board menu, the drawer, the Sorter and a confirm dialog.
     The dialog was the one that mattered: an arrow key moved focus out of a
     modal onto a card behind the scrim, and Delete then trashed that card
     while the app was still asking whether to destroy something. */

  /* --- paging between boards ------------------------------------------------
     Boards used to swap between two frames, which told you a change had
     happened but nothing about which way you had gone. Now the deck of cards
     travels: it follows your finger while you drag, carries on out the side you
     pushed it, and the next board arrives from the other side and settles. The
     direction of travel is the whole message — it is what tells you the shelf
     is a line and where on it you now are. */

  /**
   * Walking the shelf from the keyboard, wherever the shelf currently is.
   *
   * The strip walks it with Left/Right and the drawer with Up/Down, and that
   * is the entire difference between them — what a step *does* is one thing
   * said once: leave search, page, and take the focus with you. The selection
   * does not come along: the effect keyed on the board's identity drops it
   * for every way the board can change.
   * `boardTabs` holds whichever of the two shapes is mounted, so the focus
   * lands on the row the user can actually see.
   */
  function stepToBoard(next: number) {
    leaveMode();
    goToBoard(next);
    boardTabs.current[next]?.focus();
  }

  /**
   * The board you are on, chosen again: back to the top of it.
   *
   * A strip tab or a drawer row naming the board already under you used to
   * do nothing at all, and the one thing a reader forty cards down wants from
   * it is the top — where a capture lands and where the board begins. Only
   * when the board is what is being shown: both modes take the board row with
   * them, so no tab is on screen to press while one runs, but a board the
   * reader cannot see is not one to send anywhere, and leaving a mode puts the
   * board back at the place it was left. False when there was nowhere to go
   * (already at the top), and the caller then does what the press did before.
   *
   * The phone's header row is not one of these presses. It is the one control
   * that opens the drawer, and it stays that; there the drawer's own row for
   * the board you are on is the way to the top.
   */
  function backToTop(i: number): boolean {
    return i === boardIndex && !searching && !remindersOpen && toTop();
  }

  function onBoardKeyDown(index: number, e: React.KeyboardEvent<HTMLButtonElement>) {
    // A hidden Trash is not on the strip, so the keys never reach it.
    const total = trashHidden && !inTrash ? trashIndex : trashIndex + 1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % total;
    else if (e.key === "ArrowLeft") next = (index - 1 + total) % total;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = total - 1;
    if (next === null) return;

    e.preventDefault();
    e.stopPropagation();
    stepToBoard(next);
  }

  /**
   * The drawer only stands while the shelf is what the board row is showing.
   * Opening either mode — both take the row's own slot, burger included —
   * leaves it with nothing to be a drawer for, so it closes rather than
   * hanging over a search field. (It used to close on a width change too,
   * back when it was phone-only; now it is the same drawer at every width and
   * a tablet turning on its side keeps it.)
   */
  useEffect(() => {
    if (searchOpen || remindersOpen) setShelfOpen(false);
  }, [searchOpen, remindersOpen]);

  /** The query names a folder already made — jump straight to it. */
  function jumpToBoard(name: string) {
    const idx = boards.findIndex(
      (b) => isFilable(b) && b.name.toLowerCase() === name.toLowerCase(),
    );
    if (idx < 0) return;
    stepToBoard(idx);
  }

  /**
   * Where a folder's menu hangs when it is opened from the desktop strip: under
   * the tab, at its left edge (review UI-15). On a phone, and from the drawer,
   * there is no anchor and the menu stands in the corner by the thumb.
   */
  function stripAnchor(id: string): { left: number; top: number } | undefined {
    if (isPhone || shelfOpen) return undefined;
    const tab = document.getElementById(`board-tab-${id}`);
    if (!tab?.closest(".boards")) return undefined;
    const r = tab.getBoundingClientRect();
    return { left: r.left, top: r.bottom };
  }

  // What the shelf does to a folder — delete, rename, put down elsewhere along
  // its run, make — and what the open folder menu is worked out from
  // (lib/useFolderVerbs.ts).
  const {
    menuRun,
    menuAt,
    menuIsFolder,
    leaveBoard,
    handleDeleteBoard,
    handleRenameBoard,
    handlePlaceBoard,
    handleMoveBoard,
    handleCreateBoard,
  } = useFolderVerbs({
    boards,
    board,
    boardIndex,
    inTrash,
    userBoards,
    notesRef,
    bulkUpdate,
    pushUndo,
    leaveMark,
    createBoard,
    renameBoard,
    removeBoard,
    restoreBoard,
    placeBoard,
    stayOnBoard,
    goToBoard,
    openBoard: chooseBoard,
    boardMenu,
    setCreatingBoard,
    setNewBoardName,
  });

  // Holding a board's tab or drawer row picks it up: carried, it moves along
  // its own run; let go where it was, it opens its menu; and the click the
  // hold ends with goes nowhere (lib/useBoardPress.ts). A folder and the three
  // movable lenses answer; the Inbox, Archive, All and Trash hold their seats
  // and have nothing to offer (`shelfRun` in lib/boards.ts says why).
  const boardPress = useBoardPress({
    runOf: (id) => shelfRun(boards, id),
    hasMenu: (id) => boards.some((b) => b.id === id && canMoveBoard(b)),
    // Over a selection too: the menu stands above it in the layer table, so
    // Escape and Back close the menu and leave the selection. It used to be
    // set and not drawn, and Escape then cleared the selection and uncovered
    // a menu nobody had seen open (audit 2026-10-10, CODE-6). The
    // selection's own panel steps aside: one panel at a time.
    onMenu: (held) => {
      setMenuOpen(false);
      setMoving(false);
      setBoardRenaming(false);
      setBoardMenu({ ...held, anchor: stripAnchor(held.id) });
    },
    onPlace: handlePlaceBoard,
  });

  // The tab strip scrolls sideways on its own (`.boards`, overflow-x: auto)
  // independently of the deck of cards it names — nothing kept the two in
  // sync. A swipe pages the deck without ever touching a tab, so on a wide
  // window with many folders the board you swiped to could change while the
  // tab saying so — and its highlight — stayed scrolled out of sight. Keyboard
  // paging and a jump-to-board from search have the same gap. This is what
  // closes it, for every path that can move `boardIndex`.
  useEffect(() => {
    if (searchOpen || isPhone) return;
    // jsdom, which the test suite runs in, has no layout and doesn't
    // implement `scrollIntoView` at all — optional-called so the tests keep
    // exercising `boardIndex` without a real browser method to call.
    boardTabs.current[boardIndex]?.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [boardIndex, searchOpen, isPhone]);

  // The strip saying when it holds more boards than it shows, and a wheel
  // over it turned sideways (lib/useStripOverflow.ts).
  const { boardsScroll, stripHidden, updateBoardsFade, pageStrip } = useStripOverflow({
    boards,
    counts,
    searchOpen,
    remindersOpen,
    isPhone,
  });

  // The grid steps back a fraction while a note is open. It costs nothing to
  // read — the sheet covers it a moment later — but during the opening you see
  // the note come *forward* out of a grid that is still there behind it, which
  // is the whole reason for the movement.
  const receded = Boolean(openId) && !closing;
  const wasReceded = useRef(false);
  useEffect(() => {
    if (wasReceded.current === receded) return;
    wasReceded.current = receded;
    const el = scrollRef.current;
    if (!animates(el)) return;
    stopAnimations(el);
    el.animate(
      receded
        ? [
            { transform: "scale(1)", opacity: 1 },
            { transform: "scale(0.97)", opacity: 0.55 },
          ]
        : [
            { transform: "scale(0.97)", opacity: 0.55 },
            { transform: "scale(1)", opacity: 1 },
          ],
      {
        duration: receded ? OPEN_MS : CLOSE_MS,
        easing: receded ? ENTER : EXIT,
        fill: "both",
      },
    );
  }, [receded]);

  // Merging into an idea, a sketch, a note leaving an idea and the ways back
  // out of one (lib/useIdeaVerbs.ts).
  const {
    leaveIdea,
    releaseNote,
    dissolveIdea,
    unmergeIdea,
    splitNote,
    renameIdea,
    mergeNotes,
    startSketch,
    freshMerge,
  } = useIdeaVerbs({
    notesRef,
    update,
    create,
    merge,
    ensureForIdea,
    itemAt,
    removeItem,
    restoreItem,
    pushUndo,
    leaveMark,
    canvasId,
    setCanvasId,
    setTraceId,
    setSelected,
    setOpenId,
    setClosing,
    here,
  });

  /**
   * One card changing status: the archive and delete marks in the open note,
   * the Delete key on the board, and the Sorter's own Archive and Delete.
   *
   * The comment here used to lead with "the swipe on the board", which never
   * existed — a card carries no swipe, and the rule that promised one is
   * withdrawn (`SPEC.md` §6 and §12). Undo still matters most here: every
   * one of these paths takes a card off the board in a single press, and
   * getting it back otherwise meant knowing which board it went to and
   * finding it there.
   */
  const handleSetStatus = useCallback(
    (id: string, status: Note["status"]) => {
      leaveMark.current = markFor(status);
      const note = notesRef.current.find((n) => n.id === id);
      const was = note?.status;
      if (!note || was === undefined || was === status) return;

      // A note trashed straight out of an idea has to leave the idea on the
      // way, the same bookkeeping "Take out of idea" runs — or the card
      // stays on the canvas pointing at a note that is now in the bin. Only
      // the trash path does this: archiving or restoring a note never takes
      // it off the board it was standing on.
      const ideaId = status === "trashed" ? (note?.merged_into ?? null) : null;
      const idea = ideaId ? notesRef.current.find((n) => n.id === ideaId) : undefined;

      if (idea) {
        const { restore } = leaveIdea(idea.id, id);
        update(id, { status: "trashed", merged_into: null });
        pushUndo({
          message: "Deleted 1",
          steps: [],
          run: () => {
            update(id, { status: was, merged_into: idea.id });
            restore();
          },
        });
        return;
      }

      setStatus(id, status);
      const message =
        status === "trashed"
          ? "Deleted 1"
          : status === "archived"
            ? "Archived 1"
            : was === "trashed"
              ? putBackWords([note], boards)
              : "Unarchived 1";
      pushUndo({
        message,
        steps: [{ id, expect: { status }, revert: { status: was } }],
      });
    },
    [setStatus, pushUndo, leaveIdea, update, boards],
  );

  /**
   * The user cut everything out of a note and walked away from it.
   *
   * Reported by NoteView as its layer unmounts — which is after `noteClosed`
   * has already cleared `openId`, so the grid's own reflow draws the card
   * shrinking into the trash mark exactly as a swipe or the delete mark would.
   * Nothing special happens here on purpose: it is an ordinary delete, so it
   * goes through the ordinary path and inherits the idea bookkeeping, the mark
   * and the eight seconds of undo along with it.
   */
  const handleEmptied = useCallback(
    (id: string) => {
      const note = notesRef.current.find((n) => n.id === id);
      if (!note || note.status === "trashed") return;
      handleSetStatus(id, "trashed");
    },
    [handleSetStatus],
  );

  const handleOpen = useCallback(
    (note: Note, from: DOMRect) => {
      if (selecting) {
        setSelected((prev) => toggled(prev, note.id));
        return;
      }
      if (isCanvasIdea(note)) {
        const folder = ensureForIdea(note, notesRef.current);
        setCanvasId(folder.id);
        return;
      }
      // On the wall a picture tile opens the viewer; a tile that is only words
      // opens the note, as everywhere else.
      if (wall && viewerEntries([note]).length > 0) {
        setWallView({ id: note.id, origin: from });
        return;
      }
      timeToFrame("open");
      openById(note.id, from);
    },
    [ensureForIdea, selecting, openById, wall],
  );

  /**
   * Swiping the open note sideways asks for the note beside it on the board,
   * in the order the grid drew it. The note is swapped by id; it has no card
   * it grew out of — the sheet travelled in sideways, so `origin` is cleared
   * and it fades rather than shrinking back into a card the user never
   * tapped. Which side the new note arrives from is the direction of travel:
   * a swipe to the next note sends it in from the right.
   */
  const handleOpenSibling = useCallback(
    (index: number) => {
      const target = visible[index];
      const current = openIdRef.current;
      if (!target || target.id === current) return;
      const from = current ? visible.findIndex((n) => n.id === current) : -1;
      openById(target.id, null, from >= 0 && index > from ? 1 : -1);
    },
    [visible, openById],
  );

  /**
   * A right-click on a card with a mouse: the card joins the selection and
   * the selection's panel opens beside the pointer (review 2026-10-01,
   * UX-11). The bottom-right corner is the thumb's rule; a mouse is wherever
   * it clicked, and the corner was up to a screen's width away. The burger
   * still opens the same panel in the corner — this is a second way, not a
   * replacement. Joins rather than toggles: right-clicking a picked card
   * must not unpick the one thing being asked about.
   */
  const [selPanelAt, setSelPanelAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menuOpen) setSelPanelAt(null);
  }, [menuOpen]);
  const handlePointerMenu = useCallback((note: Note, at: { x: number; y: number }) => {
    setSelected((prev) => (prev.includes(note.id) ? prev : [...prev, note.id]));
    setMoving(false);
    setSelPanelAt(at);
    setMenuOpen(true);
  }, []);

  const handleLongPress = useCallback((note: Note) => {
    setSelected((prev) => toggled(prev, note.id));
  }, []);

  // Archived by the hand — let go on the creature or on the Archive tab — and
  // offered back like any archive.
  const archiveCarried = (sources: Note[]) => {
    leaveMark.current = markFor("archived");
    bulkUpdate(sources.map((n) => n.id), { status: "archived" });
    setSelected((picked) => picked.filter((id) => !sources.some((n) => n.id === id)));
    pushUndo({
      message: `Archived ${sources.length}`,
      steps: sources.map((n) => ({ id: n.id, expect: { status: "archived" as const }, revert: { status: n.status } })),
    });
  };
  // Holding a card and carrying it on to another merges the pair, on to the
  // creature archives it, on to a board files it there — the board's half of
  // the gesture (lib/useMergeDrag.ts, lib/shelfDrop.ts).
  const { mergeDrag, startMergeDrag, moveMergeDrag, endMergeDrag } = useMergeDrag({
    inTrash,
    selected,
    notesRef,
    mergeNotes,
    archiveNotes: archiveCarried,
    boards,
    phone: isPhone,
    // Each board's own verb, the one its chooser row or panel row makes.
    dropOnShelf: (sources, verb) => {
      if (verb.kind === "move") doMove(verb.boardId, undefined, sources);
      else if (verb.kind === "links") doMoveLinks(sources);
      else if (verb.kind === "trash") doTrash(sources);
      else archiveCarried(sources);
    },
  });
  /** The shelf as the drawer draws it, Trash last — and the drop drawer too. */
  const shelfRows = [
    ...boards.map((b, i) => ({ id: b.id, name: b.name, kind: b.kind, count: counts[i], icon: b.icon, tint: boardTint(b) })),
    ...(trashHidden && !inTrash ? [] : [{ id: TRASH_BOARD.id, name: TRASH_BOARD.name, kind: TRASH_BOARD.kind, count: trashCount }]),
  ];
  const dropMarks = (id: string) => ({
    "data-drop-target": mergeDrag?.shelfId === id || undefined,
    "data-refuses": mergeDrag?.refuses?.includes(id) || undefined,
  });


  /** Close the selection's panel, then act — every row of it goes through
   *  here, so a verb never runs with the panel still up over the board. */
  function then(act: () => void) {
    setMenuOpen(false);
    act();
  }

  /** `then` for a Move: the cards leave the board, and the focus goes to the
   *  slot they stood in (`handFocusToCard`) instead of the page. */
  function thenKeepCursor(act: () => void) {
    const slot = cardSlot(grid, selected);
    then(act);
    handFocusToCard(grid, [], slot);
  }

  function doMerge() {
    mergeNotes(selectedNotes);
  }

  // The one-note writes the Sorter and the Ticker make (lib/useSorterVerbs.ts).
  const {
    sortFile,
    sortLinks,
    sortPriority,
    sortTodo,
    sortRemind,
    offerListUndo,
    sortRestore,
    sortUnsort,
  } = useSorterVerbs({
    update,
    bulkUpdate,
    pushUndo,
    notesRef,
    leaveMark,
    setReminder: handleSetReminder,
    nameOf,
  });
  // The share's Inspiration offer, accepted: the Sorter's own one-note filing
  // (`filePatch`, the "Moved 1" offer back), reached by a ref because
  // `useCapture` is called long before `sortFile` exists.
  fileOfferedRef.current = (id, boardId) => {
    const note = notesRef.current.find((n) => n.id === id);
    if (note && note.board_id !== boardId) sortFile(note, boardId);
  };

  /**
   * Puts the open note's link previews away, or brings them back (`hide`
   * false), by address. The text is never touched: the flag goes on the links'
   * entries in `link_previews` (`withPreviewsHidden`), which sync like any
   * other field. Offered back through the ordinary undo, `inPlace` because the
   * note stays open — a `link_previews` step that fires only while the note
   * still holds the list this write made, so a preview that arrived from an
   * unfurl or the other device in the meantime is never overwritten by a late
   * undo.
   */
  const setPreviewsHidden = useCallback(
    (id: string, hrefs: string[], hide: boolean) => {
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;
      const next = withPreviewsHidden(note.body, note.link_previews, hrefs, hide);
      if (!next) return;
      const count = hrefs.length;
      update(id, { link_previews: next });
      pushUndo({
        message: hide ? `Hid ${count === 1 ? "preview" : `${count} previews`}` : `Showed ${count}`,
        inPlace: true,
        steps: [
          {
            id,
            expect: { link_previews: next },
            revert: { link_previews: note.link_previews ?? [] },
          },
        ],
      });
    },
    [update, pushUndo],
  );

  /** Into the Keep import, from the menu or the empty Inbox. Its one undo is
   *  written beside the rest of it (`trashImport` in `lib/keepImport.ts`),
   *  so none of it rides on the first paint. */
  const openKeepImport = useCallback(() => {
    setMenuOpen(false);
    setSettingsOpen(false);
    leaveMode();
    setImportFrom("keep");
    setKeepOpen(true);
  }, [leaveMode]);
  /** Into the same layer, for a spår download (`components/SparImport.tsx`). */
  const openSparImport = useCallback(() => {
    setMenuOpen(false);
    setSettingsOpen(false);
    leaveMode();
    setImportFrom("spar");
    setKeepOpen(true);
  }, [leaveMode]);

  // The public demo's sample notes go in through the Keep import's own door
  // (`demo/sampleNotes.ts`), so the empty Inbox's offer is handed the same
  // verbs the import is. A literal `false` in every other build, where this
  // line and the module behind it are dropped.
  if (DEMO) offerSampleStore({ importNotes, notes: () => notesRef.current, bulkUpdate, editBoards, pushUndo, inspirationId: () => inspiration?.id ?? null });

  /** How many notes are currently filed in each board — the same counts the
   *  header row and the Shelf already compute, looked up by id for the
   *  choosers and for the Sorter's destinations. */
  const countById = useMemo(
    () => new Map(boards.map((b, i) => [b.id, counts[i]])),
    [boards, counts],
  );
  const filedCount = useCallback((id: string) => countById.get(id) ?? 0, [countById]);

  /** The open note's own Move mark — one note, one board, same as the
   *  selection panel's `doMove` (`useSelectionVerbs`, below) but without
   *  touching a selection. */
  const fileNoteInBoard = useCallback(
    (id: string, boardId: string | null) => {
      const note = notesRef.current.find((n) => n.id === id);
      leaveMark.current = "move";
      const patch: Partial<Note> = note ? filePatch(note, boardId) : { board_id: boardId };
      // Moving a note in the Trash takes it out, as filing does in Tidy up:
      // a note "rescued" into a board must not go on counting down (audit
      // 2026-10-10, UX-2). One undo puts both back.
      if (note?.status === "trashed") patch.status = "active";
      update(id, patch);
      if (note) holdMove(note, patch, movedWords(1, nameOf(boardId)));
    },
    [holdMove, update, nameOf],
  );

  /** The open note's Move chooser, Links row (`keptOnLinks`). */
  const putNoteOnLinks = useCallback(
    (id: string) => {
      const note = notesRef.current.find((n) => n.id === id);
      leaveMark.current = "move";
      const patch: Partial<Note> = linksPatch();
      if (note?.status === "trashed") patch.status = "active"; // as above (UX-2)
      update(id, patch);
      if (note) holdMove(note, patch, "Moved 1 to Links");
    },
    [holdMove, update],
  );

  /**
   * The open note's Todo-toggle mark — the one field left that a person sets by
   * hand rather than the app ever guessing (CLAUDE.md, Enrichment).
   *
   * Symmetric: on writes `"todo"`, off writes `"note"`. Off used to write
   * `null`, which is not an answer — it is the absence of one — so on a note
   * that is a checklist by its own text the toggle wrote a field and moved
   * nothing. `"note"` is what makes *"this list is not a to-do list"* sayable;
   * `isTodoNote` in `lib/boards.ts` is where both halves of that are stated.
   */
  const handleToggleTodo = useCallback(
    (note: Note) => {
      leaveMark.current = "todo";
      update(note.id, { note_type: isTodoNote(note) ? "note" : "todo" });
    },
    [update],
  );

  // What the selection's panel does to the notes picked
  // (lib/useSelectionVerbs.ts).
  const {
    doArchive,
    doCopy,
    doPriority,
    doTodo,
    doClearReminder,
    doMove,
    doMoveLinks,
    doMoveCreate,
    doTrash,
    doRestoreFromTrash,
  } = useSelectionVerbs({
    selected,
    selectedNotes,
    setSelected,
    update,
    bulkUpdate,
    pushUndo,
    leaveMark,
    notesRef,
    leaveIdea,
    createBoard,
    removeBoard,
    leaveBoard,
    setMoving,
    setMoveError,
    nameOf,
    boards,
  });
  closeCanvasRef.current = () => {
    if (!canvasId) return;
    const ideaId = openCanvas?.idea_id;
    dropCanvas();
    if (!ideaId) return;
    // The board is inert until the canvas has left, and a grid filling in may
    // not have drawn the card yet: look again for a moment before giving up.
    let tries = 0;
    const focusCard = () => {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>(".card[data-id]"),
      ).find((c) => c.dataset.id === ideaId);
      card?.focus();
      if (document.activeElement !== card && ++tries < 10) window.setTimeout(focusCard, 50);
    };
    window.setTimeout(focusCard, 0);
  };
  // The grid's keys: arrows and Home/End walk the cards, Delete trashes the
  // selection or the focused card. Called here rather than beside the other
  // effects because it takes `doTrash` and `handleSetStatus` by value, and
  // both are declared above this line and below the effects.
  useGridKeyboard({
    grid,
    covered: gridCovered,
    selecting,
    notesRef,
    // In the Trash, Delete is the panel's Delete for good, and asks first.
    onTrashSelection: inTrash
      ? () => askToDestroy(selected, `${selected.length} ${selected.length === 1 ? "note" : "notes"}`)
      : doTrash,
    onTrashFocused: (id) => (inTrash ? askToDestroy([id], "1 note") : handleSetStatus(id, "trashed")),
    // E, M and F (review FX-A-05): a selection goes through the panel's own
    // verbs; a lone focused card through the open note's paths, with the
    // undo the note's marks push. Nothing here in the Trash, whose panel
    // offers only Restore and Delete.
    onVerb: (verb, id) => {
      if (inTrash) return;
      const note = id ? notesRef.current.find((n) => n.id === id) : undefined;
      if (id && !note) return;
      if (verb === "archive") {
        if (!note) return doArchive();
        const slot = inReadingOrder(
          Array.from(grid?.querySelectorAll<HTMLElement>(".card[data-id]") ?? []),
        ).findIndex((c) => c.dataset.id === id);
        handleSetStatus(note.id, note.status === "archived" ? "active" : "archived");
        // The slot is filled by the card after it; keep the cursor there, as
        // Delete does.
        focusSlot(grid, slot);
      } else if (verb === "flag") {
        if (!note) return doPriority();
        // The Sorter's one-note mark: the same write and the same "Marked
        // important 1" / "Unmarked 1" every other path reports.
        sortPriority(note);
      } else {
        // Move is the selection panel's chooser; a lone card is picked first,
        // so there is one chooser and one set of rows (Links, Inbox, undo).
        moveKey.open(note?.id ?? null);
      }
    },
  });
  // "Gained nothing" is every one of these at once: no strokes, no labels, no
  // absorbed notes, the seed heading still unrenamed, and nothing attached.
  // One stroke, one rename or one absorbed note and the sketch is a real note
  // that stays — deleting it is then the user's call, through the trash like
  // everything else. Silent on purpose: nothing the user made is being taken,
  // so there is nothing to offer back.
  sweepSketch.current = (id: string) => {
    const folder = folders.find((f) => f.id === id);
    const note = folder ? notesRef.current.find((n) => n.id === folder.idea_id) : undefined;
    if (!folder || !note || note.source !== "draw" || note.status !== "active") return;
    const untouched =
      folder.strokes.length === 0 &&
      folder.text_elements.length === 0 &&
      folder.items.length === 0 &&
      note.body === SKETCH_SEED &&
      note.attachments.length === 0;
    if (!untouched) return;
    leaveMark.current = "trash";
    update(note.id, { status: "trashed" });
  };

  /**
   * A note opened from its place on a canvas. Stable on purpose: `CanvasSheet`
   * lists it among `endNoteDrag`'s dependencies and hands the result to every
   * `memo(NoteCapsule)`, so an inline arrow here rebuilt every capsule's
   * pointer handlers on every render of this file while a canvas was open —
   * the memo bought nothing. `openById` is four setters, all stable.
   */
  const openFromCanvas = useCallback(
    (note: Note, from: DOMRect) => openById(note.id, from),
    [openById],
  );

  // The archive is local, so the archive is what paints. Resolving the
  // session can involve a network round-trip (a token inside its expiry
  // margin is refreshed before getSession() answers), and for most of a
  // year that round-trip stood here as a full-screen hourglass in front of
  // notes that were already on the device — the exact spinner-on-the-hot-path
  // the invariants forbid. Auth now settles behind the grid: the stored
  // session belongs to whoever last used this browser, which is whose notes
  // IndexedDB is holding, so painting them first exposes nothing. The one
  // case that still waits is a browser with no stored session and no
  // device-only choice — its only next screen is sign-in, and flashing a
  // grid under it would be worse than the moment of quiet.
  //
  // The ownership claim is unchanged in what it protects: a *different*
  // account signing in still purges and reloads before its sync can touch
  // this store (`claimForOwner`, one local IndexedDB read), and sync still
  // waits for `ownerReady`. What changed is only what the claim gates —
  // sync, never paint.
  // On the board the creature says it, in the bubble where the wordmark stood
  // (lib/useSpeech.ts): the offer, a capture's receipt, sync and the update.
  const { said: allSaid, onPoke } = useSpeech({
    // Not over the Keep import, which carries its own Undo; not an offer made
    // inside the open note, which stands over the note. In Tidy up and Tick off
    // the run's own offers are said by the creature visiting there (`modeSaid`).
    offer:
      offer && !keepOpen && !(openId && offer.inPlace) && (sorting || ticker ? offer.key > (modeFloor.current ?? 0) : !isShort)
        ? offer
        : null,
    onUndo: undoLast,
    landed: barLine && !barLine.also && !isShort ? barLine : null,
    failed:
      session && syncState === "error"
        ? {
            label: `Sync failed: ${syncWords(syncError)}`,
            open: () => showFileNotice({ title: "Sync failed", message: syncFailedMessage(syncError) }),
          }
        : null,
    updateReady,
    onUpdate: applyUpdate,
    online,
    syncs: Boolean(session),
    working: headerMood === "working",
    syncedAt,
    unsent: unsentWorkCount,
    syncNow,
    notes,
    openNote: openSaved,
    quiet: writing || openId !== null || sorting || ticker,
  });
  // In Tidy up and Tick off the offer is said by the creature visiting the head
  // band, and the header's own (under the layer, and away) says nothing.
  const said = sorting || ticker ? null : allSaid;
  const modeSaid = (sorting || ticker) && allSaid?.key.startsWith("undo:") ? allSaid : null;
  // The creature's other moments (lib/useMascotMoments.ts).
  const { waiting: unsentWaiting } = useMascotMoments({
    online,
    syncs: Boolean(session),
    unsent: unsentWorkCount,
    notes,
    landed: barLine && !isShort ? barLine : null,
    search: gridSearching && !remindersOpen
      ? { query: gridQuery, found: visible.length, inTrash: searchMissed?.inTrash ?? 0, goToTrash: () => { leaveMode(); goToBoard(trashIndex); } }
      : null,
  });

  if (syncConfigured && !ready && !deviceOnly && !hasStoredSession()) {
    return (
      <div className="app">
        <div className="empty empty-loading mono" role="status">
          <Spinner />
          Loading
        </div>
      </div>
    );
  }

  // The one ownership state worth a whole screen: the claim itself failed,
  // so neither adopting nor purging is safe and sync must not guess.
  if (session && ownerError) {
    return (
      <div className="app">
        <Stopped message={ownerError} />
      </div>
    );
  }

  // A different account signed in over the previous one's unsent work: stop
  // and ask rather than empty the store (`HeldWork`, `claimForOwner`).
  if (session && held !== null) {
    return (
      <div className="app">
        <Suspense fallback={null}>
          <HeldWork
            count={held}
            notes={notes}
            folders={storedBoards}
            canvases={folders}
            onSignOut={() => void signOut()}
            onClear={clearAnyway}
          />
        </Suspense>
      </div>
    );
  }

  // Sign-in gates nothing but sync; the app is fully usable either way. A spår
  // server takes a password where Supabase mails a link (`useAuth`'s `method`).
  if (signedOut && (!holdsNotes || signInAsked)) {
    if (method === "password" && PasswordSignIn) {
      return (
        <Suspense fallback={null}>
          <PasswordSignIn
            signup={signup}
            error={error}
            busy={signingIn}
            onSignIn={(email, password) => void signInWithPassword(email, password)}
            onSignUp={(email, password, invite) => void signUp(email, password, invite)}
            onSkip={stayOnThisDevice}
            onSwitch={resetSent}
          />
        </Suspense>
      );
    }
    return (
      <SignIn
        sent={sent}
        error={error}
        busy={signingIn}
        onSignIn={(email) => void signIn(email)}
        onSkip={stayOnThisDevice}
        onBack={resetSent}
        onCode={(code) => void verifyCode(code)}
      />
    );
  }

  /*
   * Where the undo offer stands. It used to float over the board's bottom-right
   * corner, and so it stood on whatever was there: a card's date, the menu's
   * Search row, the + panel, the Sorter's ✕ — and a tap meant for any of those
   * undid the last action instead (review 2026-10-01, UX-01 and UX-02). Now
   * each screen gives it a place of its own, and only one screen at a time is
   * handed it: the capture bar on the board, the Sorter's face, the Ticker's
   * head band, or over the open note for an offer made inside it.
   *
   * Not over the Keep import: its summary carries the import's own Undo, and
   * a second one for eight seconds would be two buttons for one reversal. Nor
   * on About, which takes the bar away and has no place of its own for it. The
   * entry is still on the stack either way — Ctrl+Z reaches it.
   */
  const undoShown = offer && !keepOpen ? offer : null;
  const undoOver = undoShown && openId && undoShown.inPlace === true ? undoShown : null;
  // On the board the creature says it (`useSpeech` above), except on a short
  // screen, which has no header band to speak in: there it is the bar's cell.
  const undoIn = (place: "bar") => {
    if (!undoShown || undoOver) return undefined;
    if (place !== (sorting || ticker ? null : isShort ? "bar" : null)) return undefined;
    return <UndoOffer offer={undoShown} place={place} onUndo={undoLast} />;
  };

  /**
   * Sign out, or sign in to sync — the menu's row until 2026-10-11, now
   * Settings' Account section. Everything below is as it was on the row.
   */
  const accountAction = () => {
    setMenuOpen(false);
    setSettingsOpen(false);
    if (session) {
      // This browser's push subscription goes first, while there is
      // still a session to delete its row with. Left behind, the old
      // account's reminders went on ringing on a browser handed to
      // somebody else, and the next account's subscribe was refused
      // outright — row level security will not let one owner overwrite
      // another's row on the same endpoint. Best effort and bounded: a
      // server that does not answer costs the sign-out three seconds,
      // never the sign-out. `ringingOff` is not touched, because
      // nobody said this device should stop ringing — only this
      // account should.
      const released = disablePush()
        .then(setPushStatus)
        .catch((err: unknown) => console.error("releasing push on sign-out failed", err));
      const waited = new Promise<void>((resolve) =>
        window.setTimeout(resolve, PUSH_RELEASE_MS),
      );
      // A sign-out that the server never took leaves the session alive
      // and the screen unchanged, which is indistinguishable from
      // having worked — during the one flow where that matters, since
      // the person may be about to hand the computer on. `SignIn`
      // renders the auth error and is unreachable while a session
      // exists, so it is said here.
      //
      // One that went through on a device holding notes asks what to
      // do with them (audit 2026-10-10, SEC-2): a deliberate sign-out
      // is not a session lapsing, and on a borrowed computer the notes
      // must be removable. Keep is today's board with its sign-in line.
      void Promise.race([released, waited])
        .then(() => signOut())
        .then((ok) => {
          if (ok) {
            if (notesRef.current.length > 0) askAboutSignOut();
            return;
          }
          showFileNotice({
            title: "Still signed in",
            message:
              "The server did not answer, so this device is still signed in. " +
              "Try again once there is a connection.",
          });
        });
    } else {
      offerSignIn();
    }
  };

  /*
   * Search is revealed, not resident, and it lives in the board row rather
   * than opening a row of its own above it — a field popping in above the tabs
   * pushed the whole board (and the grid under it) down the moment you tapped
   * the icon, which read as the screen lurching for something used a few times
   * a week. Open, it takes the exact slot the board tabs sit in, at the same
   * height, so nothing else on screen moves. Suggestions beside it (recent
   * terms, a matching board) are an overlay riding on top of the grid rather
   * than a row that pushes the grid down and back up as they appear and
   * disappear.
   *
   * **One row, drawn in one of two places** (`rowAtFoot`): above the grid,
   * as it always was, or — on a phone whose owner chose it in Settings — at
   * the foot, standing on the capture bar where the thumb is. The element is
   * built once here and placed by the return below, before `<main>` or after
   * it, so the reading and Tab order follow what is on screen rather than a
   * stylesheet moving a box that the DOM still holds at the top.
   */
  const boardRow = (
    <div
      className="board-row"
      // At the foot, the row stands down while the write field holds the
      // caret: on a phone that is the keyboard up, and the forty pixels it
      // would keep are a fifth of what the keyboard leaves. Hidden, never
      // unmounted, so search's state and its field survive the moment.
      hidden={rowAtFoot && writing ? true : undefined}
      // Covered by the drawer (which the dismiss layer seals off), by the
      // Sorter, the Ticker and the idea canvas, all of which are full-screen
      // — so it has to leave the tab order, not merely sit behind something. The
      // same half of the rule `main` follows below, and the same narrowing:
      // see the comment there for why this is not simply `gridCovered`.
      inert={inertRow ? true : undefined}
    >
      {searchOpen ? (
        <>
          {/* Look only here — offered on a folder, the Archive and Links
              (`canScopeSearch` says why those), off every time search
              opens. A cell at the row's left end, where the burger stood a
              moment ago, and never anywhere that comes and goes with the
              query: it is drawn from the first frame the row is open, so
              typing moves nothing, and it takes width from the field rather
              than height from the grid. Chrome, so on is raised, not
              inverted (DESIGN.md §5), and it says what it does
              in words — the board's mark, in its tint, and "Only here"; the
              name stays in its accessible name and its title (review UX-06). A tap
              must not take the caret out of the field (and put the phone's
              keyboard away), so the press is refused focus; Tab still
              reaches it, and Space or Enter toggles it like any button. */}
          {canScopeSearch(board) && (
            <button
              type="button"
              className="search-scope"
              style={tintOf(board)}
              aria-pressed={searchScoped}
              aria-label={`Only here, in ${board.name}`}
              title={searchScoped ? `Searching only ${board.name}` : `Search only ${board.name}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setSearchScoped((on) => !on)}
            >
              <BoardIcon kind={board.kind} icon={board.icon} />
              <span className="search-scope-name">Only here</span>
            </button>
          )}
          <input
          ref={searchInput}
          className="search"
          data-counted={fieldCount ? true : undefined}
          value={query}
          onChange={(e) => {
            timeToFrame("find");
            setQuery(e.target.value);
          }}
          // Search reads active and archived notes and never the trash —
          // that is the invariant, not an oversight. But the field is drawn
          // on the Trash board like any other, so a person standing in the
          // bin looking for the note they deleted typed its name, got an
          // empty screen, and had every reason to conclude it had already
          // been swept. The field says what it is searching instead — and
          // where a scope is offered beside it, which of the two it is.
          placeholder={
            inTrash
              ? "Search (not the trash)"
              : scopeBoard
                ? `Search ${scopeBoard.name}`
                : canScopeSearch(board)
                  ? "Search everything"
                  : "Search"
          }
          // The name carries the shortcut in words wherever there is a
          // key to press, and only there: "Ctrl+K" announced on a phone
          // names a modifier the reader has no key for, which is the very
          // thing the drawn hint refuses to do.
          aria-label={
            (scopeBoard ? `Search notes in ${scopeBoard.name}` : "Search notes") +
            (keyboard ? `, ${hotkeyTitle(SEARCH_KEY)}` : "")
          }
          // The keyboard's search key without the UA's searchfield box:
          // type="search" carries -webkit-appearance metrics and its own
          // clear button, and the mark beside this field is already
          // Clear/Close. A query is machine input, so no auto-capital and
          // no spellcheck squiggles under a half-typed word — the capture
          // bar's own rule (CaptureBar.tsx).
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(e) => {
            // Enter and ↓ hand the keyboard to the results: the first card
            // takes focus, and from there the grid's own arrows, Enter and
            // Delete apply. On a phone that same move is what puts the
            // on-screen keyboard away, so the results get the whole screen.
            // With nothing found, Enter still puts the keyboard away.
            if (
              (e.key === "Enter" || e.key === "ArrowDown") &&
              !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
              !e.nativeEvent.isComposing
            ) {
              const first = inReadingOrder(
                Array.from(grid?.querySelectorAll<HTMLElement>(".card[data-id]") ?? []),
              )[0];
              if (first) {
                e.preventDefault();
                first.focus();
              } else if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
              return;
            }
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            closeSearch();
          }}
        />
          {/* The key that opens this row, drawn in the row it opens, and only
              while nothing has been typed so it never sits beside results it
              is not about. Here rather than beside the closed mark because
              the board row is forty pixels the design spends carefully: a
              hint resident in the strip would be furniture on every screen,
              and this one is only ever up while search itself is. */}
          {!searching && <Hotkey keyName={SEARCH_KEY} />}
          {/* ...and once a word is typed, the same slot says how many it
              found, beside the words that found them (`fieldCount`). */}
          {fieldCount && <Count className="search-count mono" text={fieldCount} />}
        </>
      ) : remindersOpen ? (
        /* The Reminders mode takes the same slot search takes, for the same
           reason: a mode that leaves its own navigation live invites you to
           page boards mid-mode and then wonder which of the two things you
           are looking at. Giving up the row says plainly that the shelf is
           not what is under your hands right now — and it is what stops the
           phone's row from showing a board name you are not standing on.

           A name and its mark, at the size and in the face every board name
           in this row is set in, and nothing else: the count is in the
           header where it always is, and the way out is the one mark at the
           end of the row, which is search's own control doing the job it
           already does for search. */
        <span className="board-mode">
          <IconReminder tier="inline" />
          Reminders
        </span>
      ) : isPhone ? (
        /* On a phone the shelf stands up instead of lying down: the burger
           opens it as a drawer, and what stays in the row is the board you
           are actually on. Same box as a tab — same padding, same face, same
           mark tier — so the row is exactly the height it has always been and
           nothing on screen moves when the shape changes.

           One control, not two. The burger and the name answer the same
           question ("which board, and how do I get to another one"), and a
           40px target beside a word you cannot tap is a control with a dead
           half. */
        <button
          type="button"
          ref={shelfMark}
          className="board-current"
          style={tintOf(board)}
          aria-label={`Boards: ${board.name}`}
          title="Boards"
          // No `aria-haspopup`: its only sensible value here would be
          // "true", which means *menu*, and what this opens is a tablist.
          // Expanded on its own is honest and is what a reader needs.
          aria-expanded={shelfOpen}
          onClick={() => setShelfOpen(true)}
        >
          <IconBoards on={shelfOpen} />
          <BoardIcon kind={board.kind} icon={board.icon} />
          <span className="board-current-name">{board.name}</span>
          <Count key={inTrash ? "trash" : board.id} className="tab-n" text={inTrash ? trashCount : counts[boardIndex]} still={loading || !prefsReady} />
        </button>
      ) : (
        /* On a desktop the shelf lies down as a strip, which is what a wide
           window is for: every board is in the row, the one you are on is
           raised, and changing board is one click with nothing to open
           first. The drawer is still there too, behind the burger at the
           row's left end, for the shelf too long to lie down in one row. */
        <>
          {/* The same drawer the phone has, from the same edge, opened by
              the first mark in the row. The strip is still the shortest path
              to a board that is in it — one click, nothing to open first —
              but a strip with more folders than fit hides the rest behind a
              sideways scroll, and the drawer shows the whole shelf at once
              top to bottom. Only the burger here, never the board's name:
              on a desktop the raised tab already says where you are, and a
              second copy of the name beside the strip would be the row
              saying one thing twice. */}
          <button
            type="button"
            ref={shelfMark}
            className="board-burger"
            aria-label="Boards"
            title="Boards"
            // No `aria-haspopup`, for the phone's reason: what this opens
            // is a tablist, not a menu.
            aria-expanded={shelfOpen}
            onClick={() => setShelfOpen(true)}
          >
            <IconBoards on={shelfOpen} />
          </button>
          <div
            className="boards"
            // What a carried tab scrolls when it is held near either end
            // (lib/useBoardPress.ts).
            data-shelf-scroll
            ref={(el) => { boardsScroll.current = el; }}
            onScroll={updateBoardsFade}
            // Focus arriving in the strip from outside keeps the board you
            // are on in view (review UX-B-08): Tab used to land with the
            // strip scrolled to its far end and the selected tab out of
            // sight. Optional-called for jsdom, which has no layout.
            onFocus={(e) => {
              const from = e.relatedTarget as Node | null;
              if (from && e.currentTarget.contains(from)) return;
              if (searchOpen || remindersOpen) return;
              boardTabs.current[boardIndex]?.scrollIntoView?.({
                inline: "nearest",
                block: "nearest",
              });
            }}
          >
            {/* The tablist holds tabs and nothing else (review QA-02): the
                New board control scrolls beside it in the same strip, the
                burger and "N more" stand outside, and the Trash tab — pinned
                outside the scroller so it never clips off the edge — is
                still a member, by `aria-owns`. */}
            <div
              className="boards-tabs"
              role="tablist"
              aria-label="Boards"
              aria-orientation="horizontal"
              aria-owns={trashHidden && !inTrash ? undefined : "board-tab-trash"}
            >
            {boards.map((b, i) => {
              // No rule between the places and the app's own boards any more
              // (2026-10-12, owner): the lifted band (`data-lens`) marks where
              // they begin. `isBuiltIn` in lib/boards.ts says which side a
              // board is drawn on.
              return (
                <Fragment key={b.id}>
                  <button
                    ref={(el) => { boardTabs.current[i] = el; }}
                    id={`board-tab-${b.id}`}
                    data-board-id={b.id}
                    role="tab"
                    type="button"
                    className="board-tab mono"
                    // The lenses stand on one lifted ground (`--lens-ground`); the title names one shown as a mark (UX-08).
                    data-lens={isBuiltIn(b) || undefined} title={isBuiltIn(b) ? b.name : undefined} {...dropMarks(b.id)}
                    // The board's own hue, or no style attribute at all for a
                    // board that has none — the mark then falls through to
                    // `--muted`, exactly as every mark did before boards could
                    // be coloured.
                    style={tintOf(b)}
                    aria-selected={!searching && !remindersOpen && i === boardIndex}
                    aria-controls="board-panel"
                    tabIndex={!searching && !remindersOpen && i === boardIndex ? 0 : -1}
                    onKeyDown={(e) => onBoardKeyDown(i, e)}
                    // Hold to pick up, carry to move, let go in place for
                    // the menu; right-click for the menu at once.
                    {...boardPress.bind({ id: b.id, name: b.name }, "x")}
                    onClick={(e) =>
                      boardPress.click(e, () => {
                        leaveMode();
                        if (!backToTop(i)) goToBoard(i);
                      })
                    }
                  >
                    <BoardIcon kind={b.kind} icon={b.icon} />
                    {/* A name past about sixteen characters ends in an
                        ellipsis, with the whole of it on hover (review
                        UI-B-05): one 40-character folder made a 442px tab
                        and pushed Archive, the lenses and All off the strip. */}
                    <span
                      className="board-tab-name"
                      title={b.name.length > TAB_NAME_FITS ? b.name : undefined}
                    >
                      {b.name}
                    </span>
                    <Count className="tab-n" text={counts[i]} still={loading || !prefsReady} />
                  </button>
                </Fragment>
              );
            })}
            </div>
            {/* Creating a board costs one tap and a name — never a menu dive.
                The field opens right in the tab strip, where the folder it
                makes is about to sit. */}
            {creatingBoard ? (
              <span className="board-tab board-tab-new">
                <NewBoardName
                  className="field-words"
                  value={newBoardName}
                  max={BOARD_NAME_MAX}
                  onChange={setNewBoardName}
                  onCreate={handleCreateBoard}
                  onCancel={cancelNewBoard}
                />
              </span>
            ) : (
              <button
                type="button"
                className="board-tab board-tab-add mono"
                aria-label="New board"
                title="New board"
                onClick={startNewBoard}
              >
                <IconPlus />
              </button>
            )}
          </div>
          {/* The strip says when it holds more than it shows (review UX-04):
              how many boards are past its right edge, and a click brings
              them into view — which is what keeps All, the answer to "where
              did that note go", one click away however many folders there
              are. Scrolled to the end, it turns round and offers the way
              back. Out of the tab order: the arrow keys already walk every
              tab and scroll each into view, so this is the pointer's path. */}
          {stripHidden && (
            <button
              type="button"
              className="board-more mono"
              tabIndex={-1}
              aria-label={
                stripHidden.after > 0
                  ? `${stripHidden.after} more ${stripHidden.after === 1 ? "board" : "boards"}`
                  : "Back to the first boards"
              }
              title={
                stripHidden.after > 0
                  ? `${stripHidden.after} more ${stripHidden.after === 1 ? "board" : "boards"}`
                  : "Back to the first boards"
              }
              onClick={() => pageStrip(stripHidden.after > 0 ? 1 : -1)}
            >
              {stripHidden.after > 0 ? (
                <>
                  <span>{stripHidden.after}</span>
                  <IconStepOn />
                </>
              ) : (
                <IconStepBack />
              )}
            </button>
          )}
          {/* Outside the scroller, beside search, as a mark and a count with
              no name: Trash is the one destination that must always be
              findable, and inside `.boards` it clips off the right edge the
              moment there are enough boards to overflow the strip. */}
          {/* Hidden in Settings, it is drawn only while you are on it (the menu's Trash row). */}
          {trashHidden && !inTrash ? null : (
          <button
            type="button"
            ref={(el) => { boardTabs.current[trashIndex] = el; }}
            id="board-tab-trash"
            role="tab"
            className="board-trash mono"
            // Trash closes the lens run, on the same ground.
            data-lens="true" {...dropMarks(TRASH_BOARD.id)}
            aria-selected={inTrash}
            aria-controls="board-panel"
            tabIndex={!searching && !remindersOpen && inTrash ? 0 : -1}
            onKeyDown={(e) => onBoardKeyDown(trashIndex, e)}
            onClick={() => {
              leaveMode();
              setSelected([]);
              if (!backToTop(trashIndex)) goToBoard(trashIndex);
            }}
          >
            <BoardIcon kind="trash" />
            {/* Named in hidden words rather than `aria-label`, which replaced
                the count: every other tab is heard as "Inbox 20", this one was
                heard as only "Trash" (audit 2026-10-24, UX-010). */}
            <span className="sr-only">Trash</span>
            <Count className="tab-n" text={trashCount} still={loading || !prefsReady} />
          </button>
          )}
        </>
      )}
      {/* The fast way into search, beside the shelf it never leaves. The
          menu keeps its own entry too — this is a shortcut, not a
          replacement for it. Once open, the same button does what
          .search-close used to: with text in the field it empties it,
          empty it closes the row. Two ✕ side by side — one to clear, one
          to close — would be a puzzle, not a control.

          **It is the row's mode control, not only search's.** While the
          Reminders mode is running it closes that instead — one mark in one
          slot, and the two modes can never be on screen together, so it is
          never ambiguous which one it means. Search is what it opens when
          neither is running, which is what it has always done. This is also
          the only visible way out of the Reminders mode on a desktop, where
          there is no back gesture under the thumb. */}
      <button
        ref={searchBtn}
        type="button"
        className="board-search"
        aria-label={
          remindersOpen
            ? "Close reminders"
            : !searchOpen
              ? "Search"
              : searching
                ? "Clear search"
                : "Close search"
        }
        title={
          remindersOpen ? "Close" : !searchOpen ? "Search" : searching ? "Clear" : "Close"
        }
        onClick={() => {
          if (remindersOpen) {
            setRemindersOpen(false);
            return;
          }
          if (!searchOpen) {
            setMenuOpen(false);
            setSearchOpen(true);
            return;
          }
          if (searching) {
            // The same rule as `closeSearch`: only a query that found
            // something is offered back as a chip.
            if (foundRef.current > 0) rememberSearch(query);
            setQuery("");
            searchInput.current?.focus();
            return;
          }
          closeSearch();
        }}
      >
        {searchOpen || remindersOpen ? <IconClear /> : <IconSearch />}
      </button>

      <SearchSuggest
        open={searchOpen}
        searching={searching}
        recentSearches={recentSearches}
        matchedBoard={matchedBoard}
        onPick={setQuery}
        onJump={jumpToBoard}
      />
    </div>
  );

  return (
    // `data-board-row` is the stylesheet's whole knowledge of where the row
    // stands: the grid's foot room, the line's lift and the row's own box.
    <div className="app" data-board-row={rowAtFoot ? "bottom" : undefined}>
      {/* A rule around the window and one word, drawn over everything so it is
          answerable wherever the pointer happens to be. Nothing moves and
          nothing is dimmed — the grid underneath is what you are aiming at. */}
      {dropping && (
        <div className="dropzone mono" aria-hidden>
          <span>Drop to keep</span>
        </div>
      )}

      <header className="topbar">
        {/* The sync dot used to stand here. It is still the app's mark for
            "these two devices hold the same thing" and still rides on every
            note and file on its way up — this is the one instance that has
            been replaced, by something that can say the same thing and be
            alive while it does it.

            It leads the bar: it is the tallest thing in the header by more
            than double, and it is the app's identity now that the wordmark has
            gone (2026-10-16). What it says stands beside it, in its bubble
            (`HeaderWords.tsx`), and a poke is answered there in words.

            Rendered unconditionally, outside every branch below it, and that
            is the point: it is a running animation, and anything that took it
            off the screen and put a fresh one back would restart the breathing
            from zero on every sign-in, every board change, every re-render.
            It never navigates and it never opens anything — pressing it
            startles it and it says how sync stands, nothing else.

            `home` because this is where it lives: while the empty board draws
            it asleep, this one is away in a puff of smoke rather than a twin
            (`mascot-element.ts`), and it comes back here when that one goes. */}
        <Mascot state={headerMood} home local={!sendsFiles} speaking={said ? (said.ask ? "ask" : "say") : null} waiting={unsentWaiting} onPoke={onPoke} />
        <HeaderWords
          said={said}
          announcement={announcement}
          offerMessage={offer?.message ?? ""}
          updateReady={updateReady}
          headerCount={headerCount}
          onEndSelection={selecting ? () => setSelected([]) : undefined}
          // The public demo has no server, so the quiet word says where the
          // notes are and opens the page that says the rest; a device that
          // could sync and does not is offered the sign-in.
          quiet={
            session
              ? null
              : DEMO
                ? isPhone
                  ? null
                  : {
                      words: "Your notes stay in this browser",
                      run: () => {
                        leaveMode();
                        setAboutAt("top");
                        setAboutOpen(true);
                      },
                    }
                : syncConfigured && !isPhone
                  ? { words: "This device only", run: offerSignIn }
                  : null
          }
        />
        {/* Settings, at the far right of the band (2026-10-12, owner: "Setting
            icon in top right"). It was the menu's first row, and the menu is
            for what is reached daily; the corner opposite the creature was
            empty. The menu keeps its row only while this band is folded away
            on a short screen (`.menu-settings` in styles.css), where the corner
            does not exist. Ctrl+, still opens the same thing. */}
        <button
          type="button"
          ref={cogBtn}
          className="topbar-settings"
          aria-label="Settings"
          title="Settings"
          onClick={openSettings}
        >
          <IconSettings />
        </button>
      </header>

      {signedOut && holdsNotes && (
        <div className="storage-warning" role="status">
          <span>
            {`Not signed in. Sign in to sync ${unsentHere > 0 ? unsentHere : notes.length} ${
              (unsentHere > 0 ? unsentHere : notes.length) === 1 ? "note" : "notes"
            }.`}
          </span>
          <button type="button" className="mono" onClick={() => setSignInAsked(true)}>
            Sign in
          </button>
        </div>
      )}

      <StorageBanners
        unsaved={unsaved}
        loadFailed={loadFailed}
        onRetryUnsaved={retryUnsaved}
        held={heldNotes}
        notes={notes}
        onRetryHeld={retryHeld}
        onKeepHeldLocal={keepHeldLocal}
      />

      {!rowAtFoot && boardRow}

      {/* The board's own landmark, and inside it the tab panel the strip's
          tabs control (review QA-02): `role="tabpanel"` on the <main> itself
          overrode the landmark, so the page had no main region at all. */}
      <main
        className="scroll"
        ref={scrollRef}
        onScroll={onBoardScroll}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        /*
         * The open note is a full-screen sheet sitting on top of this, so a
         * keyboard user tabbing through it must never reach a card behind it.
         * NoteView traps Tab inside its own sheet; this is the other half —
         * the board underneath has to stop being part of the tab order at all,
         * not merely be covered by something visually in front of it. The
         * drawer, the Sorter and the idea canvas are the same case.
         *
         * **Deliberately narrower than `gridCovered`, and this is the list of
         * why.** Search puts its results *in* here, so inerting the board
         * during a search would inert the thing being searched. The menu, the
         * board menu and the new-board field are small panels the board behind
         * stays legitimately reachable under. A confirm dialog is the one real
         * candidate left out: `Dialog` hands focus back to whatever held it
         * before it opened, which is an element inside this subtree, and a
         * restore that lands while `inert` is still on fails silently and
         * drops focus to the body. Its Tab trap covers Tab, and the grid's
         * key listener now stands down for it, so the hole that mattered is
         * shut without taking that risk.
         */
        inert={inertBoard ? true : undefined}
      >
        <div
          id="board-panel"
          className="board-panel"
          role={gridSearching || remindersOpen ? undefined : "tabpanel"}
          // Named by its own tab where there is one to point at. On a phone the
          // tabs live in a drawer that is shut most of the time, and an
          // `aria-labelledby` naming an element that is not in the document is
          // not a quiet fallback — it is a panel with no name at all. So the
          // phone says the board's name outright.
          // In a mode there is no tab to point at and the board's name is not
          // what is in here, so the panel is named by the mode instead — which
          // for search is the query the user just typed and can see, and for the
          // Reminders list is a name nothing else in the markup says out loud.
          aria-labelledby={
            gridSearching || remindersOpen || isPhone
              ? undefined
              : `board-tab-${inTrash ? "trash" : board.id}`
          }
          aria-label={
            remindersOpen ? "Reminders" : gridSearching || !isPhone ? undefined : board.name
          }
        >
        {/* The stamp on a trashed card counts the days left, where every other
            board's counts an age; one quiet line says so (review 2026-10-24, UX-01). */}
        {inTrash && !gridSearching && !remindersOpen && visible.length > 0 && (
          <p className="trash-warn advice">{`Notes stay here ${TRASH_DAYS} days. The number on each is the days left.`}</p>
        )}
        {inTrash && trashWarnCount > 0 && (
          <p className="trash-warn advice" role="status">
            {`${trashWarnCount} note${trashWarnCount === 1 ? "" : "s"} leave${
              trashWarnCount === 1 ? "s" : ""
            } the trash within ${TRASH_WARN_DAYS} days`}
          </p>
        )}
        {/* **The way into a mode is a row in the menu, not a line here.**
            It was `.sort-entry`, a 40px line across the top of the board, from
            the day the Sorter existed until 2026-09-25, when the owner asked
            for it in the menu. Nothing about it was wrong except where it
            stood: forty pixels of chrome between the reader and their own
            notes, on every board that had a pile, for an offer taken perhaps
            once in a sitting — and the app's own answer to "where is a mode
            reached from" was already the menu, for Search and for Reminders.
            See `MenuPanel`'s `modeEntry` prop.

            Two things went with it and are not missed. The `data-hidden`
            dance — keeping the row's box while a search emptied it, so the
            grid did not jump forty pixels — was solving a problem a row inside
            a panel does not have. And the row's own rect, which the mode grew
            out of, now comes up from the menu row that was tapped. */}
        {/* One deck of cards that travels sideways between boards. Wrapping the
            grid rather than moving the scroller means the page keeps scrolling
            normally while the boards slide. */}
        <div className="deck" ref={deckRef}>
          {loading ? (
            <div className="empty empty-loading mono">
              <Spinner />
              Loading
            </div>
          ) : loadFailed ? (
            // Nothing, deliberately. The banner above says what happened; an
            // empty board here would say "Nothing here yet" about an archive
            // that was never read, which is the one sentence a notes app must
            // not say by mistake.
            null
          ) : visible.length === 0 ? (
            <EmptyBoard
              fetching={notes.length === 0 && syncState === "working" && !serverAnswered && !gridSearching}
              notArrived={notes.length === 0 && Boolean(session) && !serverAnswered && (syncState === "error" || syncState === "offline")}
              searching={gridSearching}
              searchWords={hitTerms.length}
              searchQuoted={hasPhrase(gridQuery)}
              remindersOpen={remindersOpen}
              headerMood={headerMood}
              speaking={said !== null}
              board={board}
              freshArchive={freshArchive}
              oldNotesOut={oldNotesOut}
              onImportKeep={openKeepImport}
              waiting={waiting}
              onGoTo={(kind) => {
                const at = boards.findIndex((b) => b.kind === kind);
                if (at >= 0) goToBoard(at);
              }}
              missed={searchMissed}
              onGoToTrash={() => {
                leaveMode();
                goToBoard(trashIndex);
              }}
              onSearchEverywhere={() => setSearchScoped(false)}
              onSearchWord={setQuery}
            />
          ) : (
            (() => {
              const cards = deck.map((note, pos) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  tabIndex={note.id === rovingCardId ? 0 : -1}
                  onOpen={handleOpen}
                  onLongPress={handleLongPress}
                  onPointerMenu={handlePointerMenu}
                  onMergeDragStart={startMergeDrag}
                  onMergeDragMove={moveMergeDrag}
                  onMergeDragEnd={endMergeDrag}
                  selecting={selecting}
                  selected={selectedIds.has(note.id)}
                  mergeDragging={Boolean(mergeDrag?.sourceIds.includes(note.id))}
                  mergeTarget={mergeDrag?.targetId === note.id}
                  trace={note.id === traceId}
                  metrics={cardMetrics}
                  online={online}
                  snapshot={snapshots.get(note.id)}
                  // The note's board is genuinely unknown from here — on
                  // All, in search and in Archive — so the folder mark in
                  // the footer says it. Every other board either has no
                  // filed notes (Inbox) or is the board in question.
                  inBoard={
                    (gridSearching ||
                      remindersOpen ||
                      board.kind === "recent" ||
                      board.kind === "archive") &&
                    isFiled(note, knownFolders)
                  }
                  boardName={note.board_id ? boardNameById.get(note.board_id) : undefined}
                  // Handed over only once the set is in memory, so a card that
                  // drew the folder on the frame before redraws when it lands.
                  boardIcon={
                    note.board_id
                      ? (() => {
                          const icon = boardIconById.get(note.board_id);
                          // Inspiration's mark is drawn, not loaded: no icon set to wait for.
                          return icon === INSPIRATION_MARK || iconsReady ? (icon ?? undefined) : undefined;
                        })()
                      : undefined
                  }
                  terms={hitTerms}
                  row={rows}
                  onTodos={slips}
                  reminders={remindersOpen && !gridSearching}
                  sendsFiles={sendsFiles}
                  wall={wall}
                  pos={wall ? pos : undefined}
                />
              ));
              // One listener rather than a prop per card: React's `onFocus` is
              // `focusin` and bubbles, so it catches Tab, a click, and the
              // `.focus()` the arrow keys make, all through the same line.
              const onFocus = (e: React.FocusEvent<HTMLElement>) => {
                const card = (e.target as HTMLElement).closest?.(".card[data-id]");
                const id = card instanceof HTMLElement ? card.dataset.id : undefined;
                if (id) setRovingId(id);
              };
              // Past the last mounted card, while there are more and it is
              // the growth (not the fill's first screenful) holding them back:
              // what `useDeckGrowth` watches to bring in the next page. During
              // the fill it would sit forty cards down, always in reach, and
              // ask for page after page until the board was whole.
              const more = wantsEnd ? (
                <div className="deck-more" ref={setDeckEnd} aria-hidden="true" />
              ) : null;
              return wall ? (
                <>
                  <Suspense fallback={null}>
                    <Wall notes={deck} cards={cards} gridRef={setGrid} onFocus={onFocus} />
                  </Suspense>
                  {more}
                </>
              ) : (
                <>
                  <div className="grid" data-rows={rows} data-slips={slips || undefined} ref={setGrid} onFocus={onFocus}>
                    {cards}
                  </div>
                  {more}
                </>
              );
            })()
          )}
        </div>
        </div>
      </main>

      {rowAtFoot && boardRow}

      <Vanish ghosts={ghosts} onDone={clearGhosts} />
      <CarryTag drag={mergeDrag} notes={notes} boards={boards} />

      {wallView && (
        <Suspense fallback={null}>
          <WallViewer
            notes={visible}
            startId={wallView.id}
            origin={wallView.origin}
            register={registerWall}
            onClose={closeWallView}
            onOpenNote={(id) => {
              const card = document.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(id)}"]`);
              setWallView(null);
              openById(id, card?.getBoundingClientRect() ?? null);
            }}
          />
        </Suspense>
      )}

      {/* `anyFiled` is what draws the chooser's Inbox row: the same test the
          open note's own Move mark makes about its one note, asked of a
          selection. Through `isFiled`, the app's single definition of unfiled,
          and never `board_id === null` — every one of the imported notes
          carries no such field at all. */}
      {/* Opened from the burger, or on a desktop by a right-click on a card,
          which opens it at the pointer (`selPanelAt`) — see `SelectionBar`. `then`
          closes the panel before a verb runs: most verbs end the selection
          and the effect above would close it a frame later anyway, but that
          frame is `menuOpen && !selecting`, which is the ordinary menu. */}
      {selecting && menuOpen && (
        <SelectionBar
          at={selPanelAt}
          onClose={() => setMenuOpen(false)}
          count={selected.length}
          anyArchived={selectedNotes.some((n) => n.status === "archived")}
          allTodo={selectedNotes.length > 0 && selectedNotes.every(isTodoNote)}
          // The same test `doPriority` makes, turned round: it raises unless
          // no picked note is still without the mark.
          allPriority={selectedNotes.length > 0 && !selectedNotes.some((n) => n.priority === 0)}
          anyReminder={selectedNotes.some((n) => Boolean(n.reminder_at))}
          inTrash={inTrash}
          moving={moving}
          // A note put on Links by hand is out of the Inbox too, so the row
          // that brings it back is offered for it.
          anyFiled={selectedNotes.some((n) => isFiled(n, knownFolders) || keptOnLinks(n))}
          boards={folderOrder}
          countFor={filedCount}
          moveError={moveError}
          onMoveOpen={() => {
            setMoveError(null);
            setMoving(true);
          }}
          onMoveCancel={() => void moveKey.cancel()}
          onMoveChoose={(b) => thenKeepCursor(() => doMove(b.id))}
          onMoveCreate={(name) => thenKeepCursor(() => doMoveCreate(name))}
          onMoveUnfile={() => thenKeepCursor(() => doMove(null))}
          onMoveLinks={
            selectedNotes.some(canKeepOnLinks) &&
            selectedNotes.every((n) => keptOnLinks(n) || canKeepOnLinks(n))
              ? () => thenKeepCursor(doMoveLinks)
              : undefined
          }
          onSelectAll={() => then(selectAll)}
          onCopy={() => then(doCopy)}
          onMerge={() => then(doMerge)}
          onPriority={() => then(doPriority)}
          onTodo={() => then(doTodo)}
          onClearReminder={() => then(doClearReminder)}
          onArchive={() => then(doArchive)}
          onDelete={() =>
            then(
              inTrash
                ? () => askToDestroy(selected, `${selected.length} ${selected.length === 1 ? "note" : "notes"}`)
                : doTrash,
            )
          }
          onRestore={() => then(doRestoreFromTrash)}
          onCancel={() => then(() => setSelected([]))}
        />
      )}

      {/* The shelf, stood up. Everything it does it does through the handlers
          the strip already uses — the same step, the same hold that carries a
          board or opens BoardMenu, the same new-board field — so there is one
          shelf with two shapes rather than two shelves to keep in agreement. */}
      {/* A phone's shelf, brought in for a note carried up to the board row. */}
      {isPhone && mergeDrag?.drawer && (
        <Suspense fallback={null}>
          <ShelfDrop
            boards={shelfRows}
            icon={(b) => <BoardIcon kind={b.kind} icon={b.icon} />}
            target={mergeDrag.shelfId ?? null}
            refuses={mergeDrag.refuses ?? []}
          />
        </Suspense>
      )}
      {shelfOpen && (
        <Shelf
          // On a phone the drawer is the only shelf on screen, so its rows
          // are the tabs the board panel is named by. On a desktop the strip
          // is still there behind it and already carries every `board-tab-*`
          // id, so the drawer's rows go without — two elements with one id
          // is invalid markup, not a hidden duplicate.
          alone={isPhone}
          // A folder's Look sheet opened from a row here stands over the
          // drawer; the drawer makes room for it and brings that row up.
          dressing={lookBoard?.id ?? null}
          boards={shelfRows}
          index={searching || remindersOpen ? -1 : boardIndex}
          icon={(b) => <BoardIcon kind={b.kind} icon={b.icon} />}
          registerTab={(i, el) => { boardTabs.current[i] = el; }}
          onChoose={chooseBoard}
          onStep={stepToBoard}
          // The strip's own hold, carry and menu, said along the drawer's axis.
          press={boardPress}
          onClose={() => setShelfOpen(false)}
          restoreTo={shelfReturn}
          // Opened from the note's own bar, it stands over the note.
          over={Boolean(openNote)}
          creating={creatingBoard}
          newName={newBoardName}
          nameMax={BOARD_NAME_MAX}
          onNewName={setNewBoardName}
          onStartCreate={startNewBoard}
          onCreate={handleCreateBoard}
          onCancelCreate={cancelNewBoard}
        />
      )}

      {/* The Inbox, one note at a time. A mode, not a board: it files through
          the same `board_id` write everything else files with, it is undoable
          the same way, and leaving it mid-pile costs nothing. */}
      {sorting && (
        <Suspense fallback={null}>
        <Sorter
          pile={pile}
          where={board.name}
          boards={folderOrder}
          // Inside a folder, that folder is not a destination and the Inbox
          // is one (review 2026-10-01, UX-19).
          hereId={isFilable(board) ? board.id : undefined}
          countFor={filedCount}
          onFile={sortFile}
          onLinks={sortLinks}
          onArchive={(note) => handleSetStatus(note.id, "archived")}
          // The trash, by the same path as every other delete in the app: one
          // status write, the idea bookkeeping if the note is in one, the
          // leave-mark, and eight seconds of undo. Nothing about the Sorter is
          // special here, which is the point — a note thrown out of the pile is
          // as restorable as one thrown out of the open note.
          onDelete={(note) => handleSetStatus(note.id, "trashed")}
          onUnsort={sortUnsort}
          onPriority={sortPriority}
          onTodo={sortTodo}
          onRemind={sortRemind}
          onRestore={sortRestore}
          onCreateBoard={createBoard}
          // The open note's own write: `body` only, saved at the pause.
          onEditBody={(note, body) => editBody(note.id, body)}
          onOpen={(note, from) => openById(note.id, from)}
          covered={openNote !== null}
          onClose={() => setSortingIds(null)}
          backRef={sorterBack}
          onLeft={(ids) => {
            leftLastRun.current = new Set(ids);
          }}
          nameMax={BOARD_NAME_MAX}
          origin={sorterOrigin}
          restoreTo={menuBtn}
          creature={<ModeCreature said={modeSaid} mood={headerMood} local={!sendsFiles} />}
        />
        </Suspense>
      )}

      {/* Todos, one list at a time. A mode, not a board: a tick is the same
          `body` write the open note makes, through the same `tickItem`, so it
          syncs and settles identically — the only thing this screen changes is
          how many gestures it costs. */}
      {ticker && (
        <Suspense fallback={null}>
        <Ticker
          pile={ticking}
          onTick={(note, body) => update(note.id, { body })}
          onRewrite={(note, body, message) => {
            update(note.id, { body });
            offerListUndo(note.id, note.body, body, message);
          }}
          onArchive={(note) => handleSetStatus(note.id, "archived")}
          onClose={() => setTickingIds(null)}
          origin={tickerOrigin}
          restoreTo={menuBtn}
          creature={<ModeCreature said={modeSaid} mood={headerMood} local={!sendsFiles} />}
        />
        </Suspense>
      )}

      {boardMenu && (
        <BoardMenu
          name={boardMenu.name}
          renaming={boardRenaming}
          // Rename, Look and Delete are a folder's alone: a lens is the app's,
          // named and marked by what it does, and its menu is only the two
          // Move rows that are the keyboard's way to reorder it.
          onRename={menuIsFolder ? () => setBoardRenaming(true) : undefined}
          onLook={menuIsFolder ? () => {
            setBoardLookId(boardMenu.id);
            closeBoardMenu();
          } : undefined}
          awake={boards.some((b) => b.id === boardMenu.id && b.awake === true)}
          // Stays open after the tap, as the Move rows do: the label turning
          // over is the receipt.
          onToggleAwake={menuIsFolder ? () => {
            setBoardAwake(
              boardMenu.id,
              !boards.some((b) => b.id === boardMenu.id && b.awake === true),
            );
          } : undefined}
          onSubmitRename={(name) => {
            handleRenameBoard(boardMenu.id, name);
            closeBoardMenu();
          }}
          onDelete={menuIsFolder ? () => {
            askToDeleteBoard(boardMenu);
            closeBoardMenu();
          } : undefined}
          // Which shelf is on screen decides what the two reorder rows are
          // called — "Move left" is a lie in a drawer and "Move up" is a lie in
          // a strip. A phone only ever has the drawer; a desktop has the strip
          // and, while it is open, the drawer over it — and a menu opened from
          // a drawer row is answering the drawer, whatever lies behind it. One
          // branch, in JS, exactly as this file branches rather than rendering
          // both shelves. See the block comment in `BoardMenu`.
          vertical={isPhone || shelfOpen}
          over={Boolean(openNote)}
          anchor={boardMenu.anchor}
          // A row is not drawn where the board has nowhere to go: the first
          // of its run cannot move earlier and the last cannot move later, and
          // a folder that is the only one gets neither row. Same rule as the
          // open note's list grip — "a run of one is not a list".
          onMoveEarlier={menuAt > 0 ? () => handleMoveBoard(-1) : undefined}
          onMoveLater={
            menuAt >= 0 && menuAt < menuRun.length - 1
              ? () => handleMoveBoard(1)
              : undefined
          }
          onCancel={closeBoardMenu}
        />
      )}

      {/* How a board is drawn. Reached from its own menu, one row along from
          Rename — a folder's mark and its hue are the same kind of fact as its
          name, and they are written the same way, straight into the one
          preferences row that syncs the shelf. */}
      {lookBoard && (
        <BoardLook
          name={lookBoard.name}
          icon={lookBoard.icon ?? null}
          color={lookBoard.color ?? null}
          onPick={(look) => setBoardLook(lookBoard.id, look)}
          onClose={() => setBoardLookId(null)}
          over={Boolean(openNote)}
        />
      )}

      {aboutOpen && (
        <Suspense fallback={null}>
          <About
            synced={sendsFiles}
            onClose={() => setAboutOpen(false)}
            restoreTo={noOpener}
            at={aboutAt}
            mood={headerMood}
          />
        </Suspense>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <Settings
            notes={notes}
            folders={storedBoards}
            canvases={folders}
            synced={sendsFiles}
            onClose={() => setSettingsOpen(false)}
            backRef={settingsBack}
            restoreTo={cogBtn}
            pushStatus={pushStatus}
            onEnableRing={enableRing}
            onDisableRing={disableRing}
            trashCount={trashCount}
            shelfHidden={shelfOrder.hidden}
            onHideBoard={hideBoard}
            hasInspiration={inspiration !== null}
            onOpenTrash={() => {
              setSettingsOpen(false);
              setSelected([]);
              goToBoard(trashIndex);
            }}
            onImportKeep={openKeepImport}
            onImportSpar={openSparImport}
            onAbout={() => {
              setSettingsOpen(false);
              setAboutAt("top");
              setAboutOpen(true);
            }}
            syncConfigured={syncConfigured}
            signedIn={Boolean(session)}
            onAccount={accountAction}
            // Only a spår server deletes an account from the app, and only a
            // build that reads /config.json can reach one. Gone, the session
            // ends and the sign-in screen takes over; the screen is closed so
            // it is not waiting behind the next sign-in.
            onDeleteAccount={
              RUNTIME_CONFIG && method === "password" && session
                ? (password) =>
                    deleteAccount(password).then((said) => {
                      if (said === null) setSettingsOpen(false);
                      return said;
                    })
                : undefined
            }
          />
        </Suspense>
      )}

      {keepOpen && importFrom === "spar" && (
        <Suspense fallback={null}>
          <SparImport
            notes={notes}
            folders={userBoards}
            inspiration={inspiration?.id ?? null}
            canvases={folders}
            waiting={!serverAnswered}
            stalled={syncState === "error" || syncState === "offline"}
            onImport={importNotes}
            onCanvases={importCanvases}
            store={{ notes: () => notesRef.current, bulkUpdate, editBoards, pushUndo }}
            onClose={() => setKeepOpen(false)}
            restoreTo={noOpener}
          />
        </Suspense>
      )}

      {keepOpen && importFrom === "keep" && (
        <Suspense fallback={null}>
          <KeepImport
            notes={notes}
            folders={userBoards}
            inboxSince={inboxSince}
            onTidyNow={() => {
              setKeepOpen(false);
              goToBoard(0);
              setSorterOrigin(null);
              setSortingIds(notesForBoard(notes, boards[0]).map((n) => n.id));
            }}
            onLeaveThem={() => setInboxSince(nowIso())}
            onShowNotes={(id) => goToBoard(Math.max(0, boards.findIndex((b) => b.id === id)))}
            waiting={!serverAnswered}
            stalled={syncState === "error" || syncState === "offline"}
            onImport={importNotes}
            store={{ notes: () => notesRef.current, bulkUpdate, editBoards, pushUndo }}
            onClose={() => setKeepOpen(false)}
            restoreTo={noOpener}
          />
        </Suspense>
      )}

      {menuOpen && !selecting && (
        <MenuPanel
          trashCount={trashCount}
          inTrash={inTrash}
          // The mode this board offers, and the rect of the row that opened
          // it — a mode grows out of whatever was tapped, and that is a row
          // in this panel now.
          modeEntry={modeEntry}
          onMode={(rect) => {
            if (!modeEntry) return;
            setMenuOpen(false);
            const ids = modeEntry.pile.map((n) => n.id);
            if (modeEntry.mode === "sorter") {
              setSorterOrigin(rect);
              setSortingIds(leftToBack(ids, leftLastRun.current));
            } else {
              setTickerOrigin(rect);
              setTickingIds(ids);
            }
          }}
          // The demo's sample notes stay one row away until they are in —
          // any of them active or archived (review UX-A-03). Folded away in
          // every other build.
          onSampleNotes={
            DEMO
              ? notes.some((n) => n.source === "sample" && n.status !== "trashed")
                ? undefined
                : () =>
                    loadSamples().catch((error: unknown) => {
                      console.error("the sample notes could not be written", error);
                    })
              : undefined
          }
          onSearch={() => {
            setMenuOpen(false);
            setRemindersOpen(false);
            setSearchOpen(true);
          }}
          // Both modes borrow the same grid and the same row, so opening this
          // one ends the other rather than stacking on top of it.
          reminderCount={reminding.length}
          onReminders={() => {
            setMenuOpen(false);
            closeSearch();
            setRemindersOpen(true);
          }}
          onTrash={() => {
            setMenuOpen(false);
            leaveMode();
            setSelected([]);
            goToBoard(trashIndex);
          }}
          onEmptyTrash={() => {
            setMenuOpen(false);
            askToDestroy(
              notes.filter((n) => n.status === "trashed").map((n) => n.id),
              trashCount === 1
                ? "the one note in the trash"
                : trashCount === 2
                  ? "both notes in the trash"
                  : `all ${trashCount} notes in the trash`,
            );
          }}
          // The way back from "Leave them", so that answer is never permanent.
          // Offered only while it is in force: with the whole pile already in
          // the Inbox there is nothing left outside it to bring in. The same
          // number the empty Inbox names — see `oldNotesOut`.
          oldNotesOut={oldNotesOut}
          onBringOldNotesIn={() => {
            setMenuOpen(false);
            leaveMode();
            setInboxSince(INBOX_ALL);
            goToBoard(0);
          }}
          onSettings={openSettings}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {/* The one offer that still floats: made from inside the open note,
          so it has to stand over it. Only that kind — every other offer is
          made as a note leaves, and one brought over the sheet would be
          reversed by `onReverted`, which closes the note under the hand that
          pressed it. Every other offer is handed to the screen it belongs in
          (`undoIn`). */}
      {undoOver && <UndoOffer offer={undoOver} place="over" onUndo={undoLast} />}

      {/* The capture bar is on every screen but two, and both for the same
          reason. In the Sorter and in the Ticker you are dealing with what is
          already in the pile rather than adding to it, and what is at the foot
          of those screens needs that band more than a field you are not going
          to type in. It comes back the moment either one closes. */}
      {!sorting && !ticker && !aboutOpen && !settingsOpen && !keepOpen && (
      <CaptureBar
        fieldRef={captureField}
        menuRef={menuBtn}
        onCapture={capture}
        onCaptureFiles={(files, text, choice) => takeFiles(files, text, choice)}
        findSaved={findSaved}
        twinToCreature={!isShort}
        onOpenSaved={(note) => openSaved(note.id)}
        line={(barLine && (barLine.also || isShort) ? barLine : null) ?? heldLine}
        undo={undoIn("bar")}
        onDraw={startSketch}
        menuOpen={menuOpen}
        selectedCount={selected.length}
        onMenu={() => setMenuOpen((v) => !v)}
        boards={folderOrder}
        countFor={filedCount}
        // The chooser's Inbox row is only a choice where it changes something:
        // standing on a folder, where the note would otherwise be filed into
        // it. Anywhere else the Inbox is already where the note goes.
        offerInbox={here !== null}
        // The same condition names the folder a note with nothing chosen will
        // be filed into (`captureFields`), so the mark can say so before Save.
        here={here} onTodos={filing && board.kind === "todos"}
        // The row at the foot stands down while the field has the caret; the bar names the board then.
        nameBoard={rowAtFoot && writing}
        // A board made from the bar's mark is offered back like any other (`lib/madeBoardUndo.ts`).
        onCreateBoard={(name) =>
          createWithUndo(name, { createBoard, known: folderOrder, pushUndo, notesRef, removeBoard, leaveBoard })
        }
        registerLayer={registerAdd}
        incoming={incoming}
      />
      )}

      {openCanvas && (
        // No fallback to draw: the canvas animates its own way in from the
        // card's rect, and a placeholder would be a second thing arriving.
        <Suspense fallback={null}>
        <CanvasSheet
          // Zoom is state local to this component, and it must start at 1
          // every time a canvas opens — keying on the idea's id is what
          // guarantees a remount (and so a fresh zoom) even on the one path
          // that could otherwise swap `folder`/`idea`/`notes` on an instance
          // that was already mounted, rather than opening a new one.
          key={openCanvas.id}
          folder={openCanvas}
          idea={openCanvasIdea}
          notes={notes}
          initialTool={openCanvasIdea?.source === "draw" ? "draw" : "move"}
          justMerged={freshMerge === openCanvas.id}
          where={openCanvasIdea ? homeBoard(openCanvasIdea, boards)?.name : undefined}
          onClose={closeCanvas}
          onRename={renameIdea}
          onRelease={releaseNote}
          onUnmerge={unmergeIdea}
          onDissolve={askToDissolve}
          onTrashNote={(id) => handleSetStatus(id, "trashed")}
          onDragNoteTo={moveItem}
          onOpenNote={openFromCanvas}
          onAddStroke={addStroke}
          onRemoveStroke={removeStroke}
          onRestoreStrokes={restoreStrokes}
          onClearStrokes={(canvasId) => {
            const folder = folders.find((f) => f.id === canvasId);
            if (!folder) return;
            for (const stroke of folder.strokes) removeStroke(canvasId, stroke.id);
          }}
          onResizeNote={resizeItem}
          onResizeImage={setImageWidth}
          onAddText={addText}
          onEditText={editText}
          onRemoveText={removeText}
        />
        </Suspense>
      )}

      {openNote && (
        // No fallback: the module is fetched at idle after the first paint,
        // so it is almost always here already; and the sheet animates its own
        // way in, so a placeholder would be a second thing arriving.
        <Suspense fallback={null}>
        <NoteView
          key={openNote.id}
          note={openNote}
          origin={origin}
          closing={closing}
          onClosed={noteClosed}
          onClose={closeNote}
          onEditBody={editBody}
          onEditBodyIfBase={editBodyIfBase}
          onSetStatus={handleSetStatus}
          onEmptied={handleEmptied}
          onTogglePriority={togglePriority}
          onAttach={(id, files) => {
            void withinLimit(files).then((ok) => {
              if (ok.length > 0) return attachTo(id, ok);
            });
          }}
          onDetach={detach}
          onReorderFiles={(id, attachments) => update(id, { attachments })}
          pictureTexts={pictureTexts}
          registerInner={registerInner}
          onSetReminder={handleSetReminder}
          onSetRepeat={handleSetRepeat}
          pushStatus={pushStatus}
          sendsFiles={sendsFiles}
          onEnableRing={enableRing}
          onDisableRing={disableRing}
          boards={folderOrder}
          countFor={filedCount}
          onMove={fileNoteInBoard}
          onLinks={putNoteOnLinks}
          onCreateBoard={createBoard}
          onToggleTodo={handleToggleTodo}
          onListRewritten={offerListUndo}
          onHidePreviews={setPreviewsHidden}
          // Opened from Tidy up, a swipe must not walk the board behind it.
          siblings={sorting ? [] : visible}
          siblingIndex={visible.findIndex((n) => n.id === openNote.id)}
          enterFrom={enterFrom}
          onOpenSibling={handleOpenSibling}
          // Every width's note offers the drawer. It was phone-only while the
          // drawer was, but a desktop has had one since 2026-09-16, and an
          // open note covers the strip there just as it covers the phone's
          // row — so reaching another board meant Back first. Everything
          // that makes it honest over a note (`over`, `closesElsewhere`,
          // `shelfReturn`) was never tied to the width.
          onOpenShelf={() => setShelfOpen(true)}
          shelfOpen={shelfOpen}
          shelfMark={noteShelfMark}
          // Anything standing over the note in the layer table — the drawer
          // and what it opened, a question — takes the note's Escape. The
          // picture over it is the note's own and is not counted.
          covered={coveredAbove(openLayers, "note", ["picture"])}
          closesElsewhere={closesElsewhere}
          // The same terms every result card is marked with, so the note
          // opens on the hit its card pointed at. Empty when nothing is being
          // searched, and the note then opens exactly as it always has.
          searchTerms={hitTerms}
          onSplit={splitNote}
        />
        </Suspense>
      )}

      {/* Every consequence below stays here on purpose — see Overlays.tsx. */}
      {dialogOpen && (
      <Suspense fallback={null}>
      <Overlays
        fileNotice={fileNotice}
        onCloseFileNotice={closeFileNotice}
        dissolveRequest={dissolveRequest}
        onConfirmDissolve={() => {
          const ideaId = dissolveRequest;
          if (!ideaId) return;
          closeDissolve();
          dissolveIdea(ideaId);
        }}
        onCancelDissolve={closeDissolve}
        deleteBoardRequest={deleteBoardRequest}
        onConfirmDeleteBoard={() => {
          const request = deleteBoardRequest;
          if (!request) return;
          closeDeleteBoard();
          handleDeleteBoard(request.id);
        }}
        onCancelDeleteBoard={closeDeleteBoard}
        backlogRequest={backlogRequest}
        // "Tidy up": the whole pile is the Inbox. Nothing is moved — every
        // note is already unfiled, which is precisely what the Inbox holds.
        // The question says "one at a time", so the answer also opens the
        // mode on that pile: the question is only asked on the Inbox, where
        // `inboxPile` is already the whole pile (an unanswered Inbox and one
        // answered with the epoch hold the same notes). It grows out of the
        // dialog's own button, which is what was tapped — it used to grow out
        // of the line on the board, and that line is now a row in the menu
        // that is not open.
        onSortBacklog={() => {
          closeBacklog();
          setInboxSince(INBOX_ALL);
          if (board.kind === "inbox" && inboxPile.length > 0) {
            // No origin, so it fades in rather than growing out of anything.
            // It used to grow out of the line at the top of the board; that
            // line is a row in the menu now, and the menu is not open. The
            // dialog's own button is what was tapped and would be the honest
            // shape to grow from, but `Dialog` reports a bare confirm and
            // threading a rect through it is three signatures changed for an
            // opening nobody has asked about.
            setSorterOrigin(null);
            setSortingIds(leftToBack(inboxPile.map((n) => n.id), leftLastRun.current));
          }
        }}
        // "Leave them": one date, stamped now. The old notes stay active, stay
        // on All, stay in search and stay in whatever board they are in —
        // they are simply not part of the pile the Inbox is offering to clear.
        onLeaveBacklog={() => {
          closeBacklog();
          setInboxSince(nowIso());
        }}
        // Walking away answers nothing, and it asks again next open. `asked`
        // guards only this session, so nothing has to be un-remembered.
        onDismissBacklog={closeBacklog}
        destroyRequest={destroyRequest}
        synced={sendsFiles}
        onConfirmDestroy={() => {
          const request = destroyRequest;
          if (!request) return;
          closeDestroy();
          setSelected([]);
          leaveMark.current = "trash";
          void destroy(request.ids);
          if (request.ids.length === trashCount) emptiedTrash(request.ids.length);
        }}
        onCancelDestroy={closeDestroy}
        signOutQuestion={signOutQuestion && signedOut}
        unsentHere={unsentHere}
        onKeepOnDevice={closeSignOut}
        onRemoveFromDevice={() => {
          // Emptied, then reloaded: only a reload is sure of every piece of
          // state read out of the store, and an empty, signed-out device opens
          // onto the sign-in wall. A purge that fails keeps the question up.
          purgeEverything().then(
            () => window.location.reload(),
            (error: unknown) => console.error("could not remove the notes from this device", error),
          );
        }}
      />
      </Suspense>
      )}
    </div>
  );
}
