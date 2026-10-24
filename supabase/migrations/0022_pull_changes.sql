-- One question a sync tick asks instead of four.
--
-- An idle tick — nothing to push, which is nearly every tick — asked the
-- server four things in a row: the tombstones since the last look, the notes
-- since the last look, the canvases since the last look, and the one prefs
-- row. Four round trips, twenty seconds apart, for the rest of the session,
-- on a phone. The answers do not depend on each other, so they are one
-- function returning all four, keyed by the three cursors the client already
-- keeps. The client pages exactly as it did (`p_limit` a page, keyset on
-- `(updated_at, id)`), and falls back to the four separate reads on a server
-- that has not run this migration — it asks once per session and remembers.
--
-- Keyset rules restated from the client, because they differ. Notes and
-- tombstones with no id in the cursor take rows strictly after the stamp.
-- Canvases with no id take rows *from* the stamp, inclusive: a device whose
-- folder cursor is still the plain timestamp this key stored before it
-- became a keyset must not skip a row sharing that stamp (`canvasSync.ts`,
-- `afterCursor`).
--
-- `security invoker`, so row-level security applies exactly as it does to a
-- direct read; `owner_id = auth.uid()` is restated so the owner indexes are
-- used. `to_jsonb(row)` returns every column the table has, which is what
-- lets a column added by a later migration reach the client without this
-- function being rewritten; the vector column is dropped from the payload
-- (it is empty on every row, but it is a vector) and `owner_id` is not the
-- client's business.

create or replace function public.pull_changes(
  p_notes_at      timestamptz,
  p_notes_id      uuid,
  p_tombstones_at timestamptz,
  p_tombstones_id uuid,
  p_folders_at    timestamptz,
  p_folders_id    uuid,
  p_limit         integer default 500
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'notes', (
      select coalesce(jsonb_agg(to_jsonb(n) - 'embedding' - 'owner_id'
                                order by n.updated_at, n.id), '[]'::jsonb)
        from (
          select *
            from public.notes
           where owner_id = (select auth.uid())
             and (updated_at > p_notes_at
                  or (p_notes_id is not null
                      and updated_at = p_notes_at and id > p_notes_id))
           order by updated_at, id
           limit p_limit
        ) n
    ),
    'tombstones', (
      select coalesce(jsonb_agg(jsonb_build_object('note_id', t.note_id,
                                                   'deleted_at', t.deleted_at)
                                order by t.deleted_at, t.note_id), '[]'::jsonb)
        from (
          select note_id, deleted_at
            from public.note_tombstones
           where owner_id = (select auth.uid())
             and (deleted_at > p_tombstones_at
                  or (p_tombstones_id is not null
                      and deleted_at = p_tombstones_at and note_id > p_tombstones_id))
           order by deleted_at, note_id
           limit p_limit
        ) t
    ),
    'folders', (
      select coalesce(jsonb_agg(to_jsonb(f) - 'owner_id'
                                order by f.updated_at, f.id), '[]'::jsonb)
        from (
          select *
            from public.folders
           where owner_id = (select auth.uid())
             and ((p_folders_id is null and updated_at >= p_folders_at)
                  or updated_at > p_folders_at
                  or (p_folders_id is not null
                      and updated_at = p_folders_at and id > p_folders_id))
           order by updated_at, id
           limit p_limit
        ) f
    ),
    'prefs', (
      select to_jsonb(p) - 'owner_id'
        from public.prefs p
       where owner_id = (select auth.uid())
       limit 1
    )
  );
$$;

revoke all on function public.pull_changes(timestamptz, uuid, timestamptz, uuid, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.pull_changes(timestamptz, uuid, timestamptz, uuid, timestamptz, uuid, integer)
  to authenticated, service_role;
