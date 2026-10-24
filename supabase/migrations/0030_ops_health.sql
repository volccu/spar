-- One read-only question the home server's watcher can ask: is the reminder
-- sweep still running, and is the database still answering?
--
-- Review SR-03 (2026-10-13): the server watched the app's web page and nothing
-- else, so a stopped `send-reminders` job or a broken database could go
-- unnoticed for days. The watcher (`deploy/ops/spar-watch.sh`) calls this every
-- few minutes with the service key and mails when the newest successful run is
-- too old. It reads two pg_cron and pg_net tables a client session cannot see,
-- hence `security definer`; it writes nothing.
--
-- Safe to run twice: `create or replace`, and the grants are idempotent.

create or replace function public.ops_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'now', now(),
    'reminders_last_ok', (
      select max(d.end_time)
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
       where j.jobname = 'send-reminders'
         and d.status = 'succeeded'
    ),
    'reminders_failed_last_hour', (
      select count(*)
        from cron.job_run_details d
        join cron.job j on j.jobid = d.jobid
       where j.jobname = 'send-reminders'
         and d.status = 'failed'
         and d.start_time > now() - interval '1 hour'
    ),
    'push_http_errors_last_hour', (
      select count(*)
        from net._http_response r
       where r.created > now() - interval '1 hour'
         and (r.status_code is null or r.status_code >= 400)
    )
  );
$$;

-- Only the server's watcher, holding the service key, may ask.
revoke all on function public.ops_health() from public, anon, authenticated;
grant execute on function public.ops_health() to postgres, service_role;
