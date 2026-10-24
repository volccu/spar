-- 0012_sync_repair.sql — the three server-side reasons sync was failing.
--
-- All three share a shape: the server holding an opinion about a note that the
-- client's protocol never asked it for.

-- ----------------------------------------------------------------------------
-- 1. The column 0011 talks about but 0009 never created.
--
-- This is the one that produced "sync failed". Migration 0009 was written but
-- never applied to the live project, so `notes.merged_into` does not exist —
-- while 0011's merge trigger names it outright. The client sends a clock for
-- every mergeable field whether or not the server has the column, so an
-- ordinary edit (one clock moves, the other thirteen stay) walks the trigger
-- into `new.merged_into = old.merged_into` and Postgres answers
--
--     42703: record "new" has no field "merged_into"
--
-- An upsert is one statement, so that error fails every note sent with it, and
-- the outbox is only crossed off on success — so the notes stayed queued and
-- the same batch failed again on the next tick, for ever. It also gets steadily
-- worse: only notes that already carry field clocks can trip it, and every edit
-- adds one more note to that set. Which is exactly what "it started happening a
-- lot recently" describes.
alter table public.notes add column if not exists merged_into uuid;

create index if not exists notes_merged_into_idx
  on public.notes(merged_into)
  where merged_into is not null;

-- ----------------------------------------------------------------------------
-- 2. A merge trigger that cannot be broken by a column it has not got.
--
-- Adding `merged_into` above fixes today's failure. It does not fix the shape
-- of it: the client and the schema are deployed from different places and are
-- *expected* to disagree for a while — the whole `serverKnows…` family on the
-- client exists to survive exactly that window. This trigger was the one place
-- where the disagreement raised instead of degrading.
--
-- The repair is to stop naming columns. `to_jsonb(old)` contains precisely the
-- columns this server actually has, so it is both the value source and the list
-- of what is mergeable; a clock for anything else is dropped rather than obeyed.
-- A future field can now be sent by a new client to an old server and simply be
-- ignored, which is what every other part of this protocol already does.
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
  return new;
end; $$;

drop trigger if exists trg_notes_merge_field_versions on public.notes;
create trigger trg_notes_merge_field_versions
  before update on public.notes
  for each row execute function public.merge_note_field_versions();

-- ----------------------------------------------------------------------------
-- 3. `updated_at` belongs to whoever wrote the note.
--
--     new.updated_at = greatest(now(), new.updated_at);
--
-- read as "keep updated_at honest", and did the opposite. The client stamps
-- every version itself — `nextIso` guarantees the stamps rise, the per-field
-- clocks are client time, the pull cursor is `updated_at`, and
-- `permanently_delete_note` accepts a delete only while the server's
-- `updated_at` is still at or behind the one the user confirmed. Restamping the
-- row with `now()` on the way in breaks the last of those: the server's value
-- is a few hundred milliseconds *ahead* of the copy the client is holding, the
-- check `updated_at <= p_expected_updated_at` fails, and the delete is reported
-- as "the note was restored" — the note comes back on the next pull, having
-- been destroyed locally. Whether that happens at all depends on which way the
-- device's clock is skewed against the server's, which is not a thing
-- correctness may rest on. (Measured on the live project: a client-sent
-- 10:05:00Z was stored as 19:50:18Z.)
--
-- So a writer that names a version is believed. Only a write that does *not*
-- touch `updated_at` — the enrichment function patching a title, say — is
-- stamped, and it is stamped so the pull cursor still moves and the other
-- device still hears about it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is distinct from old.updated_at then
    return new;
  end if;
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();
