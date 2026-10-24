-- 0015_push.sql — the half of a reminder that actually wakes you up.
--
-- `reminder_at` has been a real field on the note since Phase 2, riding the
-- same outbox and per-field clock as every other edit. What has never existed
-- is delivery: `lib/reminders.ts` says so in its own header, and the note has
-- been telling the user "reminds in 3 hours" while nothing anywhere was ever
-- going to fire. This migration is the missing half, and it is deliberately
-- the smallest shape that works.
--
-- Why a server at all: the Notification Triggers API never shipped, so a web
-- app cannot schedule a local alarm that survives the tab closing. The only
-- delivery route that works on an installed Android PWA is Web Push, which
-- means a subscription per device, a signing key, and something server-side
-- awake at the moment the reminder is due (SPEC §10).
--
-- Why nothing here touches `notes`: delivery is bookkeeping, not content. A
-- column on the note would have to be argued about in `CONFLICT_FIELDS`, would
-- move `updated_at`, and would risk dragging a note to the top of a board
-- ordered on the last edit — for a fact the user did not create. A separate
-- table keeps the sync path exactly as it is.
--
-- Safe to run more than once.

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
-- pg_cron is the thing that is awake when the phone is not; pg_net is how it
-- reaches the edge function that can actually do the crypto. Neither can live
-- in the app: signing a push payload needs ECDH, HKDF and AES-GCM, which is a
-- reasonable thing to ask of Deno and not of Postgres.
-- pg_net puts its functions in a `net` schema of its own whatever schema the
-- extension is created in, so the sweep below calls `net.http_post`. Naming it
-- `extensions.http_post` — which is where several Supabase snippets put it —
-- fails at run time, not at create time: the job schedules happily and then
-- errors once a minute, forever, where only cron.job_run_details can see it.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- One row per device that has agreed to be woken
-- ----------------------------------------------------------------------------
-- The endpoint is the identity: the browser mints it, it is already unique,
-- and re-subscribing on the same device returns the same one — so an upsert on
-- it is the whole of "keep this device registered" with no client-side id to
-- keep in step. `p256dh` and `auth` are the browser's own encryption keys for
-- that endpoint; without them a push can be delivered but not decrypted.
--
-- `failed_at` is how a dead endpoint is retired. A browser that has been
-- uninstalled, cleared, or simply left alone long enough answers 404 or 410
-- forever, and a subscription list that only ever grows means every reminder
-- costs a round trip to every phone the user has ever opened the app on.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  seen_at    timestamptz not null default now(),
  failed_at  timestamptz
);

create index if not exists push_subscriptions_owner_idx
  on public.push_subscriptions (owner_id)
  where failed_at is null;

-- ----------------------------------------------------------------------------
-- What has already been sent
-- ----------------------------------------------------------------------------
-- Keyed on the note, but carrying the *instant* that was delivered. That is
-- the difference between "this note has been reminded about" and "this
-- reminder has been sent": moving a reminder from Tuesday to Thursday must
-- fire again on Thursday, and a note whose reminder is unchanged must never
-- fire twice however many times the sweep runs. Comparing the stored instant
-- to the note's current `reminder_at` answers both, and needs no extra state.
create table if not exists public.reminder_deliveries (
  note_id     uuid primary key references public.notes (id) on delete cascade,
  owner_id    uuid not null default auth.uid(),
  reminder_at timestamptz not null,
  fired_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Who may touch what
-- ----------------------------------------------------------------------------
-- The same boundary as notes (0007), folders (0010) and prefs (0014). The
-- sweep runs as the service role and bypasses all of this by design — it has
-- to read across the one account to find what is due.
--
-- A subscription may be deleted by its owner, unlike a row of prefs: turning
-- notifications off on this device is a real thing to want, and it is the one
-- action here that is not a replacement.
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
alter table public.reminder_deliveries enable row level security;
alter table public.reminder_deliveries force row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;

create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Deliveries are readable by their owner and written only by the sweep. There
-- is no client-facing reason to insert one: claiming a reminder was delivered
-- when it was not is the one lie this table exists to prevent.
drop policy if exists "reminder_deliveries_select_own" on public.reminder_deliveries;

create policy "reminder_deliveries_select_own"
  on public.reminder_deliveries for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- ----------------------------------------------------------------------------
-- What is due
-- ----------------------------------------------------------------------------
-- One definition of "due", so the sweep and any future surface agree. A
-- reminder is due when it has passed, the note is still active (a trashed or
-- archived note has been dealt with, and waking someone for it is worse than
-- silence), and nothing has already been sent for that exact instant.
--
-- The lower bound matters: without it, switching the sweep on would fire every
-- reminder ever set in the past, all at once. A reminder more than a day stale
-- has missed its moment and is not worth a notification.
create or replace function public.due_reminders(p_grace interval default interval '1 day')
returns table (
  note_id     uuid,
  owner_id    uuid,
  reminder_at timestamptz,
  body        text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select n.id, n.owner_id, n.reminder_at, n.body
    from public.notes n
    left join public.reminder_deliveries d on d.note_id = n.id
   where n.reminder_at is not null
     and n.reminder_at <= now()
     and n.reminder_at > now() - p_grace
     and coalesce(n.status, 'active') = 'active'
     and (d.note_id is null or d.reminder_at is distinct from n.reminder_at)
$$;

-- Only the sweep may ask. It runs as `service_role`; nobody signed in through
-- the app has any reason to enumerate what is about to fire, and a security
-- definer function readable by `authenticated` would read across accounts.
revoke all on function public.due_reminders(interval) from public, anon, authenticated;
grant execute on function public.due_reminders(interval) to service_role;

-- ----------------------------------------------------------------------------
-- The sweep
-- ----------------------------------------------------------------------------
-- Every minute, because a reminder set for 09:00 that arrives at 09:04 is a
-- reminder that was late, and a minute is the coarsest tick nobody notices.
--
-- Both the URL and the token are read from Vault rather than written here: this
-- file is committed, and a credential in git is a credential on the internet.
-- Create them once, out of band:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-reminders',
--                              'reminder_fn_url');
--   select vault.create_secret('<CRON_SECRET>', 'reminder_fn_key');
--
-- `reminder_fn_key` is the function's own `CRON_SECRET`, not the service role
-- key. A scheduled job's arguments are readable by anything that can read the
-- job, so what sits there should be the least powerful thing that works — and
-- this token's entire power is to make already-due reminders go out. The
-- function checks it as `x-cron-secret`; its `verify_jwt` is off, because the
-- only alternative token on offer is the anon key that ships in the client
-- bundle and would therefore authenticate every visitor.
--
-- The job is dropped and recreated so this migration stays re-runnable.
do $$
begin
  perform cron.unschedule('send-reminders');
exception
  when others then null;
end $$;

select cron.schedule(
  'send-reminders',
  '* * * * *',
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_fn_url'),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_fn_key')
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $job$
);
