-- 0001_init.sql — Notes+ initial schema (Phase 1)
-- Mirrors SPEC §4. Phase 0's SQLite schema ported to Postgres + pgvector.

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "vector";         -- pgvector
create extension if not exists "pg_trgm";         -- trigram fallback (unused by FTS but useful later)

-- ----------------------------------------------------------------------------
-- notes
-- ----------------------------------------------------------------------------
create table if not exists public.notes (
  id                 uuid primary key default gen_random_uuid(),
  raw_content        text        not null,
  source             text        not null,                -- 'web'|'overlay'|'share'|'import'
  created_at         timestamptz not null default now(),

  -- AI layer (nullable until enrichment). NEVER mutates raw_content.
  title              text,
  gist               text,
  summary            text,
  note_type          text,                               -- note|todo|recipe|delve|reference|journal
  tags               text[]      not null default '{}',
  embedding          vector(1024),
  enriched_at        timestamptz,

  -- lifecycle
  status             text        not null default 'active',  -- 'active'|'archived'
  warmth             real        not null default 1.0,
  pinned             boolean     not null default false,
  last_interacted_at timestamptz not null default now(),
  last_surfaced_at   timestamptz,
  surfaced_count     integer     not null default 0,
  done               boolean,                            -- todos only

  -- import bookkeeping (non-SPEC, mirrors Phase 0)
  keep_id            text        unique,
  has_enrichable_text boolean     not null default true,
  embedding_stale     boolean     not null default true
);

-- ----------------------------------------------------------------------------
-- interactions — the signal source for warmth + resurfacing (SPEC §4, §7, §8)
-- Written on every open/search-hit/keep/let-go/edit/done.
-- ----------------------------------------------------------------------------
create table if not exists public.interactions (
  id         bigint generated always as identity primary key,
  note_id    uuid references public.notes(id) on delete cascade,
  kind       text not null,            -- opened|searched_hit|kept|let_go|edited|done
  created_at timestamptz not null default now()
);
create index if not exists interactions_note_id_idx     on public.interactions(note_id);
create index if not exists interactions_created_at_idx   on public.interactions(created_at desc);

-- ----------------------------------------------------------------------------
-- Full-text search over raw_content || title || gist.
-- 'simple' config: no stemming (keeps Finnish words intact), lowercases + strips
-- punctuation. Good enough for both languages; websearch_to_tsquery is used at
-- query time so the user can type natural phrases.
-- ----------------------------------------------------------------------------
alter table public.notes
  add column if not exists fts_doc tsvector
    generated always as (
      to_tsvector('simple', coalesce(raw_content, '') || ' ' ||
                            coalesce(title, '')      || ' ' ||
                            coalesce(gist, ''))
    ) stored;

create index if not exists notes_fts_doc_idx on public.notes using gin (fts_doc);

-- ----------------------------------------------------------------------------
-- Vector index: HNSW over cosine distance. pgvector docs recommend HNSW for
-- sub-100ms similarity at our scale.
-- ----------------------------------------------------------------------------
create index if not exists notes_embedding_hnsw_idx
  on public.notes using hnsw (embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- B-tree indexes for the home feed + archive screens.
-- ----------------------------------------------------------------------------
create index if not exists notes_status_type_idx        on public.notes(status, note_type);
create index if not exists notes_status_created_idx      on public.notes(status, created_at desc);
create index if not exists notes_status_pinned_created_idx on public.notes(status, pinned, created_at desc);
create index if not exists notes_unenriched_idx          on public.notes(enriched_at)
  where enriched_at is null and has_enrichable_text;

-- ----------------------------------------------------------------------------
-- HARD INVARIANT: raw_content is immutable.
-- Any UPDATE that changes raw_content after insert raises. Other columns
-- (title/gist/summary/tags/embedding/status/...) may change freely.
-- Implemented as BEFORE UPDATE trigger so the write never lands.
-- ----------------------------------------------------------------------------
create or replace function public.guard_raw_content_immutable()
returns trigger language plpgsql as $$
begin
  if new.raw_content is distinct from old.raw_content then
    raise exception 'raw_content is immutable — refusing update on note %', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists trg_notes_raw_immutable on public.notes;
create trigger trg_notes_raw_immutable
  before update on public.notes
  for each row execute function public.guard_raw_content_immutable();

-- ----------------------------------------------------------------------------
-- updated_at-style helper for last_interacted_at maintenance (used by RPCs /
-- client): set last_interacted_at = now() whenever an interaction is written.
-- ----------------------------------------------------------------------------
create or replace function public.touch_note_on_interaction()
returns trigger language plpgsql as $$
begin
  update public.notes
     set last_interacted_at = new.created_at
   where id = new.note_id;
  return new;
end; $$;

drop trigger if exists trg_interactions_touch on public.interactions;
create trigger trg_interactions_touch
  after insert on public.interactions
  for each row execute function public.touch_note_on_interaction();

-- ----------------------------------------------------------------------------
-- Row Level Security: authenticated users only. Single-user app — any signed-in
-- user reads/writes everything. Phase 0 had no RLS; this is the Phase 1 upgrade.
-- ----------------------------------------------------------------------------
alter table public.notes        enable row level security;
alter table public.interactions enable row level security;

drop policy if exists "notes_authenticated_all"        on public.notes;
drop policy if exists "interactions_authenticated_all" on public.interactions;

create policy "notes_authenticated_all"
  on public.notes for all
  to authenticated
  using (true) with check (true);

create policy "interactions_authenticated_all"
  on public.interactions for all
  to authenticated
  using (true) with check (true);

-- ----------------------------------------------------------------------------
-- Grants: newer Supabase projects default to NOT auto-exposing new tables to
-- the PostgREST roles anon/authenticated. Explicit GRANTs keep the schema
-- reachable via the auto-generated REST API (which the web app + edge funcs
-- use via supabase-js). service_role bypasses RLS.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.notes        to authenticated, service_role;
grant select, insert, update, delete on public.interactions to authenticated, service_role;
-- anon gets nothing on tables (login is required).
alter table public.notes        force row level security;
alter table public.interactions force row level security;