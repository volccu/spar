-- 0025_sync_contract_repairs.sql — what the conformance suite found.
--
-- `docs/sync-contract.md` writes down what the web client relies on a server
-- to do, and `conformance/` holds a backend to it. Run against a fresh local
-- stack, the Supabase backend missed the contract in seven places (§16, D1–D7).
-- Four of them are a few lines of SQL each and are fixed here; three are left,
-- each for a reason given below.
--
--   D4  a fresh project cannot reach four tables        fixed (section 1)
--   D2  an upsert cannot empty a note's body             fixed (section 2)
--   D3  a re-sent stamp can move updated_at backwards    fixed (section 3)
--   D5  keep_id is unique across every user              fixed (section 4)
--   D1  a delete signal reaches other users              left
--   D6  another user's id is refused as 42501            left
--   D7  files outlive their note                         left
--
-- Nothing here rewrites a row. The one statement that reads existing data is
-- the new unique index in section 4, and it cannot fail on any table the old
-- one allowed (the reasoning is there). `raw_content` is not touched.
--
-- Every statement is safe to run twice, like every migration here, so a push
-- that half-lands can be repaired by hand one statement at a time
-- (docs/DATABASE-MIGRATIONS.md).
--
-- What is left, and why
-- ---------------------
-- D1. Supabase Realtime does not apply row level security to DELETE events, so
-- a subscriber to `notes` or `folders` is told the primary key of a row some
-- other account permanently deleted. The only lever SQL has is the publication:
-- `publish = 'insert, update'` would stop the leak. It would also stop the
-- signal the contract requires the *owner's* other devices to get (§15: "A
-- permanent delete MUST signal them too"), and the client does use it —
-- `useSync.ts` binds `event: "*"` on both tables and wakes a sync tick on any
-- signal, which is how a note destroyed on the laptop leaves the phone at once
-- rather than on the 20-second backstop. The tombstone that tick pulls is not
-- published and the client does not listen for one, so moving the signal there
-- is a client change as well as a migration. What leaks is a random UUID and
-- never a row's contents; it stays until the signal can be moved.
--
-- D6. An upsert naming another account's note id fails as `42501` (the
-- update half's RLS check) where the contract would like a row refusal. Turning
-- it into one means a `security definer` lookup across every account's notes on
-- every insert — the hottest write path there is — to answer a case that cannot
-- happen in practice: note ids are random UUIDs the client makes.
--
-- D7. A note's files stay in storage when the note is destroyed. Removing them
-- from SQL means deleting `storage.objects` rows, which Supabase forbids: its
-- `protect_objects_delete` trigger raises "Direct deletion from storage tables
-- is not allowed. Use the Storage API instead." — rightly, since the row is
-- only the index of bytes that live in the object store, and deleting it would
-- orphan them rather than free them. The client removes them through the
-- Storage API after a confirmed delete and retries a removal that failed.


-- ----------------------------------------------------------------------------
-- 1. D4 — the grants four tables never had.
--
-- `folders` (0010), `prefs` (0014), `push_subscriptions` and
-- `reminder_deliveries` (0015) were created without a single `grant`. They
-- worked because the project they were written against hands every new table
-- in `public` to the API roles by default — the same default 0024 found handing
-- them to `anon`. A project created since 2026-05-30 does not: its new tables
-- give `authenticated` and `service_role` only TRUNCATE, REFERENCES, TRIGGER
-- and MAINTAIN, and nothing that reads or writes a row. On such a project every
-- canvas, the folder shelf, the Inbox date and push registration fail for the
-- signed-in user, the combined pull fails with them (it reads `folders` and
-- `prefs` as the caller), and the reminder sweep can neither find a device nor
-- record a delivery. The conformance stack papered over it with the legacy
-- `SUPABASE_API_AUTO_EXPOSE_NEW_TABLES=true`, which the CLI removes on
-- 2026-10-30.
--
-- Each grant is what the code actually does, verb by verb:
--
--   folders             the client pulls and upserts a canvas
--                       (`canvasSync.ts`); it never deletes one — a canvas goes
--                       with its note, by the foreign key's cascade inside
--                       `permanently_delete_note`, which needs no grant.
--   prefs               the client reads its row and upserts it
--                       (`boardSync.ts`); there is no delete policy, because a
--                       row of preferences is only ever replaced (0014).
--   push_subscriptions  the client upserts its device and deletes it when
--                       ringing is turned off (`push.ts`); all four.
--   reminder_deliveries the client never touches it. Only the sweep writes it.
--
-- `service_role` is the sweep (`send-reminders` reads subscriptions, retires
-- dead ones and upserts deliveries) and every operator's tool, so it gets the
-- four row verbs on all four tables, as 0001 and 0011 gave it on the others.
--
-- On the hosted project every one of these is already held, through the old
-- default, so there this changes nothing; the privileges are named, not `all`,
-- so `verify-migrations.mjs` checks each one (see 0024 for why that matters).
-- Nothing is granted to `anon`, and the four revokes restate 0024 for these
-- tables so that this file, read alone, says who holds what.
grant select, insert, update on table public.folders to authenticated;
grant select, insert, update, delete on table public.folders to service_role;

grant select, insert, update on table public.prefs to authenticated;
grant select, insert, update, delete on table public.prefs to service_role;

grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

grant select, insert, update, delete on table public.reminder_deliveries to service_role;

revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.folders from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.prefs from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.push_subscriptions from anon;
revoke select, insert, update, delete, truncate, references, trigger, maintain on table public.reminder_deliveries from anon;


-- ----------------------------------------------------------------------------
-- 2. D2 — an upsert may empty a note's body.
--
-- 0017's trigger fills an empty body from the capture on insert, and says
-- plainly that it must not on update: "an empty body on update is the user
-- clearing the note". But the client writes every note as an upsert —
-- `insert … on conflict (id) do update set body = excluded.body, …` — and a
-- BEFORE INSERT trigger runs on the insert half of that statement *before*
-- Postgres knows the id is taken. The row it modified is what `excluded`
-- holds. So the user empties a note, the upload carries `body: ''` under a new
-- body clock, the trigger turns `''` into the original capture, the conflict
-- turns the insert into an update, and the update stores the capture under the
-- user's clock. The device that emptied the note keeps `''` (the clock is
-- equal, so it does not take the server's value); every other device pulls the
-- capture back as the newest body; the two disagree until the next edit.
--
-- The fix is to ask the question the trigger could not: is this really the
-- note's first row? A body that was sent — the case on every capture, since
-- the client writes `body` as the capture itself — is returned untouched
-- without a lookup, so the ordinary insert costs nothing more. Only an empty
-- or missing body looks the id up:
--
--   * no row with this id: a real first insert. `''` or null becomes the
--     capture, exactly as 0017 did, so an insert from the SQL editor, a
--     restore or an import script that leaves the body out still reads.
--   * a row exists: the insert half of an upsert that is about to update it.
--     `''` is the user emptying the note and is left alone, for the merge
--     trigger to decide by its clock like any other value. A null body —
--     which no client sends, and which the column cannot hold — means the body
--     was not said, so it keeps the one already stored rather than being
--     replaced by the capture (which is what 0017 did to it, overwriting the
--     user's edits).
--
-- The lookup runs as the caller (`security invoker`, as 0017), so row level
-- security scopes it to the caller's own notes. An id belonging to someone
-- else is invisible here, the body is defaulted, and the upsert is then
-- refused by the update half's policy exactly as before — nothing about
-- another account can be learned from this trigger. Two devices inserting the
-- same new id at the same instant could both miss the other's row; the second
-- then stores the capture for an empty body, which is the old behaviour in a
-- window no real client produces (ids are random, and one device makes each).
create or replace function public.body_defaults_to_capture()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stored text;
begin
  if new.body is not null and new.body <> '' then
    return new;
  end if;

  select n.body into stored from public.notes n where n.id = new.id;
  if found then
    if new.body is null then
      new.body = stored;
    end if;
    return new;
  end if;

  new.body = coalesce(new.raw_content, '');
  return new;
end;
$$;

comment on function public.body_defaults_to_capture() is
  'Fills an empty or missing body from raw_content on a note''s first insert, so "body defaults to raw_content" holds. Not on the insert half of an upsert that updates an existing note (0025): there an empty body is the user clearing the note, and a missing one keeps the stored body.';

-- The trigger itself (0017) already calls this function; it is restated so
-- the file is complete on its own and a hand repair has one place to look.
drop trigger if exists trg_body_defaults_to_capture on public.notes;
create trigger trg_body_defaults_to_capture
  before insert on public.notes
  for each row
  execute function public.body_defaults_to_capture();


-- ----------------------------------------------------------------------------
-- 3. D3 — `updated_at` never moves backwards, a re-sent stamp included.
--
-- 0013 gave a sent stamp a floor: one at or behind the stored one becomes the
-- stored one plus a microsecond. It missed the one case its own first branch
-- does not reach — a write whose stamp *equals* the stored one, which is what
-- the outbox re-sending a note unchanged looks like, and what a narrow patch
-- naming no stamp looks like. That case still took `now()` bare. When the
-- stored stamp is ahead of the server's clock — written by a device whose
-- clock runs fast, which `stampForUpload` only ever pushes *later* — `now()`
-- is earlier, the note's stamp moves backwards, and every device whose pull
-- cursor had already passed the old stamp never sees the row again. That is
-- the exact failure 0013 was written to rule out.
--
-- The same floor now covers it: the server's clock, or the stored stamp plus
-- a microsecond, whichever is later. Every accepted update therefore leaves
-- `updated_at` strictly greater than it found it, and equal to the sent stamp
-- whenever that is later — the rule in §5 of the contract. Nothing else about
-- 0012/0013's reasoning changes: a writer that names a later version is still
-- believed exactly as sent.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is distinct from old.updated_at then
    if new.updated_at <= old.updated_at then
      new.updated_at = old.updated_at + interval '1 microsecond';
    end if;
    return new;
  end if;
  new.updated_at = greatest(now(), old.updated_at + interval '1 microsecond');
  return new;
end; $$;

-- Already the trigger's function since 0003; restated for the same reason as
-- the one above.
drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at
  before update on public.notes
  for each row execute function public.touch_updated_at();


-- ----------------------------------------------------------------------------
-- 4. D5 — `keep_id` is unique per account, not across all of them.
--
-- 0001 declared `keep_id text unique`, from the days when the table held one
-- person's archive and nobody else's. With owners (0007) that uniqueness spans
-- every account: two people importing Keep notes that share an id collide, the
-- second import's row is refused, and its owner learns that the id exists in
-- somebody else's archive. The importer's question was always "have *I*
-- imported this already", so the key is `(owner_id, keep_id)`.
--
-- Why this cannot fail on existing data: any set of rows with no two equal
-- `keep_id`s also has no two equal `(owner_id, keep_id)` pairs — adding a
-- column to a unique key can only make it more unique. So every table the old
-- constraint accepted, the owner's included, is accepted by the new index,
-- whatever the number of accounts. Nulls stay distinct, as before: a note that
-- was not imported carries none, and any number of those may exist.
--
-- The new index is built before the old uniqueness goes, so there is no moment
-- with neither. The old one is found by what it is — a unique constraint, or a
-- bare unique index, on `keep_id` alone — rather than by the name 0001's
-- inline `unique` produced locally (`notes_keep_id_key`), because the hosted
-- project cannot be read from here and a `drop constraint if exists` under the
-- wrong name would succeed without dropping anything, leaving the bug in place
-- behind a migration that says it is fixed. The composite index cannot match:
-- it is on two columns.
create unique index if not exists notes_owner_id_keep_id_key
  on public.notes (owner_id, keep_id);

do $$
declare
  keep smallint;
  hit  record;
begin
  select a.attnum into keep
    from pg_attribute a
   where a.attrelid = 'public.notes'::regclass
     and a.attname = 'keep_id'
     and not a.attisdropped;
  if keep is null then
    return;
  end if;

  for hit in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.notes'::regclass
       and c.contype = 'u'
       and c.conkey = array[keep]
  loop
    execute format('alter table public.notes drop constraint if exists %I', hit.conname);
  end loop;

  for hit in
    select ic.relname
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
     where i.indrelid = 'public.notes'::regclass
       and i.indisunique
       and i.indexprs is null
       and i.indnkeyatts = 1
       and i.indkey[0] = keep
       and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
  loop
    execute format('drop index if exists public.%I', hit.relname);
  end loop;
end $$;
