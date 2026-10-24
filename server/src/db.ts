/**
 * The database: one SQLite file in WAL mode, and its numbered migrations.
 *
 * The schema version is SQLite's own `user_version`. Each migration runs in a
 * transaction with the bump that records it, so a crash mid-migration leaves
 * the previous version whole. Migrations are append-only: an applied one is
 * never edited, a change is a new number — the same rule the Supabase
 * migrations live by (docs/DATABASE-MIGRATIONS.md).
 *
 * Every instant is an INTEGER of microseconds (see time.ts); every JSON column
 * is TEXT holding the JSON exactly as the server wrote it.
 */
import Database from "better-sqlite3";
import { chmodSync, existsSync, writeFileSync } from "node:fs";

export type Db = Database.Database;

export const MIGRATIONS: string[] = [
  // 1 — the whole contract's worth of tables.
  `
  create table users (
    id            text primary key,
    email         text not null unique,
    password_hash text not null,
    is_admin      integer not null default 0,
    created_at    integer not null
  );

  create table sessions (
    token_hash   text primary key,
    user_id      text not null references users(id) on delete cascade,
    created_at   integer not null,
    last_seen_at integer not null,
    expires_at   integer not null,
    user_agent   text
  );
  create index sessions_user on sessions(user_id);

  create table invites (
    code_hash  text primary key,
    created_at integer not null,
    expires_at integer not null,
    used_at    integer,
    used_by    text
  );

  create table notes (
    id               text primary key,
    owner_id         text not null references users(id) on delete cascade,
    raw_content      text not null,
    body             text not null,
    source           text not null,
    created_at       integer not null,
    updated_at       integer not null,
    note_type        text,
    board_id         text,
    status           text not null,
    priority         integer not null,
    reminder_at      integer,
    reminder_repeat  text,
    done             integer,
    merged_from      text,
    merged_into      text,
    keep_id          text,
    attachments      text not null,
    link_previews    text not null,
    field_updated_at text not null
  );
  create index notes_pull on notes(owner_id, updated_at, id);
  create unique index notes_keep_id on notes(owner_id, keep_id) where keep_id is not null;
  create index notes_reminders on notes(reminder_at) where reminder_at is not null;

  create table tombstones (
    note_id             text primary key,
    owner_id            text not null references users(id) on delete cascade,
    deleted_at          integer not null,
    expected_updated_at integer
  );
  create index tombstones_pull on tombstones(owner_id, deleted_at, note_id);
  create index tombstones_age on tombstones(deleted_at);

  create table canvases (
    id            text primary key references notes(id) on delete cascade,
    owner_id      text not null references users(id) on delete cascade,
    items         text not null,
    strokes       text not null,
    image_widths  text not null,
    text_elements text not null,
    created_at    integer not null,
    updated_at    integer not null
  );
  create index canvases_pull on canvases(owner_id, updated_at, id);

  create table prefs (
    owner_id    text primary key references users(id) on delete cascade,
    boards      text not null,
    inbox_since integer,
    updated_at  integer not null
  );

  create table push_subscriptions (
    endpoint   text primary key,
    owner_id   text not null references users(id) on delete cascade,
    p256dh     text not null,
    auth       text not null,
    user_agent text,
    created_at integer not null,
    seen_at    integer not null,
    failed_at  integer
  );
  create index push_subscriptions_owner on push_subscriptions(owner_id);

  create table reminder_deliveries (
    note_id     text primary key references notes(id) on delete cascade,
    owner_id    text not null references users(id) on delete cascade,
    reminder_at integer not null,
    fired_at    integer not null
  );

  create table files (
    path         text primary key,
    owner_id     text not null references users(id) on delete cascade,
    note_id      text not null,
    size         integer not null,
    content_type text not null,
    created_at   integer not null
  );
  create index files_owner_note on files(owner_id, note_id);
  `,
  // 2 — every folder list the preferences row replaced (audit DATA-9,
  // 2026-10-10): the spår server's copy of Supabase's `prefs_history`
  // (migrations 0027 and 0028). Written by `Prefs.upsert`, only when a
  // folder's id, name, mark, tint or kind changed; never pruned.
  `
  create table prefs_history (
    id          integer primary key autoincrement,
    owner_id    text not null references users(id) on delete cascade,
    boards      text not null,
    updated_at  integer not null,
    replaced_at integer not null
  );
  create index prefs_history_owner on prefs_history(owner_id, replaced_at);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Db): number {
  const current = db.pragma("user_version", { simple: true }) as number;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `spar.db is at schema version ${current}, newer than this server knows (${MIGRATIONS.length}). ` +
        "Run a newer server, or restore a backup taken before the upgrade.",
    );
  }
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
  return MIGRATIONS.length;
}

export function openDb(path: string): Db {
  // Owner-only from the first byte: SQLite gives the -wal and -shm files the
  // database file's own mode, so this covers all three.
  if (!existsSync(path)) writeFileSync(path, "", { mode: 0o600, flag: "wx" });
  else chmodSync(path, 0o600);
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}
