-- 0003_v2_columns.sql — bring the deployed schema up to SPEC v2.
--
-- Adds the editable `body` column (raw_content stays immutable and guarded by
-- the trigger from 0001), plus the organizing columns the app now writes.
-- Safe to run more than once.

-- ----------------------------------------------------------------------------
-- New columns
-- ----------------------------------------------------------------------------
alter table public.notes add column if not exists body        text;
alter table public.notes add column if not exists updated_at  timestamptz not null default now();
alter table public.notes add column if not exists priority    smallint    not null default 0;
alter table public.notes add column if not exists reminder_at timestamptz;
alter table public.notes add column if not exists merged_from uuid[];

-- Existing rows predate the raw/body split: the body starts as the original.
update public.notes set body = raw_content where body is null;

alter table public.notes alter column body set not null;
alter table public.notes alter column body set default '';

-- Carry over Phase 0's `pinned` flag into the v2 priority column, once.
update public.notes set priority = 1 where pinned and priority = 0;

-- ----------------------------------------------------------------------------
-- Full-text search must cover the edited body, not just the original capture.
-- fts_doc is a generated column, so it has to be dropped and recreated.
-- ----------------------------------------------------------------------------
drop index if exists notes_fts_doc_idx;
alter table public.notes drop column if exists fts_doc;

alter table public.notes
  add column fts_doc tsvector
    generated always as (
      to_tsvector('simple', coalesce(body, '')  || ' ' ||
                            coalesce(title, '') || ' ' ||
                            coalesce(gist, ''))
    ) stored;

create index notes_fts_doc_idx on public.notes using gin (fts_doc);

-- ----------------------------------------------------------------------------
-- Keep updated_at honest — the sync uses it to decide which side is newer.
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = greatest(now(), new.updated_at);
  return new;
end; $$;

drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Sorting the boards: priority first, then newest.
-- ----------------------------------------------------------------------------
create index if not exists notes_status_priority_created_idx
  on public.notes(status, priority desc, created_at desc);

create index if not exists notes_updated_at_idx on public.notes(updated_at);
