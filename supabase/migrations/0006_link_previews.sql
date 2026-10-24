-- 0006_link_previews.sql — optional metadata for link unfurls.
--
-- Preview metadata is enrichment, never note content. An empty list is the
-- normal offline state and keeps old rows and old clients fully usable.

alter table public.notes
  add column if not exists link_previews jsonb not null default '[]'::jsonb;

update public.notes
set link_previews = '[]'::jsonb
where link_previews is null;
