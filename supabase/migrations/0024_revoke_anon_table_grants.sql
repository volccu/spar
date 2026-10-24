-- `anon` gives back every privilege it holds on the app's tables.
--
-- What was found
-- --------------
-- The first live run of the rewritten `scripts/verify-migrations.mjs`, on
-- 2026-09-10, read the table ACLs back and found that `anon` — the role a
-- request carries when it has no session at all — holds DELETE, INSERT,
-- MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE on seven tables:
-- `notes`, `interactions`, `folders`, `note_tombstones`, `prefs`,
-- `push_subscriptions` and `reminder_deliveries`.
--
-- Nothing in this folder granted it. Every grant here is written `to
-- authenticated, service_role`, and 0001 says why: "newer Supabase projects
-- default to NOT auto-exposing new tables". This project is not one of those.
-- Its default privileges in `public` hand every new table to `anon` as well,
-- so each migration that created a table also, invisibly, opened it to anyone
-- holding the publishable key — and the old verifier checked objects by name
-- and could not see a grant at all.
--
-- Why it is closed although nothing was reachable
-- -----------------------------------------------
-- Row level security is enabled and forced on all seven and no policy names
-- `anon`, so no row could be read or written through PostgREST without a
-- session. That is why this is hardening and not an incident. But RLS governs
-- rows and nothing else: TRUNCATE is not subject to it at all, and MAINTAIN,
-- TRIGGER and REFERENCES are table-level too. The only thing standing between
-- them and an anonymous caller was that PostgREST happens to expose no verb for
-- them. A privilege no part of the app uses is surface, and the app does not
-- use this one anywhere: sync, realtime, the capability probes and push
-- subscriptions all run behind a session (`useSync` is enabled on one), the
-- edge functions use `service_role`, and an anonymous upsert into
-- `push_subscriptions` was already refused by RLS before this — it now fails
-- one step earlier, with the same outcome.
--
-- What this deliberately does not do
-- ----------------------------------
-- It does not narrow `authenticated`, which also holds TRUNCATE and the other
-- table-level privileges through the same defaults. That is the app's own
-- role, and deciding what it keeps is a separate decision from taking a role
-- the app never uses out of the picture.
--
-- It does not `alter default privileges`. The defaults belong to the platform,
-- and changing them reaches every future table in `public` by a route no
-- migration here would show. The guard against a new table arriving open is
-- the verifier, which asserts that no table a migration creates is readable or
-- truncatable by `anon` — which is how this was found.
--
-- Every statement is safe to run twice: revoking a privilege a role does not
-- hold is a no-op. The proof that it landed is `npm run db:verify` coming back
-- without its seven anon-grant failures, not the push's exit code.

-- The privileges are named rather than written as `all`. They mean the same
-- thing — these eight are every table privilege Postgres 17 has, and exactly
-- the eight the catalogue showed `anon` holding — but `verify-migrations.mjs`
-- expands a named list into what it then checks for, and skips a table's
-- grants entirely on `all`. Written as `all`, the proof this migration asks for
-- would have passed without testing anything.

revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.notes from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.interactions from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.folders from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.note_tombstones from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.prefs from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.push_subscriptions from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.reminder_deliveries from anon;
