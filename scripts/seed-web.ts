/**
 * notes.db (Phase 0 SQLite) -> web/src/seed/notes.json
 *
 * The output contains the user's real notes and is gitignored. Never commit it.
 * Usage: npm run seed [-- --db path/to/notes.db]
 */
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const dbFlag = args.indexOf("--db");
const dbPath = resolve(dbFlag === -1 ? "notes.db" : args[dbFlag + 1]);
const outPath = resolve("web/src/seed/notes.json");

interface Row {
  id: string;
  raw_content: string | null;
  source: string | null;
  created_at: string;
  title: string | null;
  gist: string | null;
  summary: string | null;
  note_type: string | null;
  tags: string | null;
  enriched_at: string | null;
  status: string | null;
  pinned: number | null;
  done: number | null;
  keep_id: string | null;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare(
    `select id, raw_content, source, created_at, title, gist, summary,
            note_type, tags, enriched_at, status, pinned, done, keep_id
       from notes`,
  )
  .all() as Row[];

const notes = rows.map((r) => ({
  id: r.id,
  raw_content: r.raw_content ?? "",
  // Phase 0 predates the raw/body split — body starts as a copy of the original.
  body: r.raw_content ?? "",
  source: r.source ?? "import",
  created_at: r.created_at,
  updated_at: r.created_at,
  title: r.title ?? null,
  gist: r.gist ?? null,
  summary: r.summary ?? null,
  note_type: r.note_type ?? null,
  tags: parseTags(r.tags),
  enriched_at: r.enriched_at ?? null,
  status: r.status ?? "active",
  priority: r.pinned ? 1 : 0,
  reminder_at: null,
  done: r.done === null ? null : Boolean(r.done),
  merged_from: null,
  merged_into: null,
  keep_id: r.keep_id ?? null,
}));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(notes));
console.log(`seeded ${notes.length} notes -> ${outPath}`);
