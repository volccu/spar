import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note, Canvas, UserBoard } from "../types";
import { syncOnce } from "./sync";
import { serverKnowsCanvases, syncCanvasesOnce } from "./canvasSync";
import { serverKnowsBoards, syncBoardsOnce } from "./boardSync";
import { pullChanges, type Ahead } from "./pullChanges";
import { uploadPending } from "./attachments";
import { getBackend } from "./backend";
import { isOwnEcho, PREFS_ROW } from "./echo";
import { HELD_CANVASES, clearRefusals, type HeldNote } from "./held";
import { clearCanvasDirtySent, clearDirtySent, dirtyCanvasEntries } from "./db";
import { narrowRepairWindow, widenRepairWindow } from "./cursors";
import { isNoAnswer } from "../lib/serverWords";
/**
 * A sync usually finishes in well under a second, which made the mark flicker
 * — a blink you register as "something twitched", not as "that synced". So the
 * working state is held for one full turn of the animation, start to finish.
 * This delays only what is shown; the sync itself is never held up, and a
 * change that lands during the hold still uploads immediately.
 *
 * The number is a fact about the drawing rather than about this loop, so it
 * lives with the drawing — `SyncMark.tsx` explains why it may not live here.
 */
import { MIN_WORKING_MS } from "../components/SyncMark";

/**
 * Backstop only — the real triggers are local edits, focus, and live updates.
 *
 * It was twenty seconds while `prefs` was the one synced table with no live
 * channel, so the shelf and the Inbox date could only ever arrive on a timer
 * and the timer had to be short. All three tables have been in the realtime
 * publication since migration 0014; only the client had never subscribed to
 * the third. With every table live and a channel that now says so when it
 * fails to open, this is what it claims to be — the net under a missed
 * event — so it costs a phone three wake-ups a minute less. Everything the
 * *user* does still syncs at once: an edit, a focus, coming back online.
 */
const INTERVAL_MS = 60_000;
/** Long enough to batch a burst of typing, short enough to feel immediate. */
const DEBOUNCE_MS = 700;
/**
 * The same wait while a note is open and being typed into. At 700ms every
 * pause to think was a full tick — the RPC, an upsert of the whole row with
 * every thumbnail, the upload check, the canvas and preferences passes — so a
 * paragraph went up a dozen times. The other device does not need a note
 * mid-sentence; it needs it when the writing stops. Closing the note ends the
 * longer wait at once (the debounce is re-armed at `DEBOUNCE_MS`), and hiding
 * the app sends it straight away.
 */
const TYPING_DEBOUNCE_MS = 2_500;
/**
 * Coming back to the app fires `focus` and `visibilitychange` together, and
 * each started a tick — the second queued a complete re-run behind the first.
 * Arrivals inside this window of a tick starting are the same arrival.
 */
const ARRIVAL_GUARD_MS = 2_000;

/**
 * A failure of something that rides beside the notes — a file, a layout, the
 * folder list — kept apart so that its having had no answer is not taken for
 * the device being offline. Same message, so the screen says the same thing.
 */
class BesideNotes extends Error {
  constructor(cause: Error) {
    super(cause.message);
    this.name = "BesideNotes";
  }
}

/** Whatever was thrown, as an Error the mark can print. */
function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * How long the backstop timer waits after consecutive failures.
 *
 * A sync that fails usually fails for a reason that is still true twenty
 * seconds later — no signal in a lift, a token that has not refreshed yet, a
 * note the server will not accept. Retrying at full speed through that spends
 * the phone's battery and radio to re-learn the same thing three times a
 * minute, and keeps the mark flashing "sync failed" at somebody who cannot act
 * on it. Anything the *user* does still tries immediately: an edit, returning
 * to the app, or coming back online all bypass this entirely, because those are
 * the moments the answer has genuinely changed.
 */
const BACKOFF_MS = [0, 5_000, 20_000, 60_000, 300_000];

/**
 * A tick that got no answer at all — the network, not the server — is the
 * device being offline, whatever `navigator.onLine` says (2026-10-23: a phone
 * with its mobile data and SIM switched off still reported itself online, so
 * the creature's static never came). It is reported as `offline`, not `error`,
 * and asked again this often while the app is in front, so that the static
 * goes the moment the connection is back even when the browser never fires
 * `online` to say so. A failed tick with no network fails at once, so a probe
 * costs nothing but the attempt.
 */
const UNREACHABLE_RETRY_MS = 15_000;

/**
 * How long a tick waits on its file uploads before going on without them. A
 * film on a poor connection held the whole tick — and every note edit queued
 * behind it — for up to the fifteen-minute file deadline (bughunt 2026-10-24).
 * Past this the upload carries on by itself, and what it lands is applied when
 * it does.
 */
export const UPLOAD_WAIT_MS = 20_000;

export type SyncState = "off" | "idle" | "working" | "offline" | "error";

/**
 * Everything the loop needs to carry canvases as well as notes. Optional, so
 * the loop still describes itself as a note sync that folders ride along with —
 * which is the order they must fail in.
 */
export interface CanvasSyncPort {
  folders: Canvas[];
  /** Bumped by an arrangement gesture, so a drag pushes without waiting. */
  version: number;
  applyRemote: (folders: Canvas[]) => void;
}

/**
 * Everything the loop needs to carry the user's folder boards along too.
 * Optional for the same reason `CanvasSyncPort` is: this is the last and
 * least thing in the tick, riding along behind notes and folders rather than
 * being load-bearing for either.
 */
export interface PrefsSyncPort {
  boards: UserBoard[];
  /** The date the Inbox starts at — the same row, the same one small value. */
  inboxSince: string | null;
  /** ISO stamp of the last local change. */
  at: string;
  /**
   * Whether a change to the **folder list** here is still queued for upload.
   * Separate from `sinceDirty` on purpose — see `boardSync.ts`.
   */
  dirty: boolean;
  /** Whether a change to the Inbox date here is still queued for upload. */
  sinceDirty: boolean;
  /** Bumped by a change, so it pushes without waiting for the backstop. */
  version: number;
  applyRemote: (boards: UserBoard[], at: string, inboxSince?: string | null) => void;
  /** The server's list as this device last saw it (`boardsBase` in `useBoards.ts`). */
  base?: { readonly current: UserBoard[] | null };
  /** The merged list a push sent, laid back over this device's (`applyMergedBoards`). */
  applyMerged?: (
    merged: UserBoard[],
    sentAt: string,
    mergeBoards: (server: UserBoard[], local: UserBoard[], base: UserBoard[] | null) => UserBoard[],
  ) => void;
  /** The account's Inbox date, taken over this device's first answer (`yieldInboxSince`). */
  yieldSince?: (since: string, sentAt: string) => void;
  clearDirty: (at: string) => void;
}

/**
 * Runs the background sync loop. It never blocks the UI: if it fails, the app
 * carries on entirely from the local store and simply tries again later.
 *
 * Three things make a note appear on the other device quickly:
 *   1. a local edit schedules a push almost immediately (DEBOUNCE_MS),
 *   2. the other device is told by the server the moment a row changes,
 *   3. returning to the app re-syncs on focus.
 * The interval is only a safety net for when all three are missed.
 */
export interface SyncOptions {
  /** Signed in, the archive claimed for this owner, and the local read done. */
  enabled: boolean;
  /** A note is open and being written in: uploads wait `TYPING_DEBOUNCE_MS`. */
  typing?: boolean;
  notes: Note[];
  applyRemote: (notes: Note[]) => void;
  /** `landed` is this tick's new paths by attachment id — see `applyUploaded` in `useNotes`. */
  applyUploaded: (notes: Note[], landed?: Map<string, string>) => void;
  /** Bumped by every local change; a push follows within DEBOUNCE_MS. */
  localVersion: number;
  canvas?: CanvasSyncPort;
  prefs?: PrefsSyncPort;
}

export function useSync({
  enabled,
  typing = false,
  notes,
  applyRemote,
  applyUploaded,
  localVersion,
  canvas: canvasSync,
  prefs: prefsSync,
}: SyncOptions) {
  const [state, setState] = useState<SyncState>("off");
  /**
   * Whether a tick is genuinely in flight this instant.
   *
   * Deliberately not the same fact as `state === "working"`, which is held
   * open for a full turn of the sync mark's animation (MIN_WORKING_MS) so the
   * mark cannot flicker. That hold is right for a mark and useless as an
   * input: anything wanting to *decide* whether a sync is worth drawing at all
   * — the mascot's 250ms threshold — has to measure the real window, or every
   * sync already looks like it took a second and a half. It also stays true
   * across a re-run queued by a change that landed mid-flight, so overlapping
   * saves are one span rather than several.
   */
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  /** When the last tick finished clean — what the creature says when poked
   *  ("All synced · 2 minutes ago", `lib/useSpeech.ts`). Kept for this session only. */
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  /**
   * Notes the server will not take, held rather than retried forever
   * (`held.ts`). State rather than a read, because the two ways out of it are
   * offered on screen and both end in a tick that answers for itself.
   */
  const [held, setHeld] = useState<HeldNote[]>([]);
  /** Idea layouts held the same way (`canvasSync.ts`), named by their idea. */
  const [heldCanvases, setHeldCanvases] = useState<HeldNote[]>([]);
  /**
   * Whether a pull has come back and been applied at least once in this
   * session. Latched: the one question it answers is whether what is on screen
   * has been told about the other device yet, and after the first pull it has.
   */
  const [pulledOnce, setPulledOnce] = useState(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const canvasRef = useRef(canvasSync);
  canvasRef.current = canvasSync;
  const prefsRef = useRef(prefsSync);
  prefsRef.current = prefsSync;
  const heldRef = useRef(held);
  heldRef.current = held;
  const heldCanvasesRef = useRef(heldCanvases);
  heldCanvasesRef.current = heldCanvases;
  const running = useRef(false);
  const again = useRef(false);
  /** The upload still on the wire, if a tick went on without it. */
  const uploadLane = useRef<Promise<Awaited<ReturnType<typeof uploadPending>>> | null>(null);
  /** What that upload failed with, raised by the next tick. */
  const uploadLate = useRef<Error | null>(null);
  const startedAt = useRef(0);
  const settle = useRef<number | undefined>(undefined);
  /** Consecutive failures, and when the last attempt began. Backoff reads both. */
  const failures = useRef(0);
  const attemptedAt = useRef(0);
  /** A local change is waiting on the debounce — what leaving the app sends. */
  const waiting = useRef(false);
  /** The next ask after a tick that got no answer (`UNREACHABLE_RETRY_MS`). */
  const probe = useRef<number | undefined>(undefined);
  /** Read by the probe, which may fire after a sign-out made this render's `run` stale. */
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /**
   * Shows the finished state, but never before the animation has had its full
   * turn. Failures land at once — a problem should not wait to be seen.
   */
  const finish = useCallback((next: SyncState) => {
    window.clearTimeout(settle.current);
    const held = Date.now() - startedAt.current;
    const wait = next === "idle" ? Math.max(0, MIN_WORKING_MS - held) : 0;
    if (wait === 0) {
      setState(next);
      return;
    }
    settle.current = window.setTimeout(() => setState(next), wait);
  }, []);

  const run = useCallback(async () => {
    if (!enabled) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      window.clearTimeout(settle.current);
      setState("offline");
      return;
    }
    // A change that lands mid-flight must not be dropped; queue one re-run.
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    waiting.current = false;
    setBusy(true);
    window.clearTimeout(settle.current);
    window.clearTimeout(probe.current);
    startedAt.current = Date.now();
    attemptedAt.current = startedAt.current;
    // A server that is down fails every tick, and the client library retries
    // inside each one: going back to "working" on every attempt flickered the
    // failure into "Syncing" about half the time (review CD-01). A failure
    // stands until a tick comes round clean — and so does being offline, or
    // every probe would flash the creature's static off and on.
    setState((was) => (was === "error" || was === "offline" ? was : "working"));
    try {
      const current = notesRef.current;
      // The first thing to go wrong on the way that must not stop the rest:
      // a file the bucket refused, a canvas or a preferences row the server
      // would not take. Each is caught where it happens so notes still sync,
      // and raised at the end so the mark says so. For a whole session the
      // mark read fine over folder sync that had stopped, because these were
      // logged to a console nobody had open.
      let late: Error | null = null;
      // What went wrong beside the notes — a file, a layout, the folder list.
      // Any of those can fail with no answer while the notes went up fine (a
      // film cut off mid-upload), and that is a failure, never "offline".
      const beside = new Set<unknown>();
      // Everything the tick will pull, asked for as one question before any
      // of it is needed (`pullChanges.ts`). Null on a server without the
      // function, and the three modules below then read for themselves; a
      // failure here is the failure their own reads are about to hit, and is
      // reported the same way.
      let ahead: Ahead | null = null;
      try {
        ahead = await pullChanges();
      } catch (error) {
        console.error("combined pull failed", error);
        late ??= asError(error);
      }
      const { pulled, refused, held: stuck, notesPulled } = await syncOnce(current, ahead);
      setHeld(stuck);
      // What arrived is applied before anything is allowed to fail. The pull
      // has already been written to IndexedDB by this point, so throwing first
      // would leave the screen behind the store until the next reload.
      if (pulled.length > 0) applyRemote(pulled);
      // In the same batch as the notes it applied, so a reader waiting on this
      // renders with them already in hand. Not on a turn whose notes read
      // failed: reminder answers wait on this, against a fresh copy.
      if (notesPulled !== false) setPulledOnce(true);

      // Files after the notes, and separately. Bytes go to storage rather than
      // to the notes table, so a storage problem — a bucket that isn't there
      // yet, a file too large — must not stop the notes themselves from
      // syncing. An attachment that fails simply keeps its empty path and is
      // tried again.
      //
      // After, not before: they used to go first, so a note carrying eleven
      // photographs did not reach the other device at all until the last byte
      // of the last one had — the thumbnails that ride in the row, which are
      // the whole reason the other device can draw the note at once, sat
      // waiting behind a minute of upload. The note goes now and says "still on
      // the other device" per file; each batch's paths go up on the re-run.
      try {
        if (uploadLate.current) {
          const failed = uploadLate.current;
          uploadLate.current = null;
          beside.add(failed);
          late ??= failed;
        }
        // One upload on the wire at a time: a tick that finds the last one
        // still going leaves it be rather than sending the same files again.
        if (!uploadLane.current) {
          const lane = uploadPending(current);
          uploadLane.current = lane;
          lane
            .finally(() => {
              if (uploadLane.current === lane) uploadLane.current = null;
            })
            .catch(() => {});
          let timer: number | undefined;
          const waited = await Promise.race([
            lane.then((result) => ({ result })),
            new Promise<null>((resolve) => {
              timer = window.setTimeout(() => resolve(null), UPLOAD_WAIT_MS);
            }),
          ]).finally(() => window.clearTimeout(timer));
          if (waited) {
            const { uploaded, failed, landed } = waited.result;
            if (failed) beside.add(failed);
            late ??= failed;
            // Straight back round, rather than waiting on the debounce or the
            // minute's backstop: the paths that just landed are what the other
            // device needs, and the rest of the pile may still be waiting. Only
            // when something landed — a batch that failed whole waits for the
            // backstop, or a missing bucket would spin here forever.
            if (uploaded.length > 0) {
              applyUploaded(uploaded, landed);
              again.current = true;
            }
          } else {
            // Still going: the notes go on syncing, and the upload is applied,
            // and followed by a tick, whenever it lands.
            void lane.then(
              ({ uploaded, failed, landed }) => {
                if (failed) uploadLate.current = failed;
                if (uploaded.length > 0) applyUploaded(uploaded, landed);
                if (enabledRef.current) void run();
              },
              (error: unknown) => {
                console.error("attachment upload failed", error);
                uploadLate.current = asError(error);
              },
            );
          }
        }
      } catch (error) {
        console.error("attachment upload failed", error);
        const failed = asError(error);
        beside.add(failed);
        late ??= failed;
      }

      // Folders after notes, and in their own try for the same reason files
      // are: a canvas is an arrangement of notes that have already synced, so
      // nothing in it is unrecoverable — while a server that has not run
      // migration 0010 yet would otherwise take the whole sync down with it.
      // Notes are the part that cannot be reconstructed and they go first.
      const port = canvasRef.current;
      if (port) {
        try {
          const outcome = await syncCanvasesOnce(port.folders, ahead?.folders);
          if (outcome.pulled.length > 0) port.applyRemote(outcome.pulled);
          setHeldCanvases(outcome.held);
          if (outcome.refused) beside.add(outcome.refused);
          late ??= outcome.refused;
        } catch (error) {
          // Reported but not raised. A canvas is reconstructible from the notes
          // it arranges, so it may never take note sync down with it — but a
          // failure that says nothing at all is how folder sync came to stop
          // for a whole session with the sync mark still reading "fine".
          console.error("canvas sync failed", error);
          const failed = asError(error);
          beside.add(failed);
          late ??= failed;
        }
      }

      // Prefs after folders, and in its own try for the same reason: nothing
      // here may ever take note sync down with it.
      const prefsPort = prefsRef.current;
      if (prefsPort) {
        try {
          const outcome = await syncBoardsOnce({
            boards: prefsPort.boards,
            inboxSince: prefsPort.inboxSince,
            at: prefsPort.at,
            boardsDirty: prefsPort.dirty,
            sinceDirty: prefsPort.sinceDirty,
            base: prefsPort.base?.current ?? null,
          }, ahead ? ahead.prefs : undefined);
          if (outcome.merged) {
            prefsPort.applyMerged?.(outcome.merged.boards, prefsPort.at, outcome.merged.mergeBoards);
          }
          if (outcome.yieldedSince !== undefined) prefsPort.yieldSince?.(outcome.yieldedSince, prefsPort.at);
          if (outcome.pushed) prefsPort.clearDirty(prefsPort.at);
          if (outcome.pulled) {
            prefsPort.applyRemote(
              outcome.pulled.boards,
              outcome.pulled.at,
              outcome.pulled.inboxSince,
            );
          }
        } catch (error) {
          console.error("board sync failed", error);
          const failed = asError(error);
          beside.add(failed);
          late ??= failed;
        }
      }

      // Everything that could arrive has arrived and everything that could be
      // applied has been. Raised last so the failure is reported without any
      // of the work being thrown away with it; a refused note first, because
      // the notes are the part that cannot be reconstructed.
      const problem = refused ?? late;
      if (problem) throw beside.has(problem) ? new BesideNotes(problem) : problem;

      setLastError(null);
      setSyncedAt(Date.now());
      failures.current = 0;
      // A clean tick: the next may step back only a few seconds rather than
      // two minutes (`STEADY_WINDOW_MS`). Any failure puts the full window back.
      narrowRepairWindow();
      finish("idle");
    } catch (err) {
      // The raw words for whoever is helping; the screen says them plainly
      // (`syncWords`, review CD-01).
      console.error("sync failed", err);
      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      failures.current += 1;
      widenRepairWindow();
      // Offline only when the notes themselves got no answer.
      if (!(err instanceof BesideNotes) && isNoAnswer(message)) {
        finish("offline");
        probe.current = window.setTimeout(() => {
          if (enabledRef.current && document.visibilityState !== "hidden") void run();
        }, UNREACHABLE_RETRY_MS);
      } else {
        finish("error");
      }
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        // Still busy: the re-run is the same span of work continuing, not a
        // new one, and letting the flag drop between the two would show as a
        // mascot that stopped walking and set off again.
        void run();
      }
      // The queued re-run may have declined — the connection dropped while
      // this tick was in flight, or sync was switched off — and a declined run
      // is still the end of this span of work. `run` claims `running` in its
      // synchronous prefix, so this reads whether the hand-over actually
      // happened; without it `busy` stayed true with nothing running, and the
      // mascot's own thresholds are measured against exactly that flag.
      if (!running.current) setBusy(false);
    }
  }, [enabled, applyRemote, applyUploaded, finish]);

  useEffect(
    () => () => {
      window.clearTimeout(settle.current);
      window.clearTimeout(probe.current);
    },
    [],
  );

  // Push local edits almost immediately rather than waiting for the timer.
  // A canvas counts as a local edit: dragging a note across it should reach the
  // phone as quickly as typing one does. So does pinning a tag.
  const canvasVersion = canvasSync?.version ?? 0;
  const prefsVersion = prefsSync?.version ?? 0;
  useEffect(() => {
    if (!enabled || localVersion + canvasVersion + prefsVersion === 0) return;
    waiting.current = true;
    const t = window.setTimeout(() => void run(), typing ? TYPING_DEBOUNCE_MS : DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [enabled, typing, localVersion, canvasVersion, prefsVersion, run]);

  // Live updates: the server tells us the moment the other device writes.
  useEffect(() => {
    if (!enabled) return;
    let debounce: number | undefined;
    let dropped = false;
    /** Each open channel's way out. */
    let notes: (() => void) | null = null;
    let canvases: (() => void) | null = null;
    let prefs: (() => void) | null = null;
    const wake = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void run(), DEBOUNCE_MS);
    };
    // A channel that fails to open is written to the console by the backend
    // (`channelStatus`): the 20-second backstop keeps the app in step, so
    // nothing on screen says live updates are off.

    getBackend().then((backend) => {
      if (!backend || dropped) return;
      notes = backend.subscribe("notes", (row) => {
        // This device's own upsert comes back through here too, and used
        // to start a second tick that pulled the row it had just pushed.
        if (isOwnEcho("notes", row)) return;
        wake();
      });

      /**
       * Folders listen on a channel of their own, and only once the table is
       * known to exist. A binding to a table the server has not got fails the
       * whole channel, not just that binding — sharing one would have traded
       * live *note* updates for live canvas updates during the window between
       * this deploying and migration 0010 being applied.
       */
      serverKnowsCanvases().then((known) => {
        if (!known || dropped) return;
        canvases = backend.subscribe("folders", (row) => {
          if (isOwnEcho("folders", row)) return;
          wake();
        });
      }, (error: unknown) => console.error("canvas realtime channel not opened", error));

      /**
       * The folder shelf and the Inbox date, on a channel of their own for
       * the same reason canvases are, and gated on the same kind of probe.
       *
       * It is the last of the three tables to get one. `prefs` has been in
       * the realtime publication since the migration that created it; the
       * client simply never listened, so a folder made on the phone reached
       * the laptop only when the backstop next fired. That is what kept the
       * backstop short, and it is why raising it waited for this.
       */
      serverKnowsBoards().then((known) => {
        if (!known || dropped) return;
        prefs = backend.subscribe("prefs", (row) => {
          if (isOwnEcho("prefs", row, PREFS_ROW)) return;
          wake();
        });
      }, (error: unknown) => console.error("board realtime channel not opened", error));
    }, (error: unknown) => console.error("realtime channels not opened", error));

    return () => {
      dropped = true;
      window.clearTimeout(debounce);
      notes?.();
      canvases?.();
      prefs?.();
    };
  }, [enabled, run]);

  /**
   * Ask again. The count is per version, so this is the same thing editing
   * the note does, said by somebody who does not want to edit it.
   */
  const retryHeld = useCallback(async () => {
    const stuck = heldRef.current;
    const layouts = heldCanvasesRef.current;
    if (stuck.length + layouts.length === 0) return;
    await clearRefusals(stuck.map((note) => note.id));
    await clearRefusals(layouts.map((canvas) => canvas.id), HELD_CANVASES);
    setHeld([]);
    setHeldCanvases([]);
    await run();
  }, [run]);

  /**
   * Keep this version here alone. The outbox entry is dropped — by the same
   * stamp rule everything else uses, so a note edited since this banner
   * appeared keeps its place in the queue — and the note stays exactly as it
   * is on this device. Editing it later offers it to the server again.
   */
  const keepHeldLocal = useCallback(async () => {
    const stuck = heldRef.current;
    const layouts = heldCanvasesRef.current;
    if (stuck.length + layouts.length === 0) return;
    await clearDirtySent(stuck.map((note) => ({ id: note.id, stamp: note.stamp })));
    await clearRefusals(stuck.map((note) => note.id));
    // An idea kept here takes its queued layout with it: the layout cannot go
    // up without its idea, so it would only be refused and asked about again.
    const stuckIds = new Set(stuck.map((note) => note.id));
    const ideaLayouts = (await dirtyCanvasEntries()).filter(
      (entry) => stuckIds.has(entry.id) && !layouts.some((canvas) => canvas.id === entry.id),
    );
    await clearCanvasDirtySent([
      ...layouts.map((canvas) => ({ id: canvas.id, stamp: canvas.stamp })),
      ...ideaLayouts,
    ]);
    await clearRefusals([...layouts, ...ideaLayouts].map((canvas) => canvas.id), HELD_CANVASES);
    setHeld([]);
    setHeldCanvases([]);
  }, []);

  useEffect(() => {
    if (!enabled) {
      window.clearTimeout(probe.current);
      setState("off");
      setBusy(false);
      // Whoever signs in next starts with a full look back.
      widenRepairWindow();
      return;
    }
    void run();
    // The backstop alone respects the backoff. Everything below it is the user
    // arriving, which is always worth one attempt however badly the last went.
    const timer = window.setInterval(() => {
      // A hidden app has nobody looking at it, and a phone should not wake its
      // radio for one. Coming back runs a tick anyway.
      if (document.visibilityState === "hidden") return;
      const wait = BACKOFF_MS[Math.min(failures.current, BACKOFF_MS.length - 1)];
      if (Date.now() - attemptedAt.current < wait) return;
      void run();
    }, INTERVAL_MS);
    // `focus` and `visibilitychange` both fire on the one return to the app;
    // whichever comes second finds a tick just started and stands down.
    const onFocus = () => {
      if (running.current || Date.now() - attemptedAt.current < ARRIVAL_GUARD_MS) return;
      void run();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
      // Leaving: whatever is waiting on the typing debounce goes now, while
      // the page is still allowed to run. The notes store flushes its own
      // pending write on the same event, and IndexedDB serves that write
      // before this tick's read of the outbox.
      else if (waiting.current && !running.current) void run();
    };
    const onOnline = () => void run();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, run]);

  // One banner names both; an idea held twice, note and layout, is named once.
  const heldAll = useMemo(
    () => [...held, ...heldCanvases.filter((canvas) => !held.some((note) => note.id === canvas.id))],
    [held, heldCanvases],
  );

  return { state, busy, lastError, syncedAt, held: heldAll, retryHeld, keepHeldLocal, pulledOnce, syncNow: run };
}
