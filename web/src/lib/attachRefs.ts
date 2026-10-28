import type { Attachment } from "../types";
import { linkify } from "./links";

/**
 * Markers in a note's text that point at one of its files: `[image 2]`,
 * `[file 1]` (owner, 2026-10-26).
 *
 * A file added while the note already has words writes its marker at the
 * caret, so a sentence can say which picture it means ("the crack is here
 * [image 2]"). In the open note the marker is drawn as a link and opens that
 * file; on a card it is plain text. A file added to a note with no words
 * writes nothing — the note is the file, as it always was.
 *
 * The marker is ordinary characters the user can edit or delete, so the
 * stored text is still exactly what is drawn (`lib/inline.ts`'s hard rule).
 * The number is stored on the attachment (`Attachment.ref`) when it is added,
 * counted per kind per note, and never reused or renumbered by reordering or
 * removing a file: a marker never silently starts pointing at another file.
 * A marker whose file is gone is drawn as plain text.
 */

export type AttachKind = "image" | "file";

/**
 * Pictures are "image"; everything else — a PDF, a film, a sound — is "file".
 * A picture the browser would not name a type for (a phone's HEIC, often) is
 * known by its ending, so the bar's marker and the stored file agree.
 */
export function kindOf(mime: string, name = ""): AttachKind {
  return mime.startsWith("image/") || /\.(heic|heif|jpe?g|png|gif|webp|avif|bmp)$/i.test(name) ? "image" : "file";
}

const kindOfAtt = (a: Pick<Attachment, "mime" | "name">) => kindOf(a.mime, a.name);

/** A marker, with the kind and the number captured. */
export const MARKER_RE = /\[(image|file) (\d{1,3})\]/g;

/** The highest number each kind has used among these files. */
function topRefs(existing: readonly Pick<Attachment, "mime" | "name" | "ref">[]): Record<AttachKind, number> {
  const top: Record<AttachKind, number> = { image: 0, file: 0 };
  for (const a of existing) {
    if (a.ref !== undefined) top[kindOfAtt(a)] = Math.max(top[kindOfAtt(a)], a.ref);
  }
  return top;
}

/**
 * The numbers files about to be added will take: one past the highest each
 * kind has used, in order. Worked out *before* the files are read, so their
 * markers are written at once, where the caret is, and handed to the store
 * with the files (`attachTo`, `createWithFiles`), which keeps them.
 */
export function refsFor(
  existing: readonly Pick<Attachment, "mime" | "name" | "ref">[],
  files: readonly { type: string; name: string }[],
): number[] {
  const top = topRefs(existing);
  return files.map((f) => (top[kindOf(f.type, f.name)] += 1));
}

/**
 * The files being added, each given its number: the one handed in (`refs`,
 * by position) where there is one, else the next after everything else.
 */
export function numberAttachments(
  existing: readonly Attachment[],
  added: readonly Attachment[],
  refs: readonly (number | undefined)[] = [],
): Attachment[] {
  const given = added.map((a, i) => (a.ref === undefined && refs[i] !== undefined ? { ...a, ref: refs[i] } : a));
  const top = topRefs([...existing, ...given]);
  return given.map((a) => (a.ref !== undefined ? a : { ...a, ref: (top[kindOfAtt(a)] += 1) }));
}

/** The marker an attachment is written as, or null for one with no number. */
export function markerFor(a: Pick<Attachment, "mime" | "name" | "ref">): string | null {
  return a.ref === undefined ? null : `[${kindOfAtt(a)} ${a.ref}]`;
}

/** The file a marker points at, if the note still carries it. */
export function findMarked(atts: readonly Attachment[], kind: AttachKind, n: number): Attachment | undefined {
  return atts.find((a) => a.ref === n && kindOfAtt(a) === kind);
}

/** The text without its markers, for asking whether a note has words of its own. */
export function stripMarkers(text: string): string {
  return text.replace(MARKER_RE, "");
}

/**
 * Whether a file added now gets a marker: only where there are words to say
 * which file they mean. Not in an empty note (the note is the file), and not
 * in one of nothing but addresses, which would stop it being a link note.
 */
export function wantsMarkers(text: string): boolean {
  return linkify(stripMarkers(text)).some((seg) => !seg.href && seg.text.trim() !== "");
}

/** The text with its markers taken out, each with the space written in front of it. */
export function dropMarkers(text: string): string {
  return text.replace(/ ?\[(?:image|file) \d{1,3}\]/g, "");
}

/**
 * The numbers of a new note's files, by their place in the list: 1, 2… per
 * kind, in order. The capture bar writes its markers with these, and the
 * capture hands each kept file its own (`useCapture`), so a file refused at
 * Save leaves its marker pointing at nothing rather than at the next file.
 */
export function refsInOrder(files: readonly { type: string; name: string }[]): number[] {
  return refsFor([], files);
}

/** The markers for files joining the ones waiting in the capture bar. */
export function pendingMarkers(waiting: readonly File[], added: readonly File[]): string[] {
  return refsInOrder([...waiting, ...added])
    .slice(waiting.length)
    .map((n, i) => `[${kindOf(added[i].type, added[i].name)} ${n}]`);
}

/** The marker for a file about to be added under number `n`. */
export function markerOf(file: { type: string; name: string }, n: number): string {
  return `[${kindOf(file.type, file.name)} ${n}]`;
}

/**
 * The markers written in at `at`, with a space put between them and a word
 * they would otherwise touch; the caret lands after them.
 */
export function withMarkers(value: string, at: number, markers: readonly string[]): { value: string; caret: number } {
  if (markers.length === 0) return { value, caret: at };
  const before = at > 0 && !/\s/.test(value[at - 1]) ? " " : "";
  const after = at < value.length && !/\s/.test(value[at]) ? " " : "";
  const put = `${before}${markers.join(" ")}${after}`;
  return { value: value.slice(0, at) + put + value.slice(at), caret: at + put.length };
}
