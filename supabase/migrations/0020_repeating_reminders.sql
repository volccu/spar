-- 0020 — a reminder that comes round again.
--
-- `reminder_at` has always been one instant: it rings once and then sits there
-- as a fact about a moment that has passed. "Bins out on Tuesday" could not be
-- said at all, so it was said by hand every week, which means it was not said.
--
-- The whole feature is one nullable column and a rewrite of `due_reminders`.
-- Nothing else moves, and in particular **the server still never writes a
-- note**. That is the property Phase 3 was built around (SPEC §10): delivery is
-- bookkeeping, it lives in `reminder_deliveries`, and a column on `notes` would
-- move `updated_at` and drag the note to the top of a board ordered on the last
-- edit, for a fact the user did not create. Advancing `reminder_at` after each
-- firing would have broken exactly that rule — so nothing is advanced. The
-- anchor stays where the user put it and the *occurrence* is computed on the
-- way past.
--
-- Which makes the non-repeating case a special case of one line: with no rule,
-- the occurrence is the anchor, which is what this function did before.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. The rule itself.
--
--    Plain nullable text with no check constraint, exactly like `note_type`
--    beside it, and for the same reason: the set of periods is a decision the
--    client makes and a fourth one should not cost a migration. An unreadable
--    value is not a hazard here — every reader below matches the three known
--    spellings and falls through to "does not repeat", which is the same
--    answer null gives.
-- ----------------------------------------------------------------------------
alter table public.notes add column if not exists reminder_repeat text;

-- ----------------------------------------------------------------------------
-- 2. The series, as one function.
--
--    The occurrence is the latest one that is not in the future: the anchor
--    plus however many whole periods have elapsed since it. A count is floored
--    and clamped at zero, so an anchor still in the future projects to itself —
--    which the caller's `<= now()` test then rejects, exactly as it always did
--    for a reminder set for tomorrow.
--
--    **A day is 24 hours and a week is 7 of those**, computed on the instant.
--    In a zone that keeps summer time a daily reminder therefore lands an hour
--    off its wall-clock time for half the year, until the next time it is set.
--    A month is `interval '1 month'`, which is calendar arithmetic, so the 31st
--    clamps to the 28th in February and back again in March.
--
--    That clamping is also why the month count is *checked* rather than
--    trusted. `age()` does its subtraction on the date fields and borrows a
--    whole month when the day would go negative, so from an anchor on the 31st
--    it reports 0 months elapsed on the 28th of the next month — one real
--    occurrence it would have skipped silently. Stepping on while the next one
--    has also passed costs one comparison and removes the whole class of
--    edge case. Two steps is enough for any rule here; the loop is bounded
--    anyway, because nothing may hang the sweep.
--
--    All of it is mirrored in `web/src/lib/reminders.ts`, which must project
--    the same series or the app shows a time the server will not ring at.
-- ----------------------------------------------------------------------------
create or replace function public.reminder_occurrence(
  p_anchor timestamptz,
  p_repeat text,
  p_now    timestamptz
)
returns timestamptz
language plpgsql
-- `stable`, not `immutable`, and the difference is not pedantry: adding
-- `interval '1 month'` to a timestamptz is calendar arithmetic done in the
-- session's own time zone, which Postgres itself marks stable for that reason.
-- Claiming immutability would licence the planner to fold a result computed
-- under one zone into a plan reused under another.
stable
set search_path = public, pg_temp
as $$
declare
  step interval;
  n    int;
  at   timestamptz;
begin
  if p_anchor is null then
    return null;
  end if;

  step := case p_repeat
            when 'daily'   then interval '1 day'
            when 'weekly'  then interval '7 days'
            when 'monthly' then interval '1 month'
            else null
          end;
  if step is null then
    return p_anchor;
  end if;

  if p_repeat = 'monthly' then
    n := greatest(0, floor(
           extract(year from age(p_now, p_anchor)) * 12
             + extract(month from age(p_now, p_anchor))
         ))::int;
  else
    n := greatest(0, floor(
           extract(epoch from (p_now - p_anchor)) / extract(epoch from step)
         ))::int;
  end if;

  at := p_anchor + (n * step);
  while at + step <= p_now loop
    at := at + step;
    n := n + 1;
    exit when n > 10000;
  end loop;

  return at;
end; $$;

-- ----------------------------------------------------------------------------
-- 3. `due_reminders`, asking that question of every note carrying a reminder.
--
--    The grace window is unchanged and still does the work it always did: an
--    occurrence more than `p_grace` old has missed its moment. For a repeating
--    reminder it does something extra and worth naming — a phone that was off
--    for a week comes back to *one* notification, the most recent occurrence,
--    rather than seven days of them.
--
--    The signature is unchanged but the return type is not, so this is a drop
--    and a create rather than a replace — which means the grants go with it and
--    have to be restated below.
-- ----------------------------------------------------------------------------
drop function if exists public.due_reminders(interval);

create function public.due_reminders(p_grace interval default interval '1 day')
returns table (
  note_id         uuid,
  owner_id        uuid,
  reminder_at     timestamptz,
  reminder_repeat text,
  body            text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with occurrence as (
    select
      n.id,
      n.owner_id,
      n.reminder_repeat,
      n.body,
      public.reminder_occurrence(n.reminder_at, n.reminder_repeat, now()) as at
      from public.notes n
     where n.reminder_at is not null
       and coalesce(n.status, 'active') = 'active'
  )
  select o.id, o.owner_id, o.at, o.reminder_repeat, o.body
    from occurrence o
    left join public.reminder_deliveries d on d.note_id = o.id
   where o.at <= now()
     and o.at > now() - p_grace
     and (d.note_id is null or d.reminder_at is distinct from o.at)
$$;

-- Restated because the drop above took the old ones with it. Only the sweep may
-- ask: it runs as `service_role`, and nobody signed in through the app has any
-- reason to enumerate what is about to fire (0015).
revoke all on function public.due_reminders(interval) from public, anon, authenticated;
grant execute on function public.due_reminders(interval) to service_role;

-- The arithmetic is locked down beside it. It reads no table and could leak
-- nothing if it were open, but 0008's rule for auxiliary objects is that the
-- sweep's own machinery is reachable by the sweep and by nobody else, and a
-- function that is only *probably* harmless is not an argument for an
-- exception.
revoke all on function public.reminder_occurrence(timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reminder_occurrence(timestamptz, text, timestamptz)
  to service_role;

-- ----------------------------------------------------------------------------
-- 4. The field-clock merge trigger (0011, repaired in 0012, extended in 0016):
--    `reminder_repeat` joins the mergeable set.
--
--    It has to. Two devices may each set a reminder rule, and a field missing
--    from this array is not rejected anywhere — the server simply never merges
--    it, so it falls back to whole-row last-write-wins whenever the two clock
--    sets differ and one device's edit quietly overwrites the other's.
--    `lib/constants.test.ts` checks this array against `CONFLICT_FIELDS`, and
--    reads whichever migration most recently declared it — this one.
--
--    Nothing else about the function changes; it is restated in full because
--    that is the only way to change the array it walks.
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
    'priority', 'reminder_at', 'reminder_repeat', 'done',
    'merged_from', 'merged_into',
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
