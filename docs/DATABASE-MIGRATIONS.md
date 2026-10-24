# Migrations: how to push, and the trap that eats one

Read this before running anything that writes to the Supabase project. It is short
because there is only one rule and one trap.

## The rule

**Never run `supabase db push` directly. Run `npm run db:push`.**

```bash
npm run db:push          # push, then prove the objects really landed
npm run db:verify        # just the proof, against the linked (remote) project
npm run db:verify:local  # the same, against the local dev stack
```

`npm run db:push` is `supabase db push` followed by `scripts/verify-migrations.mjs`.
The second half is not decoration. Read on.

## The trap

On **2026-08-17**, `npx supabase db push --yes` (CLI **2.109.1**, a hosted
project on Postgres 17.6) did this:

- printed `Finished supabase db push.` and exited 0;
- wrote a `supabase_migrations.schema_migrations` row for migration `0017`, with
  all four of its statements stored in the row;
- **never created the function or the trigger that migration defines.**

Buried in the output, repeated twice, was:

```
event loop error: Error: Failed to read certificate file
'/workspace/supabase/.temp/pgdelta/pgdelta-target-ca.crt': ENOENT: no such file or directory
    at getCertValue (.../@supabase/pg-delta/1.0.0-alpha.27/dist/core/plan/ssl-config.js:44:27)
    at async parseSslConfig (.../ssl-config.js:62:23)
    at async createManagedPool (.../postgres-config.js:340:23)
main worker has been destroyed
```

This is the worst possible failure shape. Both sides now agree the migration is
applied, so nothing will ever retry it. `supabase migration list` looks perfect.
The change is simply absent from the schema, forever, and the first sign of it is
a bug in the app months later.

It was fixed by hand with
`npx supabase db query --linked --file <one-statement-file>`, one statement at a
time. Two things about that command are worth remembering:

- **`db query` talks to the LOCAL database unless you pass `--linked`.** Without
  the flag you will "fix" a database nobody is using.
- **`db query` refuses more than one statement per file** — it goes through a
  prepared statement, so you get
  `cannot insert multiple commands into a prepared statement`. Split the file.

## The second shape: applied, then hung

On **2026-08-27**, pushing migration `0019` (CLI 2.114.0) did something different
and just as misleading. `supabase db push` **applied the migration correctly** —
the function body really was replaced — and then **never returned**. Because
`npm run db:push` is `supabase db push && npm run db:verify`, the `&&` never
fired, so the verification half of the command silently did not run. The job had
to be killed after seven minutes.

What that leaves behind looks identical to the 2026-08-17 trap from the outside:
a `schema_migrations` row for `0019`, and a command that did not print success.
The two cases want opposite responses — one needs re-applying by hand, the other
is already done and re-applying is at best noise. **Nothing about the CLI's
output distinguishes them.** Only reading the object back does.

So after a push that does not exit cleanly:

```bash
# Did the change actually land? Read the definition, do not infer it.
npx supabase db query --linked --file <a file holding one select>
#   select pg_get_functiondef(p.oid), p.prosecdef, p.proconfig::text, p.proacl::text
#     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
#    where n.nspname = 'public' and p.proname = '<the function>';
npm run db:verify   # then this, separately, since the && never reached it
```

`db:verify` alone is **not** the proof for a `create or replace`. It checks that
every object exists, and a replaced function existed before the migration too, so
it passes whether or not the new body landed. It catches an object that was never
created; it cannot catch one that was never changed.

## What caused the certificate error

Confirmed upstream, [supabase/cli#5921][issue] and its fix [supabase/cli#5929][pr]:

> `exportCatalog` writes the CA bundle to `<cwd>/supabase/.temp/pgdelta/` and
> points `sslrootcert` at `/workspace/…` inside the container, but never mounted
> `cwd` to `/workspace` like every other pg-delta call site does. Container looks
> for a file that was never shared with it.

So the cert is written correctly **on the host** — you will find
`supabase/.temp/pgdelta/pgdelta-target-ca.crt` sitting right there after a failed
run — but the edge-runtime container that pg-delta runs inside was never given the
project directory, so the path baked into the connection URL resolves to nothing.
Nothing about the local machine causes it; it happens on every push against a
hosted project on an affected CLI.

The mount was added on 2026-07-22 and first shipped in CLI **v2.110.0**
(2026-07-27). This repo now pins **`supabase` 2.114.0** exactly, in the root
`package.json`, above that line. If you ever loosen the pin, do not go back below
2.110.0.

## What is *not* explained

The certificate crash is understood. **Why the same run also recorded `0017` as
applied without executing it is not conclusively determined.** The upstream issue
describes the migration applying normally and only the post-push catalog-cache
step failing, which is not what happened here. Candidates, none confirmed:

- the crashed pg-delta worker is not treated as fatal, and some later CLI step
  marks the batch complete regardless;
- a statement-batch / pipelining fault against the pooler
  (`aws-0-eu-north-1.pooler.supabase.com:5432`, session mode) where the DDL and
  the history insert did not share a transaction.

Reproducing it would mean pushing to the live project, which is not worth the
risk. That uncertainty is exactly why the verifier below exists: it does not care
*why* a migration went missing, only that it did.

## The guard

`scripts/verify-migrations.mjs` treats a migration history row as a **claim** and
checks it against the catalogue.

1. It reads every file in `supabase/migrations/` in version order, stripping
   comments, string literals and `$$…$$` bodies so nothing inside a function can
   masquerade as a statement.
2. It collects what each file creates — `create [or replace] function`,
   `create trigger`, `create table` (including its inline columns),
   `create index`, `create view`, `create policy`, `create type`, `create schema`,
   `alter table … add column` — and cancels anything a later migration drops or
   renames.
3. It asks the live database, in one `select`, what actually exists.
4. It reports every object that an **applied** migration should have created and
   that is not there, and exits 1.

Objects from migrations the database has not applied yet are skipped and counted,
not reported as failures. `--all` checks every file regardless.

It is a smoke detector, not a schema differ. It understands the SQL shapes this
repo actually writes and nothing more. If it ever reports something wrongly,
**teach it the shape — do not delete the check.**

### Evidence it works

Both directions were exercised on 2026-08-17.

Against the local stack, after dropping a real index that migration `0001`
creates:

```
Verifying 133 objects from 17 migrations against the local database...
MISSING: 1 object(s) that an applied migration should have created.
  migration 0001 is recorded as applied, but these do not exist:
    - index public.notes_status_type_idx
exit=1
```

Against the linked project, with a fabricated migration file claiming a function,
a trigger and a column that were never created — the exact shape of the `0017`
incident:

```
MISSING: 3 object(s) that an applied migration should have created.
  migration 0016 is recorded as applied, but these do not exist:
    - function public.selftest_never_created
    - trigger public.notes.trg_selftest_never_created
    - column public.notes.selftest_never_added
exit=1
```

With the real tree, both databases pass:

```
Verifying 133 objects from 17 migrations against the linked (remote) database...
OK — every object from every applied migration exists.
exit=0
```

## If the guard fires

1. Do **not** `migration repair`. The history row is not the problem; the missing
   schema is.
2. Re-apply just the missing statements by hand:
   `npx supabase db query --linked --file <one-statement-file>` — one statement
   per file, `--linked` every time.
3. Re-run `npm run db:verify` until it is clean.
4. Leave the history row alone. Every statement in these migrations is written to
   be safe to run twice (`create or replace`, `drop … if exists` before
   `create trigger`, `if not exists` on indexes and columns) — keep it that way,
   because hand-repair depends on it.

[issue]: https://github.com/supabase/cli/issues/5921
[pr]: https://github.com/supabase/cli/pull/5929
