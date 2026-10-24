-- 0016_folder_boards.sql — boards become real folders.
--
-- A board stopped being a saved filter over a tag and became a real folder a note is filed into
-- (SPEC §6). This migration covers everything about that change that is safe to apply outright —
-- additive columns, and dead server-side machinery that only ever gated writes nothing makes
-- anymore.
--
-- Deliberately NOT in this migration: physically dropping title/gist/summary/tags/embedding/
-- enriched_at. The app no longer reads or writes any of them — see CLAUDE.md's Enrichment section
-- — but the live table is not the empty one the project notes assumed: 227 real notes, 56 of them
-- still carrying AI-suggested tags in that column. Deleting a column is not undoable, so that part
-- is held for an explicit go-ahead rather than folded in here. Safe to run more than once.

-- ----------------------------------------------------------------------------
-- 1. A note's own folder — nullable, no FK. Just an id matched against the
--    list in prefs.boards below, the same "no referential integrity" shape a
--    hand-typed tag always had: one person's own folders don't need a
--    foreign key to police them, and it means a folder can be deleted (§6:
--    deleting one archives its notes) without a cascade to reason about.
-- ----------------------------------------------------------------------------
alter table public.notes add column if not exists board_id uuid;

create index if not exists notes_status_board_idx on public.notes(status, board_id);

-- ----------------------------------------------------------------------------
-- 2. The user's own folders — repurposing the pinned-tag shelf (migration
--    0014). There is one shelf per person, so this stays a single jsonb
--    column on the same one-row-per-person table rather than becoming a
--    table of its own; store/prefsSync.ts already carries the "did anyone
--    here actually touch it" conflict rule that column needs. The old
--    pinned_tags column is left in place, not dropped — it's dead weight,
--    not a risk, and the same "confirm before deleting real data" caution
--    above applies to it too, however unlikely anyone misses it.
-- ----------------------------------------------------------------------------
alter table public.prefs add column if not exists boards jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- 3. The field-clock merge trigger (0011, repaired in 0012 to stop naming
--    columns it might not have): board_id joins the mergeable set. Nothing
--    else about it needs to change — a clock for a column the server hasn't
--    got (or no longer has, once the AI columns are eventually dropped) is
--    already just quietly ignored.
-- ----------------------------------------------------------------------------
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
    'body', 'note_type', 'board_id', 'status',
    'priority', 'reminder_at', 'done', 'merged_from', 'merged_into',
    'attachments', 'link_previews'
  ] loop
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
      patch := patch || jsonb_build_object(field, before -> field);
    end if;
  end loop;

  if patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, patch);
  end if;
  new.field_updated_at = clocks;
  return new;
end; $$;
-- The trigger already points at this function (0011); redefining it is enough.

-- ----------------------------------------------------------------------------
-- 4. The AI-enrichment ownership guard is dead code the moment nothing but
--    the user ever writes note_type again, and both flags are pure
--    bookkeeping booleans with no content of their own — nothing a person
--    typed or that AI generated, just "did a write touch this", so dropping
--    them carries none of the risk the AI-output columns do.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_notes_mark_user_fields on public.notes;
drop function if exists public.mark_user_owned_enrichment_fields();
alter table public.notes drop column if exists note_type_user_set;
alter table public.notes drop column if exists tags_user_set;

-- ----------------------------------------------------------------------------
-- 5. Whatever database webhook used to call enrich-note on insert. A
--    Database Webhook is an ordinary trigger under the hood (one that calls
--    supabase_functions.http_request), usually made through the dashboard
--    rather than a migration — so this hunts for one by what it *calls*
--    rather than by a name a migration never chose, and drops it if found. A
--    project with no such trigger does nothing here. This only removes the
--    trigger that *called* enrichment; it touches no note data at all.
-- ----------------------------------------------------------------------------
do $$
declare
  trig record;
begin
  for trig in
    select t.tgname
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
     where t.tgrelid = 'public.notes'::regclass
       and not t.tgisinternal
       and n.nspname = 'supabase_functions'
       and p.proname = 'http_request'
       and pg_get_triggerdef(t.oid) ilike '%enrich-note%'
  loop
    execute format('drop trigger if exists %I on public.notes', trig.tgname);
  end loop;
end $$;
