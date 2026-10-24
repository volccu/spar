-- 0029_push_endpoint_https.sql — a push subscription's endpoint is https.
--
-- Why
-- ---
-- `send-reminders` posts to whatever endpoint a signed-in client stored in
-- `push_subscriptions` (0015 has no CHECK), so a row could point the sender at
-- any address at all (audit 2026-10-10, SEC-3). Every push service a browser
-- hands out — Google, Mozilla, Apple, Microsoft — is https; nothing that is not
-- has any business here.
--
-- Nothing in this repository can write anything else any more:
--   - the web app stores only `PushSubscription.endpoint`, and refuses one that
--     is not https before the upsert (`rowFor` in web/src/store/push.ts);
--   - the self-hosted server refuses it on the way in (server/src/push.ts)
--     and keeps its own table, not this one;
--   - the sender refuses it too and retires the row (`pushEndpointOk` in
--     supabase/functions/_shared/webpush.ts), so this CHECK is the backstop
--     for a row written by some other client, not the only guard.
--
-- How
-- ---
-- Added NOT VALID, then validated as its own statement: the add takes only a
-- brief lock and stops new bad rows at once; the validate then reads the
-- existing ones without blocking writes. **If an existing row is not https,
-- the validate fails and this migration with it** — nothing is deleted on the
-- way. Look first:
--
--   select endpoint, failed_at from public.push_subscriptions
--    where endpoint not like 'https://%';
--
-- A row found there is a device that could never have rung; deleting it is the
-- owner's call, and that device re-subscribes on its next open.
--
-- Safe to run more than once.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'push_subscriptions_endpoint_https'
       and conrelid = 'public.push_subscriptions'::regclass
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_endpoint_https
      check (endpoint like 'https://%') not valid;
  end if;
end
$$;

alter table public.push_subscriptions
  validate constraint push_subscriptions_endpoint_https;
