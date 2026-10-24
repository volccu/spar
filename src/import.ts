import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { openDb } from "./db.js";
import { parseKeepNote, type KeepNote } from "./keep.js";

export interface ImportSummary {
  imported: number;
  skippedTrashed: number;
  archived: number;
  withWeblink: number;
  withImages: number;
  imageOnly: number;
  empty: number;
}

export function importDir(db: Database.Database, dir: string): ImportSummary {
  const s: ImportSummary = {
    imported: 0, skippedTrashed: 0, archived: 0,
    withWeblink: 0, withImages: 0, imageOnly: 0, empty: 0,
  };
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notes
       (id, raw_content, source, created_at, last_interacted_at, status, pinned,
        tags, has_enrichable_text, embedding_stale, keep_id)
     VALUES (@id, @raw_content, 'import', @created_at, @last_interacted_at, @status, @pinned,
        @tags, @has_enrichable_text, 1, @keep_id)`
  );

  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json"));
  for (const file of files) {
    const keepId = file.replace(/\.json$/i, "");
    const json = JSON.parse(readFileSync(join(dir, file), "utf-8")) as KeepNote;
    const parsed = parseKeepNote(json, keepId);
    if (!parsed) { s.skippedTrashed++; continue; }

    const info = insert.run({
      id: randomUUID(),
      raw_content: parsed.raw_content,
      created_at: parsed.created_at,
      last_interacted_at: parsed.last_interacted_at,
      status: parsed.status,
      pinned: parsed.pinned ? 1 : 0,
      tags: JSON.stringify(parsed.tags),
      has_enrichable_text: parsed.has_enrichable_text ? 1 : 0,
      keep_id: parsed.keep_id,
    });
    if (info.changes === 0) continue; // already imported (idempotent)

    s.imported++;
    if (parsed.status === "archived") s.archived++;
    const hasWeblink = (json.annotations ?? []).some((a) => a.source === "WEBLINK");
    if (hasWeblink) s.withWeblink++;
    const hasImg = (json.attachments ?? []).length > 0;
    if (hasImg) s.withImages++;
    if (hasImg && !parsed.has_enrichable_text) s.imageOnly++;
    if (parsed.raw_content === "") s.empty++;
  }
  return s;
}

// CLI (robust main-module check — handles Windows paths and the `å` in the repo path)
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: npm run import -- <takeout-keep-dir>"); process.exit(1); }
  const db = openDb();
  const s = importDir(db, dir);
  console.log(
    `Imported ${s.imported} notes (skipped ${s.skippedTrashed} trashed).\n` +
    `  archived: ${s.archived}\n` +
    `  with weblink: ${s.withWeblink}\n` +
    `  with images: ${s.withImages} (image-only: ${s.imageOnly})\n` +
    `  empty: ${s.empty}`
  );
}
