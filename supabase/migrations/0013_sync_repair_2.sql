-- 0013_sync_repair_2.sql — two more shapes of the same class of bug: a trigger
-- believing something it should not have.

-- ----------------------------------------------------------------------------
-- 1. A losing edit was marking tags/type as user-owned forever.
--
-- Same-timing triggers on one table fire in name order. `trg_notes_mark_user_
-- fields` sorted before `trg_notes_merge_field_versions`, so it saw the
-- *incoming* row before the merge trigger had a chance to decide the incoming
-- clock actually lost and revert the value. Result: a tag edit that arrived
-- late — and was correctly discarded by the merge — still flipped
-- `tags_user_set` (or `note_type_user_set`) to true, permanently, on a row
-- that in the end never changed. From that moment on, `enrich-note` is
-- forbidden from ever writing tags to that note again, for a change that
-- didn't happen.
--
-- The fix folds the marking into the merge trigger itself, after it has
-- decided which fields actually won, so only a change that survives the merge
-- can set the flag. The standalone marking trigger and function are dropped.
drop trigger if exists trg_notes_mark_user_fields on public.notes;
drop function if exists public.mark_user_owned_enrichment_fields();

create or replace function public.merge_note_field_versions()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  field    text;
  incoming text;
  previous text;
  before   jsonb;
  patch    jsonb := '{}'::jsonb;
  clocks   jsonb;
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

  before := to_jsonb(old);
  clocks := new.field_updated_at;

  foreach field in array array[
    'body', 'title', 'gist', 'summary', 'note_type', 'tags', 'status',
    'priority', 'reminder_at', 'done', 'merged_from', 'merged_into',
    'attachments', 'link_previews'
  ] loop
    -- A column this server has not been taught about yet is not something
    -- anyone can hold a version of. Forget the clock and carry on.
    if not (before ? field) then
      clocks := clocks - field;
      continue;
    end if;
    if not (clocks ? field) then
      continue;
    end if;

    incoming := clocks ->> field;
    previous := before -> 'field_updated_at' ->> field;
    if incoming is null or (previous is not null and incoming <= previous) then
      if previous is null then
        clocks := clocks - field;
      else
        clocks := jsonb_set(clocks, array[field], to_jsonb(previous), true);
      end if;
      -- The losing field keeps the value it already had. Collected and applied
      -- in one go, so the trigger never names a column in an assignment.
      patch := patch || jsonb_build_object(field, before -> field);
    end if;
  end loop;

  if patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, patch);
  end if;
  new.field_updated_at = clocks;

  -- Mark ownership only for a field whose new value actually survived the
  -- merge above — reading `new` down here, after the possible revert, rather
  -- than trusting the incoming row's own opinion of itself.
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

drop trigger if exists trg_notes_merge_field_versions on public.notes;
create trigger trg_notes_merge_field_versions
  before update on public.notes
  for each row execute function public.merge_note_field_versions();

-- ----------------------------------------------------------------------------
-- 2. updated_at could still move backwards, and a pull cursor never looks
--    backwards.
--
-- 0012 stopped restamping with now() for a writer that names its own version —
-- correct, and argued at length in that migration's own comment. But it left
-- no floor: a client whose clock runs behind the server's, or a long-offline
-- device pushing a stamp made hours ago, can still write an updated_at earlier
-- than the row already carries. Every other device pulls with
-- `updated_at.gt.<cursor>`, so a row whose stamp fell behind their cursor is
-- never fetched again — the edit sits on the server, correctly stored, and is
-- invisible to every other device forever. Nothing errors; there is nothing to
-- notice.
--
-- The fix keeps everything 0012 argued for — a writer that names a forward
-- version is still believed exactly as sent — and adds only a floor: the
-- stamp may never fall at or behind the one already stored.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is distinct from old.updated_at then
    if new.updated_at <= old.updated_at then
      new.updated_at = old.updated_at + interval '1 microsecond';
    end if;
    return new;
  end if;
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();
