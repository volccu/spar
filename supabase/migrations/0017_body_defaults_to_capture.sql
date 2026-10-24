-- The editable body falls back to the original capture, which is what three
-- documents have said all along and nothing implemented.
--
-- SPEC §2.3, CLAUDE.md and web/CLAUDE.md all state that `raw_content` is the
-- immutable original and `body` "defaults to raw_content". Migration 0003 added
-- the column, backfilled the rows that predated it once, and then set the
-- column default to the empty string:
--
--     alter table public.notes alter column body set default '';
--
-- So the promise held for exactly the rows 0003 backfilled, and for nothing
-- written since. Every current writer sends `body` explicitly, which is the
-- only reason this has never bitten — but the app deliberately offers no way to
-- read `raw_content` back ("No 'Original' button", web/CLAUDE.md), so a row
-- that lands with an empty body is a note whose words are present in the table
-- and unreachable from every surface the user has. An insert from the SQL
-- editor, a restore, an import script, or anything else that omits the column
-- produces exactly that, silently, one blank card per note.
--
-- A BEFORE INSERT trigger is the whole fix. It runs after column defaults are
-- applied, so it sees the `''` the default just put there and replaces it with
-- the capture. Nothing existing is rewritten and nothing is dropped: the `''`
-- default stays, because removing it would make `body` a required column for
-- every writer, which is a different and larger change.
--
-- Insert only. `raw_content` is immutable and `body` is the field the user
-- edits, so an *update* that clears the body is the user emptying a note, and
-- refilling it with the original capture would put back words they just
-- deleted. That is why this is not a BEFORE UPDATE trigger as well.

create or replace function public.body_defaults_to_capture()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.body is null or new.body = '' then
    new.body = coalesce(new.raw_content, '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_body_defaults_to_capture on public.notes;

create trigger trg_body_defaults_to_capture
  before insert on public.notes
  for each row
  execute function public.body_defaults_to_capture();

comment on function public.body_defaults_to_capture() is
  'Fills an empty body from raw_content on insert, so the stated "body defaults to raw_content" invariant is actually enforced. Insert only: an empty body on update is the user clearing the note.';
