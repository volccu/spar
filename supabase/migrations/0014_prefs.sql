-- 0014_prefs.sql — one row of preferences per person: the pinned-tag boards.
--
-- The tags themselves already sync — a hand-typed `#tag` is characters in
-- `note.body`, and `body` is in `CONFLICT_FIELDS` like any other edit. What
-- has never synced is which tags are *pinned* into a board on the shelf:
-- `usePinnedTags.ts` kept that list under the local-only IndexedDB `meta`
-- store, so pinning `#recipes` on the laptop left the phone with the tag in
-- the note and no board for it. This table is that one missing fact.
--
-- Modelled on 0010_spatial_folders.sql, at a smaller scale: a folder is one
-- row per idea, this is one row per person, because there is exactly one
-- shelf of pinned boards to a person, not one per note. See
-- `web/src/store/prefsSync.ts` for the conflict rule this enables — it is not
-- plain last-write-wins, for the same reason a folder's invented default
-- layout is not either.
--
-- Safe to run more than once.

-- ----------------------------------------------------------------------------
-- The table
-- ----------------------------------------------------------------------------
create table if not exists public.prefs (
  owner_id    uuid primary key default auth.uid(),
  pinned_tags jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Who may touch what
-- ----------------------------------------------------------------------------
-- The same boundary as folders (0010) and notes (0007). No delete policy: a
-- row of preferences is never removed on its own, only ever replaced — there
-- is nothing here for a delete to mean.
alter table public.prefs enable row level security;
alter table public.prefs force row level security;

drop policy if exists "prefs_select_own" on public.prefs;
drop policy if exists "prefs_insert_own" on public.prefs;
drop policy if exists "prefs_update_own" on public.prefs;

create policy "prefs_select_own"
  on public.prefs for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "prefs_insert_own"
  on public.prefs for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "prefs_update_own"
  on public.prefs for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ----------------------------------------------------------------------------
-- Live updates
-- ----------------------------------------------------------------------------
-- Same reasoning as 0004 and 0010: without it a re-pin still arrives within a
-- few seconds via the backstop poll, with it the other device is told at
-- once. Realtime respects row level security, so the policies above still
-- apply.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'prefs'
  ) then
    alter publication supabase_realtime add table public.prefs;
  end if;
end $$;

alter table public.prefs replica identity full;
