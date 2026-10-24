import type {
  Attachment,
  Canvas,
  Note,
  NoteStatus,
  NoteType,
  ReminderRepeat,
  UserBoard,
} from "../types";
import { ADOPTABLE_NAMES, INSPIRATION_NAME } from "./boards";
import { mergeBoards } from "./boardsMerge";
import { planArchive } from "./exportArchive";
import { MAX_FILE_BYTES } from "./files";
import {
  breathe,
  IMPORT_CHUNK,
  recognise,
  stoppedBecause,
  type ImportBatch,
  type ImportChunk,
} from "./keepImport";
import type { SourceFile, SourceFiles } from "./keepSource";

/* --- a spår download, back in ---------------------------------------------------
   The way back from "Download everything" (audit 2026-10-10, DATA-4 / UX-3).
   `lib/exportArchive.ts` writes `spår.json` "for anything that wants to read it
   back in", and the device-clearing screen tells people to download first; this
   is the thing that reads it.

   What a download becomes:

   - **Every note under its own id, exactly as it was** — its text, the
     original it was first written as (`raw_content` is the export's, never
     re-derived from the body), its clocks, its marks, its board. A restored
     note is the same note, which is what lets a second run see it is already
     here and skip it: **safe to run twice**.
   - **A note already here, or deleted for good here (a tombstone), is
     skipped**, never overwritten — this device's copy is the newer word on it.
     So is one whose Keep id another note here already holds: the server keeps
     one row per Keep id, and a second would never sync.
   - **The download's own Trash stays behind**, counted: restored, it would be
     destroyed by the next open's sweep as soon as its thirty days were up.
   - **Folders come in through the shelf's own merge** (`mergeBoards`), with
     the shelf as it is now standing in for the server's list: a folder here is
     never renamed or removed by a download, and one the download has and this
     shelf does not is added at the end.
   - **Files come back from the zip.** The export writes each one at a path
     `planArchive` decides from the notes alone, so the same plan, replayed on
     the download's own notes and date, says where each file is. A file the
     download only holds a preview of, or not at all, keeps its record (its
     thumbnail still draws) and is named in the summary.
   - **Canvases come back** for the ideas that came back with them.
   - **Link previews do not**: they are fetched again the ordinary way, rather
     than trusting addresses read out of a file.

   One import is one decision and one undo: the same batch-to-the-trash the
   Keep import uses (`trashImport` in `lib/keepImport.ts`).
   -------------------------------------------------------------------------- */

/** The name the export gives its one JSON file. */
export const SPAR_JSON = "spår.json";

export interface SparExport {
  exported_at: string;
  notes: Note[];
  folders: UserBoard[];
  canvases: Canvas[];
  /** Which folder is Inspiration, as the download says; absent in one made before it said. */
  inspiration?: string | null;
  /**
   * The notes and folders exactly as the file has them, before any cleaning —
   * what `filePaths` replays the export's plan on, so a row this side refused
   * cannot shift where the export put the files after it.
   */
  as_written: { notes: unknown[]; folders: unknown[] };
}

/** The file holding the download's notes, wherever in the zip it sits. */
export function findSparJson(files: SourceFiles): SourceFile | null {
  let found: SourceFile | null = null;
  for (const file of files.values()) {
    // A zip written on one system and read on another may spell the å as one
    // character or as a + ring; both are the same name.
    const name = file.path.slice(file.path.lastIndexOf("/") + 1).normalize("NFC");
    if (name !== SPAR_JSON) continue;
    if (!found || file.path.length < found.path.length) found = file;
  }
  return found;
}

/** The folder `spår.json` stands in — the root every other path in the zip is under. */
export function rootOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

const STATUSES: readonly NoteStatus[] = ["active", "archived", "trashed"];
const TYPES: readonly NoteType[] = ["note", "todo", "link", "recipe", "delve", "reference", "journal"];
const REPEATS: readonly ReminderRepeat[] = ["daily", "weekly", "monthly"];

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const stamp = (v: unknown): string | null =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function cleanAttachment(raw: unknown): Attachment | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || name === null) return null;
  const thumb = str(raw.thumb);
  return {
    id,
    name,
    mime: str(raw.mime) ?? "",
    size: Math.max(0, num(raw.size) ?? 0),
    width: num(raw.width),
    height: num(raw.height),
    // A thumbnail is a picture the app drew itself; anything else is not one.
    thumb: thumb && thumb.startsWith("data:image/") ? thumb : null,
    path: str(raw.path),
    added_at: stamp(raw.added_at) ?? new Date(0).toISOString(),
  };
}

/** One note out of the file, held to the shape the app stores — or null. */
export function cleanNote(raw: unknown): Note | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  if (!id || id.length > 200) return null;
  const body = str(raw.body);
  const original = str(raw.raw_content);
  if (body === null && original === null) return null;
  const created = stamp(raw.created_at) ?? stamp(raw.updated_at);
  if (!created) return null;
  const updated = stamp(raw.updated_at) ?? created;
  const clocks: Record<string, string> = {};
  if (isObject(raw.field_updated_at)) {
    for (const [field, at] of Object.entries(raw.field_updated_at)) {
      const ok = stamp(at);
      if (ok) clocks[field] = ok;
    }
  }
  const reminder = stamp(raw.reminder_at);
  const repeat = REPEATS.find((r) => r === raw.reminder_repeat) ?? null;
  const merged = Array.isArray(raw.merged_from) ? raw.merged_from.filter((v): v is string => typeof v === "string") : null;
  const note: Note = {
    id,
    // The original is the original: kept as the download has it, and only
    // where a very old row carries none does the body stand in, as it did
    // when the note was made.
    raw_content: original ?? (body as string),
    body: body ?? (original as string),
    source: str(raw.source) ?? "spår",
    created_at: created,
    updated_at: updated,
    note_type: TYPES.find((t) => t === raw.note_type) ?? null,
    board_id: str(raw.board_id),
    status: STATUSES.find((s) => s === raw.status) ?? "active",
    priority: (num(raw.priority) ?? 0) > 0 ? 1 : 0,
    reminder_at: reminder,
    reminder_repeat: reminder ? repeat : null,
    done: typeof raw.done === "boolean" ? raw.done : null,
    merged_from: merged,
    keep_id: str(raw.keep_id),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map(cleanAttachment).filter((a): a is Attachment => a !== null)
      : [],
    ...(Object.keys(clocks).length > 0 ? { field_updated_at: clocks } : {}),
  };
  if (raw.merged_into === null || typeof raw.merged_into === "string") note.merged_into = raw.merged_into;
  return note;
}

function cleanFolder(raw: unknown): UserBoard | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name?.trim()) return null;
  // The export writes Inspiration as a plain folder (`exportFolders`), and a
  // shelf's own order entry is never in it; neither is let in here.
  if (raw.kind !== undefined || id === "shelf-order") return null;
  return {
    id,
    name: name.slice(0, 200),
    position: num(raw.position) ?? 0,
    ...(typeof raw.icon === "string" ? { icon: raw.icon } : {}),
    ...(typeof raw.color === "string" ? { color: raw.color } : {}),
    ...(raw.awake === true ? { awake: true as const } : {}),
  };
}

function cleanCanvas(raw: unknown): Canvas | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const idea = str(raw.idea_id);
  const created = stamp(raw.created_at);
  if (!id || !idea || !created) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.filter(
        (i): i is Canvas["items"][number] =>
          isObject(i) && typeof i.note_id === "string" && num(i.x) !== null && num(i.y) !== null,
      )
    : [];
  const texts = Array.isArray(raw.text_elements)
    ? raw.text_elements.filter(
        (t): t is Canvas["text_elements"][number] =>
          isObject(t) && typeof t.id === "string" && typeof t.text === "string" && num(t.x) !== null && num(t.y) !== null,
      )
    : [];
  const widths: Record<string, number> = {};
  if (isObject(raw.image_widths)) {
    for (const [att, w] of Object.entries(raw.image_widths)) {
      const ok = num(w);
      if (ok !== null) widths[att] = ok;
    }
  }
  return {
    id,
    idea_id: idea,
    items,
    strokes: Array.isArray(raw.strokes) ? (raw.strokes.filter(isObject) as unknown as Canvas["strokes"]) : [],
    image_widths: widths,
    text_elements: texts,
    created_at: created,
    updated_at: stamp(raw.updated_at) ?? created,
  };
}

/**
 * The download's contents, or the sentence that says why there are none.
 * Everything in the file is held to the app's shape on the way in; a row that
 * cannot be is counted, never guessed at.
 */
export function readSparExport(json: unknown): { data: SparExport; unreadable: number } | string {
  if (!isObject(json) || json.format !== "spår export") {
    return "That is not a spår download. Choose the zip that Download everything made.";
  }
  if (json.version !== 1) {
    return "That download was made by a newer spår than this one. Update the app, then try again.";
  }
  const rawNotes = Array.isArray(json.notes) ? json.notes : [];
  const notes = rawNotes.map(cleanNote).filter((n): n is Note => n !== null);
  const folders = (Array.isArray(json.folders) ? json.folders : [])
    .map(cleanFolder)
    .filter((f): f is UserBoard => f !== null);
  const canvases = (Array.isArray(json.canvases) ? json.canvases : [])
    .map(cleanCanvas)
    .filter((c): c is Canvas => c !== null);
  return {
    data: {
      exported_at: stamp(json.exported_at) ?? new Date().toISOString(),
      notes,
      folders,
      canvases,
      ...(json.inspiration === null || typeof json.inspiration === "string"
        ? { inspiration: json.inspiration }
        : {}),
      as_written: { notes: rawNotes, folders: Array.isArray(json.folders) ? json.folders : [] },
    },
    unreadable: rawNotes.length - notes.length,
  };
}

/** What a download will do here, decided before anything is written. */
export interface SparPlan {
  /** Notes to write, in the order they were written. */
  fresh: Note[];
  /** Already on this device under the same id. */
  already: number;
  /** Deleted for good on this device; not brought back. */
  deleted: number;
  /** Their Keep id is held by another note here. */
  keepTwin: number;
  /** In the download's own Trash, left behind. */
  trashed: number;
  /** The shelf with the download's folders merged in, and which those are. */
  shelf: UserBoard[];
  /** The download's folders not to add: Inspiration, where this shelf has one. */
  skipFolders: ReadonlySet<string>;
  newFolders: UserBoard[];
  /** Canvases for ideas that come back, and have none here. */
  canvases: Canvas[];
  /** How many files the fresh notes carry. */
  files: number;
}

/**
 * The shelf's folders with the download's merged in, through `mergeBoards`:
 * the shelf as it stands plays the server's part, and `base` is the part of
 * the download it already holds — so a folder on both keeps this shelf's
 * version, and one only in the download is added after the rest. `skip` holds
 * this shelf's Inspiration and the download's own, where this shelf has one
 * (`SparPlan.skipFolders`): the download's notes are filed there instead.
 */
export function mergeFolders(
  folders: UserBoard[],
  incoming: UserBoard[],
  skip: ReadonlySet<string> = new Set(),
): UserBoard[] {
  const current = new Set(folders.map((f) => f.id));
  const wanted = incoming.filter((f) => !skip.has(f.id));
  if (wanted.every((f) => current.has(f.id))) return folders;
  return mergeBoards(
    folders,
    wanted,
    wanted.filter((f) => current.has(f.id)),
  );
}

export function planSparImport(
  data: SparExport,
  here: {
    notes: Note[];
    tombstones: ReadonlySet<string>;
    folders: UserBoard[];
    /** This shelf's Inspiration, if it has one. */
    inspiration?: string | null;
    canvases: Canvas[];
  },
): SparPlan {
  // The download writes its Inspiration as a plain folder. Where this shelf
  // has an Inspiration too, the download's is that board, not a folder to add
  // beside it: its notes are filed into the one here. A download that names
  // it says which; an older one is read by the name it was written under.
  const theirs =
    data.inspiration !== undefined
      ? data.inspiration
      : (data.folders.find(
          (f) => f.name === INSPIRATION_NAME || ADOPTABLE_NAMES.includes(f.name.trim().toLowerCase()),
        )?.id ?? null);
  const ours = here.inspiration ?? null;
  const into = theirs && ours && theirs !== ours ? ours : null;
  const skip = new Set<string>([...(ours ? [ours] : []), ...(into && theirs ? [theirs] : [])]);
  const ids = new Set(here.notes.map((n) => n.id));
  const keepIds = new Set(here.notes.map((n) => n.keep_id).filter((k): k is string => !!k));
  const plan: SparPlan = {
    fresh: [],
    already: 0,
    deleted: 0,
    keepTwin: 0,
    trashed: 0,
    shelf: here.folders,
    skipFolders: skip,
    newFolders: [],
    canvases: [],
    files: 0,
  };
  const seen = new Set<string>();
  for (const note of [...data.notes].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    if (ids.has(note.id)) plan.already += 1;
    else if (here.tombstones.has(note.id)) plan.deleted += 1;
    else if (note.status === "trashed") plan.trashed += 1;
    else if (note.keep_id && keepIds.has(note.keep_id)) plan.keepTwin += 1;
    else {
      plan.fresh.push(into && note.board_id === theirs ? { ...note, board_id: into } : note);
      plan.files += note.attachments.length;
      if (note.keep_id) keepIds.add(note.keep_id);
    }
  }

  const current = new Set(here.folders.map((f) => f.id));
  plan.shelf = mergeFolders(here.folders, data.folders, skip);
  plan.newFolders = plan.shelf.filter((f) => !current.has(f.id));

  const coming = new Set(plan.fresh.map((n) => n.id));
  const canvasIds = new Set(here.canvases.map((c) => c.id));
  const ideasWithOne = new Set(here.canvases.map((c) => c.idea_id));
  plan.canvases = data.canvases.filter(
    (c) => coming.has(c.idea_id) && !canvasIds.has(c.id) && !ideasWithOne.has(c.idea_id),
  );
  return plan;
}

/**
 * Where the download put each file: the export's own plan, replayed on the
 * download's notes and date, with its root moved to wherever `spår.json` was
 * found. Keyed by attachment id.
 */
export function filePaths(data: SparExport, root: string): Map<string, string> {
  const out = new Map<string, string>();
  let plan: ReturnType<typeof planArchive>;
  try {
    plan = planArchive({
      notes: data.as_written.notes as Note[],
      folders: data.as_written.folders as UserBoard[],
      canvases: [],
      now: new Date(data.exported_at),
    });
  } catch (error) {
    // A file edited by hand into a shape the plan cannot walk: the notes still
    // come back, their files are named as not found.
    console.error("the download's file layout could not be worked out", error);
    return out;
  }
  for (const entry of plan.entries) {
    if (!("attachment" in entry)) continue;
    const rest = entry.path.slice(plan.root.length + 1);
    out.set(entry.attachment.id, root ? `${root}/${rest}` : rest);
  }
  return out;
}

/** A file that did not come back, and why. */
export interface SparLeftBehind {
  note: string;
  name: string;
  why: "not in the download" | "too large" | "damaged";
}

export interface SparResult {
  imported: number;
  archived: number;
  filed: number;
  /** Files brought back from the zip. */
  files: number;
  leftBehind: SparLeftBehind[];
  /** Every note made, with its status — what the one undo checks. */
  made: ImportBatch["made"];
  stopped: string | null;
}

/**
 * Writes the plan, a chunk at a time, through the store's `importNotes` — the
 * Keep import's door, so files go the way a dropped file's go and a device out
 * of room stops it with what landed still counted and undoable.
 *
 * A file found in the zip comes back as a file (`files` beside the note, which
 * `importNotes` describes and stores). One that is not keeps its record, so
 * its thumbnail still draws, and is named.
 */
export async function runSparImport(
  plan: SparPlan,
  source: SourceFiles,
  paths: Map<string, string>,
  write: (chunk: ImportChunk) => Promise<Note[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<SparResult> {
  const result: SparResult = {
    imported: 0,
    archived: 0,
    filed: 0,
    files: 0,
    leftBehind: [],
    made: [],
    stopped: null,
  };
  const folderIds = new Set(plan.shelf.map((f) => f.id));
  const total = plan.fresh.length;
  for (let start = 0; start < total; start += IMPORT_CHUNK) {
    const chunk: ImportChunk = [];
    // Said only once the chunk is written: a run that stops names nothing
    // about the notes it never reached.
    const left: SparLeftBehind[] = [];
    let restored = 0;
    for (const original of plan.fresh.slice(start, start + IMPORT_CHUNK)) {
      const files: File[] = [];
      const kept: Attachment[] = [];
      for (const att of original.attachments) {
        const at = paths.get(att.id);
        const found = at ? source.get(at) : undefined;
        if (!found) {
          kept.push(att);
          left.push({ note: recognise(original.body, original.created_at), name: att.name, why: "not in the download" });
          continue;
        }
        if (found.size > MAX_FILE_BYTES) {
          kept.push(att);
          left.push({ note: recognise(original.body, original.created_at), name: att.name, why: "too large" });
          continue;
        }
        try {
          const bytes = found.file ?? ((await found.read()) as Uint8Array<ArrayBuffer>);
          files.push(new File([bytes], att.name, { type: att.mime }));
        } catch {
          kept.push(att);
          left.push({ note: recognise(original.body, original.created_at), name: att.name, why: "damaged" });
        }
      }
      restored += files.length;
      chunk.push({ note: { ...original, attachments: kept }, files });
    }
    let made: Note[];
    try {
      made = await write(chunk);
    } catch (error) {
      console.error("the spår import could not write a chunk", error);
      result.stopped = stoppedBecause(error);
      break;
    }
    result.files += restored;
    result.leftBehind.push(...left);
    for (const note of made) {
      result.imported += 1;
      if (note.status === "archived") result.archived += 1;
      if (note.board_id && folderIds.has(note.board_id)) result.filed += 1;
      result.made.push({ id: note.id, status: note.status });
    }
    onProgress?.(Math.min(start + IMPORT_CHUNK, total), total);
    await breathe();
  }
  return result;
}
