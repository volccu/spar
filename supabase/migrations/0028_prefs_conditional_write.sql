-- 0028_prefs_conditional_write.sql — a folder list is written only over the
-- row it was merged against, and the history keeps only real changes.
--
-- Why the conditional write (audit DATA-1, 2026-10-10)
-- ---------------------------------------------------
-- Since 0027's day the client merges a queued folder change into the server's
-- list instead of pushing its own list whole (`web/src/lib/boardsMerge.ts`).
-- But it merged against a copy read at the start of the sync tick — before
-- notes, files and canvases, which can be minutes — and then wrote with a
-- plain upsert. A folder change the other device made in that span was
-- overwritten. The client now re-reads the row just before merging, and
-- writes through this function, which writes only while `updated_at` is still
-- the value it read (no row at all when it read none). On `false` the client
-- reads again, merges again and tries again.
--
-- `security invoker`: row-level security applies exactly as it does to the
-- plain upsert, so the caller can only ever reach their own row. A client
-- that finds no such function (the app deployed before this migration) falls
-- back to the plain upsert, which is the behaviour before it.
--
-- Why the history trigger changes (audit SEC-9, 2026-10-10)
-- --------------------------------------------------------
-- 0027 copied the old list on every change to `boards` at all — a drag that
-- renumbered positions, a lens moved, a folder's keep-awake switch — so the
-- table grew with rewrites that change nothing a lost shelf would need. It now
-- records only when a folder's id, name, mark (`icon`), tint (`color`) or
-- built-in kind (`kind`: Inspiration made, or demoted to a folder) changes.
-- Nothing is pruned: deleting history rows is a separate decision.
--
-- Safe to run more than once.

-- ----------------------------------------------------------------------------
-- The conditional write
-- ----------------------------------------------------------------------------
create or replace function public.write_prefs_if_unchanged(
  p_expected_at timestamptz,
  p_boards      jsonb,
  p_updated_at  timestamptz,
  p_set_since   boolean default false,
  p_inbox_since timestamptz default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_expected_at is null then
    insert into public.prefs (owner_id, boards, updated_at, inbox_since)
    values (auth.uid(), p_boards, p_updated_at, case when p_set_since then p_inbox_since end)
    on conflict (owner_id) do nothing;
  else
    update public.prefs
       set boards      = p_boards,
           updated_at  = p_updated_at,
           inbox_since = case when p_set_since then p_inbox_since else inbox_since end
     where owner_id = auth.uid()
       and updated_at = p_expected_at;
  end if;
  get diagnostics written = row_count;
  return written = 1;
end;
$$;

revoke all on function public.write_prefs_if_unchanged(timestamptz, jsonb, timestamptz, boolean, timestamptz)
  from public, anon;
grant execute on function public.write_prefs_if_unchanged(timestamptz, jsonb, timestamptz, boolean, timestamptz)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The history, for real changes only
-- ----------------------------------------------------------------------------
-- What a lost shelf needs back: each entry's id, name, mark, tint and kind,
-- in id order, so a reorder alone compares equal. Positions, the lens order
-- and the keep-awake switch are left out on purpose.
create or replace function public.prefs_folder_shape(p_boards jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', entry -> 'id',
        'name', entry -> 'name',
        'icon', entry -> 'icon',
        'color', entry -> 'color',
        'kind', entry -> 'kind'
      )
      order by entry ->> 'id'
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(p_boards) = 'array' then p_boards else '[]'::jsonb end
  ) as entry;
$$;

revoke all on function public.prefs_folder_shape(jsonb) from public, anon;
grant execute on function public.prefs_folder_shape(jsonb) to authenticated, service_role;

drop trigger if exists trg_prefs_keep_history on public.prefs;
create trigger trg_prefs_keep_history
  before update on public.prefs
  for each row
  when (public.prefs_folder_shape(old.boards) is distinct from public.prefs_folder_shape(new.boards))
  execute function public.keep_prefs_history();
