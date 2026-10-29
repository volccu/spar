import type { Note, NoteStatus, UserBoard } from "../types";
import {
  BOARD_NAME_MAX,
  buildBoards,
  createBoard,
  INSPIRATION_NAME,
  isTodoNote,
  linksOnly,
  TRASH_BOARD,
} from "./boards";
import { MAX_FILE_BYTES } from "./files";
import { CONFLICT_FIELDS } from "./versions";
import type { SourceFile, SourceFiles } from "./keepSource";

/* --- Google Keep, in the browser -----------------------------------------------
   A stranger holding a Takeout gets their Keep archive into spår on their own
   device, in one sitting. This file is every decision about *what a Keep note
   becomes*; `lib/keepSource.ts` finds the files, and the store writes the notes
   (`importNotes` in `store/useNotes.ts`). It follows `src/keep.ts`, the Phase 0
   importer the owner's own archive came in through, and deliberately leaves
   that file alone — `hasEnrichable` there is still load-bearing.

   What a Keep note becomes:

   - **Its text is the note's text, written once as `raw_content`**, exactly as
     every capture is, with `body` starting equal to it. Nothing is capitalised
     or tidied: these are the person's own words, years of them.
   - **A title is the note's name** — a `# ` line at the top (`lib/name.ts`),
     the app's own answer to "a note may be named". The Phase 0 importer wrote
     it as a plain first line because names did not exist yet; written as a
     name, a titled checklist keeps its tick-box face and lands on Todos.
   - **A checklist is tick boxes**, `[ ]` and `[x]`, the characters the app
     already reads as boxes. An item Keep let run over several lines is one line
     here, because an item is one line in the block model.
   - **A saved web link is its address on a line of its own**, which is how
     every link in the app is written — the card names it and the preview is
     fetched the ordinary way. An address already in the text is not repeated.
   - **Created and edited times are Keep's**, not the moment of import, so the
     board orders the archive the way it was written (`editedAt` reads the
     `body` clock, which is stamped with Keep's edit time).
   - **Pinned is Important** (`priority: 1`) — the one mark that lifts a note
     to the top of its board, which is what a pin did. Phase 0 mapped it the
     same way (`scripts/seed-web.ts`).
   - **Archived goes to the Archive; Keep's trash is left behind and counted.**
   - **Labels become boards, as the person chooses** (the labels screen): a new
     board, one they already have, or the Inbox. A note has one board, so the
     first of its labels that became a board wins, and **every label that did
     not become its board is written on its last line** — `Keep labels: work,
     ideas` — so nothing the person wrote down is lost. That line is part of the
     imported text, and so part of `raw_content`.
   - **Photographs, drawings and recordings become real attachments** through
     the path a dropped file takes (`describeAll`, `putFiles`), under the same
     50 MB limit. A file over it, missing from the Takeout or damaged in it is
     named in the summary, never left out in silence.

   What does not come across, said on the screen as plainly as here: Keep's
   colours (the app has none), Keep's reminders (Takeout does not export them)
   and who a note was shared with (the app has one reader).
   -------------------------------------------------------------------------- */

/** The fields of a Takeout Keep JSON that this reads. Everything is optional:
 *  Takeout has changed shape before and a missing field is never an error. */
export interface KeepJson {
  title?: string;
  textContent?: string;
  listContent?: { text?: string; isChecked?: boolean }[];
  annotations?: { source?: string; title?: string; url?: string; description?: string }[];
  attachments?: { filePath?: string; mimetype?: string }[];
  labels?: { name?: string }[];
  isTrashed?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
}

/** A file a Keep note carried, and where in the Takeout it was found. */
export interface KeepFileRef {
  name: string;
  mime: string;
  /** The file in the source, or null when the Takeout did not include it. */
  source: SourceFile | null;
}

/** One Keep note, read and turned into text, not yet anything in the store. */
export interface KeepFound {
  /** The Takeout file's name without `.json` — Keep's own id for the note, and
   *  what the Phase 0 importer stored as `keep_id`. */
  stem: string;
  /** Keep's creation stamp in microseconds, or null when the file has none. */
  createdUsec: number | null;
  text: string;
  labels: string[];
  status: Exclude<NoteStatus, "trashed">;
  pinned: boolean;
  created_at: string;
  edited_at: string;
  files: KeepFileRef[];
}

export interface KeepScan {
  notes: KeepFound[];
  /** Notes in Keep's own trash — left behind, and counted. */
  trashed: number;
  /** Files that looked like notes and could not be read, by path. */
  unreadable: string[];
}

function usecToIso(usec: number): string {
  return new Date(Math.round(usec / 1000)).toISOString();
}

/** A title or a list item as one line: Keep lets both run over several. */
function oneLine(text: string | undefined): string {
  return (text ?? "").replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * The text a Keep note becomes — everything but the labels line, which waits
 * for the person's choices (`placeNote`).
 */
export function composeText(json: KeepJson): string {
  const sections: string[] = [];
  const words = (json.textContent ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "").replace(/^\s*\n/, "");
  if (words.trim()) sections.push(words);
  const items = (json.listContent ?? [])
    .map((item) => ({ text: oneLine(item.text), done: item.isChecked === true }))
    .filter((item) => item.text);
  if (items.length > 0) {
    sections.push(items.map((item) => `[${item.done ? "x" : " "}] ${item.text}`).join("\n"));
  }
  const written = sections.join("\n");
  const links: string[] = [];
  for (const note of json.annotations ?? []) {
    const url = (note.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (written.includes(url) || links.includes(url)) continue;
    links.push(url);
  }
  if (links.length > 0) sections.push(links.join("\n"));
  const body = sections.join("\n\n");
  // The same marker `withNoteName` writes, and the same hashes stripped off a
  // title typed as one — but written by hand, because `withNoteName` replaces
  // a first line that is already a name, and a note whose own text opens with
  // `# ` would lose that line to its title.
  const title = oneLine(json.title).replace(/^#{1,2}[ \t]+/, "").trim();
  if (!title) return body;
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}

/** The directory part of a path, with its trailing slash, or "". */
function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at + 1);
}

function stemOf(path: string): string {
  return path.slice(dirOf(path).length).replace(/\.json$/i, "");
}

/**
 * Where a file a note names actually is. Takeout writes the name into the
 * note, and has long been known to write it with a different extension than
 * the file on disk — `.jpeg` in the note, `.jpg` beside it — so an exact miss
 * falls back to the same name with any extension, in the note's own folder.
 */
function findFile(files: SourceFiles, dir: string, name: string): SourceFile | null {
  const exact = files.get(dir + name);
  if (exact) return exact;
  const base = name.replace(/\.[^./]*$/, "").toLowerCase();
  for (const [path, file] of files) {
    if (dirOf(path) !== dir) continue;
    const other = path.slice(dir.length);
    if (other.replace(/\.[^./]*$/, "").toLowerCase() === base && !/\.(json|html)$/i.test(other)) {
      return file;
    }
  }
  return null;
}

/**
 * One Takeout JSON as a note, or `"trashed"` for a note in Keep's trash, or
 * null for a JSON that is not a Keep note at all (Takeout puts other products'
 * files beside Keep's, and a folder can hold anything).
 */
export function readKeepNote(json: unknown, path: string, files: SourceFiles): KeepFound | "trashed" | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const note = json as KeepJson;
  // Every Keep note carries at least one of its two stamps; nothing else in a
  // Takeout does.
  const created = typeof note.createdTimestampUsec === "number" ? note.createdTimestampUsec : null;
  const edited = typeof note.userEditedTimestampUsec === "number" ? note.userEditedTimestampUsec : null;
  if (created === null && edited === null) return null;
  if (note.isTrashed === true) return "trashed";

  const created_at = usecToIso(created ?? edited ?? 0);
  const editedIso = usecToIso(edited ?? created ?? 0);
  const dir = dirOf(path);
  const labels: string[] = [];
  for (const label of note.labels ?? []) {
    const name = oneLine(label.name);
    if (name && !labels.includes(name)) labels.push(name);
  }
  return {
    stem: stemOf(path),
    createdUsec: created,
    text: composeText(note),
    labels,
    status: note.isArchived === true ? "archived" : "active",
    pinned: note.isPinned === true,
    created_at,
    // A note edited before it existed is two clocks disagreeing; the board
    // clamps it the same way (`editedAt`).
    edited_at: editedIso < created_at ? created_at : editedIso,
    files: (note.attachments ?? [])
      .filter((att) => (att.filePath ?? "").trim())
      .map((att) => {
        const name = att.filePath!.trim();
        return { name, mime: att.mimetype ?? "", source: findFile(files, dir, name) };
      }),
  };
}

/**
 * The note files in a Takeout. Keep's live in a folder called `Keep`
 * (`Takeout/Keep/…` in the zip, `Keep/…` when that folder is what was
 * picked), and a Takeout of more than Keep holds thousands of other JSON
 * files that must not be opened one by one. Only when nothing sits under a
 * `Keep` folder is every JSON offered — a folder of loose Keep files, picked
 * straight — and `readKeepNote` still refuses anything that is not a note.
 */
export function keepJsonPaths(files: SourceFiles): string[] {
  const json = [...files.keys()].filter((path) => /\.json$/i.test(path));
  const underKeep = json.filter((path) => /(^|\/)keep\//i.test(dirOf(path)));
  return (underKeep.length > 0 ? underKeep : json).sort();
}

/** How many JSON files are read at once — enough to keep the zip reader busy,
 *  few enough that a phone is not holding hundreds of inflated files. */
const READ_AT_ONCE = 8;

/** Reads every note in the source. `onProgress` is told how far it has got. */
export async function scanKeep(
  files: SourceFiles,
  onProgress?: (done: number, total: number) => void,
): Promise<KeepScan> {
  const paths = keepJsonPaths(files);
  const found: (KeepFound | null)[] = new Array(paths.length).fill(null);
  const scan: KeepScan = { notes: [], trashed: 0, unreadable: [] };
  const utf8 = new TextDecoder();
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < paths.length) {
      const i = next++;
      const path = paths[i];
      try {
        const bytes = await files.get(path)!.read();
        const note = readKeepNote(JSON.parse(utf8.decode(bytes)), path, files);
        if (note === "trashed") scan.trashed += 1;
        else found[i] = note;
      } catch {
        // Under a Keep folder a file that will not read is a note lost, and
        // is said; a stray file elsewhere was never a note.
        if (/(^|\/)keep\//i.test(dirOf(path))) scan.unreadable.push(path);
      }
      done += 1;
      onProgress?.(done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, paths.length) }, lane));
  scan.notes = found.filter((note): note is KeepFound => note !== null);
  scan.unreadable.sort();
  return scan;
}

/* --- not twice ---------------------------------------------------------------- */

/** A note that is going in, and the `keep_id` it will carry. */
export interface KeepFresh extends KeepFound {
  keep_id: string;
}

/** A note an earlier import made that now sits in the trash — an Undo put it
 *  there — and the Keep note it came from. Importing again brings it back under
 *  the new choices rather than calling it "already here" or making it twice. */
export interface KeepRevive {
  id: string;
  /** The Keep note, for its labels and the status Keep gave it. */
  found: KeepFound;
}

export interface KeepPlan {
  fresh: KeepFresh[];
  /** Already in this archive from an earlier import, active or archived, and
   *  so left alone. */
  already: number;
  /** Matches that are in the trash here: counted apart and brought back. */
  revive: KeepRevive[];
  /** Notes with nothing in them once what cannot come across is left out — no
   *  words, no label, and every file missing or over the limit. Said up front,
   *  and not offered again on every run. */
  empty: number;
  /** Each label once, with how many of the notes going in carry it. */
  labels: { name: string; count: number }[];
}

/** No words, no label to write on its last line, and no file that could come
 *  across (missing from the Takeout, or over the limit). */
function isEmptyNote(found: KeepFound): boolean {
  return (
    !found.text.trim() &&
    found.labels.length === 0 &&
    found.files.every((ref) => !ref.source || ref.source.size > MAX_FILE_BYTES)
  );
}

function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}

/**
 * Which notes are new here, and the `keep_id` each one will carry.
 *
 * A note is already here when a note in the store carries its Keep id and was
 * created at the same instant — which is how running the import twice, or
 * running it over an archive that came in through the Phase 0 importer, skips
 * everything it has seen. **The trash counts as here**: a note undone into the
 * trash is still a note, and making it again would be the duplicate the undo
 * was for.
 *
 * The creation stamp is part of the question because the Keep id is only the
 * file's name, and two Keep accounts can both hold a `Shopping.json`. The
 * second one is a different note and goes in — under `Shopping@<created>`,
 * because the server holds `keep_id` unique and a second row under the same
 * id would be refused on every sync for ever. That longer id is what a later
 * import of the same Takeout recognises too.
 */
export function planImport(scan: KeepScan, existing: Note[]): KeepPlan {
  const taken = new Map<string, Note[]>();
  for (const note of existing) {
    if (!note.keep_id) continue;
    const list = taken.get(note.keep_id) ?? [];
    list.push(note);
    taken.set(note.keep_id, list);
  }
  const plan: KeepPlan = { fresh: [], already: 0, revive: [], empty: 0, labels: [] };
  const counts = new Map<string, number>();
  const claimed = new Set<string>();
  const countLabels = (found: KeepFound) => {
    for (const label of found.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  };
  for (const found of scan.notes) {
    const own = taken.get(found.stem) ?? [];
    const alternate = `${found.stem}@${found.createdUsec ?? "none"}`;
    const matches = [
      ...own.filter((note) => found.createdUsec === null || sameInstant(note.created_at, found.created_at)),
      ...(taken.get(alternate) ?? []),
    ];
    if (matches.length > 0) {
      // In the trash only: an Undo's notes. Anywhere else it is here already.
      if (matches.every((note) => note.status === "trashed")) {
        plan.revive.push({ id: matches[0].id, found });
        countLabels(found);
      } else {
        plan.already += 1;
      }
      continue;
    }
    // Nothing to make: decided here, where it is said up front, rather than
    // after the writing starts (and offered again by every later run).
    if (isEmptyNote(found)) {
      plan.empty += 1;
      continue;
    }
    let keep_id = own.length > 0 || claimed.has(found.stem) ? alternate : found.stem;
    // Three notes of one name with no creation instant would all ask for
    // `stem@none`, and the server, holding keep_id unique, refuses the third
    // on every sync: a repeat is counted on instead.
    for (let n = 2; claimed.has(keep_id) || taken.has(keep_id); n++) keep_id = `${alternate}#${n}`;
    claimed.add(keep_id);
    plan.fresh.push({ ...found, keep_id });
    countLabels(found);
  }
  plan.labels = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return plan;
}

/* --- labels, and where each note goes ----------------------------------------- */

/** Where one label's notes go: a board made for it, a board already on the
 *  shelf, or nowhere — the Inbox. */
export type LabelChoice = { to: "new"; name: string } | { to: "board"; id: string } | { to: "inbox" };

/** The name a new board for this label starts with — the label, within the
 *  length a board name may have. */
export function boardNameFor(label: string): string {
  return label.trim().slice(0, BOARD_NAME_MAX).trim();
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/**
 * A label on this many notes or fewer starts in the Inbox rather than as a
 * board of its own (review UX-21). A Keep account with thirty labels made
 * thirty boards in one go, most of them holding a note or two, on a shelf
 * that already overflowed at five. The label is not lost: it stays on the
 * note's last line (`LABELS_LINE`), and the row's chooser still makes it a
 * board in one change.
 */
export const SMALL_LABEL = 2;

/**
 * What the labels screen starts at: a board the person already has, where one
 * is called what the label is called — which is also what makes a second
 * import land where the first did — then the Inbox for a label on one or two
 * notes (`SMALL_LABEL`), and otherwise a new board named after it.
 */
export function defaultChoices(
  labels: { name: string; count?: number }[],
  boards: UserBoard[],
): Record<string, LabelChoice> {
  const out: Record<string, LabelChoice> = {};
  for (const { name, count } of labels) {
    const existing = boards.find((board) => sameName(board.name, name));
    out[name] = existing
      ? { to: "board", id: existing.id }
      : count !== undefined && count <= SMALL_LABEL
        ? { to: "inbox" }
        : { to: "new", name: boardNameFor(name) };
  }
  return out;
}

/**
 * Every label at once, from the one switch above the rows: each to a board —
 * the one already called that, or a new one named after it — or all of them
 * to the Inbox.
 */
export function chooseAll(
  labels: { name: string }[],
  boards: UserBoard[],
  to: "new" | "inbox",
): Record<string, LabelChoice> {
  const out: Record<string, LabelChoice> = {};
  for (const { name } of labels) {
    const existing = boards.find((board) => sameName(board.name, name));
    out[name] =
      to === "inbox"
        ? { to: "inbox" }
        : existing
          ? { to: "board", id: existing.id }
          : { to: "new", name: boardNameFor(name) };
  }
  return out;
}

/** What the switch above the rows reads: every label to a board of its own
 *  name, every label to the Inbox, or anything else ("mixed"). */
export function allChoice(
  labels: { name: string }[],
  boards: UserBoard[],
  choices: Record<string, LabelChoice>,
): "new" | "inbox" | "mixed" {
  const each = (to: "new" | "inbox") => chooseAll(labels, boards, to);
  const same = (a: Record<string, LabelChoice>) =>
    labels.every(({ name }) => {
      const x = a[name];
      const y = choices[name] ?? { to: "inbox" };
      if (x.to !== y.to) return false;
      if (x.to === "board" && y.to === "board") return x.id === y.id;
      return true;
    });
  if (same(each("inbox"))) return "inbox";
  if (same(each("new"))) return "new";
  return "mixed";
}

/** The boards the choices ask to be made, each name once however many labels
 *  asked for it, blank names falling back to the label's own. A name a board
 *  already has is not made again: its notes are filed into that board
 *  (`resolveChoices`), so the shelf never holds two of one name (review GAP-04). */
export function boardsToMake(
  choices: Record<string, LabelChoice>,
  existing: readonly UserBoard[] = [],
): string[] {
  const names: string[] = [];
  for (const [label, choice] of Object.entries(choices)) {
    if (choice.to !== "new") continue;
    const name = choice.name.trim().slice(0, BOARD_NAME_MAX).trim() || boardNameFor(label);
    if (!name || existing.some((board) => sameName(board.name, name))) continue;
    if (!names.some((known) => sameName(known, name))) names.push(name);
  }
  return names;
}

/** The letters of a name, lower-cased and singular, so "Todo", "To-do" and
 *  "todos" are one word. */
function looseName(name: string): string {
  return name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/s$/, "");
}

/**
 * The automatic board a name looks like — Inbox, Archive, Todos, Links, Files,
 * All, Trash or Inspiration — or null. A label named "Todo" still makes a board, and a shelf
 * scanned by name then holds Todo beside Todos, so the labels screen says so in
 * one line (review GAP-04). The names are the app's own (`buildBoards`).
 */
export function automaticBoardName(name: string): string | null {
  const loose = looseName(name);
  if (!loose) return null;
  const own: { name: string }[] = [...buildBoards([]), TRASH_BOARD, { name: INSPIRATION_NAME }];
  return own.find((board) => looseName(board.name) === loose)?.name ?? null;
}

/** Each label's board id, or null for the Inbox, once the new boards exist. */
export function resolveChoices(
  choices: Record<string, LabelChoice>,
  boards: UserBoard[],
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [label, choice] of Object.entries(choices)) {
    if (choice.to === "board") {
      out.set(label, boards.some((board) => board.id === choice.id) ? choice.id : null);
    } else if (choice.to === "new") {
      const name = choice.name.trim().slice(0, BOARD_NAME_MAX).trim() || boardNameFor(label);
      out.set(label, boards.find((board) => sameName(board.name, name))?.id ?? null);
    } else {
      out.set(label, null);
    }
  }
  return out;
}

/** The line that keeps the labels a note did not get a board for. */
export const LABELS_LINE = "Keep labels: ";

/**
 * Where one note goes, and what its text says once its labels are settled:
 * the first label (in Keep's own order) that became a board is its board, and
 * every other label is written on its last line.
 */
export function placeNote(
  found: KeepFound,
  target: Map<string, string | null>,
): { board_id: string | null; text: string } {
  let board_id: string | null = null;
  let won: string | null = null;
  for (const label of found.labels) {
    const id = target.get(label) ?? null;
    if (id) {
      board_id = id;
      won = label;
      break;
    }
  }
  const rest = found.labels.filter((label) => label !== won);
  if (rest.length === 0) return { board_id, text: found.text };
  const line = LABELS_LINE + rest.join(", ");
  return { board_id, text: found.text ? `${found.text}\n\n${line}` : line };
}

/**
 * The note a Keep note becomes, carrying no files yet — those are read and
 * attached by the store, the way a drop's are.
 *
 * Its clocks are Keep's edit time, every one of them: the same full set
 * `fieldClocks` invents for a note that has none, said at the moment the note
 * was really last written. So the board orders it by when it was written in
 * Keep, and the first thing done to it here stamps only what was done.
 */
export function keepNote(found: KeepFresh, board_id: string | null, text: string): Note {
  return {
    id: crypto.randomUUID(),
    raw_content: text,
    body: text,
    source: "keep",
    created_at: found.created_at,
    updated_at: found.edited_at,
    note_type: null,
    board_id,
    status: found.status,
    priority: found.pinned ? 1 : 0,
    reminder_at: null,
    reminder_repeat: null,
    done: null,
    merged_from: null,
    keep_id: found.keep_id,
    attachments: [],
    field_updated_at: Object.fromEntries(CONFLICT_FIELDS.map((field) => [field, found.edited_at])),
  };
}

/* --- the import itself ------------------------------------------------------------ */

/** A file that did not come across, and why — named in the summary. */
export interface FileLeftBehind {
  /** How the person will recognise the note: its first line, or its date. */
  note: string;
  name: string;
  why: "too large" | "not in the Takeout" | "unreadable";
}

/** What one import did, and exactly which notes, for its one undo. */
export interface ImportResult {
  imported: number;
  archived: number;
  filed: number;
  /** Of those, the notes that went to the Archive from a board: counted in `archived` once. */
  archivedFiled: number;
  important: number;
  /** Active notes the Inbox will not show because its line is drawn after
   *  them (the first-open question's "Leave them"). */
  beforeInboxLine: number;
  /** Active, unfiled to-dos and bare links: they wait on Todos and Links, not in the Inbox. */
  onTodos: number;
  onLinks: number;
  /** Notes with nothing left in them once their files were left behind. */
  empty: number;
  /** Notes an earlier import made that were in the trash and are back, under
   *  the choices this run was given (`KeepPlan.revive`). */
  revived: number;
  /** Active, unfiled notes this run put in the Inbox as it stands — not those
   *  its line keeps out, nor to-dos and bare links, which wait elsewhere. The
   *  summary offers the first-open question's answers at `INBOX_ASK_MIN`. */
  inInbox: number;
  files: number;
  leftBehind: FileLeftBehind[];
  /** Every note made, with the status it was made with — what the undo
   *  checks before it moves one to the trash. */
  made: { id: string; status: NoteStatus }[];
  /**
   * Why the import stopped before the end, in words, or null when it did not.
   * The notes written before it are in, counted above and undoable; a second
   * run skips them and brings in the rest.
   */
  stopped: string | null;
}

/**
 * One import, as its undo needs it: every note it made with the status it made
 * it with, and the boards its labels made. The undo moves those notes to the
 * trash — only while each still has that status, the rule every undo here
 * keeps — and takes off the shelf any of those boards left holding nothing.
 */
export interface ImportBatch {
  made: { id: string; status: NoteStatus }[];
  boards: UserBoard[];
}

/* --- the one undo ------------------------------------------------------------------
   An import is thousands of notes and it is one decision, so it is one undo:
   the whole batch to the trash, where the month and Put back already are. It
   is a `run`, not a step per note — `undoLast` fires steps one `update` at a
   time, and five thousand of those is five thousand passes over the archive —
   but it keeps the rule every step keeps: a note moves only while it still has
   the status the import gave it, so one archived or trashed since is left
   where it was put. Nothing is destroyed; `destroy()` keeps its two callers.

   Written here rather than in `App.tsx`, which hands over the store's verbs:
   the whole of it arrives with the import's own chunk and none of it rides on
   the first paint, and it is tested without mounting the app.
   -------------------------------------------------------------------------- */

/** What the import needs from the app: the notes as they are now, the store's
 *  own bulk write, a change to the shelf, and the undo stack. */
export interface ImportStore {
  notes: () => Note[];
  bulkUpdate: (ids: string[], patch: Partial<Note>) => void;
  editBoards: (change: (list: UserBoard[]) => UserBoard[]) => void;
  pushUndo: (entry: { message: string; steps: never[]; run: () => void }) => void;
}

/** The boards the labels asked for, made in one change to the shelf, in the
 *  order asked. */
export function makeBoards(names: string[], store: ImportStore): UserBoard[] {
  const made: UserBoard[] = [];
  if (names.length === 0) return made;
  store.editBoards((list) => {
    let next = list;
    for (const name of names) {
      const board = createBoard(name, next);
      next = [...next, board];
      made.push(board);
    }
    return next;
  });
  return made;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The batch to the trash, and the boards it made that are left holding
 *  nothing, off the shelf. Answers what it moved, for the way back. */
export function trashImport(
  batch: ImportBatch,
  store: ImportStore,
): { moved: ImportBatch["made"]; boards: UserBoard[] } {
  const now = store.notes();
  const byId = new Map(now.map((note) => [note.id, note]));
  const moved = batch.made.filter(({ id, status }) => byId.get(id)?.status === status);
  const going = new Set(moved.map((m) => m.id));
  if (going.size > 0) store.bulkUpdate([...going], { status: "trashed" });
  const emptied = batch.boards.filter(
    (board) =>
      !now.some((note) => note.board_id === board.id && note.status !== "trashed" && !going.has(note.id)),
  );
  if (emptied.length > 0) {
    const gone = new Set(emptied.map((board) => board.id));
    store.editBoards((list) => list.filter((board) => !gone.has(board.id)));
  }
  return { moved, boards: emptied };
}

/** Puts back what `trashImport` moved, on the same terms: only a note still in
 *  the trash, to the status it had, and its boards first so it is filed where
 *  it was. */
export function untrashImport(moved: ImportBatch["made"], boards: UserBoard[], store: ImportStore): void {
  // Under their own ids, so the notes that name them are filed in them again;
  // one already back (the other device restored it too) is left alone.
  store.editBoards((list) => {
    const missing = boards.filter((board) => !list.some((b) => b.id === board.id));
    return missing.length > 0 ? [...list, ...missing] : list;
  });
  const byId = new Map(store.notes().map((note) => [note.id, note]));
  for (const status of ["active", "archived"] as const) {
    const ids = moved
      .filter((m) => m.status === status && byId.get(m.id)?.status === "trashed")
      .map((m) => m.id);
    if (ids.length > 0) store.bulkUpdate(ids, { status });
  }
}

/** An import landed: its undo goes on the stack like any other action's, so
 *  Ctrl+Z reaches it once the screen is closed. */
export function offerImportUndo(batch: ImportBatch, store: ImportStore, from = "Google Keep"): void {
  if (batch.made.length === 0) return;
  store.pushUndo({
    message: `Imported ${count(batch.made.length, "note", "notes")} from ${from}`,
    steps: [],
    run: () => void trashImport(batch, store),
  });
}

/** The summary's Undo: the batch to the trash, and that itself undoable.
 *  Answers how many notes it moved. */
export function undoImport(batch: ImportBatch, store: ImportStore): number {
  const { moved, boards } = trashImport(batch, store);
  if (moved.length > 0) {
    store.pushUndo({
      message: `Moved ${count(moved.length, "imported note", "imported notes")} to the trash`,
      steps: [],
      run: () => untrashImport(moved, boards, store),
    });
  }
  return moved.length;
}

/** Where the notes of one import went, as one line: "4 in the Inbox, 1 in the Archive". */
export function whereTheyWent(
  result: Pick<
    ImportResult,
    "inInbox" | "filed" | "archived" | "archivedFiled" | "beforeInboxLine" | "onTodos" | "onLinks"
  >,
): string {
  return (
    [
      [result.inInbox, "in the Inbox"],
      [result.filed - result.archivedFiled, "in boards"],
      [result.archived, "in the Archive"],
      [result.beforeInboxLine, "on All"],
      [result.onTodos, "on Todos"],
      [result.onLinks, "on Links"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, where]) => `${n} ${where}`)
    .join(", ");
}

/** The board "Show my notes" opens: null for the Inbox, else the first board the
 *  import made, else All when notes older than the Inbox's line went there
 *  (All shows the to-dos too), else Todos, else Links. */
export function whereToShow(
  result: Pick<ImportResult, "inInbox" | "onTodos" | "onLinks"> & Partial<Pick<ImportResult, "beforeInboxLine">>,
  made: UserBoard[],
): string | null {
  if (result.inInbox > 0) return null;
  if (made[0]) return made[0].id;
  if ((result.beforeInboxLine ?? 0) > 0) return "recent";
  return result.onTodos > 0 ? "todos" : result.onLinks > 0 ? "links" : null;
}

/** One chunk handed to the store: each note and the files to attach to it. */
/** `refs`: a restored file's number, for its `[image 2]` markers (`lib/attachRefs.ts`), by position. */
export type ImportChunk = { note: Note; files: File[]; refs?: (number | undefined)[] }[];

/** How many notes go to the store in one write: small enough that the page
 *  answers between chunks, large enough that 5,000 notes is a hundred writes. */
export const IMPORT_CHUNK = 50;

/**
 * How the person will recognise a note in the list of what was left behind:
 * its first line, or failing that its date. Both importers say it the same way.
 */
export function recognise(text: string, createdAt: string): string {
  const first = text.split("\n", 1)[0].replace(/^#\s+/, "").trim();
  if (first) return first.length > 60 ? `${first.slice(0, 59)}…` : first;
  return `a note from ${createdAt.slice(0, 10)}`;
}

/** Yields to the browser so a long import paints its progress and stays
 *  answerable. */
export function breathe(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

/** What the summary says when a chunk would not write, and the run stopped. */
export function stoppedBecause(error: unknown): string {
  return error instanceof DOMException && error.name === "QuotaExceededError"
    ? "This device ran out of room."
    : "This device would not save any more notes.";
}

/**
 * Brings back what an Undo left in the trash, under this run's label choices
 * (review GAP-03): the status Keep gave the note, and the board its first label
 * that became one now names. Grouped by those two so a thousand notes are a
 * handful of writes. A note that is no longer in the trash — put back by hand
 * since the plan was made — is left alone. Counted into `made`, so the one
 * undo takes them back to the trash with the rest.
 */
function reviveFromTrash(
  plan: KeepPlan,
  target: Map<string, string | null>,
  result: ImportResult,
  options: { revive?: (ids: string[], patch: Partial<Note>) => void; notes?: () => Note[] },
): void {
  if (plan.revive.length === 0 || !options.revive) return;
  const trashed = new Set(
    (options.notes?.() ?? []).filter((n) => n.status === "trashed").map((n) => n.id),
  );
  const groups = new Map<string, { status: NoteStatus; board_id: string | null; ids: string[] }>();
  for (const { id, found } of plan.revive) {
    if (options.notes && !trashed.has(id)) continue;
    const { board_id } = placeNote(found, target);
    const key = `${found.status}|${board_id ?? ""}`;
    const group = groups.get(key) ?? { status: found.status, board_id, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }
  for (const { status, board_id, ids } of groups.values()) {
    options.revive(ids, { status, board_id });
    for (const id of ids) {
      result.revived += 1;
      if (status === "archived") result.archived += 1;
      if (board_id) result.filed += 1;
      if (board_id && status === "archived") result.archivedFiled += 1;
      result.made.push({ id, status });
    }
  }
}

/**
 * Writes the plan into the store, a chunk at a time, and says what it did.
 *
 * `write` is the store's `importNotes`: it attaches the files through the path
 * a dropped file takes and writes the chunk in one transaction, then the notes
 * go up through the ordinary outbox like any other write. A chunk that cannot
 * be written stops the import there (`stopped`) rather than throwing: the
 * notes already in stay in, are counted, and are still one undo away, and a
 * second run skips them.
 */
export async function runImport(
  plan: KeepPlan,
  target: Map<string, string | null>,
  write: (chunk: ImportChunk) => Promise<Note[]>,
  options: {
    inboxSince?: string | null;
    onProgress?: (done: number, total: number) => void;
    /** The store's `bulkUpdate`, for the notes an Undo left in the trash. */
    revive?: (ids: string[], patch: Partial<Note>) => void;
    /** The notes as they are now, to see which of those are still in the trash. */
    notes?: () => Note[];
  } = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    archived: 0,
    filed: 0,
    archivedFiled: 0,
    important: 0,
    beforeInboxLine: 0,
    onTodos: 0,
    onLinks: 0,
    empty: plan.empty,
    revived: 0,
    inInbox: 0,
    files: 0,
    leftBehind: [],
    made: [],
    stopped: null,
  };
  const since = options.inboxSince ? Date.parse(options.inboxSince) : NaN;
  const total = plan.fresh.length;
  for (let start = 0; start < total; start += IMPORT_CHUNK) {
    const chunk: ImportChunk = [];
    for (const found of plan.fresh.slice(start, start + IMPORT_CHUNK)) {
      const files: File[] = [];
      for (const ref of found.files) {
        if (!ref.source) {
          result.leftBehind.push({ note: recognise(found.text, found.created_at), name: ref.name, why: "not in the Takeout" });
          continue;
        }
        if (ref.source.size > MAX_FILE_BYTES) {
          result.leftBehind.push({ note: recognise(found.text, found.created_at), name: ref.name, why: "too large" });
          continue;
        }
        try {
          const type = ref.mime || ref.source.file?.type || "";
          const name = ref.source.path.slice(dirOf(ref.source.path).length);
          const bytes: BlobPart = ref.source.file ?? ((await ref.source.read()) as Uint8Array<ArrayBuffer>);
          files.push(new File([bytes], name, { type }));
        } catch {
          result.leftBehind.push({ note: recognise(found.text, found.created_at), name: ref.name, why: "unreadable" });
        }
      }
      const { board_id, text } = placeNote(found, target);
      if (!text.trim() && files.length === 0) {
        // A file that went unreadable on the way leaves nothing; the plan
        // counted every other empty note up front.
        result.empty += 1;
        continue;
      }
      chunk.push({ note: keepNote(found, board_id, text), files });
    }
    let made: Note[];
    try {
      made = await write(chunk);
    } catch (error) {
      console.error("the Keep import could not write a chunk", error);
      result.stopped = stoppedBecause(error);
      break;
    }
    for (const note of made) {
      result.imported += 1;
      result.files += note.attachments.length;
      if (note.status === "archived") result.archived += 1;
      if (note.board_id) result.filed += 1;
      if (note.board_id && note.status === "archived") result.archivedFiled += 1;
      if (note.priority > 0) result.important += 1;
      // The Inbox's own test with its line taken away, against the test with
      // it: a to-do or a bare link was never going to wait in the Inbox, so
      // it is not a note the line is keeping out.
      if (note.status === "active" && !note.board_id) {
        if (isTodoNote(note)) result.onTodos += 1;
        else if (linksOnly(note)) result.onLinks += 1;
        else if (Date.parse(note.created_at) < since) result.beforeInboxLine += 1;
        else result.inInbox += 1;
      }
      result.made.push({ id: note.id, status: note.status });
    }
    options.onProgress?.(Math.min(start + IMPORT_CHUNK, total), total);
    await breathe();
  }
  if (!result.stopped) reviveFromTrash(plan, target, result, options);
  return result;
}
