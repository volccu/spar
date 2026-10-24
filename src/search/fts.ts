import type Database from "better-sqlite3";

/** Build a safe FTS5 MATCH string: prefix-matched OR of quoted tokens. */
export function ftsQuery(raw: string): string {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/"/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

export function ftsSearch(db: Database.Database, raw: string, limit: number): string[] {
  const q = ftsQuery(raw);
  const rows = db
    .prepare(
      `SELECT n.id AS id FROM notes_fts f JOIN notes n ON n.rowid=f.rowid
       WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts) LIMIT ?`
    )
    .all(q, limit) as { id: string }[];
  return rows.map((r) => r.id);
}
