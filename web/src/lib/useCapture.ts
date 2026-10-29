import { useCallback, useMemo, useRef, useState } from "react";
import { NO_CHOICE, type CaptureChoice, type IncomingWords } from "../components/CaptureBar";
import type { BarLine, BusyLine } from "../components/CaptureLine";
import { mascotNotice } from "../components/mascot-element";
import type { FileNotice } from "../store/useDialogs";
import type { CaptureFields } from "../store/useNotes";
import type { Board, Note, UserBoard } from "../types";
import { refsInOrder } from "./attachRefs";
import { canKeep, fileSize, filesSaid, hasContent, MAX_FILE_BYTES } from "./files";
import { presetReminder } from "./reminders";
import { receipt } from "./haptics";
import { timeToFrame } from "./speed";
import { useFileDrop } from "./useFileDrop";
import { useFilePaste } from "./useFilePaste";
import type { SharedCapture } from "./shareTarget";
import { useShareTarget } from "./useShareTarget";

interface Options {
  /** The board under the bar is a place a capture is filed by: no search, no
   *  Reminders mode and no drawer over it. */
  filing: boolean;
  /** The folder a capture with no board chosen is filed into, or null. */
  here: string | null;
  /** The board under the grid. */
  board: Board;
  /** The user's folders, so a board chosen and since deleted is let go. */
  userBoards: UserBoard[];
  /** The local archive is still being read. */
  loading: boolean;
  /** A typed capture. */
  create: (text: string, source?: string, fields?: CaptureFields) => Note | null;
  /** A capture that is files. */
  createWithFiles: (files: File[], text?: string, fields?: CaptureFields, refs?: readonly (number | undefined)[]) => Promise<Note | null>;
  /** The app's one notice dialog. */
  showFileNotice: (notice: FileNotice) => void;
  /** Mark a card to draw its border once. */
  setTraceId: (id: string) => void;
  /** What the bar says after a capture (`lib/useLandedLine.ts`). */
  landed: (note: Note, also?: { verb: string; act: () => void }) => void;
  /**
   * A note was made with a reminder chosen in the bar: the one moment worth
   * asking this device to ring, as setting one in the open note is
   * (`askToRing` in `store/useReminders.ts`).
   */
  onReminder?: (made: Note) => void;
  /** Inspiration, once the shelf has it — what a share is offered. */
  inspiration?: { id: string; name: string } | null;
  /** Files one note into one board: one write and one undo (`fileOffered` in App.tsx). */
  fileOffered?: (noteId: string, boardId: string) => void;
}

/**
 * Every way a note comes in from outside it: the capture bar's words, files by
 * the bar, a drop, a paste and the phone's share sheet. Moved out of `App.tsx`
 * whole (review PL-10); the comments are the ones it had there.
 */
export function useCapture({
  filing,
  here,
  board,
  userBoards,
  loading,
  create,
  createWithFiles,
  showFileNotice,
  setTraceId,
  landed,
  onReminder,
  inspiration,
  fileOffered,
}: Options) {
  // Held in refs so a share collected before the next render still sees the
  // latest: the share effect runs once, on whatever closure it was born with.
  const inspirationRef = useRef(inspiration ?? null);
  inspirationRef.current = inspiration ?? null;
  const fileOfferedRef = useRef(fileOffered);
  fileOfferedRef.current = fileOffered;
  // The same for the reminder's receipt: App hands a new function each render.
  const onReminderRef = useRef(onReminder);
  onReminderRef.current = onReminder;

  /**
   * Files become a note, and the note traces itself like any other capture.
   *
   * A file too large to be a note is refused by name rather than silently
   * dropped — an upload that vanishes is the exact failure that sends people
   * back to Drive. Everything under the limit still goes.
   */
  /**
   * What the bar's marks mean for the note about to be made — SPEC §2.1.
   *
   * One definition, because there are two capture paths and they must not
   * drift: words typed and saved, and a file that becomes a note of its own.
   * A file is a note here, so a file attached with the marks set carries them,
   * and both paths resolve "where does this go" the same way.
   *
   * The standing-on-a-board rule is the fallback, not the rule: it runs only
   * where the bar chose nothing, and not while search, the Reminders mode or
   * the drawer has the grid — those are layers over a board, not a place you
   * are standing.
   */
  const captureFields = useCallback(
    (choice: CaptureChoice): CaptureFields => {
      // A board chosen by hand is chosen even when it is the Inbox: `null`
      // means "not filed, on purpose", which is the one way to write a stray
      // thought while standing in a folder. `undefined` means nothing was
      // chosen and the rule above decides. A board deleted between the
      // choosing and the saving is not a destination and falls through to it.
      const chosen =
        typeof choice.board === "string" && userBoards.some((b) => b.id === choice.board)
          ? choice.board
          : choice.board === null
            ? null
            : undefined;
      const boardId = chosen !== undefined ? chosen : here;
      const todo = choice.todo || (filing && board.kind === "todos");
      return {
        ...(choice.priority ? { priority: 1 } : {}),
        ...(todo ? { note_type: "todo" as const } : {}),
        ...(boardId !== null ? { board_id: boardId } : {}),
        // The preset, resolved at Save: "in 1 hour" is an hour from the note,
        // not from the tap on the clock (review 2026-10-04, FX-B-06). A picked
        // day and time is already an instant, and its repeat goes with it.
        ...(choice.reminder
          ? {
              reminder_at:
                typeof choice.reminder === "string" ? presetReminder(choice.reminder) : choice.reminder.at,
              ...(choice.repeat ? { reminder_repeat: choice.repeat } : {}),
            }
          : {}),
      };
    },
    [filing, here, board.kind, userBoards],
  );

  /**
   * The size limit, asked once for every door a file comes in by.
   *
   * The bucket's own `file_size_limit` is this same number (migration 0005),
   * so a file over it is one the server is *guaranteed* to refuse — and an
   * attachment the server refuses is not a small loss. It keeps `path: null`
   * forever, which makes it permanently un-droppable by `pruneCache` (a file
   * that exists nowhere else is never a candidate), so it sits in the 300 MB
   * budget evicting files that did upload, and the row draws "on its way" for
   * the life of the note while every sync tick offers it again.
   *
   * The bar, the board's drop and paste, and the share sheet all asked. **The
   * open note's three doors — paste, drop and the insert panel's picker — did
   * not**, because they go straight to `attachTo`, which has no check of its
   * own. One helper, so the next door added cannot forget either.
   */
  const keptWithin = useCallback(
    async (arrived: File[]): Promise<{ files: File[]; from: number[] }> => {
      // Made ready to keep first — an iPhone photo made a JPEG, a camera-sized
      // one brought to 2560px, the place it was taken removed, a pasted
      // picture named (`lib/photoPrep.ts`) — so a 30 MB photograph is
      // measured as the 1 MB it will be kept as, not refused for the size it
      // arrived at. A chunk of its own, fetched on the first attach.
      const { prepareFiles } = await import("./photoPrep");
      // Each file remembers its place in what arrived (`from`), so a file
      // refused here leaves its `[image 2]` marker pointing at nothing rather
      // than handing its number to the next one (`lib/attachRefs.ts`).
      const content = arrived.flatMap((f, i) => (hasContent(f) ? [i] : []));
      const files = await prepareFiles(content.map((i) => arrived[i]));
      // A folder or an empty file is dropped without a word, as `useFileDrop`
      // always dropped it — there is nothing in it to explain the loss of.
      const tooBig = files.filter((f) => hasContent(f) && f.size > MAX_FILE_BYTES);
      if (tooBig.length > 0) {
        showFileNotice({
          title: "Files over the limit were not added",
          message:
            `The limit is ${fileSize(MAX_FILE_BYTES)}.\n` +
            tooBig.map((f) => `${f.name}: ${fileSize(f.size)}`).join("\n"),
        });
      }
      const kept = files.flatMap((f, k) => (canKeep(f) ? [k] : []));
      return { files: kept.map((k) => files[k]), from: kept.map((k) => content[k]) };
    },
    [showFileNotice],
  );
  const withinLimit = useCallback(async (arrived: File[]) => (await keptWithin(arrived)).files, [keptWithin]);

  const takeReady = useCallback(
    async (files: File[], text: string, choice: CaptureChoice, fromShare: boolean) => {
      const { files: ok, from } = await keptWithin(files);
      if (ok.length === 0) return false;
      // The numbers the capture bar's markers were written with: by place.
      const order = refsInOrder(files);
      // The same resolution a typed capture gets, including the folder it was
      // dropped on — a file is a note, so a file captured with the bar's marks
      // set carries them, and one dropped with nothing set is filed by where
      // you are standing exactly as before. Applied at creation rather than as
      // an update afterwards, for the same reason the typed path does it: one
      // write, one clock.
      const made = await createWithFiles(ok, text, captureFields(choice), from.map((i) => order[i]));
      if (made) {
        if (made.reminder_at) onReminderRef.current?.(made);
        setTraceId(made.id);
        // The trace says where the note landed; the nod says it was received.
        // Where the trace cannot be seen, the bar says it in words.
        mascotNotice();
        receipt();
        // A picture shared from the phone is offered Inspiration for the few
        // seconds the bar's line shows — an offer, never a guess: leaving it
        // alone leaves the note where the rules above put it.
        const into = inspirationRef.current;
        landed(
          made,
          fromShare && into && made.board_id !== into.id
            ? { verb: into.name, act: () => fileOfferedRef.current?.(made.id, into.id) }
            : undefined,
        );
      }
      // Reported back so the bar knows whether the capture it cleared itself
      // for actually happened. `false` also covers "every file was too big",
      // which the notice above has already explained — and which used to empty
      // the field anyway, for a note that was never made.
      return made !== null;
    },
    // `showFileNotice` is a state setter and so never changes; it is listed
    // because it now arrives through a hook, where the linter cannot see that.
    [createWithFiles, keptWithin, captureFields, landed, setTraceId],
  );

  /**
   * How many files are being made ready and written right now, for the bar's
   * "Adding 3 files". A HEIC can take seconds, and the bar used to show
   * nothing in the gap: the files had left its line and no note had landed.
   * Counted here, across every door (bar, drop, paste, share), because they
   * all run through `takeFiles`.
   */
  const [adding, setAdding] = useState(0);
  const takeFiles = useCallback(
    async (files: File[], text = "", choice: CaptureChoice = NO_CHOICE, fromShare = false) => {
      const n = files.filter(hasContent).length;
      setAdding((now) => now + n);
      try {
        return await takeReady(files, text, choice, fromShare);
      } finally {
        setAdding((now) => Math.max(0, now - n));
      }
    },
    [takeReady],
  );

  /** Something is being dragged over the window and will be taken if dropped.
   *  A file is a note, so the drop runs the ordinary capture path above. */
  const dropping = useFileDrop(takeFiles);

  /** ...and the same for Ctrl+V, which is how a screenshot actually arrives on
   *  a desktop. Same capture path, and it stands aside for the capture bar and
   *  the open note, both of which take their own paste first. */
  useFilePaste(takeFiles);

  /**
   * Words waiting to be put in the write field, unsaved: a page shared from
   * the phone, or the desktop bookmark's `?do=capture&text=` (review
   * 2026-10-04, FX-A-02, FX-A-03). One slot; a newer offer replaces an older
   * one the bar has not taken yet. `then` runs once the bar has them drafted.
   */
  const [incoming, setIncoming] = useState<IncomingWords | null>(null);
  const offer = useCallback((text: string, then?: () => void, boardOffer?: { id: string; name: string } | null) => {
    const words: IncomingWords = {
      text,
      ...(boardOffer ? { boardOffer } : {}),
      taken: () => {
        setIncoming((now) => (now === words ? null : now));
        then?.();
      },
    };
    setIncoming(words);
  }, []);

  /**
   * The worker's own refusals, said as the size check says its own: a file
   * left out at the door is named, never lost quietly (audit SEC-1).
   */
  const tellLeft = useCallback(
    (left: NonNullable<SharedCapture["left"]>) => {
      const more = left.count - left.names.length;
      showFileNotice({
        title: "Some shared files were not added",
        message:
          (left.full
            ? "This device ran out of room to hold them. Free some space and share them again.\n"
            : `A share holds at most ${SHARE_MAX_FILES} files and ${fileSize(SHARE_MAX_BYTES)}, ` +
              `and each file at most ${fileSize(MAX_FILE_BYTES)}.\n`) +
          left.names.map((f) => `${f.name}: ${fileSize(f.size)}`).join("\n") +
          (more > 0 ? `\n…and ${more} more` : ""),
      });
    },
    [showFileNotice],
  );

  /**
   * A share carrying files, waiting for one tap (2026-10-10, owner approved,
   * audit SEC-1). It used to be saved the moment the app opened — and any
   * website can post a form to `/share`, so any website could put pictures in
   * the notes. Now the bar says what arrived and offers Save, exactly as a
   * share of words waits in the field. One slot; the share stays parked in
   * the worker's cache until Save or Discard, so a reload brings it back.
   */
  const [held, setHeld] = useState<SharedCapture | null>(null);
  const hold = useCallback((shared: SharedCapture) => setHeld(shared), []);
  // A held share is answered once: a double tap on Save lands in the same
  // frame as the first, before the line is gone, and must not make two notes.
  const answered = useRef(new WeakSet<SharedCapture>());
  const saveHeld = useCallback(
    async (shared: SharedCapture) => {
      if (answered.current.has(shared)) return;
      answered.current.add(shared);
      setHeld((now) => (now === shared ? null : now));
      if (shared.left) tellLeft(shared.left);
      const done = () => void shared.commit();
      // The words are not the files' passengers. `takeFiles` answers `false`
      // when every file was over the limit, and the share was then dropped
      // whole — a 40 MB video shared with its title and its address took the
      // title and the address down with it. The bar has always kept typed
      // words on that answer; this is the same rule for a share.
      if (await takeFiles(shared.files, shared.text, undefined, true)) {
        done();
        return;
      }
      if (!shared.text) {
        // A refusal that will be the same refusal next time — every file over
        // the limit, or a folder — is spent here, or the share stays parked
        // and comes back on every open for good. A storage failure is the
        // other way `takeFiles` says no, and that one is left to try again.
        if (!shared.files.some(canKeep)) done();
        return;
      }
      offer(shared.text, done, inspirationRef.current);
    },
    [takeFiles, offer, tellLeft],
  );
  const dropHeld = useCallback((shared: SharedCapture) => {
    if (answered.current.has(shared)) return;
    answered.current.add(shared);
    setHeld((now) => (now === shared ? null : now));
    void shared.commit();
  }, []);
  const heldLine = useMemo<BarLine | null>(
    () =>
      held
        ? {
            key: `held-share:${held.files.length}:${held.files[0]?.name ?? ""}`,
            said: sharedSaid(held.files),
            files: held.files,
            verb: "Save",
            act: () => void saveHeld(held),
            also: { verb: "Discard", act: () => dropHeld(held) },
          }
        : null,
    [held, saveHeld, dropHeld],
  );

  // Photographs and pages sent here from the phone's own share sheet
  // (lib/useShareTarget.ts), collected once the archive is in.
  useShareTarget({ loading, offer, hold, tellLeft, inspirationRef });

  /** The bar's own save: the words typed, and Save. */
  const capture = (text: string, choice: CaptureChoice) => {
    // Everything the note is saved as — the marks, and where standing on
    // a folder puts it — resolved in one place (`captureFields`), because
    // a file capture has to answer it identically.
    //
    // One write. The priority, the type and the board go in with the
    // words, so the card lands where it belongs at once — traced there,
    // nodded at there — rather than being made unfiled and moved a tick
    // later by a second write carrying a second clock.
    timeToFrame("capture");
    const made = create(text, "web", captureFields(choice));
    if (!made) return;
    // Asked inside the press that saved, so the browser still counts it as
    // the user's own gesture.
    if (made.reminder_at) onReminderRef.current?.(made);
    // The new card lands at the top of a grid you may not be looking at
    // the top of. The trace is how it says which one it is; the mascot's
    // nod is the same fact said by the creature — where it landed, and
    // that it was received, are different halves of one receipt.
    setTraceId(made.id);
    mascotNotice();
    receipt();
    // ...and where neither can be seen, the bar says where it went.
    landed(made);
  };

  // A held share's offer is a question and outranks the work in hand.
  const addingLine = useMemo<BusyLine | null>(
    () => (adding > 0 ? { key: "adding", said: addingSaid(adding), busy: true } : null),
    [adding],
  );

  return { withinLimit, keptWithin, takeFiles, dropping, capture, incoming, offer, heldLine: heldLine ?? addingLine };
}

/** `MAX_FILES` and `MAX_TOTAL_BYTES` in `public/share-sw.js`, said in the notice. */
const SHARE_MAX_FILES = 30;
const SHARE_MAX_BYTES = 200 * 1024 * 1024;

/** What the bar says while files are being made ready: "Adding 3 files". */
export function addingSaid(n: number): string {
  return `Adding ${n} ${n === 1 ? "file" : "files"}`;
}

/** What a held share is called on the bar: "2 pictures shared", "1 file shared". */
export function sharedSaid(files: File[]): string {
  return filesSaid(files, "shared");
}

