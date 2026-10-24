-- 0011_sync_safety.sql - durable deletes and field-level sync protection.
--
-- A delete must survive an offline device coming back later, and two devices
-- editing different fields must not lose either edit. The client carries a
-- timestamp per editable field; this trigger merges a full-row upsert by those
-- timestamps instead of treating the row as one indivisible value.

create table if not exists public.note_tombstones (
  note_id    uuid primary key,
  owner_id   uuid not null default auth.uid(),
  deleted_at timestamptz not null default now(),
  expected_updated_at timestamptz
);

alter table public.note_tombstones
  add column if not exists expected_updated_at timestamptz;

create index if not exists note_tombstones_owner_deleted_idx
  on public.note_tombstones(owner_id, deleted_at, note_id);

alter table public.note_tombstones enable row level security;
alter table public.note_tombstones force row level security;

drop policy if exists "note_tombstones_select_own" on public.note_tombstones;
drop policy if exists "note_tombstones_insert_own" on public.note_tombstones;
drop policy if exists "note_tombstones_update_own" on public.note_tombstones;
drop policy if exists "note_tombstones_delete_own" on public.note_tombstones;

create policy "note_tombstones_select_own"
  on public.note_tombstones for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "note_tombstones_insert_own"
  on public.note_tombstones for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "note_tombstones_update_own"
  on public.note_tombstones for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "note_tombstones_delete_own"
  on public.note_tombstones for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.note_tombstones to authenticated, service_role;

create or replace function public.permanently_delete_note(
  p_note_id uuid,
  p_expected_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.notes
     where id = p_note_id
       and owner_id = auth.uid()
       and status = 'trashed'
       and updated_at <= p_expected_updated_at
  ) then
    return false;
  end if;

  insert into public.note_tombstones(note_id, owner_id, deleted_at, expected_updated_at)
  values (p_note_id, auth.uid(), now(), p_expected_updated_at)
  on conflict (note_id) do update
    set deleted_at = excluded.deleted_at,
        expected_updated_at = excluded.expected_updated_at;

  delete from public.notes
   where id = p_note_id and owner_id = auth.uid();
  return true;
end; $$;

grant execute on function public.permanently_delete_note(uuid, timestamptz)
  to authenticated, service_role;

-- Once a note is tombstoned, an old offline copy must not resurrect it.
create or replace function public.reject_tombstoned_note()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from public.note_tombstones
     where note_id = new.id and owner_id = new.owner_id
  ) then
    raise exception 'note % has been permanently deleted', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists trg_notes_reject_tombstone on public.notes;
create trigger trg_notes_reject_tombstone
  before insert or update on public.notes
  for each row execute function public.reject_tombstoned_note();

alter table public.notes
  add column if not exists field_updated_at jsonb not null default '{}'::jsonb;
alter table public.notes
  add column if not exists note_type_user_set boolean not null default false;
alter table public.notes
  add column if not exists tags_user_set boolean not null default false;

-- Existing non-empty values are safer treated as owner-owned than replaced by
-- a later enrichment pass. New AI values remain false until the owner edits.
update public.notes
   set note_type_user_set = true
 where note_type is not null and not note_type_user_set;
update public.notes
   set tags_user_set = true
 where coalesce(cardinality(tags), 0) > 0 and not tags_user_set;

create or replace function public.mark_user_owned_enrichment_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Enrichment changes enriched_at in the same statement. A normal client
  -- update leaves it alone, which makes this distinction explicit and robust.
  if new.enriched_at is not distinct from old.enriched_at then
    if new.note_type is distinct from old.note_type then
      new.note_type_user_set = true;
    end if;
    if new.tags is distinct from old.tags then
      new.tags_user_set = true;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_notes_mark_user_fields on public.notes;
create trigger trg_notes_mark_user_fields
  before update on public.notes
  for each row execute function public.mark_user_owned_enrichment_fields();

create or replace function public.merge_note_field_versions()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  field text;
  incoming text;
  previous text;
begin
  -- Server-side writes such as enrichment do not carry client field clocks and
  -- are therefore explicit patches. Client full-row upserts carry all clocks.
  if jsonb_typeof(new.field_updated_at) <> 'object' then
    new.field_updated_at = coalesce(old.field_updated_at, '{}'::jsonb);
    return new;
  end if;
  if new.field_updated_at is not distinct from old.field_updated_at then
    return new;
  end if;

  foreach field in array array[
    'body', 'title', 'gist', 'summary', 'note_type', 'tags', 'status',
    'priority', 'reminder_at', 'done', 'merged_from', 'merged_into',
    'attachments', 'link_previews'
  ] loop
    if new.field_updated_at ? field then
      incoming := new.field_updated_at ->> field;
      previous := old.field_updated_at ->> field;
      if incoming is null or (previous is not null and incoming <= previous) then
        if previous is null then
          new.field_updated_at = new.field_updated_at - field;
        else
          new.field_updated_at = jsonb_set(
            new.field_updated_at, array[field], to_jsonb(previous), true
          );
        end if;
        case field
          when 'body' then new.body = old.body;
          when 'title' then new.title = old.title;
          when 'gist' then new.gist = old.gist;
          when 'summary' then new.summary = old.summary;
          when 'note_type' then new.note_type = old.note_type;
          when 'tags' then new.tags = old.tags;
          when 'status' then new.status = old.status;
          when 'priority' then new.priority = old.priority;
          when 'reminder_at' then new.reminder_at = old.reminder_at;
          when 'done' then new.done = old.done;
          when 'merged_from' then new.merged_from = old.merged_from;
          when 'merged_into' then new.merged_into = old.merged_into;
          when 'attachments' then new.attachments = old.attachments;
          when 'link_previews' then new.link_previews = old.link_previews;
        end case;
      end if;
    end if;
  end loop;
  return new;
end; $$;

drop trigger if exists trg_notes_merge_field_versions on public.notes;
create trigger trg_notes_merge_field_versions
  before update on public.notes
  for each row execute function public.merge_note_field_versions();

create index if not exists notes_field_updated_at_idx
  on public.notes using gin (field_updated_at);

-- Search what the owner currently reads. The original generated index searched
-- only the immutable capture, so edits could be found locally but not remotely.
drop index if exists public.notes_fts_doc_idx;
alter table public.notes drop column if exists fts_doc;
alter table public.notes
  add column fts_doc tsvector generated always as (
    to_tsvector('simple', coalesce(body, '') || ' ' ||
                          coalesce(title, '') || ' ' ||
                          coalesce(gist, ''))
  ) stored;
create index notes_fts_doc_idx on public.notes using gin (fts_doc);
