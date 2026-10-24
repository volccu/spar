import { headingOf, markerOf } from "./blocks";

/* --- naming a note -----------------------------------------------------------
   A note may be named, and the name is not a field. It is a `# ` heading on the
   first line of the note's own text, which is the app's existing answer to
   exactly this question: the app derives no heading, the user may write one,
   and a line they opened with "#" is drawn as a heading because the app is
   reading rather than choosing. Naming from a control writes that line for
   them; typing it into the note by hand does the same thing, and the two are
   indistinguishable afterwards because they are the same thing.

   Ideas were named this way first (an idea is a *place*, and by the fifth
   merge the board was five identical canvases). Plain notes were given the same
   thing on request — "a way to name a note just like the ideaboards have" — so
   this lives here rather than in `canvas.ts`, and both read one definition.

   Everything follows from that for free. The name travels with the note rather
   than with a layout. It is searchable, because the body is searched. It
   survives on `raw_content`'s side of the line, because `body` is what editing
   writes. And no schema, no column and no second content model is involved:
   `title` stays exactly what it was, the AI layer's, and stays unrendered.

   Only a **single** `#` on line 0 is a name. `##` is still read and drawn as a
   heading, but it is the pasted-markdown subheading, and a merge joins source
   texts head-first — so a source's own `## Ingredients` landing on line 0 is
   the ordinary case, not a rare one, and it is not the name of anything.
   -------------------------------------------------------------------------- */

function nameLine(line: string): string | null {
  const heading = headingOf(line);
  if (!heading || !/^#[ \t]/.test(heading.marker)) return null;
  const words = heading.words.trim();
  return words ? words : null;
}

/** The name the user gave this note, or null if they have not named it. */
export function noteName(body: string | null | undefined): string | null {
  return nameLine((body ?? "").split("\n", 1)[0] ?? "");
}

/**
 * The note's text with its name set to `name`, or with the name removed when
 * `name` is empty.
 *
 * Only ever touches the first line, and only when that line is already a name
 * — so naming a note whose text opens with a sentence puts the name *above* the
 * sentence and takes nothing away. Renaming replaces the line it wrote last
 * time. Nothing else in the note is read or rewritten.
 */
export function withNoteName(body: string, name: string): string {
  // Hashes typed into the name field are the marker the field writes itself;
  // kept, "# Plan" would be stored as "# # Plan" and read back as "# Plan".
  const trimmed = name.trim().replace(/^#{1,2}[ \t]+/, "").trim();
  const lines = (body ?? "").split("\n");
  const named = nameLine(lines[0] ?? "") !== null;

  if (!trimmed) {
    if (!named) return body;
    // Take the blank line that followed the heading with it, or removing a
    // name would leave the note opening on an empty line forever.
    lines.shift();
    if (lines[0] === "") lines.shift();
    return lines.join("\n");
  }

  const heading = `# ${trimmed}`;
  if (named) {
    lines[0] = heading;
    return lines.join("\n");
  }
  return body ? `${heading}\n\n${body}` : heading;
}

/**
 * The opening line of an unnamed idea's text — the first source's own first
 * words, for the idea card to carry under its picture (review UX-A-09).
 *
 * Read from the note's text as the user wrote it, never composed by the app:
 * the first line that holds words, past blank lines and the `———` rule merge
 * joins sources with, with a list or tick-box marker taken off (`markerOf`, the
 * one definition). Null when there is none, and null for a *named* note — the
 * name is what its card says then.
 */
export function openingLine(body: string | null | undefined): string | null {
  const text = body ?? "";
  if (noteName(text)) return null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || /^[—–\-_=*]{3,}$/.test(line)) continue;
    const words = (markerOf(line)?.words ?? line).trim();
    if (words) return words;
  }
  return null;
}
