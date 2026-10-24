-- A permanent delete is checked against what a *client* wrote, not against
-- whatever the server last stamped.
--
-- The bug this fixes
-- ------------------
-- `permanently_delete_note` refuses a delete when the note's `updated_at` has
-- moved past what the deleting device expected. That guard is right in spirit:
-- it is asking "has the other device changed this note since I last looked".
-- It was wrong in fact, because `updated_at` is not only moved by clients.
--
-- `touch_updated_at` (migration 0013) sets `updated_at = now()` whenever a row
-- is written, and the outbox deliberately re-sends notes it has already sent
-- ("sending a note twice is free"). A browser can only write milliseconds --
-- `toISOString()` always emits three decimals -- so a microsecond stamp is
-- proof the server wrote it. On 2026-08-27, 118 of 291 rows carried one. The
-- client never learns those values, because `remoteIsNewer` sees identical
-- field clocks and drops the row, so the two copies quietly disagree about a
-- number that only one of them is allowed to read.
--
-- The delete then hands over the stamp the client remembers, the server does
-- not recognise it, and refuses. Four trashed notes were already in that
-- state. Before `cb86772` a refusal meant the note was gone locally, alive on
-- the server and past the pull cursor -- lost quietly, on one device only.
--
-- Why the check is widened rather than moved
-- ------------------------------------------
-- The per-field clocks in `field_updated_at` answer the real question
-- honestly: only a client ever writes one. The server can move `updated_at`
-- on its own but it cannot invent a field clock. So the delete is accepted
-- when the stored `updated_at` is within what the client expected **or** when
-- nothing any client wrote is newer than what the client expected.
--
-- Deliberately `create or replace` with the signature untouched. Changing the
-- arguments or the return type would mean `drop function` first, and in that
-- window any device that has not reloaded the app gets "function does not
-- exist" and every delete fails. One of the two devices here is a phone that
-- reloads when it feels like it; that window is worse than the bug.
--
-- What this gives up, on purpose
-- ------------------------------
-- 114 of the 291 rows -- the imported notes -- carry no field clocks at all.
-- For those, `max` over an empty object is null, the coalesce makes it
-- `-infinity`, and the second branch is always true, so the guard falls back
-- to "is it still trashed on the server". That still catches the case that
-- matters (the other device restored it) but it is genuinely weaker than
-- before for a third of the archive. This trade was put to the user in those
-- terms and accepted on 2026-08-27.
--
-- This treats the symptom. The cause is `touch_updated_at` restamping rows
-- that did not change, and fixing that means comparing `to_jsonb(new)` to
-- `to_jsonb(old)` (minus the generated `fts_doc`, which is null in a BEFORE
-- trigger, so a plain `new is distinct from old` does not work) on the hottest
-- write path in the app, for a rare correctness case. That is its own
-- decision and is not folded in here.
--
-- `security definer` and `set search_path` are restated verbatim because
-- `create or replace` resets a function's configuration and nothing warns you
-- when it does. Dropping them would silently undo migrations 0008 and 0011.

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
    select 1 from public.notes n
     where n.id = p_note_id
       and n.owner_id = auth.uid()
       and n.status = 'trashed'
       and (
         n.updated_at <= p_expected_updated_at
         -- Or: the server's own stamp has run ahead, but nothing a *client*
         -- wrote has. `jsonb_typeof` and the date-shaped filter are not
         -- decoration -- a malformed value would raise inside a
         -- `security definer` function and every delete would fail until the
         -- row was repaired by hand. Checked read-only against all 291 rows
         -- before this was pushed: no non-object values, no malformed clocks.
         or coalesce(
              (select max(e.value::timestamptz)
                 from jsonb_each_text(
                        case when jsonb_typeof(n.field_updated_at) = 'object'
                             then n.field_updated_at
                             else '{}'::jsonb end
                      ) as e(key, value)
                where e.value ~ '^[0-9]{4}-'),
              '-infinity'::timestamptz
            ) <= p_expected_updated_at
       )
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
