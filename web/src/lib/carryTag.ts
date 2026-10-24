import type { Board, Note } from "../types";
import { wordsBesideLinks } from "./face";
import { openingLine } from "./name";
import { boardById, dropVerb } from "./shelfDrop";
import type { MergeDrag } from "./useMergeDrag";

/** The most characters of a note's first line the tag draws. */
const TAG_CHARS = 28;

/**
 * What the small tag beside a carried note says (review 2026-10-24, UX-17): the
 * note's own first line, or a count when several are carried, and — once the
 * pointer is over something that would take them — what letting go would do,
 * in the words the same action has everywhere (Merge, Archive, Delete, Move
 * to a board). Over a board that refuses them, or nothing, no verb.
 */
export function carryWords(
  drag: MergeDrag,
  notes: readonly Note[],
  boards: readonly Board[],
): { what: string; verb: string | null } {
  const sources = drag.sourceIds
    .map((id) => notes.find((n) => n.id === id))
    .filter((n): n is Note => Boolean(n));
  // A note with an address is named by the words beside it, as its card is.
  const first = sources[0]
    ? (openingLine(wordsBesideLinks(sources[0])) ??
      openingLine(sources[0].body) ??
      sources[0].attachments?.[0]?.name ??
      "Note")
    : "Note";
  const what =
    sources.length > 1
      ? `${sources.length} notes`
      : first.length > TAG_CHARS
        ? `${first.slice(0, TAG_CHARS - 1).trimEnd()}…`
        : first;
  return { what, verb: verbWords(drag, sources, boards) };
}

function verbWords(drag: MergeDrag, sources: Note[], boards: readonly Board[]): string | null {
  if (drag.onRobot) return "Archive";
  if (drag.shelfId) {
    const board = boardById(boards, drag.shelfId);
    const verb = board ? dropVerb(board, sources) : null;
    if (!board || !verb) return null;
    if (verb.kind === "archive") return "Archive";
    if (verb.kind === "trash") return "Delete";
    return `Move to ${board.name}`;
  }
  return drag.targetId ? "Merge" : null;
}
