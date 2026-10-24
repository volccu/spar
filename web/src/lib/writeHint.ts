/**
 * What the empty write box says, by where you are standing (joy review
 * 2026-10-14, #7). It is the quiet confirmation of the fact "In Inbox · Go"
 * tells after the fact: a capture made here is filed here.
 *
 * Inbox (and every board a capture falls through to the Inbox from: All,
 * Archive, Links, Files) keeps the plain "Write…". A folder names itself, as
 * the user wrote it. Inspiration takes pasting as well; Todos says to-do, never "the list".
 *
 * A placeholder cannot ellipsise itself in a textarea and must never wrap on a
 * phone, so a long folder name is cut here, on a word if there is one, and the
 * cut is the ellipsis: "Write into Recipes for the…".
 */
export const WRITE_HINT = "Write…";

/** The longest a folder's name runs in the hint, in characters. */
export const HINT_NAME_MAX = 16;

export interface HintBoard {
  name: string;
  kind?: string;
}

export function writeHint(here: HintBoard | null, todos: boolean): string {
  if (todos) return "Write a to-do…";
  if (!here) return WRITE_HINT;
  if (here.kind === "inspiration") return "Paste or write…";
  const name = here.name.trim();
  if (!name) return WRITE_HINT;
  const chars = Array.from(name);
  if (chars.length <= HINT_NAME_MAX) return `Write into ${name}…`;
  const cut = chars.slice(0, HINT_NAME_MAX - 1).join("");
  // Back to the last whole word when that keeps most of the name.
  const space = cut.lastIndexOf(" ");
  const wholeWords = chars[HINT_NAME_MAX - 1] === " ";
  const kept = !wholeWords && space >= HINT_NAME_MAX / 2 ? cut.slice(0, space) : cut;
  return `Write into ${kept.trimEnd()}…`;
}
