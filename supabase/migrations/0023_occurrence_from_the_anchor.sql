-- 0023 — every step is measured from the anchor, and the clock is pinned to UTC.
--
-- Migration 0020 gave a reminder a rule and kept `reminder_at` as the anchor it
-- is measured from, so that the server still never writes a note. The whole of
-- that rests on one promise: `reminder_occurrence` here and `lastOccurrence` in
-- `web/src/lib/reminders.ts` project the **same** series. Two projections of one
-- series is exactly the thing that can drift, 0020 said so itself, and it then
-- drifted — in the two ways below, both of which were live from the day it was
-- pushed until this migration.
--
-- The failure a drift makes is silent and is the one the feature exists to
-- prevent: the open note says "reminds in 3 days" and the phone rings tonight,
-- or rings twice. Nothing errors, nothing is logged, and the only witness is a
-- person who stopped trusting the reminders.
--
-- Neither fault is in the app. `lib/reminders.ts` was right both times; this
-- file is what moves to meet it.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. The fault: the series walked off its own anchor.
--
--    0020 ended with
--
--        at := p_anchor + (n * step);
--        while at + step <= p_now loop at := at + step; ... end loop;
--
--    and that second line is the bug. The first line is right — `n` whole
--    periods on **from the anchor** — and the loop then throws the anchor away
--    and steps from wherever it has got to. For a day and a week that is the
--    same arithmetic either way. For a month it is not, because
--    `interval '1 month'` **clamps**: 31 January + 1 month is 28 February,
--    and a step taken from *that* lands on 28 March. The day-of-month the user
--    chose is lost at the first short month and never comes back.
--
--    Worked, for `reminder_at = 2026-01-31T09:00:00Z`, monthly:
--
--        from the anchor (what the app shows)   from the clamped date (what rang)
--        2026-02-28  ✓                          2026-02-28  ✓
--        2026-03-31                             2026-03-28   ← a day early, twice
--        2026-04-30                             2026-04-28
--        2026-05-31                             2026-05-28
--
--    On 28 March the sweep fired for an occurrence the app did not believe in;
--    on 31 March it fired again, for the one it did. It recurs for the life of
--    the note and it recurs on every anchor falling on the 29th, 30th or 31st.
--    An audit comparing 41,877 (anchor, rule, now) triples against a real
--    Postgres found 46 divergences under a UTC session, every one of them
--    monthly and every one of them an anchor at the end of a month.
--
--    The second half of the same fault is what the loop does **not** have. The
--    TypeScript corrects its estimate in both directions — down while the
--    projected instant is still in the future, up while the next one has
--    already passed — and 0020 only ever corrects upward. An over-count from
--    `age()` therefore stood, and the function could hand back an instant in
--    the future, which breaks its own stated contract ("the latest one that is
--    not in the future") and would have `due_reminders` compare a future
--    occurrence against `now()` and quietly find nothing due.
--
--    The fix is not a patch on the loop. It is `periodsSince` from
--    `lib/reminders.ts`, said in plpgsql, statement for statement: an estimate,
--    a clamp at zero, a bounded walk down, a bounded walk up, and **one**
--    expression that turns a count into an instant — `p_anchor + (n * step)` —
--    used for every comparison inside the loops as well as for the answer, so
--    there is no second way to compute an occurrence that could disagree with
--    the first.
--
--    `age()` goes with it. It was the estimate for a month and it borrows —
--    from an anchor on the 31st it reports 0 months elapsed on the 28th of the
--    next month — which is why 0020 needed to step on at all. The client
--    estimates with a plain count of month boundaries (`monthsBetween`), so
--    that is what this counts now: same estimate, same corrections, same
--    bounds. Mirroring is the point. A cleverer estimate here would be a
--    second algorithm to keep in step with the first.
--
--    Both loops stay bounded at four turns, the same four the client allows,
--    because nothing may hang the sweep and a series that cannot be projected
--    must cost a wrong answer rather than a stuck cron job. Four is generous:
--    a fixed period needs none, and a month needs at most one.
--
--    **No drop, and deliberately so.** The signature and the return type are
--    unchanged, so `create or replace` is enough, and a drop would open two
--    windows for nothing. The small one: the sweep runs every minute, and a
--    drop-then-create leaves a minute in which `due_reminders` — which calls
--    this — raises instead of returning, costing one sweep (nothing is lost;
--    the reminder is still due next minute). The large one: Postgres does not
--    record a dependency from one function's *string* body to another, so
--    dropping this would succeed silently and leave `due_reminders` calling a
--    function that no longer exists, with nothing in the catalogue to warn
--    anybody. Replacing keeps the call intact and keeps the ACL.
--
--    Everything else in the header is restated verbatim because a
--    `create or replace` that omits a `SET` clause **silently drops it**:
--    leaving `set search_path` off here would hand the function back its
--    search-path-injection surface, which 0008 closed deliberately. `stable`
--    is restated for 0020's own reason — calendar arithmetic on a timestamptz
--    is done in a session zone, so claiming immutability would licence the
--    planner to reuse a result across zones. It is now *also* true that the
--    zone is pinned, which does not make the function immutable: `now()` is
--    still passed in by the caller, and the answer still depends on it.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 2. The zone, which was never anybody's decision.
--
--    `timestamptz + interval '1 day'` is **calendar** arithmetic performed in
--    the session's own time zone: Postgres converts to local time, adds a day
--    to the date field, and converts back. In UTC that is 24 hours. In a zone
--    that keeps summer time it is 23 or 25 hours twice a year — and a month is
--    clamped against the local calendar, so even the *day* an occurrence falls
--    on depends on the zone the session happens to be in.
--
--    `lib/reminders.ts` does its month arithmetic in UTC and says why: "the
--    sweep's session is UTC, so UTC is what makes this function agree with
--    `reminder_occurrence`". That was a statement about how the database
--    happened to be configured, made by a file that cannot see the database.
--    Nothing enforced it. The same 41,877-triple sweep run under
--    `Europe/Helsinki` — the owner's own zone, and the obvious value for
--    anybody to set — diverged in **12,079** cases, across all three rules,
--    which is two orders of magnitude worse than the bug in section 1.
--
--    So the agreement stops being a coincidence and becomes a property of the
--    function: `set timezone = 'UTC'`, through the same function-local `SET`
--    mechanism `search_path` already uses, applied on entry and restored on
--    exit. It costs nothing — both functions already carry a `SET` clause, so
--    neither was inlinable and neither becomes less so — and it means the
--    projection is the same whoever calls it, from whatever session, forever.
--
--    `due_reminders` takes it too, and not only for tidiness: its own
--    `now() - p_grace` is calendar arithmetic in the session zone, so the
--    grace window was itself 23 or 25 hours wide twice a year in a summer-time
--    zone.
--
--    **Pinning UTC pins the DST behaviour with it, and that is deliberate.**
--    A day is 24 hours and a week is 7 of those, measured on the instant, so a
--    daily reminder set for 09:00 in Helsinki rings at 10:00 (or 08:00) for
--    half the year, until the next time it is set. That is what SPEC §10a
--    already promises and what the app already shows; making it *true* is an
--    improvement on it being true only while nobody touched the database's
--    zone.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 2b. Correcting 0020's own sentence about a month.
--
--     0020 says: "A month is `interval '1 month'`, which is calendar
--     arithmetic, so the 31st clamps to the 28th in February and back again in
--     March." Both halves need repair.
--
--     It was not back again in March — that is precisely the bug in section 1,
--     and the comment described the intent while the code below it did
--     something else. That half is now true.
--
--     And *whose* calendar was left unsaid. With the zone pinned it is UTC's,
--     which is not the calendar the user set the reminder against. An anchor
--     near local midnight sits on the previous UTC day: a Helsinki
--     `2026-10-31 01:30` is `2026-10-30 23:30Z`, so a monthly series anchored
--     there is projected on the **30th** of each UTC month and rings on
--     1 December, local, in wall-clock terms. Nothing here is wrong — every
--     occurrence is exactly one calendar month on from the instant the user
--     chose — but "every month on the 31st" is not what it will look like to
--     the person holding the phone.
--
--     **The known limitation, with its reason.** Fixing that means the note
--     carrying the zone it was set in: a column, a migration, a decision about
--     what an anchor means after the owner moves or travels, and both
--     projections rewritten to take a zone rather than assume one. That is a
--     design change and it has not been asked for. Recording it here is the
--     honest minimum, and it is recorded rather than half-built, because a
--     per-note zone applied on one side only would recreate exactly the drift
--     this migration exists to end.
-- ----------------------------------------------------------------------------
create or replace function public.reminder_occurrence(
  p_anchor timestamptz,
  p_repeat text,
  p_now    timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = public, pg_temp
set timezone = 'UTC'
as $$
declare
  step  interval;
  n     int;
  turns int;
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
    -- No rule, or one this build has never heard of: the occurrence is the
    -- anchor, which is the answer null gives and the one safe way to be wrong
    -- about a series. The caller's `<= now()` test does the rest.
    return p_anchor;
  end if;

  -- The estimate. Exact for a fixed period; for a month it is a count of month
  -- boundaries crossed and says nothing about the day or the time, which is
  -- what the two corrections below are for. This is `monthsBetween` and the
  -- `Math.floor` beside it in `lib/reminders.ts`, said in SQL.
  if p_repeat = 'monthly' then
    n := (extract(year  from p_now)::int - extract(year  from p_anchor)::int) * 12
       + (extract(month from p_now)::int - extract(month from p_anchor)::int);
  else
    n := floor(extract(epoch from (p_now - p_anchor))
               / extract(epoch from step))::int;
  end if;

  -- Never fewer than none: an anchor still in the future projects to itself.
  if n < 0 then
    n := 0;
  end if;

  -- Down while the projection is still ahead of `p_now`. This is the half 0020
  -- did not have, and without it the function can return a future instant.
  turns := 0;
  while turns < 4 and n > 0 and p_anchor + (n * step) > p_now loop
    n := n - 1;
    turns := turns + 1;
  end loop;

  -- Up while the next one has also passed. Every comparison is against the
  -- anchor, never against the last answer — that is the whole repair.
  turns := 0;
  while turns < 4 and p_anchor + ((n + 1) * step) <= p_now loop
    n := n + 1;
    turns := turns + 1;
  end loop;

  return p_anchor + (n * step);
end; $$;

-- ----------------------------------------------------------------------------
-- 3. `due_reminders`, restated whole for the zone.
--
--    Not one line of its logic changes. It is restated because the only way to
--    add a `SET` clause to a function is to write the function again, and
--    because a `create or replace` that leaves a clause out drops it: omitting
--    `security definer` here would silently make the sweep run as its caller
--    and see nothing, and omitting `set search_path` would undo 0008.
--
--    **No drop.** 0020 had to drop and re-create because its return type
--    changed; nothing about the signature or the returned columns moves here,
--    so `create or replace` is enough, and a drop would take the grants below
--    with it and leave the once-a-minute sweep raising for as long as the
--    window lasted.
--
--    The grace window is unchanged and still means what it always meant: an
--    occurrence more than `p_grace` old has missed its moment, and a phone
--    that was off for a week comes back to one notification rather than seven.
--    It is now **named in a second place** — `GRACE_SECONDS` in
--    `supabase/functions/send-reminders/index.ts`, which derives each push's
--    TTL from what is left of it — and the two must agree, the same way
--    `TOMBSTONE_DAYS` and 0021 must. Why that matters is in that file: the
--    sweep records a delivery on the push service's 201, which means *accepted*
--    and not *delivered*, so a push whose TTL expires before the phone comes
--    back was booked as sent and never arrived.
-- ----------------------------------------------------------------------------
create or replace function public.due_reminders(p_grace interval default interval '1 day')
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
set timezone = 'UTC'
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

-- ----------------------------------------------------------------------------
-- 4. The grants, restated.
--
--    A `create or replace` keeps an existing function's ACL, so on this
--    database these are a restatement rather than a repair. They are here
--    anyway for the case that is not this database: a fresh project, or a
--    local stack rebuilt from the migrations, where the same statement is a
--    plain `create` and Postgres grants `execute` to `public` by default. A
--    migration that is only correct against one instance is not a migration.
--
--    The rule itself is 0015's and 0020's, unchanged: only the sweep may ask
--    what is about to fire, and it runs as `service_role`. Nobody signed in
--    through the app has any reason to enumerate it.
-- ----------------------------------------------------------------------------
revoke all on function public.due_reminders(interval) from public, anon, authenticated;
grant execute on function public.due_reminders(interval) to service_role;

-- And the arithmetic beside it, by 0008's rule for auxiliary objects: the
-- sweep's own machinery is reachable by the sweep and by nobody else. It reads
-- no table and could leak nothing if it were open, but a function that is only
-- *probably* harmless is not an argument for an exception.
revoke all on function public.reminder_occurrence(timestamptz, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reminder_occurrence(timestamptz, text, timestamptz)
  to service_role;

-- ----------------------------------------------------------------------------
-- 5. What now holds the two projections together.
--
--    Nothing did. The one test that mentioned this function asserted the
--    TypeScript against a *prose description* of the SQL, which passed happily
--    for as long as the bug in section 1 was live — a test can only ever hold
--    code to what it was told, and it had been told the intention.
--
--    `web/src/lib/reminders.test.ts` now carries a checked-in table of
--    (anchor, rule, now, expected) triples covering the cases both faults live
--    in: anchors on the 29th, 30th and 31st, a leap-day anchor, a far-past
--    anchor, an anchor still in the future, and instants either side of a
--    summer-time change. It is the contract between the two projections, and
--    a change to **either** side has to be re-checked against it.
--
--    Nothing here can run that test, and this migration deliberately does not
--    pretend to check itself: verifying the SQL half means a database, and the
--    honest instruction is the one at the top of `docs/DATABASE-MIGRATIONS.md`
--    — `npm run db:push`, then read the function definition back rather than
--    inferring it from the CLI's exit code.
-- ----------------------------------------------------------------------------
