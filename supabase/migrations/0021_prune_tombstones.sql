-- A permanent delete is remembered for a year, not forever.
--
-- `note_tombstones` (migration 0011) is what stops an offline device with an
-- old copy from resurrecting a note the other device destroyed: the upsert
-- trigger refuses any row a tombstone names. That is the right guard and it
-- stays. What was wrong was that nothing ever let a tombstone go — the table
-- was the one store in the app with no ceiling, read whole by every device on
-- every sync tick and matched per upserted row here, and it can only grow.
--
-- A year past the delete there is no offline device left to guard against: a
-- phone that has not synced in a year is a phone somebody replaced. What a
-- pruned tombstone can no longer prevent is a device restored from a backup
-- older than that bringing a note back — a note returning, not one being
-- lost, and it is the trade. The client drops its own copies on the same
-- horizon (`TOMBSTONE_DAYS` in `web/src/lib/trash.ts`, `pruneTombstones` in
-- `web/src/store/db.ts`); the two numbers must agree.
--
-- Written to be safe to run twice, like every migration here: `create or
-- replace`, and the cron job unscheduled before it is scheduled.

create or replace function public.prune_note_tombstones()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  gone integer;
begin
  delete from public.note_tombstones
   where deleted_at < now() - interval '365 days';
  get diagnostics gone = row_count;
  return gone;
end;
$$;

-- Runs from cron as the database owner; no client session may call it.
revoke all on function public.prune_note_tombstones() from public, anon, authenticated;
grant execute on function public.prune_note_tombstones() to postgres, service_role;

-- Once a day, at a quiet hour. `cron.schedule` on an existing name updates
-- it on recent pg_cron and errors on older ones, so the job is dropped first,
-- the same way 0015 schedules `send-reminders`.
do $$
begin
  perform cron.unschedule('prune-note-tombstones');
exception
  when others then null;
end $$;

select cron.schedule(
  'prune-note-tombstones',
  '41 3 * * *',
  $job$ select public.prune_note_tombstones() $job$
);
