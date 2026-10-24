-- 0008_harden_auxiliary_access.sql - close secondary note access paths.

-- Interactions expose note IDs and can invoke a trigger that touches notes, so
-- they must follow the same ownership boundary as notes themselves.
alter table public.interactions enable row level security;
alter table public.interactions force row level security;

drop policy if exists "interactions_authenticated_all" on public.interactions;
drop policy if exists "interactions_select_own" on public.interactions;
drop policy if exists "interactions_insert_own" on public.interactions;
drop policy if exists "interactions_update_own" on public.interactions;
drop policy if exists "interactions_delete_own" on public.interactions;

create policy "interactions_select_own"
  on public.interactions for select
  to authenticated
  using (
    exists (
      select 1
        from public.notes
       where notes.id = interactions.note_id
         and notes.owner_id = (select auth.uid())
    )
  );

create policy "interactions_insert_own"
  on public.interactions for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.notes
       where notes.id = interactions.note_id
         and notes.owner_id = (select auth.uid())
    )
  );

create policy "interactions_update_own"
  on public.interactions for update
  to authenticated
  using (
    exists (
      select 1
        from public.notes
       where notes.id = interactions.note_id
         and notes.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.notes
       where notes.id = interactions.note_id
         and notes.owner_id = (select auth.uid())
    )
  );

create policy "interactions_delete_own"
  on public.interactions for delete
  to authenticated
  using (
    exists (
      select 1
        from public.notes
       where notes.id = interactions.note_id
         and notes.owner_id = (select auth.uid())
    )
  );

-- Keep the security-definer helper from resolving objects through a caller-
-- controlled search_path. It is now callable only by service_role.
alter function public.set_note_embedding(uuid, jsonb)
  set search_path = public, pg_temp;

revoke all on function public.set_note_embedding(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_note_embedding(uuid, jsonb)
  to service_role;
