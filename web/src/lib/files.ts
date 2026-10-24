import type { Attachment } from "../types";

/**
 * Turning a dropped file into something a note can carry.
 *
 * Nothing here touches the network or the store. It answers three questions:
 * what is this file called, how big is it, and what does it look like — the
 * last one being the whole trick, because a card that can draw the picture is
 * a card you can find again without reading anything.
 */

/**
 * Past this a single file is no longer a note, it is a transfer job. 50 MiB since
 * 2026-10-09 (owner approved: about thirty seconds of a phone's 1080p video), the
 * bucket's own `file_size_limit` moved with it (migration 0027).
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Whether a file has anything in it to keep.
 *
 * A **folder** arrives through a file API — dropped, pasted from a file
 * manager, shared — as a `File` with no type and no readable bytes, and it made
 * a note named after the folder that would never open, never upload, and sit
 * in the outbox for good. There is no way to tell a directory from a genuinely
 * empty file through that API, and an empty file is not worth a note either.
 * `useFileDrop` has always refused both; this is the same test for every door.
 */
export function hasContent(f: File): boolean {
  return f.size > 0 || f.type !== "";
}

/** Whether a file is one a note can carry: something in it, and under the
 *  bucket's limit. Anything else is refused by every door, every time. */
export function canKeep(f: File): boolean {
  return hasContent(f) && f.size <= MAX_FILE_BYTES;
}

/**
 * The long edge of the thumbnail carried in the note row.
 *
 * Small on purpose. This travels inside the note itself so it arrives with the
 * sync rather than after it, which means every byte is paid for on every pull,
 * for every device, forever.
 *
 * 200px was too small, though, and visibly so: a desktop column runs to 323px,
 * and a portrait photo in a landscape card is scaled by its *width*, so a phone
 * photo whose long edge is its height arrived at the card about 180px wide and
 * was blown up to nearly double. 320 covers the widest column outright and the
 * portrait case honestly, at roughly 12kB. That is the ceiling: this is still a
 * thumbnail for finding the file by, never a substitute for opening it — the
 * card reaches for the real bytes when this device already has them, and the
 * open note fetches them.
 */
export const THUMB_PX = 320;
export const THUMB_QUALITY = 0.62;

/**
 * The long edge of a *link* preview thumbnail — smaller than `THUMB_PX`
 * because the slot it rides in is smaller: `.link-preview-thumb` is
 * `flex: 0 0 68px` (48px in the compact card layout), not a card-width photo.
 * It still rides inside the note row, for the same reason `Attachment.thumb`
 * does: the other device draws it the moment the note syncs, no second fetch.
 */
export const PREVIEW_THUMB_PX = 200;

/**
 * The long edge of a link picture **stored for the Inspiration wall**, defined
 * in `lib/links.ts` (which the server's typecheck also reads, and which must
 * therefore not import this DOM-bound module) and said here with the sizes it
 * sits beside. Everywhere else a link picture stays `PREVIEW_THUMB_PX`, and an
 * attachment's own thumbnail stays capped at 320 (`THUMB_PX`) — never raise
 * that one, the wall reads the local decode instead.
 */
export { WALL_THUMB_PX } from "./links";
export const WALL_THUMB_QUALITY = 0.7;

/**
 * What a file's *name* says it is, for the file whose own `type` says nothing.
 *
 * An empty `file.type` is not rare and is not a bug to fix upstream: Android's
 * share sheet sends one often enough that `shareTarget.test.ts` pins it, and
 * some drag sources do the same. `fileKind` and `fileIconKey` already read the
 * extension first for exactly that reason, so the card drew a picture's name,
 * its "PNG" and its picture mark correctly — and then `measure()` returned
 * early on `!file.type.startsWith("image/")` without ever asking
 * `createImageBitmap`, which would have decoded the bytes perfectly well. The
 * note was stored with `mime: ""`, so `isImage` was false and the row drew a
 * grey box, `canPreview` was false so the viewer would not open it at all, and
 * the other device got a note with no thumbnail in it. `isPdf(mime, name)` has
 * always been the two-source shape; this is the rest of it.
 *
 * Deliberately only the four families whose *fields* are read as behaviour —
 * picture, sound, film, document. A `.docx` with no type still shows its four
 * letters and its paper mark from the extension, which is everything the app
 * does with it, so mapping it here would buy nothing and would be one more
 * table to keep true. And nothing is guessed: an extension nobody recognises
 * comes back as the empty string it arrived as, because a file whose type is
 * genuinely unknown is a file, and saying `application/octet-stream` out loud
 * would be inventing an answer rather than admitting there is none.
 */
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
  heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg",
  opus: "audio/opus", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", m4v: "video/x-m4v",
  pdf: "application/pdf",
};

/**
 * The type to *believe* for a file: what the browser said, and only where it
 * said nothing, what the name says. That order matters — `x.png` carrying a
 * real `application/pdf` is a PDF someone renamed, and the browser sniffed the
 * bytes while the extension is only what it was typed as.
 *
 * `""` for a file neither source can name, which is what an `Attachment` has
 * always stored in that case.
 */
export function mimeFor(name: string, type: string): string {
  if (type) return type;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return EXT_MIME[ext] ?? "";
}

/**
 * The three predicates read `mimeFor`, not the stored string, so a note that
 * was **already** saved with an empty type — every picture shared from Android
 * before this was fixed, on this device and on the other one — starts drawing
 * its picture again without a migration touching a single row.
 */
export function isImage(a: Attachment): boolean {
  return mimeFor(a.name, a.mime).startsWith("image/");
}

export function isAudio(a: Attachment): boolean {
  return mimeFor(a.name, a.mime).startsWith("audio/");
}

export function isVideo(a: Attachment): boolean {
  return mimeFor(a.name, a.mime).startsWith("video/");
}

/** The same two-source test on a raw `File`, before there is an `Attachment`. */
export function looksLikeImage(mime: string, name: string): boolean {
  return mimeFor(name, mime).startsWith("image/");
}

/**
 * Whether the full-screen viewer has anything to open for this file.
 *
 * The same test the attachment row makes before it draws a button at all: a
 * picture always, a document because it has a face drawn for it, and nothing
 * else — audio and video play in the row itself, and a file with no face is
 * four letters and a name. It is written once here because the viewer now
 * walks between files, and the list it walks has to be exactly the list of
 * rows that could have opened it.
 */
export function canPreview(a: Attachment): boolean {
  if (isAudio(a) || isVideo(a)) return false;
  return isImage(a) || Boolean(a.thumb);
}

/** Bytes as something a person reads, in the four characters the footer has. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/**
 * A MIME subtype is written for machines, so when it has to stand in for a
 * missing extension the common ones get the word a person would use —
 * "text/plain" is a TEXT file, not a PLAI one, and the Office types bury the
 * answer at the end of a sentence. Everything else still takes the subtype's
 * first word, bounded as before.
 */
const MIME_LABEL: Record<string, string> = {
  "text/plain": "TEXT",
  "image/jpeg": "JPG",
  "image/svg+xml": "SVG",
  "audio/mpeg": "MP3",
  "video/quicktime": "MOV",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.oasis.opendocument.text": "ODT",
};

/**
 * The bit after the last dot, uppercased — what a file with no picture shows
 * instead of one. Bounded, because "photo.that.is.not.an.extension" is a name,
 * not a type, and a twelve-character box would wreck the card.
 */
export function fileKind(name: string, mime: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  if (ext.length >= 1 && ext.length <= 4 && /^[A-Za-z0-9]+$/.test(ext)) {
    return ext.toUpperCase();
  }
  const label = MIME_LABEL[mime.toLowerCase()];
  if (label) return label;
  const sub = mime.split("/")[1] ?? "";
  return (sub.split(/[+.;]/)[0] || "FILE").slice(0, 4).toUpperCase();
}

/**
 * Which family of thing a file is — the key for the mark drawn where a
 * preview would have been (`IconFileType` in `Icons.tsx`).
 *
 * Extension first, then MIME: the same two sources `fileKind` reads, in the
 * same order, because the extension is the part the user can see and the type
 * is whatever the browser guessed — often nothing at all (Android share and
 * some drag sources hand over an empty string).
 *
 * The families are deliberately few. The mark only names the family; the
 * extension text drawn beside it still says exactly what the file is, which
 * no icon can — a .7z and a .tar.gz are both boxes. "file" is the honest
 * answer for everything else: a plain page, a file and nothing more.
 */
export type FileIconKey =
  | "image"
  | "document"
  | "audio"
  | "video"
  | "sheet"
  | "slides"
  | "code"
  | "archive"
  | "calendar"
  | "contact"
  | "file";

const EXT_FAMILY: Record<string, FileIconKey> = {
  // Pictures normally carry their own face; the mark is for the one that
  // would not decode (a HEIC on a machine that cannot read one).
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  heic: "image", heif: "image", avif: "image", bmp: "image", svg: "image",
  tif: "image", tiff: "image",
  // Paper: things that are read. Plain text included — the extension text
  // tells TXT from PDF, the family is the same.
  pdf: "document", doc: "document", docx: "document", odt: "document",
  rtf: "document", txt: "document", md: "document", log: "document",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio",
  flac: "audio", aac: "audio", opus: "audio",
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video",
  m4v: "video",
  xlsx: "sheet", xls: "sheet", csv: "sheet", ods: "sheet",
  pptx: "slides", ppt: "slides", key: "slides", odp: "slides",
  js: "code", ts: "code", jsx: "code", tsx: "code", py: "code", json: "code",
  yml: "code", yaml: "code", xml: "code", html: "code", css: "code",
  sh: "code", sql: "code", toml: "code", ini: "code",
  zip: "archive", tar: "archive", gz: "archive", tgz: "archive",
  bz2: "archive", xz: "archive", rar: "archive",
  "7z": "archive",
  ics: "calendar",
  vcf: "contact",
};

export function fileIconKey(name: string, mime: string): FileIconKey {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const known = EXT_FAMILY[ext];
  if (known) return known;

  const type = mime.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type === "text/csv" || type.includes("spreadsheet")) return "sheet";
  if (type.includes("presentation")) return "slides";
  if (type === "text/calendar") return "calendar";
  if (type === "text/vcard" || type === "text/x-vcard") return "contact";
  if (
    type === "application/json" ||
    type === "application/xml" ||
    type === "application/javascript" ||
    type.endsWith("+xml")
  ) {
    return "code";
  }
  if (
    type === "application/zip" ||
    type === "application/gzip" ||
    type === "application/x-tar" ||
    type === "application/x-7z-compressed" ||
    type === "application/x-rar-compressed"
  ) {
    return "archive";
  }
  if (
    type === "application/pdf" ||
    type === "application/rtf" ||
    type.includes("word") ||
    type.includes("opendocument.text") ||
    type.startsWith("text/")
  ) {
    return "document";
  }
  return "file";
}

/**
 * A file dropped in writes *no* text into the note.
 *
 * It used to write its own filename, on the reasoning that a note has to say
 * something. It does not: the file is what the note is. Writing the name into
 * the body printed it twice — once in the note's own words and again in the
 * row under the picture, which already says the name, the size and the state —
 * and the copy in the body was the one that was not a fact about the file but a
 * sentence the user appeared to have written and had to delete by hand.
 *
 * The name is not lost by leaving it out. `searchNotes` reads the names off the
 * attachments, so the file is still found by typing it.
 */

/**
 * Files waiting on the bar, counted in the bar's words: "2 pictures attached",
 * "1 file shared". Pictures are called pictures only when every one is.
 */
export function filesSaid(files: File[], how: string): string {
  // A folder rides along as an empty `File` and is never kept, so it is not counted.
  const kept = files.filter(hasContent);
  const n = kept.length;
  const pictures = kept.every((f) => looksLikeImage(f.type, f.name));
  const noun = pictures ? (n === 1 ? "picture" : "pictures") : n === 1 ? "file" : "files";
  return `${n} ${noun} ${how}`;
}
