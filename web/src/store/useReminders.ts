import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Note, ReminderRepeat } from "../types";
import {
  disablePush,
  enablePush,
  pushState,
  refreshPush,
  ringingOff,
  setRingingOff,
  type PushState,
} from "./push";
import { answerPatch, takeReminderAnswers } from "../lib/reminderActions";
import { anchorForRule, nextOccurrenceIso, spentReminder } from "../lib/reminders";
import { robotSays } from "../lib/mascotMoments";

const RING_FAILED = "Uh-oh. Reminders didn't turn on. Check the connection.";

/** How often an open app looks for a reminder that has rung and can clear. */
const SPENT_CHECK_MS = 60 * 1000;

interface Options {
  /** The one field write every reminder change goes through. */
  update: (id: string, patch: Partial<Note>) => void;
  /** The notes as they are at the moment a handler runs. */
  notesRef: RefObject<Note[]>;
  /** The local archive is still being read; no answer is collected before it is in. */
  loading: boolean;
  /** Sync is set up in this build at all. */
  syncConfigured: boolean;
  /** This device keeps its notes to itself. */
  deviceOnly: boolean;
  /** The server has been heard from once since the app opened. */
  pulledOnce: boolean;
  /** Open a note by id, with no card to grow out of. Stable. */
  onOpen: (id: string) => void;
}

/**
 * Reminders, on the app's side (SPEC §10): whether this device rings, a tapped
 * notification opening its note, the open note's reminder writes, and a Later
 * or Done pressed in the shade becoming an edit. Moved out of `App.tsx` whole
 * (review PL-10); the comments below are the ones it had there.
 */
export function useReminders({
  update,
  notesRef,
  loading,
  syncConfigured,
  deviceOnly,
  pulledOnce,
  onOpen,
}: Options) {
  // Whether a reminder set on this device will actually sound on it, and if
  // not, whether that can still be fixed from here. Assumed settled until the
  // check resolves, because the alternative is the open note flickering "not
  // on this device" for a frame on every load.
  const [pushStatus, setPushStatus] = useState<PushState>("on");

  /**
   * Reminders, arriving.
   *
   * Three small jobs, all of them once, none of them on the hot path. The
   * subscription is re-stored so a rotated endpoint or a device the sweep had
   * given up on comes back (store/push.ts); the state decides whether an open
   * note admits it will not ring here; and a tapped notification opens the note
   * it was about.
   *
   * The note is opened by id alone, with no origin rect — there is no card to
   * grow out of when the app was not on screen a moment ago. `openNote` is
   * derived from `notes` on every render, so setting the id before the archive
   * has loaded is fine: the sheet appears the moment the note does.
   */
  useEffect(() => {
    let live = true;
    void refreshPush().then(() => pushState()).then((state) => {
      if (live) setPushStatus(state);
    });

    const fromNotification = (id: string | null | undefined) => {
      if (!id) return;
      onOpen(id);
    };

    // Already open: the worker posts across rather than opening a second copy.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "open-note") fromNotification(event.data.note_id);
    };

    navigator.serviceWorker?.addEventListener("message", onMessage);

    // Cold start from a tapped notification. Cleared out of the address bar
    // straight away, or a reload weeks later reopens a note for no reason.
    // The entry's state is kept: it may be `useDismissOnBack`'s.
    const param = new URLSearchParams(window.location.search).get("note");
    if (param) {
      fromNotification(param);
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }

    return () => {
      live = false;
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
    // `onOpen` is stable, so this is registered once, as it always was.
  }, [onOpen]);

  /**
   * Setting a reminder is the one moment worth asking to interrupt.
   *
   * Not on first open, which is the ask every site makes and everyone refuses
   * on reflex. Settings has a row for it now (2026-10-11), but this is still
   * the moment the question answers itself: the user has just said they want
   * to be reminded.
   *
   * The write happens first and does not wait on the answer. `reminder_at` is
   * an ordinary field on the note — it syncs, it works offline, and it is what
   * the server sweep reads — so a refused prompt costs the reminder nothing
   * except this device's part in it, which is exactly what `ringsHere` then
   * says in the open note.
   */
  /**
   * The asking half on its own, for the capture bar's clock (review
   * 2026-10-04, FX-B-06): a note saved with a reminder already on it asks at
   * Save, under the same rule as one set in the open note.
   */
  const askToRing = useCallback(() => {
    // Asking is one thing; asking again after being told no is another. The
    // reminder panel's "Stop notifying on this device" unsubscribes, and
    // setting any later reminder used to re-subscribe silently — permission
    // is still granted, so there is no prompt and nothing on screen says the
    // bedside phone has started ringing again. The refusal is remembered
    // (`ringingOff`), and only the panel's own "Notify on this device"
    // clears it, which is the switch working in both directions the way this
    // app claims it does.
    if (ringingOff()) return;
    // The reminder itself is already written; a device that cannot ring says so
    // in the open note (`ringsHere`), so a failure here is only logged.
    enablePush()
      .then(setPushStatus)
      .catch((error: unknown) => console.error("asking this device to ring failed", error));
  }, []);

  const handleSetReminder = useCallback(
    (id: string, at: string | null) => {
      // Clearing the time clears the rule with it, in the same write and on
      // the same clock. A repeat is a fact about a series and the anchor is
      // where that series starts, so a rule left behind on a note with no
      // reminder is a series with no members — invisible, un-clearable from
      // anywhere in the UI, and waiting to repeat the next time a time is set.
      update(id, at ? { reminder_at: at } : { reminder_at: null, reminder_repeat: null });
      if (at) askToRing();
    },
    [update, askToRing],
  );

  /**
   * How often it comes round again.
   *
   * One more ordinary field write — `reminder_repeat` sits on CONFLICT_FIELDS
   * beside `reminder_at` and rides the same outbox and per-field clock. It
   * schedules nothing, because nothing about a reminder is ever scheduled from
   * the client: the sweep projects each occurrence from the anchor as it goes
   * past (migration 0020), so a rule set on a plane works the moment the phone
   * finds signal, and changing it cancels nothing that needs cancelling.
   */
  const handleSetRepeat = useCallback(
    (id: string, repeat: ReminderRepeat | null) => {
      const note = notesRef.current.find((n) => n.id === id);
      // Turning a repeat **on**, or changing it, on an anchor that is already
      // behind can project an occurrence from before the rule existed into the
      // sweep's grace window, and the phone rings for it at once — see
      // `anchorForRule`. When it would, the anchor moves to the rule's first
      // real occurrence in the same write, on the same clock as the rule.
      if (repeat && note?.reminder_at) {
        const moved = anchorForRule(note, repeat);
        update(id, { reminder_repeat: repeat, ...(moved ? { reminder_at: moved } : {}) });
        return;
      }
      // Turning a repeat **off** leaves the anchor where it is, and the anchor
      // is by then months behind: a monthly reminder set in January and
      // switched off in September became a one-shot reminder eight months
      // overdue — the card takes the overdue mark, the open note says "due 8
      // months ago", and it will never ring again, because the sweep's grace
      // window closed long ago. The series' *next* occurrence is the one thing
      // the user can have meant by "stop repeating, keep the reminder", so it
      // is written in the same clock as the rule that is being cleared.
      if (!repeat && note?.reminder_at && note.reminder_repeat) {
        const next = nextOccurrenceIso(note);
        update(id, { reminder_repeat: null, ...(next ? { reminder_at: next } : {}) });
        return;
      }
      update(id, { reminder_repeat: repeat });
    },
    [update, notesRef],
  );

  /**
   * Turning this device on for reminders, on purpose.
   *
   * Setting a reminder used to be the only thing that ever asked, which left
   * anyone who already *had* reminders set — the people it matters most to —
   * with no prompt and no control anywhere in the app. Offered from the
   * reminder panel, where somebody thinking about reminders already is.
   */
  const enableRing = useCallback(() => {
    setRingingOff(false);
    // Said by the creature, the app's one voice for a notice with no button.
    // `enablePush` answers "askable" when the browser said yes and the server
    // could not be told (offline, signed out); that is the same failure here.
    const failed = () => robotSays(RING_FAILED);
    enablePush()
      .then((state) => {
        setPushStatus(state);
        if (state === "askable" && typeof Notification !== "undefined" && Notification.permission === "granted") {
          failed();
        }
      })
      .catch((error: unknown) => {
        console.error("turning on reminders for this device failed", error);
        failed();
      });
  }, []);

  /**
   * Turning it off again.
   *
   * `disablePush` has existed, tested, since reminders shipped, and nothing
   * ever called it — so reminders were a one-way switch: a device could be
   * told to ring and never told to stop. It unsubscribes and drops this
   * device's row, which is what stops the sweep sending to it; the reminders
   * themselves are untouched, because `reminder_at` is a fact about the note
   * and this is a fact about the device.
   */
  const disableRing = useCallback(() => {
    setRingingOff(true);
    void disablePush().then(setPushStatus);
  }, []);

  /**
   * Later and Done, answered in the notification shade and collected here.
   *
   * The worker parks the press and cannot write a note (`lib/reminderActions.ts`
   * says why), so this is where one becomes an edit — through the same `update`
   * every other reminder write goes through, which is what puts it on the
   * outbox with a clock and syncs it to the other device.
   *
   * It waits for `loading`, and that is the whole reason this is an effect of
   * its own rather than a line in the arrival effect above. A press collected
   * before the archive is in memory would find no note to patch and be dropped
   * silently, which is the one failure mode a button that leaves no trace on
   * screen cannot afford. An answer for a note that has since been destroyed is
   * dropped, and should be.
   */
  const collectAnswers = useCallback(async (): Promise<Set<string>> => {
    const moved = new Set<string>();
    const answers = await takeReminderAnswers();
    for (const answer of answers) {
      const note = notesRef.current.find((n) => n.id === answer.note_id);
      // A note that has since been trashed is not the note this reminder was
      // about. Patching it would be a write, and a write resets the thirty-day
      // clock the sweep counts from (`update` bumps `updated_at`) — the same
      // fault the unfurl and the uploader were each fixed for.
      if (!note || note.status === "trashed") continue;
      const patch = answerPatch(note, answer);
      if (patch) {
        update(note.id, patch);
        moved.add(note.id);
      }
    }
    return moved;
  }, [update, notesRef]);

  /**
   * And, where there is another device, it waits for the first pull too.
   *
   * A cold open from the shade collects the moment the archive is read — and
   * that archive is this device's copy as it was when the app last ran, before
   * sync has said a word. A reminder moved on the other device since then
   * still reads as the one that rang, so the answer's occurrence check passes,
   * and the snooze's fresh clock then beats the newer move when the two meet:
   * the move is lost to a button pressed about a time that no longer existed.
   * The press is parked in the worker's cache and stamped when it was made, so
   * waiting costs it nothing. Device-only and an unconfigured build have no
   * other device to hear from, and collect as soon as the archive is in.
   */
  const answersWait = syncConfigured && !deviceOnly && !pulledOnce;

  /**
   * A reminder that rings once clears itself once it has rung (`spentReminder`;
   * 2026-10-14, owner asked). Only where something rings at all: with no
   * server — the demo, a device kept to itself — nothing ever sounds, the
   * "passed" mark is the only reminder there is, and taking it away would lose
   * it. Only while online, so a device that has not heard from the server for
   * a while does not clear a reminder another device has since moved: the
   * clear carries a fresh clock and would win the field.
   *
   * After the answers, always: a Later collected on this open is applied
   * first, so it moves the reminder on rather than finding it already gone —
   * and the notes it just moved are skipped on that pass, because `notesRef`
   * is the board's and the board has not drawn the move yet: it still holds
   * the spent time, and clearing it wiped the snooze (bughunt 2026-10-15).
   */
  const rings = syncConfigured && !deviceOnly;
  const clearSpent = useCallback((justMoved?: ReadonlySet<string>) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const now = Date.now();
    for (const note of notesRef.current) {
      if (justMoved?.has(note.id) || !spentReminder(note, now)) continue;
      // A rule this build cannot read goes with the time, as Clear does.
      update(note.id, note.reminder_repeat ? { reminder_at: null, reminder_repeat: null } : { reminder_at: null });
    }
  }, [update, notesRef]);

  useEffect(() => {
    if (loading || answersWait) return;
    let live = true;
    void collectAnswers().then((moved) => {
      if (live && rings) clearSpent(moved);
    });
    // While the app stays open, a reminder that rings now clears in its turn.
    const tick = rings ? window.setInterval(() => clearSpent(), SPENT_CHECK_MS) : 0;
    // A press made while the app is open and on screen: same path, no delay.
    const onAnswered = (event: MessageEvent) => {
      if (event.data?.type === "reminder-answered") void collectAnswers();
    };
    navigator.serviceWorker?.addEventListener("message", onAnswered);
    return () => {
      live = false;
      window.clearInterval(tick);
      navigator.serviceWorker?.removeEventListener("message", onAnswered);
    };
  }, [collectAnswers, clearSpent, loading, answersWait, rings]);

  return {
    pushStatus,
    setPushStatus,
    handleSetReminder,
    handleSetRepeat,
    enableRing,
    disableRing,
    askToRing,
  };
}
