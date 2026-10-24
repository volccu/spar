/**
 * Canvases (§9) and preferences (§8): the two row kinds with no merge at all.
 * A canvas write replaces the whole row as sent; a preferences write replaces
 * only the fields it carries. Neither floors its stamp.
 */
import type { Db } from "./db";
import type { Signal } from "./events";
import { badRequest, HttpError, rowRefused } from "./http";
import { formatInstant, formatNullable, type Micros } from "./time";
import { instant, isPlainObject, isUuid, jsonArray, jsonObject } from "./values";
import type { Cursor } from "./notes";

export interface CanvasDbRow {
  id: string;
  owner_id: string;
  items: string;
  strokes: string;
  image_widths: string;
  text_elements: string;
  created_at: number;
  updated_at: number;
}

const CANVAS_COLUMNS = new Set(["id", "items", "strokes", "image_widths", "text_elements", "created_at", "updated_at"]);

export function canvasJson(row: CanvasDbRow): string {
  return (
    `{"id":${JSON.stringify(row.id)},"items":${row.items},"strokes":${row.strokes},` +
    `"image_widths":${row.image_widths},"text_elements":${row.text_elements},` +
    `"created_at":${JSON.stringify(formatInstant(row.created_at))},"updated_at":${JSON.stringify(formatInstant(row.updated_at))}}`
  );
}

export class Canvases {
  constructor(
    private readonly db: Db,
    private readonly now: () => Micros,
  ) {}

  /** Upserts a batch; call inside a transaction. Refuses a canvas whose idea
   *  note is missing or someone else's (§9, I5). */
  upsert(owner: string, rows: unknown[]): Signal[] {
    const signals: Signal[] = [];
    for (const raw of rows) {
      if (!isPlainObject(raw)) throw badRequest("Every row must be a JSON object");
      for (const key of Object.keys(raw)) {
        if (!CANVAS_COLUMNS.has(key)) throw badRequest(`Unknown canvas column "${key}"`, "unknown_column");
      }
      if (!isUuid(raw.id)) throw rowRefused("invalid", "id must be a UUID");
      const id = raw.id.toLowerCase();
      const note = this.db.prepare("select owner_id from notes where id = ?").get(id) as { owner_id: string } | undefined;
      if (!note || note.owner_id !== owner) {
        throw rowRefused("no_such_note", "A canvas needs an idea note of yours with the same id", id);
      }
      const now = this.now();
      const existing = this.db.prepare("select 1 from canvases where id = ?").get(id);
      const row: CanvasDbRow = {
        id,
        owner_id: owner,
        items: JSON.stringify(raw.items === undefined ? [] : jsonArray("items", raw.items, id)),
        strokes: JSON.stringify(raw.strokes === undefined ? [] : jsonArray("strokes", raw.strokes, id)),
        image_widths: JSON.stringify(raw.image_widths === undefined ? {} : jsonObject("image_widths", raw.image_widths, id)),
        text_elements: JSON.stringify(raw.text_elements === undefined ? [] : jsonArray("text_elements", raw.text_elements, id)),
        created_at: raw.created_at === undefined ? now : (instant("created_at", raw.created_at, false, id) as Micros),
        updated_at: raw.updated_at === undefined ? now : (instant("updated_at", raw.updated_at, false, id) as Micros),
      };
      this.db
        .prepare(
          `insert into canvases (id, owner_id, items, strokes, image_widths, text_elements, created_at, updated_at)
           values (@id, @owner_id, @items, @strokes, @image_widths, @text_elements, @created_at, @updated_at)
           on conflict (id) do update set
             items = excluded.items, strokes = excluded.strokes, image_widths = excluded.image_widths,
             text_elements = excluded.text_elements, created_at = excluded.created_at, updated_at = excluded.updated_at`,
        )
        .run(row);
      signals.push({ table: "folders", event: existing ? "UPDATE" : "INSERT", newJson: canvasJson(row), oldJson: null });
    }
    return signals;
  }

  /** The canvas keyset: inclusive of `at` when the cursor has no id (§6.1). */
  pull(owner: string, after: Cursor, limit: number): CanvasDbRow[] {
    return this.db
      .prepare(
        `select * from canvases
          where owner_id = @owner
            and (case when @id is null then updated_at >= @at
                      else (updated_at > @at or (updated_at = @at and id > @id)) end)
          order by updated_at, id
          limit @limit`,
      )
      .all({ owner, at: after.at, id: after.id, limit }) as CanvasDbRow[];
  }

  all(owner: string): CanvasDbRow[] {
    return this.db.prepare("select * from canvases where owner_id = ? order by id").all(owner) as CanvasDbRow[];
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface PrefsDbRow {
  owner_id: string;
  boards: string;
  inbox_since: number | null;
  updated_at: number;
}

export function prefsJson(row: PrefsDbRow): string {
  return (
    `{"boards":${row.boards},"inbox_since":${JSON.stringify(formatNullable(row.inbox_since))},` +
    `"updated_at":${JSON.stringify(formatInstant(row.updated_at))}}`
  );
}

/**
 * What a lost shelf would need back from a stored folder list: each entry's
 * id, name, mark (`icon`), tint (`color`) and kind, in id order — so a
 * reorder, a lens moved or the keep-awake switch compares equal and is not
 * kept in the history. The same comparison as Supabase's
 * `prefs_folder_shape` (migration 0028, audit SEC-9).
 */
export function folderShape(boards: string): string {
  let list: unknown;
  try {
    list = JSON.parse(boards);
  } catch {
    return boards;
  }
  if (!Array.isArray(list)) return "[]";
  const field = (value: unknown) => (value === undefined ? null : value);
  return JSON.stringify(
    list
      .map((entry: unknown) =>
        isPlainObject(entry)
          ? [field(entry.id), field(entry.name), field(entry.icon), field(entry.color), field(entry.kind)]
          : [entry],
      )
      .sort((a, b) => {
        const x = JSON.stringify(a[0]);
        const y = JSON.stringify(b[0]);
        return x < y ? -1 : x > y ? 1 : 0;
      }),
  );
}

export class Prefs {
  constructor(
    private readonly db: Db,
    private readonly now: () => Micros,
  ) {}

  read(owner: string): PrefsDbRow | null {
    return (this.db.prepare("select * from prefs where owner_id = ?").get(owner) as PrefsDbRow | undefined) ?? null;
  }

  /**
   * Writes only the fields the upload carries, plus `updated_at` (§8).
   *
   * With `expected_updated_at` the write is conditional (audit DATA-1): made
   * only while the row's `updated_at` is still that instant — or, given
   * `null`, only while there is no row — and otherwise refused with
   * `412 prefs_moved`, writing nothing. The client then reads the row again,
   * merges its folder change into it and sends again. The same check as
   * Supabase's `write_prefs_if_unchanged` (migration 0028).
   */
  upsert(owner: string, input: Record<string, unknown>): Signal[] {
    for (const key of Object.keys(input)) {
      if (key !== "boards" && key !== "inbox_since" && key !== "updated_at" && key !== "expected_updated_at") {
        throw badRequest(`Unknown preferences field "${key}"`, "unknown_column");
      }
    }
    const updatedAt = input.updated_at === undefined ? this.now() : (instant("updated_at", input.updated_at, false) as Micros);
    const existing = this.read(owner);
    if ("expected_updated_at" in input) {
      const expected = instant("expected_updated_at", input.expected_updated_at, true);
      const holds = expected === null ? existing === null : existing !== null && existing.updated_at === expected;
      if (!holds) throw new HttpError(412, "prefs_moved", "The preferences changed since they were read");
    }
    const row: PrefsDbRow = {
      owner_id: owner,
      boards: "boards" in input ? JSON.stringify(jsonArray("boards", input.boards)) : (existing?.boards ?? "[]"),
      inbox_since:
        "inbox_since" in input ? instant("inbox_since", input.inbox_since, true) : (existing?.inbox_since ?? null),
      updated_at: updatedAt,
    };
    // The list being replaced is kept first, whenever what a lost shelf
    // would need back has changed (see `folderShape`).
    if (existing && folderShape(existing.boards) !== folderShape(row.boards)) {
      this.db
        .prepare("insert into prefs_history (owner_id, boards, updated_at, replaced_at) values (?, ?, ?, ?)")
        .run(owner, existing.boards, existing.updated_at, this.now());
    }
    this.db
      .prepare(
        `insert into prefs (owner_id, boards, inbox_since, updated_at) values (@owner_id, @boards, @inbox_since, @updated_at)
         on conflict (owner_id) do update set boards = excluded.boards, inbox_since = excluded.inbox_since, updated_at = excluded.updated_at`,
      )
      .run(row);
    return [{ table: "prefs", event: existing ? "UPDATE" : "INSERT", newJson: prefsJson(row), oldJson: null }];
  }
}
