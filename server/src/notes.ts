/**
 * Notes and tombstones: every rule of docs/sync-contract.md §3–§7.
 *
 * This file is the Postgres triggers of the Supabase backend said in
 * TypeScript — `trg_notes_raw_immutable`, `trg_body_defaults_to_capture`,
 * `merge_note_field_versions`, `touch_updated_at`, `permanently_delete_note`
 * — but implementing the contract's *intended* behaviour where Supabase
 * deviates (§16: D2 the body, D3 the stamp, D5 `keep_id`, D6 the refusal).
 * Every write runs inside the caller's transaction, so a batch is accepted or
 * refused whole.
 */
import { CONFLICT_FIELDS } from "../../web/src/lib/versions";
import { TOMBSTONE_DAYS } from "../../web/src/lib/trash";
import type { Db } from "./db";
import type { Signal } from "./events";
import { badRequest, rowRefused } from "./http";
import { DAY_US, formatInstant, formatNullable, parseInstant, type Micros } from "./time";
import {
  boolOrNull,
  compareClocks,
  instant,
  isPlainObject,
  isUuid,
  jsonArray,
  jsonEqual,
  smallint,
  text,
  uuid,
  uuidArray,
} from "./values";

/** The fields merged by per-field clock: the client's own list, imported, so
 *  the two cannot drift (docs/sync-contract.md §4.1). */
export const MERGE_FIELDS: readonly string[] = CONFLICT_FIELDS;

/** How long a tombstone is kept: the client's own constant (§7.3). */
export const TOMBSTONE_US = TOMBSTONE_DAYS * DAY_US;

/** The columns a client writes and reads (§3.1), in the order rows are sent. */
export const NOTE_COLUMNS = [
  "id",
  "raw_content",
  "body",
  "source",
  "created_at",
  "updated_at",
  "note_type",
  "board_id",
  "status",
  "priority",
  "reminder_at",
  "reminder_repeat",
  "done",
  "merged_from",
  "merged_into",
  "keep_id",
  "attachments",
  "link_previews",
  "field_updated_at",
] as const;

type Column = (typeof NOTE_COLUMNS)[number];
const COLUMN_SET = new Set<string>(NOTE_COLUMNS);

/** A note as the server holds it in memory: instants in microseconds, JSON parsed. */
export interface NoteRecord {
  id: string;
  owner_id: string;
  raw_content: string;
  body: string;
  source: string;
  created_at: Micros;
  updated_at: Micros;
  note_type: string | null;
  board_id: string | null;
  status: string;
  priority: number;
  reminder_at: Micros | null;
  reminder_repeat: string | null;
  done: boolean | null;
  merged_from: string[] | null;
  merged_into: string | null;
  keep_id: string | null;
  attachments: unknown[];
  link_previews: unknown[];
  field_updated_at: unknown;
}

/** A note as SQLite stores it. */
export interface NoteDbRow {
  id: string;
  owner_id: string;
  raw_content: string;
  body: string;
  source: string;
  created_at: number;
  updated_at: number;
  note_type: string | null;
  board_id: string | null;
  status: string;
  priority: number;
  reminder_at: number | null;
  reminder_repeat: string | null;
  done: number | null;
  merged_from: string | null;
  merged_into: string | null;
  keep_id: string | null;
  attachments: string;
  link_previews: string;
  field_updated_at: string;
}

export interface Cursor {
  at: Micros;
  id: string | null;
}

/** A note's fields by column name, for the loops that walk a list of columns:
 *  `NoteRecord` names each one and has no index signature to read them by. */
function byName(note: NoteRecord): Record<string, unknown> {
  return note as unknown as Record<string, unknown>;
}

function decode(row: NoteDbRow): NoteRecord {
  return {
    ...row,
    done: row.done === null ? null : row.done === 1,
    merged_from: row.merged_from === null ? null : (JSON.parse(row.merged_from) as string[]),
    attachments: JSON.parse(row.attachments) as unknown[],
    link_previews: JSON.parse(row.link_previews) as unknown[],
    field_updated_at: JSON.parse(row.field_updated_at) as unknown,
  };
}

function encode(note: NoteRecord): NoteDbRow {
  return {
    ...note,
    done: note.done === null ? null : note.done ? 1 : 0,
    merged_from: note.merged_from === null ? null : JSON.stringify(note.merged_from),
    attachments: JSON.stringify(note.attachments),
    link_previews: JSON.stringify(note.link_previews),
    field_updated_at: JSON.stringify(note.field_updated_at),
  };
}

/**
 * A note row as the client reads it (§3.1), serialised by hand: the JSON
 * columns are already JSON text, and splicing them in saves parsing and
 * re-stringifying every thumbnail on every pull. No `owner_id`.
 */
export function noteJson(row: NoteDbRow): string {
  const s = JSON.stringify;
  return (
    `{"id":${s(row.id)},"raw_content":${s(row.raw_content)},"body":${s(row.body)},"source":${s(row.source)},` +
    `"created_at":${s(formatInstant(row.created_at))},"updated_at":${s(formatInstant(row.updated_at))},` +
    `"note_type":${s(row.note_type)},"board_id":${s(row.board_id)},"status":${s(row.status)},` +
    `"priority":${row.priority},"reminder_at":${s(formatNullable(row.reminder_at))},` +
    `"reminder_repeat":${s(row.reminder_repeat)},"done":${row.done === null ? "null" : row.done === 1},` +
    `"merged_from":${row.merged_from ?? "null"},"merged_into":${s(row.merged_into)},"keep_id":${s(row.keep_id)},` +
    `"attachments":${row.attachments},"link_previews":${row.link_previews},"field_updated_at":${row.field_updated_at}}`
  );
}

/** The value of one incoming column, checked against its type (§3.1). */
type Incoming = Partial<Record<Column, unknown>>;

function coerce(column: Column, value: unknown, id?: string): unknown {
  switch (column) {
    case "id":
    case "board_id":
    case "merged_into":
      return uuid(column, value, column !== "id", id);
    case "raw_content":
    case "source":
      return text(column, value, false, id);
    case "body":
      // Null is allowed through here only so an insert can fill it from the
      // capture; an update refuses it below.
      return text(column, value, true, id);
    case "note_type":
    case "reminder_repeat":
    case "keep_id":
      return text(column, value, true, id);
    case "status":
      return text(column, value, false, id);
    case "created_at":
      return instant(column, value, false, id);
    case "updated_at":
      // Null reads as "no stamp in the write": the server stamps it (§5).
      return instant(column, value, true, id);
    case "reminder_at":
      return instant(column, value, true, id);
    case "priority":
      return smallint(column, value, id);
    case "done":
      return boolOrNull(column, value, id);
    case "merged_from":
      return uuidArray(column, value, id);
    case "attachments":
    case "link_previews":
      return jsonArray(column, value, id);
    case "field_updated_at":
      // Taken as JSON; a map that is not an object is handled by the merge.
      return value;
  }
}

function checkedColumns(input: Record<string, unknown>, allowId: boolean, id?: string): Incoming {
  const out: Incoming = {};
  for (const [key, value] of Object.entries(input)) {
    if (!COLUMN_SET.has(key) || (key === "id" && !allowId)) {
      throw badRequest(`Unknown note column "${key}"`, "unknown_column");
    }
    if (value === undefined) continue;
    out[key as Column] = coerce(key as Column, value, id);
  }
  return out;
}

export interface NoteWriteResult {
  signals: Signal[];
  /** Notes whose rows changed, for the reminder sweep's benefit. */
  ids: string[];
}

export class Notes {
  constructor(
    private readonly db: Db,
    private readonly now: () => Micros,
  ) {}

  private byId(id: string): NoteDbRow | undefined {
    return this.db.prepare("select * from notes where id = ?").get(id) as NoteDbRow | undefined;
  }

  private keepIdTaken(owner: string, keepId: string, exceptId: string): boolean {
    return Boolean(
      this.db.prepare("select 1 from notes where owner_id = ? and keep_id = ? and id <> ?").get(owner, keepId, exceptId),
    );
  }

  private insert(note: NoteRecord): NoteDbRow {
    const row = encode(note);
    this.db
      .prepare(
        `insert into notes (${["owner_id", ...NOTE_COLUMNS].join(", ")})
         values (${["owner_id", ...NOTE_COLUMNS].map((c) => `@${c}`).join(", ")})`,
      )
      .run(row);
    return row;
  }

  private replace(note: NoteRecord): NoteDbRow {
    const row = encode(note);
    this.db
      .prepare(`update notes set ${NOTE_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = @${c}`).join(", ")} where id = @id`)
      .run(row);
    return row;
  }

  /**
   * The update half of every write — an upsert of an existing note and a
   * narrow patch alike — exactly as the triggers apply it (§3.3, §3.4, §4.3, §5).
   */
  private update(stored: NoteDbRow, w: Incoming): NoteDbRow {
    const s = decode(stored);
    const id = s.id;
    if ("raw_content" in w && w.raw_content !== s.raw_content) {
      throw rowRefused("raw_content_immutable", "raw_content is immutable once a note exists", id);
    }
    if ("body" in w && w.body === null) throw rowRefused("invalid", "body must be a string", id);

    const next: NoteRecord = { ...s };
    for (const column of NOTE_COLUMNS) {
      if (column === "id" || column === "updated_at" || column === "field_updated_at") continue;
      if (column in w) byName(next)[column] = w[column];
    }

    // Per-field last-write-wins (§4.3). A write with no clock map at all keeps
    // the stored clocks and is taken whole.
    if ("field_updated_at" in w) {
      const incoming = w.field_updated_at;
      const storedClocks = isPlainObject(s.field_updated_at) ? s.field_updated_at : {};
      if (!isPlainObject(incoming)) {
        // Unspecified by the contract; kept as Supabase keeps it.
        next.field_updated_at = s.field_updated_at;
      } else if (jsonEqual(incoming, storedClocks)) {
        next.field_updated_at = incoming;
      } else {
        const clocks: Record<string, unknown> = { ...incoming };
        for (const field of MERGE_FIELDS) {
          if (!Object.prototype.hasOwnProperty.call(clocks, field)) continue;
          const mine = clocks[field];
          const theirs = Object.prototype.hasOwnProperty.call(storedClocks, field) ? storedClocks[field] : null;
          const loses = mine === null || (theirs !== null && theirs !== undefined && compareClocks(mine, theirs) <= 0);
          if (loses) {
            if (theirs === null || theirs === undefined) delete clocks[field];
            else clocks[field] = theirs;
            byName(next)[field] = byName(s)[field];
          }
        }
        next.field_updated_at = clocks;
      }
    }

    // `updated_at` never moves backwards, and every accepted update moves it
    // strictly forward (§5).
    const sent = "updated_at" in w ? (w.updated_at as Micros | null) : null;
    if (sent !== null && sent > s.updated_at) next.updated_at = sent;
    else if (sent !== null && sent < s.updated_at) next.updated_at = s.updated_at + 1;
    else next.updated_at = Math.max(this.now(), s.updated_at + 1);

    if (next.keep_id !== null && next.keep_id !== s.keep_id && this.keepIdTaken(s.owner_id, next.keep_id, id)) {
      throw rowRefused("keep_id_taken", "Another of your notes already carries that keep_id", id);
    }
    return this.replace(next);
  }

  /**
   * Upserts a batch (§3.2). Call inside a transaction: the first refusal
   * throws, and the caller's rollback takes every row of the batch with it.
   */
  upsert(owner: string, rows: unknown[]): NoteWriteResult {
    const signals: Signal[] = [];
    const ids: string[] = [];
    for (const raw of rows) {
      if (!isPlainObject(raw)) throw badRequest("Every row must be a JSON object");
      const rawId = raw.id;
      if (!isUuid(rawId)) throw rowRefused("invalid", "id must be a UUID", typeof rawId === "string" ? rawId : undefined);
      const id = rawId.toLowerCase();
      const w = checkedColumns(raw, true, id);
      const stored = this.byId(id);
      if (stored && stored.owner_id !== owner) {
        throw rowRefused("not_owner", "That note id belongs to another account", id);
      }
      let row: NoteDbRow;
      let event: "INSERT" | "UPDATE";
      if (stored) {
        row = this.update(stored, w);
        event = "UPDATE";
      } else {
        row = this.insertNew(owner, id, w);
        event = "INSERT";
      }
      ids.push(id);
      signals.push({ table: "notes", event, newJson: noteJson(row), oldJson: null });
    }
    return { signals, ids };
  }

  private insertNew(owner: string, id: string, w: Incoming): NoteDbRow {
    if (this.db.prepare("select 1 from tombstones where note_id = ?").get(id)) {
      throw rowRefused("tombstoned", "That note was permanently deleted and cannot come back", id);
    }
    if (typeof w.raw_content !== "string") throw rowRefused("invalid", "raw_content is required", id);
    if (typeof w.source !== "string") throw rowRefused("invalid", "source is required", id);
    const now = this.now();
    const clocks = w.field_updated_at;
    const note: NoteRecord = {
      id,
      owner_id: owner,
      raw_content: w.raw_content,
      // §3.4: an empty or missing body on a genuine insert is the capture.
      body: typeof w.body === "string" && w.body !== "" ? w.body : w.raw_content,
      source: w.source,
      created_at: (w.created_at as Micros | undefined) ?? now,
      updated_at: (w.updated_at as Micros | null | undefined) ?? now,
      note_type: (w.note_type as string | null | undefined) ?? null,
      board_id: (w.board_id as string | null | undefined) ?? null,
      status: (w.status as string | undefined) ?? "active",
      priority: (w.priority as number | undefined) ?? 0,
      reminder_at: (w.reminder_at as Micros | null | undefined) ?? null,
      reminder_repeat: (w.reminder_repeat as string | null | undefined) ?? null,
      done: (w.done as boolean | null | undefined) ?? null,
      merged_from: (w.merged_from as string[] | null | undefined) ?? null,
      merged_into: (w.merged_into as string | null | undefined) ?? null,
      keep_id: (w.keep_id as string | null | undefined) ?? null,
      attachments: (w.attachments as unknown[] | undefined) ?? [],
      link_previews: (w.link_previews as unknown[] | undefined) ?? [],
      field_updated_at: isPlainObject(clocks) ? clocks : {},
    };
    if (note.keep_id !== null && this.keepIdTaken(owner, note.keep_id, id)) {
      throw rowRefused("keep_id_taken", "Another of your notes already carries that keep_id", id);
    }
    return this.insert(note);
  }

  /**
   * The narrow patch (§3.2): changes the named columns of one of the caller's
   * notes, through the same rules as an upsert's update, and never creates a
   * note. A missing, foreign or destroyed id changes nothing and says nothing.
   */
  patch(owner: string, id: string, input: Record<string, unknown>): NoteWriteResult {
    const w = checkedColumns(input, false, id);
    const stored = this.byId(id);
    if (!stored || stored.owner_id !== owner) return { signals: [], ids: [] };
    const row = this.update(stored, w);
    return { signals: [{ table: "notes", event: "UPDATE", newJson: noteJson(row), oldJson: null }], ids: [id] };
  }

  /** One keyset page of the owner's notes in `(updated_at, id)` order (§6.1). */
  pull(owner: string, after: Cursor, limit: number): NoteDbRow[] {
    return this.db
      .prepare(
        `select * from notes
          where owner_id = @owner
            and (updated_at > @at or (@id is not null and updated_at = @at and id > @id))
          order by updated_at, id
          limit @limit`,
      )
      .all({ owner, at: after.at, id: after.id, limit }) as NoteDbRow[];
  }

  byIds(owner: string, ids: string[]): NoteDbRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return this.db
      .prepare(`select * from notes where owner_id = ? and id in (${placeholders}) order by updated_at, id`)
      .all(owner, ...ids) as NoteDbRow[];
  }

  state(owner: string, id: string): { id: string; status: string; field_updated_at: string } | null {
    const row = this.db
      .prepare("select id, status, field_updated_at from notes where id = ? and owner_id = ?")
      .get(id, owner) as { id: string; status: string; field_updated_at: string } | undefined;
    return row ?? null;
  }

  all(owner: string): NoteRecord[] {
    return (this.db.prepare("select * from notes where owner_id = ? order by created_at, id").all(owner) as NoteDbRow[]).map(
      decode,
    );
  }

  /** A note as stored, whoever owns it — for the server's own use and tests. */
  read(id: string): NoteRecord | null {
    const row = this.byId(id);
    return row ? decode(row) : null;
  }

  /**
   * `permanentlyDeleteNote` (§7.2): destroys a trashed note of the caller's
   * when nothing a client wrote is newer than `expected`, records its
   * tombstone and takes its canvas and delivery record with it. Call inside a
   * transaction. Returns the signals to send, or null for "false".
   */
  destroy(owner: string, id: string, expected: Micros): Signal[] | null {
    const row = this.db
      .prepare("select updated_at, status, field_updated_at from notes where id = ? and owner_id = ?")
      .get(id, owner) as { updated_at: number; status: string; field_updated_at: string } | undefined;
    if (!row || row.status !== "trashed") return null;
    if (!(row.updated_at <= expected || latestClock(row.field_updated_at) <= expected)) return null;

    this.db
      .prepare(
        `insert into tombstones (note_id, owner_id, deleted_at, expected_updated_at) values (?, ?, ?, ?)
         on conflict (note_id) do update set deleted_at = excluded.deleted_at, expected_updated_at = excluded.expected_updated_at`,
      )
      .run(id, owner, this.now(), expected);
    const hadCanvas = this.db.prepare("delete from canvases where id = ?").run(id).changes > 0;
    this.db.prepare("delete from reminder_deliveries where note_id = ?").run(id);
    this.db.prepare("delete from reminder_device_deliveries where note_id = ?").run(id);
    this.db.prepare("delete from notes where id = ? and owner_id = ?").run(id, owner);
    const old = JSON.stringify({ id });
    const signals: Signal[] = [{ table: "notes", event: "DELETE", newJson: null, oldJson: old }];
    if (hadCanvas) signals.push({ table: "folders", event: "DELETE", newJson: null, oldJson: old });
    return signals;
  }

  pullTombstones(owner: string, after: Cursor, limit: number): { note_id: string; deleted_at: number }[] {
    return this.db
      .prepare(
        `select note_id, deleted_at from tombstones
          where owner_id = @owner
            and (deleted_at > @at or (@id is not null and deleted_at = @at and note_id > @id))
          order by deleted_at, note_id
          limit @limit`,
      )
      .all({ owner, at: after.at, id: after.id, limit }) as { note_id: string; deleted_at: number }[];
  }

  /** The daily job: forget tombstones older than a year (§7.3). */
  pruneTombstones(): number {
    return this.db.prepare("delete from tombstones where deleted_at < ?").run(this.now() - TOMBSTONE_US).changes;
  }
}

/**
 * The latest per-field clock in a stored map, compared as instants; values
 * that are not dates are ignored, and no clocks at all is "nothing later".
 */
function latestClock(json: string): number {
  let clocks: unknown;
  try {
    clocks = JSON.parse(json);
  } catch {
    return -Infinity;
  }
  if (!isPlainObject(clocks)) return -Infinity;
  let latest = -Infinity;
  for (const value of Object.values(clocks)) {
    const us = parseInstant(value);
    if (us !== null && us > latest) latest = us;
  }
  return latest;
}

export function tombstoneJson(row: { note_id: string; deleted_at: number }): string {
  return `{"note_id":${JSON.stringify(row.note_id)},"deleted_at":${JSON.stringify(formatInstant(row.deleted_at))}}`;
}
