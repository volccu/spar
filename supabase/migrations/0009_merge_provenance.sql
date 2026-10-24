-- 0009_merge_provenance.sql — keep the source side of an idea relationship.
--
-- `merged_from` identifies the sources on the new idea note. This reciprocal
-- pointer lets an archived source explain where it went without reconstructing
-- the relationship from every idea row.

alter table public.notes add column if not exists merged_into uuid;

create index if not exists notes_merged_into_idx
  on public.notes(merged_into)
  where merged_into is not null;
