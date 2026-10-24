import type { LinkPreview, Note } from "../types";
import { isTodoNote } from "./boards";
import { isCanvasIdea } from "./canvas";
import { handedOverReminder, isHandedOver, type Reminding } from "./reminders";

/**
 * Merge (SPEC §7).
 *
 * The point of this feature: two notes about the same thing stay two notes
 * forever in Keep, because fixing it means open → select → copy → open →
 * paste → format → archive. Here it is one action.
 *
 * Merging never mutates a source. It composes a NEW note from their text and
 * archives the sources, so nothing is lost and un-merge stays possible. That
 * is why a block-based data model was not needed (SPEC §3).
 */

/**
 * Sources are separated by a rule, not a heading. Notes have no headings, and
 * nothing here renders markdown — a "## " would just be two literal hash marks
 * sitting in the middle of the text forever.
 */
const DIVIDER = "———";

/** Collapse runs of blank lines so composed notes don't grow gaps. */
function tidy(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One source's contribution: its own words, tidied, and nothing added. */
export function sectionFor(note: Note): string {
  return tidy(note.body);
}

export function composeMergedBody(sources: Note[]): string {
  return tidy(
    sources
      .map(sectionFor)
      .filter((s) => s.length > 0)
      .join(`\n\n${DIVIDER}\n\n`),
  );
}

/**
 * Absorbing notes into an existing idea, rather than composing a new one.
 *
 * Same rule as `composeMergedBody`, applied to one side only: the idea's own
 * text — its `# name` heading included, since that always sits on line 0 —
 * stays exactly where it is, and each incoming note's words are appended
 * after it, separated by the same rule. Nothing is prepended, so the idea's
 * name can never be pushed off line 0 by an absorption.
 */
export function appendToIdeaBody(ideaBody: string, sources: Note[]): string {
  const head = tidy(ideaBody);
  const additions = sources.map(sectionFor).filter((s) => s.length > 0);
  return tidy([head, ...additions].filter((s) => s.length > 0).join(`\n\n${DIVIDER}\n\n`));
}

/**
 * Whether a note is a merge that can be taken apart again.
 *
 * A composed idea only: `source: "merge"` with sources still named. A sketch
 * is an idea too, and may have absorbed notes, but its drawing is the user's
 * own work rather than a composition of other notes, so there is nothing to
 * un-merge it *back into* — its notes leave one at a time, or it dissolves.
 */
export function isUnmergeable(note: Note): boolean {
  // `isCanvasIdea` less its sketch arm, so the two cannot drift apart.
  return note.source !== "draw" && isCanvasIdea(note);
}

/**
 * The sources an un-merge puts back on the board (SPEC §7).
 *
 * Only a source that is still exactly what the merge left: present, archived,
 * and pointing back at this idea through `merged_into`. Everything else named
 * in `merged_from` has already been moved on by somebody — taken out of the
 * idea by hand, trashed, restored on the other device, or absorbed into a
 * different idea — and an un-merge that dragged it back would be overwriting a
 * later decision with an earlier one.
 *
 * Where each goes back to needs no bookkeeping: merge never touches a source's
 * `board_id`, so a note filed in a folder when it was merged is still filed
 * there, and one whose folder has since been deleted is in the Inbox by the
 * same definition every board uses (`isFiled`).
 */
export function unmergeSources(idea: Note, notes: Note[]): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return (idea.merged_from ?? [])
    .map((id) => byId.get(id))
    .filter(
      (n): n is Note =>
        n !== undefined && n.status === "archived" && n.merged_into === idea.id,
    );
}

/**
 * The hidden previews of `sources`, to be added to `existing` — what a merge
 * carries so a link the owner put away is not drawn again in the note it
 * went into. Only the hidden entries travel: the rest are the page's answers,
 * asked afresh for the new text like any other link, while "hidden" is the
 * owner's word and exists nowhere else. First entry for an address wins.
 * `null` when there is nothing to add, so the caller writes no list at all.
 */
export function carriedPreviews(
  existing: readonly LinkPreview[] | null | undefined,
  sources: readonly Note[],
): LinkPreview[] | null {
  const have = new Set((existing ?? []).map((entry) => entry.href));
  const added: LinkPreview[] = [];
  for (const source of sources) {
    for (const entry of source.link_previews ?? []) {
      if (entry.hidden !== true || have.has(entry.href)) continue;
      have.add(entry.href);
      added.push(entry);
    }
  }
  return added.length > 0 ? [...(existing ?? []), ...added] : null;
}

/**
 * The reminder an idea takes from the notes joining it, or null to leave the
 * idea's own (review 2026-10-13, EH-03). An idea keeps a reminder it already
 * has; one without takes the first that is still to ring
 * (`handedOverReminder`). Without this an absorbed note's reminder never rang,
 * since the sweep rings only active notes and the note is archived.
 */
export function reminderJoiningIdea(idea: Note, incoming: Note[], now = Date.now()): Reminding | null {
  if (idea.reminder_at) return null;
  return incoming.map((n) => handedOverReminder(n, now)).find((r) => r.reminder_at) ?? null;
}

/**
 * A note leaving an idea that holds its reminder takes it back (review
 * 2026-10-13, EH-03): null when the idea does not hold it. The sweep remembers
 * what rang by note id, so an occurrence that rang from the idea is not given
 * back to the note to ring again (`handedOverReminder`): `noteNow` is what the
 * note's own reminder becomes, or null when it stays as it is.
 */
export function reminderLeavingIdea(
  idea: Note,
  leaving: Note,
  now = Date.now(),
): { ideaWas: Reminding; noteWas: Reminding; noteNow: Reminding | null } | null {
  if (!isHandedOver(idea, leaving)) return null;
  const noteWas = { reminder_at: leaving.reminder_at ?? null, reminder_repeat: leaving.reminder_repeat ?? null };
  const next = handedOverReminder(leaving, now);
  const same = next.reminder_at === noteWas.reminder_at && next.reminder_repeat === noteWas.reminder_repeat;
  return {
    ideaWas: { reminder_at: idea.reminder_at, reminder_repeat: idea.reminder_repeat ?? null },
    noteWas,
    noteNow: same ? null : next,
  };
}

export interface MergeResult {
  merged: Note;
  archivedSourceIds: string[];
}

/**
 * Builds the merged note. Selection order is preserved — the user picked it.
 * Highest priority wins.
 *
 * The idea lands in the board every source shares, and unfiled
 * (`board_id: null`) when they do not agree on one: a composition is a new
 * thing, not a continuation of whichever board happened to hold one source.
 * A merge of to-do lists stays a to-do, so it stays on Todos (review
 * 2026-10-13, UX-07: two shopping lists merged to tick one left Todos and
 * their folder).
 *
 * The earliest source's creation date is kept, because that is when the
 * thinking started and a composition is not a new capture. That used to also
 * be what kept the idea from jumping to the top of the board; it no longer is,
 * and should not be. The board is now ordered on the last *edit* (see
 * `editedAt`), and composing a note is unmistakably one — it is, in fact, the
 * thing you are working on at that exact moment, which is why merge opens its
 * canvas the instant it is made. So the body clock is stamped now, and the
 * idea surfaces. The creation date still says March, and the open note still
 * says so beside it.
 */
export function buildMerge(sources: Note[], now = new Date()): MergeResult {
  if (sources.length < 2) {
    throw new Error("merge needs at least two notes");
  }

  const body = composeMergedBody(sources);
  const iso = now.toISOString();
  const earliest = sources
    .map((s) => s.created_at)
    .sort((a, b) => (a ?? "").localeCompare(b ?? ""))[0];

  const hiddenPreviews = carriedPreviews([], sources);

  const reminder = sources
    .map((s) => handedOverReminder(s, now.getTime()))
    .find((r) => r.reminder_at);
  const board = sources[0].board_id ?? null;
  const shared = sources.every((s) => (s.board_id ?? null) === board);

  const merged: Note = {
    id: crypto.randomUUID(),
    // A merged note has no single original capture; its raw_content IS the
    // composition, and stays immutable from here like any other note.
    raw_content: body,
    body,
    source: "merge",
    created_at: earliest ?? iso,
    updated_at: iso,
    // An idea is a composed text, not a checklist or link just because one
    // source happened to have that face — but lists merged with lists are
    // still a list.
    note_type: sources.every(isTodoNote) ? "todo" : null,
    board_id: shared ? board : null,
    status: "active",
    priority: Math.max(...sources.map((s) => s.priority)),
    // The first source carrying a reminder hands over **both** halves of it.
    // Picking the anchor and the rule with two separate searches would let an
    // idea inherit "every week" from one note and the instant it repeats from
    // another — a series neither source ever had. One that has just rung is
    // not handed over as it was, or it rings again (`handedOverReminder`).
    reminder_at: reminder?.reminder_at ?? null,
    reminder_repeat: reminder?.reminder_repeat ?? null,
    done: null,
    merged_from: sources.map((s) => s.id),
    keep_id: null,
    // Files stay with the notes that carried them, which are archived rather
    // than destroyed and remain fully searchable. Copying them across would put
    // two notes on one set of bytes, and removing the file from either would
    // then break the other.
    attachments: [],
    // Stated rather than inferred, the same way `newNote` states it: the text
    // of this note was written now, whatever its creation date says.
    field_updated_at: { body: iso, ...(hiddenPreviews ? { link_previews: iso } : {}) },
    ...(hiddenPreviews ? { link_previews: hiddenPreviews } : {}),
  };

  return { merged, archivedSourceIds: sources.map((s) => s.id) };
}
