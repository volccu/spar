import { useCallback, useEffect, useState, type RefObject } from "react";
import type { Mark } from "../components/Vanish";
import type { Undo } from "../store/useUndo";
import type { Canvas, CanvasItem, Note } from "../types";
import { isCanvasIdea, placeForNewItem, SKETCH_SEED } from "./canvas";
import {
  appendToIdeaBody,
  carriedPreviews,
  isUnmergeable,
  reminderJoiningIdea,
  reminderLeavingIdea,
  unmergeSources,
} from "./merge";
import { withNoteName } from "./name";

/** A reminder taken off an idea (review 2026-10-13, EH-03). */
const NO_REMINDER = { reminder_at: null, reminder_repeat: null };

interface Options {
  /** The notes as they are at the moment a handler runs. */
  notesRef: RefObject<Note[]>;
  /** One note's field write. */
  update: (id: string, patch: Partial<Note>) => void;
  /** A new note, for the piece a split makes and for a sketch. */
  create: (text: string, source?: string, fields?: { board_id?: string | null }) => Note | null;
  /** Compose a new note from the sources and archive them (`useNotes`), with
   *  the reversal that puts them back. */
  merge: (sources: Note[]) => { merged: Note; undo: () => Set<string> };
  /** The idea's canvas, made on this device if it has none yet. */
  ensureForIdea: (idea: Note, notes: Note[]) => Canvas;
  /** Where a note stands on an idea's canvas, or null. */
  itemAt: (canvasId: string, noteId: string) => CanvasItem | null;
  /** Take a note's place off a canvas. */
  removeItem: (canvasId: string, noteId: string) => void;
  /** Put a note's place back on a canvas. */
  restoreItem: (canvasId: string, item: CanvasItem) => void;
  /** Offer a reversal on the undo strip. */
  pushUndo: (entry: Omit<Undo, "key">) => void;
  /** Which mark a card leaving the board shrinks into. */
  leaveMark: RefObject<Mark | null>;
  /** The canvas open now, if any. */
  canvasId: string | null;
  /** Open a canvas, or close it with null. */
  setCanvasId: (id: string | null) => void;
  /** Mark a card to draw its border once. */
  setTraceId: (id: string) => void;
  /** End the selection a merge was made from. */
  setSelected: (ids: string[]) => void;
  /** Close the open note, at once: a merge lands in the canvas instead. */
  setOpenId: (id: string | null) => void;
  setClosing: (closing: boolean) => void;
  /** The folder a capture made now would be filed into, or null. */
  here: string | null;
}

/**
 * The idea verbs: the ways into an idea — a merge, a note joining one, a
 * sketch — and the ways out of one and the ways a note's words change inside
 * it: a note leaving it, released, dissolved, un-merged, split from, and the
 * idea renamed. Review PL-10 moved the ways out of `App.tsx` whole, as
 * `useIdeaExits`; audit 2026-10-10 CODE-6 moved the ways in after them and
 * renamed the hook. The comments are the ones they had there.
 */
export function useIdeaVerbs({
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
}: Options) {
  /**
   * Everything that has to change on the idea's side when one of its notes
   * leaves it, whatever sent the note away — released by hand from the
   * canvas menu, or trashed from anywhere at all. The note's own status is
   * the one thing this deliberately does *not* touch: a release and a
   * delete want different things there, and that is the caller's call to
   * make, not this helper's.
   *
   * `place` — where the note stood on the canvas — is the one thing this
   * actually destroys, so it is read before the item is removed and handed
   * back for undo to restore. Emptying the idea trashes it and closes the
   * canvas, the same rule releasing the last source has always followed.
   */
  const leaveIdea = useCallback(
    (
      ideaId: string,
      noteId: string,
      /** The idea's sources as they stand now, when an earlier call in the same
       *  gesture has already changed them and the notes have not re-rendered. */
      sourcesNow?: string[],
    ): {
      sources: string[];
      place: CanvasItem | null;
      emptied: boolean;
      restore: () => void;
    } => {
      const idea = notesRef.current.find((n) => n.id === ideaId);
      const sources = sourcesNow ?? idea?.merged_from ?? [];
      const left = sources.filter((id) => id !== noteId);
      const place = itemAt(ideaId, noteId);
      // A sketch's source count is permanently zero — that is its normal
      // state, not the emptied state that finishes a composed idea. Notes it
      // absorbed can all leave again without taking the drawings with them.
      const emptied = left.length === 0 && idea?.source !== "draw";
      // Put back as it was: an archived idea emptied by a merge from the
      // Archive goes back to the Archive, not onto the board.
      const statusWas = idea?.status ?? "active";
      // A reminder the note handed the idea goes back with the note, or the
      // two would both ring it (review 2026-10-13, EH-03).
      const note = notesRef.current.find((n) => n.id === noteId);
      const reminder = idea && note ? reminderLeavingIdea(idea, note) : null;
      const dropped = reminder ? NO_REMINDER : {};

      update(
        ideaId,
        emptied ? { merged_from: left, status: "trashed", ...dropped } : { merged_from: left, ...dropped },
      );
      if (reminder?.noteNow) update(noteId, reminder.noteNow);
      removeItem(ideaId, noteId);
      if (emptied) setCanvasId(null);

      return {
        sources,
        place,
        emptied,
        restore: () => {
          const back = reminder?.ideaWas ?? {};
          update(
            ideaId,
            emptied
              ? { merged_from: sources, status: statusWas, ...back }
              : { merged_from: sources, ...back },
          );
          if (reminder?.noteNow) update(noteId, reminder.noteWas);
          if (place) restoreItem(ideaId, place);
        },
      };
    },
    [itemAt, removeItem, restoreItem, update, notesRef, setCanvasId],
  );

  /**
   * A note already living in a *different* idea can't be named in two ideas'
   * merged_from at once, so before it joins or composes another it leaves the
   * one it is in: the same bookkeeping "Take out of idea" and a trash from
   * inside an idea run. Two notes leaving one idea in the same gesture read
   * the sources the first one left, not the ones on screen, or the second
   * would put the first back. Returns the undo, which runs the leaves
   * backwards so each restore finds the list it took.
   */
  const leaveOtherIdeas = useCallback(
    (notes: Note[], joining: string | null): ((only?: Set<string>) => void) => {
      const restores: Array<{ id: string; ideaId: string; restore: () => void }> = [];
      const sourcesNow = new Map<string, string[]>();
      const sourcesBefore = new Map<string, string[]>();
      for (const note of notes) {
        const otherId = note.merged_into ?? null;
        if (!otherId || otherId === joining || notes.some((n) => n.id === otherId)) continue;
        if (!notesRef.current.some((n) => n.id === otherId)) continue;
        const { sources, restore } = leaveIdea(otherId, note.id, sourcesNow.get(otherId));
        if (!sourcesBefore.has(otherId)) sourcesBefore.set(otherId, sources);
        sourcesNow.set(otherId, sources.filter((id) => id !== note.id));
        restores.push({ id: note.id, ideaId: otherId, restore });
      }
      // `only`: the notes the undo around this really took back. One that has
      // moved on since stays where it went, or two ideas would name it.
      return (only) => {
        const skipped = new Map<string, Set<string>>();
        for (const { id, ideaId, restore } of [...restores].reverse()) {
          if (!only || only.has(id)) restore();
          else skipped.set(ideaId, (skipped.get(ideaId) ?? new Set()).add(id));
        }
        // Each restore puts back the list it took, which still names a note
        // skipped after it; the idea ends naming every source but those.
        for (const [ideaId, gone] of skipped) {
          const kept = (sourcesBefore.get(ideaId) ?? []).filter((id) => !gone.has(id));
          if (restores.some((r) => r.ideaId === ideaId && only?.has(r.id))) update(ideaId, { merged_from: kept });
        }
      };
    },
    [leaveIdea, notesRef, update],
  );

  /**
   * The canvas a merge has just opened, so it opens fitted to the screen with
   * a line saying what happened (`justMerged` on `CanvasSheet`, review
   * 2026-10-01, UX-26). Any other canvas opening — or none — lets it go, so
   * the same idea opened again later opens like any other.
   */
  const [freshMerge, setFreshMerge] = useState<string | null>(null);
  useEffect(() => {
    if (canvasId !== freshMerge) setFreshMerge(null);
  }, [canvasId, freshMerge]);

  /**
   * Merging a note onto an idea (or an idea onto a note) joins that idea
   * rather than composing a brand-new one around it — see the merge bullet
   * in CLAUDE.md. Only reached when exactly one source is an idea; the two
   * (or more) case still composes, in `mergeNotes` below.
   */
  const absorbIntoIdea = useCallback(
    (idea: Note, incoming: Note[]) => {
      const already = new Set(idea.merged_from ?? []);
      const toAdd = incoming.filter((n) => !already.has(n.id));
      if (toAdd.length === 0) return;

      const putBackLeaves = leaveOtherIdeas(toAdd, idea.id);

      // The idea's own fields, as they stood before this absorption — undo's
      // whole job. `merged_from` is an array, so this can't be said as a
      // `steps` patch (`stillLooksLike` compares by identity), the same reason
      // merge and dissolve bring their own reversal.
      const before: Partial<Note> = {
        body: idea.body,
        merged_from: idea.merged_from,
        priority: idea.priority,
      };
      // Links the owner put away in an incoming note stay put away in the idea.
      const hiddenPreviews = carriedPreviews(idea.link_previews, toAdd);
      if (hiddenPreviews) before.link_previews = idea.link_previews ?? [];
      // A joining note's reminder goes on ringing, from the idea.
      const reminder = reminderJoiningIdea(idea, toAdd);
      if (reminder) {
        before.reminder_at = idea.reminder_at ?? null;
        before.reminder_repeat = idea.reminder_repeat ?? null;
      }
      update(idea.id, {
        body: appendToIdeaBody(idea.body, toAdd),
        merged_from: [...(idea.merged_from ?? []), ...toAdd.map((n) => n.id)],
        priority: Math.max(idea.priority, ...toAdd.map((n) => n.priority)),
        ...(hiddenPreviews ? { link_previews: hiddenPreviews } : {}),
        ...(reminder ?? {}),
      });

      // Each incoming note is archived into the idea, exactly as an ordinary
      // merge archives its sources — nothing here is destroyed.
      const beforeNotes = toAdd.map((n) => ({
        id: n.id,
        status: n.status,
        merged_into: n.merged_into ?? null,
      }));
      for (const note of toAdd) update(note.id, { status: "archived", merged_into: idea.id });

      // `idea` still names its *old* merged_from here, which is exactly what a
      // canvas that doesn't exist on this device yet should be built from —
      // the new items are placed on top of it below, one at a time, so each
      // one sees where the last one landed.
      const folder = ensureForIdea(idea, notesRef.current);
      const added: CanvasItem[] = [];
      let working = folder;
      for (const note of toAdd) {
        const item = { note_id: note.id, ...placeForNewItem(working, note) };
        restoreItem(folder.id, item);
        added.push(item);
        working = { ...working, items: [...working.items, item] };
      }

      // The sources are absorbed, not destroyed — they leave into the archive.
      leaveMark.current = "archive";
      setSelected([]);
      // Joining an idea opens its canvas, the same as composing one does.
      setFreshMerge(folder.id);
      setCanvasId(folder.id);
      setOpenId(null);
      setClosing(false);

      pushUndo({
        message: `Added ${toAdd.length} to idea`,
        steps: [],
        run: () => {
          update(idea.id, before);
          for (const b of beforeNotes) {
            update(b.id, { status: b.status, merged_into: b.merged_into });
          }
          for (const item of added) removeItem(folder.id, item.note_id);
          putBackLeaves();
        },
      });
    },
    [
      ensureForIdea,
      leaveOtherIdeas,
      leaveMark,
      notesRef,
      pushUndo,
      removeItem,
      restoreItem,
      setCanvasId,
      setClosing,
      setOpenId,
      setSelected,
      update,
    ],
  );

  const mergeNotes = useCallback(
    (sources: Note[]) => {
      if (sources.length < 2) return;
      const ideas = sources.filter(isCanvasIdea);
      // Absorbing only makes sense with exactly one idea in play. With two (or
      // more), there are two canvases and no way for the app to say which one
      // should survive — choosing for the user is worse than composing a third,
      // so that case keeps today's behaviour, unchanged, below.
      if (ideas.length === 1) {
        const idea = ideas[0];
        absorbIntoIdea(
          idea,
          sources.filter((n) => n.id !== idea.id),
        );
        return;
      }
      // The sources are archived, not destroyed — they leave into the archive.
      leaveMark.current = "archive";
      // Sources merged out of another idea (from the Archive, where an idea's
      // notes stand as cards) leave it, or both ideas would name them.
      const putBackLeaves = leaveOtherIdeas(sources, null);
      const { merged, undo: undoMerge } = merge(sources);
      setSelected([]);
      pushUndo({
        message: `Merged ${sources.length}`,
        steps: [],
        run: () => putBackLeaves(undoMerge()),
      });
      // The merged note becomes the folder cover; the original notes remain its
      // independent, editable children.
      const folder = ensureForIdea(merged, notesRef.current.concat(merged));
      setFreshMerge(folder.id);
      setCanvasId(folder.id);
      setOpenId(null);
      setClosing(false);
    },
    [
      absorbIntoIdea,
      ensureForIdea,
      leaveOtherIdeas,
      leaveMark,
      merge,
      notesRef,
      pushUndo,
      setCanvasId,
      setClosing,
      setOpenId,
      setSelected,
    ],
  );

  /**
   * The + panel's Draw row: a sketch is an idea born empty. It follows the
   * merge shape exactly — create the note, ensure its canvas, land in it —
   * except there is nothing to compose it from, so the note is seeded with
   * the `# Sketch` heading (the idea-name convention; renameable from the
   * canvas bar) and the sheet opens with the pen already in hand. No undo
   * step on purpose: backing out having drawn nothing sweeps the sketch away
   * again (`sweepSketch` in App.tsx), and once something is drawn the trash
   * covers regret like it does for every other note.
   */
  const startSketch = useCallback(() => {
    const made = create(SKETCH_SEED, "draw");
    if (!made) return;
    // Standing in a folder files the sketch there, the same rule a typed
    // capture follows — what makes a folder somewhere you can work.
    if (here !== null) {
      update(made.id, { board_id: here });
    }
    const folder = ensureForIdea(made, notesRef.current);
    setCanvasId(folder.id);
    setOpenId(null);
    setClosing(false);
  }, [create, ensureForIdea, here, notesRef, setCanvasId, setClosing, setOpenId, update]);

  /* --- getting back out of an idea ------------------------------------------
     Merge is one gesture — hold a card, drag it onto another — and one gesture
     is one gesture you can make without meaning to. Until now the only way back
     was the eight seconds of undo that followed it; after that the sources were
     archived inside an idea and the app offered no way to say "not that one"
     or "not this at all".

     Both paths here are the merge run backwards, and neither destroys
     anything. A released note goes back to `active` with its `merged_into`
     cleared, exactly as merge's own undo does it, and drops out of the idea's
     `merged_from`. Dissolving does that for every source and sends the idea
     note itself to the trash, where it stays whole and restorable for a month
     like everything else — the canvas, the drawings and the labels are all
     still on it, so putting it back puts the idea back.

     Neither can be said as a patch the guard understands, because `merged_from`
     is an array and `stillLooksLike` compares by identity. So both bring their
     own reversal, the way merge does. */

  const releaseNote = useCallback(
    (ideaId: string, noteId: string) => {
      const idea = notesRef.current.find((n) => n.id === ideaId);
      const note = notesRef.current.find((n) => n.id === noteId);
      if (!idea || !note) return;
      const { emptied, restore } = leaveIdea(ideaId, noteId);

      update(noteId, { status: "active", merged_into: null });
      setTraceId(noteId);
      // Releasing the last source also trashes the idea (leaveIdea, above) —
      // the idea's own card is what actually disappears off the board then,
      // not the note coming back, so the mark has to say "trash", not
      // "restore". An ordinary release leaves the idea's card standing right
      // where it was, so nothing departs the grid and the mark goes unused.
      leaveMark.current = emptied ? "trash" : "restore";

      pushUndo({
        message: emptied ? "Dissolved the idea" : "Took 1 out",
        steps: [],
        run: () => {
          update(noteId, { status: "archived", merged_into: ideaId });
          restore();
        },
      });
    },
    [leaveIdea, pushUndo, update, leaveMark, notesRef, setTraceId],
  );

  const dissolveIdea = useCallback(
    (ideaId: string) => {
      const idea = notesRef.current.find((n) => n.id === ideaId);
      if (!idea) return;
      const sources = idea.merged_from ?? [];
      const before = sources
        .map((id) => notesRef.current.find((n) => n.id === id))
        .filter((n): n is Note => Boolean(n))
        .map((n) => ({
          id: n.id,
          status: n.status,
          merged_into: n.merged_into ?? null,
          reminder: reminderLeavingIdea(idea, n),
        }));
      // A reminder a source handed the idea goes back with it, so the idea
      // restored from the trash does not ring it too (review 2026-10-13, EH-03).
      const tookBack = before.some((was) => was.reminder);

      for (const was of before) {
        update(was.id, { status: "active", merged_into: null, ...was.reminder?.noteNow });
      }
      // The idea's own record of its sources goes with them, the same way
      // releaseNote clears it when the last note leaves. Left in place, a
      // restore from the trash later would bring back an idea pointing at
      // notes that are simultaneously active on the board — the same note
      // rendered twice, in two places, over one set of edits.
      update(ideaId, { status: "trashed", merged_from: [], ...(tookBack ? NO_REMINDER : {}) });
      setCanvasId(null);
      // The idea's own card is what leaves the board here — its sources were
      // never on the grid to begin with, they were hidden inside it — so this
      // is a trash, the same as any other note whose status just became
      // "trashed", not a restore.
      leaveMark.current = "trash";

      pushUndo({
        message: `Dissolved into ${before.length}`,
        steps: [],
        run: () => {
          for (const was of before) {
            update(was.id, { status: was.status, merged_into: was.merged_into, ...was.reminder?.noteWas });
          }
          update(ideaId, {
            status: "active",
            merged_from: sources,
            ...(tookBack ? { reminder_at: idea.reminder_at, reminder_repeat: idea.reminder_repeat ?? null } : {}),
          });
        },
      });
    },
    [pushUndo, update, leaveMark, notesRef, setCanvasId],
  );

  /**
   * Un-merge (SPEC §7): the merge taken back, which the spec always said was
   * "trivially possible" and nothing offered.
   *
   * It differs from Dissolve in the one place the two could be confused, and
   * the difference is the point: the idea is **archived**, not trashed.
   * Dissolving says "this idea was a mistake"; un-merging says "I want the
   * notes back", and the idea's own text may hold words written after the
   * merge — a name, a paragraph typed into the composition — so it is kept
   * whole and searchable in the Archive for good rather than for a month. And
   * because nothing is thrown away, it does not ask first.
   *
   * Each source that is still exactly what the merge left (`unmergeSources`)
   * goes back to `active` with its `merged_into` cleared. It goes back to the
   * board it was on without anything being done about it, because merge never
   * touched its `board_id`. The idea's `merged_from` is emptied on the way to
   * the archive, the same reason Dissolve empties it: an idea still naming
   * notes that are active on the board would draw every one of them twice if
   * it were ever unarchived. Emptied, it is no longer a canvas
   * (`isCanvasIdea`) and opens as the plain note its composed text is. The
   * canvas record itself is left alone, so the undo is whole.
   *
   * It brings its own reversal for the reason Dissolve does — `merged_from`
   * is an array — and a source is only put back into the idea while it is
   * still where the un-merge left it: one filed, archived or trashed since is
   * a later decision, and is not overwritten.
   */
  const unmergeIdea = useCallback(
    (ideaId: string) => {
      const idea = notesRef.current.find((n) => n.id === ideaId);
      if (!idea || !isUnmergeable(idea)) return;
      const sources = idea.merged_from ?? [];
      const was = idea.status;
      const woken = unmergeSources(idea, notesRef.current);
      const back = woken.map((n) => n.id);
      // Nothing left to hand back: archiving the idea would only make it
      // vanish into the Archive under "Un-merged into 0".
      if (back.length === 0) return;
      // A reminder a source handed the idea goes back with it, so the idea
      // taken out of the archive does not ring it too (review 2026-10-13, EH-03).
      const reminders = new Map(woken.map((n) => [n.id, reminderLeavingIdea(idea, n)]));
      const tookBack = [...reminders.values()].some(Boolean);

      for (const id of back) {
        update(id, { status: "active", merged_into: null, ...reminders.get(id)?.noteNow });
      }
      update(ideaId, { status: "archived", merged_from: [], ...(tookBack ? NO_REMINDER : {}) });
      setCanvasId(null);
      // The idea's card is what leaves the board, and it leaves into the
      // archive; its sources were never on the grid, they were inside it.
      leaveMark.current = "archive";

      pushUndo({
        message: `Un-merged into ${back.length}`,
        steps: [],
        run: () => {
          // The idea itself is held to the same rule as its sources: put back
          // only while it is still where the un-merge left it.
          const ideaNow = notesRef.current.find((n) => n.id === ideaId);
          if (!ideaNow || ideaNow.status !== "archived" || (ideaNow.merged_from?.length ?? 0) > 0) {
            return;
          }
          // A source moved on since (archived by hand, trashed, merged into
          // another idea) is not re-archived here, so it must not be named
          // in `merged_from` again either — or the idea would draw a note
          // that is also somewhere else.
          const skipped = new Set<string>();
          for (const id of back) {
            const now = notesRef.current.find((n) => n.id === id);
            if (now && now.status === "active" && !now.merged_into) {
              update(id, { status: "archived", merged_into: ideaId, ...reminders.get(id)?.noteWas });
            } else {
              skipped.add(id);
            }
          }
          // The idea takes the reminder back only from a source it takes back.
          const retaken = back.some((id) => reminders.get(id) && !skipped.has(id));
          update(ideaId, {
            status: was,
            merged_from: sources.filter((id) => !skipped.has(id)),
            ...(retaken ? { reminder_at: idea.reminder_at, reminder_repeat: idea.reminder_repeat ?? null } : {}),
          });
        },
      });
    },
    [pushUndo, update, leaveMark, notesRef, setCanvasId],
  );

  /**
   * New note from selection — merge's inverse, from inside the open note
   * (`splitOut` in NoteView.tsx, which has already cut the text).
   *
   * The new note is filed where the note it came out of is filed: a split is
   * the same thinking in two pieces, and a folder's note splitting into the
   * Inbox would be the pile growing because you tidied. `board_id` only —
   * whether it is a to-do or a link is a fact about each piece's own text.
   *
   * One undo for both halves, and the halves are tied: the words go back into
   * the note only while the note still holds exactly what the split left, and
   * the new note goes to the trash only when they did. Written as two
   * independent `steps`, an undo after the new note had been edited would put
   * the words back *and* leave them in the new note — harmless — but an undo
   * after the old note had been edited would send the new note to the trash
   * with the words nowhere else. That is the one outcome an undo must not
   * have. The new note goes to the trash, not away: undo sends the opposite,
   * and the opposite of making a note is deleting it, which here is the trash.
   */
  const splitNote = useCallback(
    (id: string, moved: string, before: string, after: string): boolean => {
      const source = notesRef.current.find((n) => n.id === id);
      // `before` is the base the note's own write is about to be checked
      // against (`editBodyIfBase`). A note that no longer holds it would refuse
      // that write after the new note already existed — the words in both
      // notes, and an undo that stands down on the first check. Refused here
      // instead, nothing is made and nothing is cut.
      if (!source || source.body !== before) return false;
      const made = create(moved, "web", { board_id: source.board_id ?? null });
      if (!made) return false;
      pushUndo({
        message: "Split into a new note",
        // Made from inside the open note, so offered over it and reversed
        // without closing it — as Untick all and Clear done are.
        inPlace: true,
        steps: [],
        run: () => {
          const from = notesRef.current.find((n) => n.id === id);
          if (!from || from.body !== after) return;
          update(id, { body: before });
          const piece = notesRef.current.find((n) => n.id === made.id);
          if (piece && piece.status === "active" && piece.body === made.body) {
            leaveMark.current = "trash";
            update(made.id, { status: "trashed" });
          }
          setTraceId(id);
        },
      });
      return true;
    },
    [create, pushUndo, update, leaveMark, notesRef, setTraceId],
  );

  /**
   * Naming an idea writes a heading into its own text — see `withNoteName`.
   * There is no name field and no rename column: the app reads the line back
   * out again, exactly as it would if the user had typed it themselves.
   */
  const renameIdea = useCallback(
    (ideaId: string, name: string) => {
      const idea = notesRef.current.find((n) => n.id === ideaId);
      if (!idea) return;
      const body = withNoteName(idea.body ?? "", name);
      if (body === idea.body) return;
      update(ideaId, { body });
    },
    [update, notesRef],
  );

  return {
    leaveIdea,
    releaseNote,
    dissolveIdea,
    unmergeIdea,
    splitNote,
    renameIdea,
    absorbIntoIdea,
    mergeNotes,
    startSketch,
    freshMerge,
  };
}
