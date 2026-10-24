-- 0004_realtime.sql — let the server push note changes to other devices.
--
-- Without this the app still syncs (a local edit uploads within a second, and
-- the other device re-syncs whenever you switch to it). With it, the other
-- device is told the instant a row changes, so notes appear without switching
-- away and back.
--
-- Safe to run more than once.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;

-- Realtime respects row level security, so the existing policy still applies:
-- only a signed-in user is told anything, and only about rows they can read.
alter table public.notes replica identity full;
