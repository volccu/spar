import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notes (
  id                  TEXT PRIMARY KEY,
  raw_content         TEXT NOT NULL,          -- immutable after insert
  source              TEXT,                   -- 'web'|'overlay'|'share'|'import'
  created_at          TEXT,
  -- AI layer (nullable until enrichment)
  title               TEXT,
  gist                TEXT,
  summary             TEXT,
  note_type           TEXT,                   -- note|todo|recipe|delve|reference|journal
  tags                TEXT,                   -- JSON array (Postgres text[] later)
  embedding           TEXT,                   -- JSON number[1024] (Postgres vector(1024) later)
  enriched_at         TEXT,
  -- lifecycle
  status              TEXT DEFAULT 'active',  -- 'active'|'archived'
  warmth              REAL DEFAULT 1.0,
  pinned              INTEGER DEFAULT 0,
  last_interacted_at  TEXT,
  last_surfaced_at    TEXT,
  surfaced_count      INTEGER DEFAULT 0,
  done                INTEGER,
  -- non-SPEC throwaway columns
  keep_id             TEXT UNIQUE,            -- dedupe key = Keep json filename
  has_enrichable_text INTEGER DEFAULT 1,      -- 0 => enrich skips this note
  embedding_stale     INTEGER DEFAULT 1       -- 1 => needs (re)embedding
);

CREATE TABLE IF NOT EXISTS interactions (        -- parity with SPEC §4; unused in Phase 0
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    TEXT REFERENCES notes(id),
  kind       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrichment_history (  -- non-SPEC: powers before/after review
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id      TEXT REFERENCES notes(id),
  title        TEXT,
  gist         TEXT,
  summary      TEXT,
  note_type    TEXT,
  tags         TEXT,                             -- JSON array
  model        TEXT,
  prompt_label TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  raw_content, title, gist,
  content='notes', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, raw_content, title, gist)
  VALUES (new.rowid, coalesce(new.raw_content,''), coalesce(new.title,''), coalesce(new.gist,''));
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, raw_content, title, gist)
  VALUES ('delete', old.rowid, coalesce(old.raw_content,''), coalesce(old.title,''), coalesce(old.gist,''));
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, raw_content, title, gist)
  VALUES ('delete', old.rowid, coalesce(old.raw_content,''), coalesce(old.title,''), coalesce(old.gist,''));
  INSERT INTO notes_fts(rowid, raw_content, title, gist)
  VALUES (new.rowid, coalesce(new.raw_content,''), coalesce(new.title,''), coalesce(new.gist,''));
END;
`;

export function openDb(path = "notes.db"): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}
