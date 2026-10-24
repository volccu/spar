-- 0027_prefs_history_and_bigger_files.sql — every folder list the row ever
-- held is kept, and a file may be 50 MB.
--
-- Why the history
-- ---------------
-- On 2026-10-09 the owner's nine folders left `public.prefs.boards` in one
-- upsert: a browser used "on this device only" signed in and pushed its own
-- list — an empty shelf and an Inspiration it had made for itself — over the
-- account's. No note was lost (each keeps its `board_id`), but the list was
-- gone from the server and, a tick later, from every device. It was recovered
-- from a freed page of one browser's IndexedDB. The client now merges instead
-- of overwriting (`web/src/lib/boardsMerge.ts`); this is the backstop that
-- does not depend on any client being right: before the folder list changes,
-- the list it replaces is copied here, so a bad write is always one query from
-- undone.
--
-- Read by its owner, written only by the trigger. `anon` holds nothing on it,
-- named privilege by privilege, which `npm run db:verify` asserts for every
-- table a migration creates (see 0024).
--
-- Why 50 MB
-- ---------
-- 25 MB (0005) is about fifteen seconds of a phone's 1080p video. 50 MB is the
-- per-file ceiling of the project's plan. The client's `MAX_FILE_BYTES`
-- (`web/src/lib/files.ts`) moves with it in the same change: a file the
-- bucket refuses keeps `path: null` forever and sits in the device's cache
-- budget unremovable, so the two numbers must never disagree.
--
-- Safe to run more than once.

-- ----------------------------------------------------------------------------
-- The history
-- ----------------------------------------------------------------------------
create table if not exists public.prefs_history (
  id          bigserial primary key,
  owner_id    uuid not null,
  boards      jsonb,
  updated_at  timestamptz,
  replaced_at timestamptz not null default now()
);

create index if not exists prefs_history_owner_replaced
  on public.prefs_history (owner_id, replaced_at desc);

alter table public.prefs_history enable row level security;
alter table public.prefs_history force row level security;

drop policy if exists "prefs_history_select_own" on public.prefs_history;
create policy "prefs_history_select_own"
  on public.prefs_history for select
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke select, insert, update, delete, truncate, references, trigger, maintain
  on table public.prefs_history from anon;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.prefs_history from authenticated;
grant select on table public.prefs_history to authenticated;
grant select, insert, update, delete on table public.prefs_history to service_role;
revoke all on sequence public.prefs_history_id_seq from anon, authenticated;

-- Runs as its owner so the copy lands whatever the caller may write; the
-- caller can only reach it by updating their own `prefs` row, which RLS
-- already confines to them.
create or replace function public.keep_prefs_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.prefs_history (owner_id, boards, updated_at)
  values (old.owner_id, old.boards, old.updated_at);
  return new;
end;
$$;

revoke all on function public.keep_prefs_history() from public, anon, authenticated;

drop trigger if exists trg_prefs_keep_history on public.prefs;
create trigger trg_prefs_keep_history
  before update on public.prefs
  for each row
  when (old.boards is distinct from new.boards)
  execute function public.keep_prefs_history();

-- ----------------------------------------------------------------------------
-- 50 MB a file
-- ----------------------------------------------------------------------------
update storage.buckets set file_size_limit = 52428800 where id = 'files';
