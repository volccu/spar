-- 0031 — a reminder is delivered per device, and a reminder time is a real time.
--
-- Bughunt 2026-10-24, owner approved 2026-10-25.
--
-- 1. Per-device deliveries. `reminder_deliveries` (0015) is keyed on the note
--    and was written the moment *any* device accepted an occurrence, so with a
--    phone and a laptop, a push the laptop's service answered 503 was never
--    tried again. This table records each device that took an occurrence;
--    `send-reminders` sends only to the live devices not in it, and writes
--    `reminder_deliveries` once every live device has it, or an hour after it
--    was due while some device has it (`_shared/deliveries.ts`). Rows are
--    removed when the occurrence closes, so it holds only what is in flight.
--    Only the sweep, as the service role, reads or writes it: RLS is on with
--    no policy, and neither client role holds any privilege on it.
--
-- 2. `reminder_at` must be finite. `reminder_occurrence` turns the time into a
--    whole count of periods with `floor(...)::int`, and 'infinity' put there
--    would make `due_reminders` raise for every note of every user, so no
--    reminder would ring until the row was found by hand. The app never writes
--    one; the database now refuses it too. Added NOT VALID and then validated,
--    so an existing bad row stops this migration and is named, rather than
--    being silently grandfathered in.
--
-- Safe to run twice: `if not exists`, and the constraint is dropped first.

create table if not exists public.reminder_device_deliveries (
  note_id     uuid        not null references public.notes (id) on delete cascade,
  endpoint    text        not null,
  owner_id    uuid        not null,
  reminder_at timestamptz not null,
  fired_at    timestamptz not null default now(),
  primary key (note_id, endpoint)
);

alter table public.reminder_device_deliveries enable row level security;
alter table public.reminder_device_deliveries force row level security;

revoke select, insert, update, delete, truncate, references, trigger, maintain
  on table public.reminder_device_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.reminder_device_deliveries to service_role;

alter table public.notes drop constraint if exists notes_reminder_at_finite;
alter table public.notes
  add constraint notes_reminder_at_finite
  check (reminder_at is null or isfinite(reminder_at)) not valid;
alter table public.notes validate constraint notes_reminder_at_finite;
