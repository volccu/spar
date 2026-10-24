-- 0005_attachments.sql — files carried by notes.
--
-- Two halves. The metadata rides in the note row, so it syncs through the
-- existing notes push/pull with no second sync path and no second conflict
-- rule — including the thumbnail, which is why a phone can draw a screenshot
-- the moment the note lands and before any file has been downloaded. The bytes
-- go to a private storage bucket, one folder per user.
--
-- Safe to run more than once.

-- ----------------------------------------------------------------------------
-- The column
-- ----------------------------------------------------------------------------
-- jsonb rather than a table: an attachment has no life of its own. It is
-- created with a note, deleted with a note, and only ever read through one.
-- A join table would buy referential integrity over rows that are already
-- last-write-wins per note, and cost a whole second sync path to get it.
alter table public.notes
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Everything imported from Keep predates files and must read as an empty list
-- rather than as null, which the client would have to defend against forever.
update public.notes set attachments = '[]'::jsonb where attachments is null;

-- The Files board asks one question — does this note carry anything — and asks
-- it of every active note on every render of that board.
create index if not exists notes_has_attachments_idx
  on public.notes ((jsonb_array_length(attachments) > 0))
  where status = 'active';

-- ----------------------------------------------------------------------------
-- The bucket
-- ----------------------------------------------------------------------------
-- Private. A note is personal and so is everything hanging off it; the client
-- reads bytes through the authenticated API, never through a public URL.
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 26214400)          -- 25 MB, matching the client
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- ----------------------------------------------------------------------------
-- Who may touch what
-- ----------------------------------------------------------------------------
-- Every object is stored at `<user id>/<note id>/<attachment id>`, so the first
-- path segment is the owner and that is the whole of the rule. storage.foldername
-- returns the path split on "/", one-indexed.
drop policy if exists "own files read"   on storage.objects;
drop policy if exists "own files write"  on storage.objects;
drop policy if exists "own files update" on storage.objects;
drop policy if exists "own files delete" on storage.objects;

create policy "own files read" on storage.objects
  for select to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

-- Upsert is an update when the object already exists, which is what a retried
-- upload does. Without this an interrupted transfer could never be resumed.
create policy "own files update" on storage.objects
  for update to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own files delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
