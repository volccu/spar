-- 0010_spatial_folders.sql — the canvas an idea is arranged on.
--
-- A folder holds no content. Every word in it belongs to a note that syncs
-- through `notes` already; this stores only the arrangement — where each source
-- note stands, how wide it was pulled, what was drawn over the top, and any
-- free-standing labels. That is why it can be one row of jsonb and a
-- last-write-wins rule, with no second content model and no CRDT (SPEC §3).
--
-- Until this ran, the arrangement lived in IndexedDB and nowhere else: a canvas
-- laid out on the laptop opened as an untouched default on the phone, and a
-- drawing made on the phone stayed there. The grid card papered over it by
-- deriving a miniature from the notes, so nothing looked broken — it was just
-- quietly a different canvas on each device.
--
-- Safe to run more than once.

-- ----------------------------------------------------------------------------
-- The table
-- ----------------------------------------------------------------------------
-- `id` is the idea note's own id — a folder is the arrangement *of* that note's
-- sources and cannot exist without it, which the foreign key states outright.
-- The client's `idea_id` is that same value and is read back from `id`; a second
-- stored copy could only ever drift out of agreement with the key.
--
-- The cascade is the whole cleanup story. A note reaches destruction only after
-- a month in the trash, and its canvas has no meaning once it is gone; without
-- the cascade every destroyed idea would leave a row here for ever.
create table if not exists public.folders (
  id            uuid primary key references public.notes(id) on delete cascade,
  owner_id      uuid not null default auth.uid(),
  items         jsonb not null default '[]'::jsonb,
  strokes       jsonb not null default '[]'::jsonb,
  image_widths  jsonb not null default '{}'::jsonb,
  text_elements jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The pull asks one question — what changed since I last looked — of this
-- column, in this order, for this owner.
create index if not exists folders_owner_updated_idx
  on public.folders(owner_id, updated_at);

-- ----------------------------------------------------------------------------
-- Who may touch what
-- ----------------------------------------------------------------------------
-- The same boundary as notes (0007). A folder names note ids and nothing else,
-- but a note id is still a fact about somebody's archive.
alter table public.folders enable row level security;
alter table public.folders force row level security;

drop policy if exists "folders_select_own" on public.folders;
drop policy if exists "folders_insert_own" on public.folders;
drop policy if exists "folders_update_own" on public.folders;
drop policy if exists "folders_delete_own" on public.folders;

create policy "folders_select_own"
  on public.folders for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- The insert check is deliberately two conditions. Owning the folder row is not
-- enough on its own: without the second clause a signed-in user could attach a
-- canvas to somebody else's note id and learn, from whether it succeeded,
-- whether that note exists.
create policy "folders_insert_own"
  on public.folders for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1
        from public.notes
       where notes.id = folders.id
         and notes.owner_id = (select auth.uid())
    )
  );

create policy "folders_update_own"
  on public.folders for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "folders_delete_own"
  on public.folders for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- ----------------------------------------------------------------------------
-- Live updates
-- ----------------------------------------------------------------------------
-- Same reasoning as 0004: without it a folder still arrives within a few
-- seconds, with it the other device is told the moment a note is dragged.
-- Realtime respects row level security, so the policies above still apply.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'folders'
  ) then
    alter publication supabase_realtime add table public.folders;
  end if;
end $$;

alter table public.folders replica identity full;
