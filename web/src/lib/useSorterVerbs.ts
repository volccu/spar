import { useCallback, type RefObject } from "react";
import type { Mark } from "../components/Vanish";
import { markedWords, type Undo } from "../store/useUndo";
import type { Note, ReminderRepeat } from "../types";
import type { Binned } from "../components/Sorter";
import { filePatch, isTodoNote, linksPatch } from "./boards";
import { movedWords } from "./movedWords";

interface Options {
  /** One note's field write. */
  update: (id: string, patch: Partial<Note>) => void;
  /** The same write over several notes at once. */
  bulkUpdate: (ids: string[], patch: Partial<Note>) => void;
  /** Offer a reversal on the undo strip. */
  pushUndo: (entry: Omit<Undo, "key">) => void;
  /** The notes as they are at the moment a handler runs. */
  notesRef: RefObject<Note[]>;
  /** Which mark a card leaving the board shrinks into. */
  leaveMark: RefObject<Mark | null>;
  /** The open note's reminder write (`handleSetReminder`): sets the time and
   *  asks this device to ring, at that moment and under that rule. */
  setReminder: (id: string, at: string | null) => void;
  /** A board's name, for the offer that says where the note went (null is the Inbox). */
  nameOf: (id: string | null) => string | undefined;
}

/**
 * The one-note writes the Sorter and the Ticker make, each with its own undo
 * (review PL-10 moved them out of `App.tsx` whole; the comments are the ones
 * they had there).
 */
export function useSorterVerbs({
  update,
  bulkUpdate,
  pushUndo,
  notesRef,
  leaveMark,
  setReminder,
  nameOf,
}: Options) {
  /**
   * Filing one note from the Sorter.
   *
   * The same write the Move panel and the open note's Move mark make — one
   * `board_id` and nothing else, no new path — so it is bookkeeping rather than
   * editing and does not drag the note to the top of a board ordered on the last
   * edit. And it is undoable the ordinary way, one step per note, exactly as any
   * other move is: the Sorter files fast, which is precisely why every filing
   * has to be reversible.
   */
  const sortFile = useCallback(
    (note: Note, boardId: string | null) => {
      const patch = filePatch(note, boardId);
      leaveMark.current = "move";
      update(note.id, patch);
      pushUndo({
        message: movedWords(1, nameOf(boardId)),
        steps: [
          {
            id: note.id,
            expect: patch,
            revert: "note_type" in patch
              ? { board_id: note.board_id ?? null, note_type: note.note_type }
              : { board_id: note.board_id ?? null },
          },
        ],
      });
    },
    [pushUndo, update, leaveMark, nameOf],
  );

  /** The Sorter's Links row — `sortFile`, said about Links (`linksPatch`). */
  const sortLinks = useCallback(
    (note: Note) => {
      const patch = linksPatch();
      leaveMark.current = "move";
      update(note.id, patch);
      pushUndo({
        message: "Moved 1 to Links",
        steps: [
          {
            id: note.id,
            expect: patch,
            revert: { board_id: note.board_id ?? null, note_type: note.note_type },
          },
        ],
      });
    },
    [pushUndo, update, leaveMark],
  );

  /**
   * The priority mark, from inside the Sorter — one note, both directions.
   *
   * The selection's own `doPriority` decides a whole mixed selection's
   * direction and then clears the selection; neither is wanted here, where
   * there is exactly one note and it stays on screen afterwards. The write
   * itself is identical, so the two cannot report different things about the
   * same note.
   */
  const sortPriority = useCallback(
    (note: Note) => {
      const was = note.priority;
      const next = was === 0 ? 1 : 0;
      update(note.id, { priority: next });
      pushUndo({
        message: markedWords("important", next === 1, 1),
        steps: [{ id: note.id, expect: { priority: next }, revert: { priority: was } }],
      });
    },
    [pushUndo, update],
  );

  /**
   * The to-do mark, from inside the Sorter — one note, both directions, and it
   * stays on screen. The same write the open note's Todo-toggle makes
   * (`handleToggleTodo`: on writes `"todo"`, off writes `"note"`), so it is
   * filing rather than editing and does not touch the `body` clock; undoable
   * a note at a time like every other answer here.
   */
  const sortTodo = useCallback(
    (note: Note) => {
      const was = note.note_type;
      const next: Note["note_type"] = isTodoNote(note) ? "note" : "todo";
      leaveMark.current = "todo";
      update(note.id, { note_type: next });
      pushUndo({
        message: markedWords("to-do", next === "todo", 1),
        steps: [{ id: note.id, expect: { note_type: next }, revert: { note_type: was } }],
      });
    },
    [pushUndo, update, leaveMark],
  );

  /**
   * "Remind me later", from inside the Sorter — the open note's reminder write
   * (so push permission is asked at this moment, as there) and one step of
   * undo that fires only while the reminder is still what was set here. The
   * note stays where it is: no `board_id`, no leave-mark (review 2026-10-04,
   * FX-B-01).
   */
  const sortRemind = useCallback(
    (note: Note, at: string, repeat: ReminderRepeat | null = null) => {
      const was = { reminder_at: note.reminder_at ?? null, reminder_repeat: note.reminder_repeat ?? null };
      setReminder(note.id, at);
      // The rule chosen beside the time, written only when it changes it.
      if (was.reminder_repeat !== repeat) update(note.id, { reminder_repeat: repeat });
      pushUndo({
        message: "Reminder set",
        steps: [{ id: note.id, expect: { reminder_at: at, reminder_repeat: repeat }, revert: was }],
      });
    },
    [pushUndo, setReminder, update],
  );

  /**
   * Untick all or Clear done has rewritten a list — from the open note, where
   * the write has already gone through the note's own save, or from the
   * Ticker, which asks for it here. Either way the offer back is the ordinary
   * one: a `body` step that fires only while the note still says what the
   * rewrite put there, so an edit made since on the other device is never
   * overwritten by a late undo. `inPlace`, because it is reversed from the
   * screen it was made on and that screen stays up (`onReverted`).
   */
  const offerListUndo = useCallback(
    (id: string, before: string, after: string, message: string) => {
      pushUndo({
        message,
        inPlace: true,
        steps: [{ id, expect: { body: after }, revert: { body: before } }],
      });
    },
    [pushUndo],
  );

  /**
   * A whole run's deletes, put back at once, from the Sorter's own summary.
   *
   * Nothing new happens to a note here — this is the `status` write `Put
   * back` on the Trash board makes, said about several at once — and it is
   * itself undoable, so the button cannot be a one-way door either. It exists
   * because the eight-second strip is the right offer for one delete and no
   * offer at all for the third of twenty, which has expired long before the
   * reader reaches the end of the pile and finds out what they did.
   */
  const sortRestore = useCallback(
    (binned: Binned[]) => {
      if (binned.length === 0) return;
      leaveMark.current = "move";
      // Each back to where it was binned from: a Tidy up of the Archive puts
      // its notes back in the Archive, not the Inbox (bughunt 2026-10-15).
      const byStatus = new Map<Note["status"], string[]>();
      for (const { id, status } of binned) {
        const back = status === "trashed" ? "active" : status;
        byStatus.set(back, [...(byStatus.get(back) ?? []), id]);
      }
      for (const [status, ids] of byStatus) bulkUpdate(ids, { status });
      pushUndo({
        message: `Put back ${binned.length}`,
        steps: binned.map(({ id, status }) => ({
          id,
          expect: { status: status === "trashed" ? "active" : status },
          revert: { status: "trashed" as const },
        })),
      });
    },
    [bulkUpdate, pushUndo, leaveMark],
  );

  /**
   * The Sorter's change of mind: Back to a note already answered, then Keep
   * (or a folder, for a note an earlier answer binned). Writes back only the
   * fields that still differ from what the note held before the run touched
   * it, so a reversal the undo mark already made writes nothing and offers
   * nothing. It is an ordinary write said the ordinary way — one step, guarded
   * on what it wrote — so it is itself undoable (review 2026-10-01, UX-03).
   */
  const sortUnsort = useCallback(
    (note: Note, before: Partial<Note>) => {
      const live = notesRef.current.find((n) => n.id === note.id);
      if (!live) return;
      const revert: Partial<Note> = {};
      const now: Partial<Note> = {};
      for (const field of Object.keys(before) as (keyof Note)[]) {
        if ((live[field] ?? null) === (before[field] ?? null)) continue;
        (revert as Record<string, unknown>)[field] = before[field] ?? null;
        (now as Record<string, unknown>)[field] = live[field] ?? null;
      }
      if (Object.keys(revert).length === 0) return;
      update(note.id, revert);
      pushUndo({
        message:
          "status" in revert
            ? live.status === "trashed"
              ? "Put back 1"
              : "Unarchived 1"
            : "Moved 1",
        steps: [{ id: note.id, expect: revert, revert: now }],
      });
    },
    [pushUndo, update, notesRef],
  );

  return {
    sortFile,
    sortLinks,
    sortPriority,
    sortTodo,
    sortRemind,
    offerListUndo,
    sortRestore,
    sortUnsort,
  };
}
