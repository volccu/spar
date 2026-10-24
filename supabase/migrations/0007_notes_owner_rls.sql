-- 0007_notes_owner_rls.sql - make notes tenant-owned.
--
-- Existing notes are assigned to the only existing auth user. If there are
-- multiple users while unowned notes remain, stop rather than guessing which
-- account owns personal data. New browser inserts use auth.uid() by default.

alter table public.notes
  add column if not exists owner_id uuid;

do $$
declare
  v_owner_id uuid;
  v_user_count integer;
begin
  if exists (select 1 from public.notes where owner_id is null) then
    select count(*)::integer
      into v_user_count
      from auth.users;

    if v_user_count <> 1 then
      raise exception
        'Cannot backfill notes.owner_id: expected exactly one auth user, found %',
        v_user_count;
    end if;

    select id
      into v_owner_id
      from auth.users
      limit 1;

    if v_owner_id is null then
      raise exception 'Cannot backfill notes.owner_id: auth user ID is null';
    end if;

    update public.notes
       set owner_id = v_owner_id
     where owner_id is null;
  end if;
end $$;

alter table public.notes
  alter column owner_id set default auth.uid(),
  alter column owner_id set not null;

create index if not exists notes_owner_id_idx
  on public.notes(owner_id);

alter table public.notes enable row level security;
alter table public.notes force row level security;

drop policy if exists "notes_authenticated_all" on public.notes;
drop policy if exists "notes_select_own" on public.notes;
drop policy if exists "notes_insert_own" on public.notes;
drop policy if exists "notes_update_own" on public.notes;
drop policy if exists "notes_delete_own" on public.notes;

create policy "notes_select_own"
  on public.notes for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "notes_insert_own"
  on public.notes for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "notes_update_own"
  on public.notes for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "notes_delete_own"
  on public.notes for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Embeddings are an internal enrichment operation. The security-definer RPC
-- must not be callable by an ordinary authenticated user for arbitrary IDs.
revoke all on function public.set_note_embedding(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_note_embedding(uuid, jsonb)
  to service_role;
