/**
 * What a card is called out loud — its accessible name (review UX-13).
 *
 * Without one, a card's name is its whole text, which for a 15k-character wall
 * is unusable, so the card announces its opening instead. This is that
 * sentence, built from what the card is actually showing and what the footer
 * is saying in marks a screen reader never sees.
 *
 * - **The kind leads only where it says something.** A list, an idea, a file
 *   and a link are named as such; a plain note is not. Every card used to open
 *   with "NOTE", which on a board of notes is a word to sit through every time.
 *   A note marked as a to-do says so, because nothing else in its words does.
 * - **A list is named by its items.** The checklist face draws no body text,
 *   so a list without a name was announced as "Empty note". It now opens with
 *   its first items and says how far through it you are — "2 of 8 done" — the
 *   same fraction the footer draws.
 * - **The marks are said in words**: more under the cut, several attachments,
 *   priority, a reminder, and the folder the note is filed in — on the boards
 *   where the footer draws that folder mark at all — and the state the card is
 *   drawn in: archived, and the trash countdown where the footer shows it
 *   (audit 2026-10-10, UX-10).
 */

import type { ChecklistItem, FaceKind } from "./face";

/** How much of the opening is read before the name moves on. */
const OPENING_CHARS = 60;

export interface CardNameParts {
  kind: FaceKind;
  /** An idea card — a canvas, whatever its face. */
  idea: boolean;
  /** Marked as a to-do by hand (`note_type`). */
  todo: boolean;
  /** The name the user gave the note, if any (`lib/name.ts`). */
  name: string | null;
  /** The words the face shows. Empty on a list and a file. */
  body: string;
  /** The items a list face shows. */
  items: ChecklistItem[];
  /** The file a file face shows. */
  fileName: string | null;
  /** What the note's first link is called, for a link with no words beside it. */
  linkTitle: string | null;
  /** How many files the face draws. */
  files: number;
  /** The face is cut: there is more than it shows. */
  cut: boolean;
  checkDone: number;
  checkCount: number;
  priority: boolean;
  /** Whether the note has a reminder, and whether its time has passed. */
  reminder: "none" | "set" | "passed";
  /** The folder the note is filed in, where the footer marks it. */
  boardName: string | null;
  /** Archived: the card is drawn faded, with a dashed edge (audit UX-10). */
  archived: boolean;
  /** Days left in the trash, where the footer draws the countdown; else null. */
  trashDaysLeft: number | null;
}

/** The first items of a list, joined, for as long as the opening runs. */
function itemsOpening(items: ChecklistItem[]): string {
  let out = "";
  for (const item of items) {
    const words = item.text.trim();
    if (!words) continue;
    if (out && out.length + words.length + 2 > OPENING_CHARS) break;
    out = out ? `${out}, ${words}` : words;
  }
  return out.slice(0, OPENING_CHARS);
}

function kindWord(parts: CardNameParts): string | null {
  if (parts.idea) return "Idea";
  switch (parts.kind) {
    case "checklist":
      return "List";
    case "file":
      return "File";
    case "link":
      return "Link";
    case "text":
      return parts.todo ? "To-do" : null;
  }
}

export function cardName(parts: CardNameParts): string {
  const opening =
    parts.name ||
    (parts.kind === "checklist" ? itemsOpening(parts.items) : "") ||
    parts.fileName ||
    parts.body.slice(0, OPENING_CHARS).trim() ||
    parts.linkTitle ||
    "";
  const kind = kindWord(parts);
  // A line break inside the opening is read as nothing at all, so the two
  // lines either side of it ran together into one word.
  const said = opening.replace(/\s+/g, " ").trim() || "Empty note";

  const after: string[] = [];
  if (parts.checkCount > 0) after.push(`${parts.checkDone} of ${parts.checkCount} done`);
  if (parts.files > 1) after.push(`${parts.files} attachments`);
  else if (parts.cut) after.push("continues");
  if (parts.priority) after.push("marked important");
  if (parts.reminder === "set") after.push("reminder");
  if (parts.reminder === "passed") after.push("reminder passed");
  if (parts.boardName) after.push(`in ${parts.boardName}`);
  if (parts.archived) after.push("archived");
  if (parts.trashDaysLeft !== null) {
    const left = parts.trashDaysLeft;
    after.push(
      left <= 0
        ? "leaves the trash today"
        : `${left} ${left === 1 ? "day" : "days"} left in the trash`,
    );
  }

  return [kind ? `${kind}: ${said}` : said, ...after].join(", ");
}
