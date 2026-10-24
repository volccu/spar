-- 0002_set_embedding_rpc.sql — RPC helper used by the enrich-note edge
-- function to write a vector(1024) column from a JSON number[] payload. The
-- Supabase JS client can't send a vector literal directly, so we accept a
-- JSON array and cast inside Postgres.
create or replace function public.set_note_embedding(
  p_note_id uuid,
  p_embedding jsonb
) returns void language plpgsql security definer as $$
declare
  v_vec vector(1024);
begin
  -- Convert the JSON array to a text representation '[1,2,3]' that vector
  -- can parse. p_embedding::text already yields '[1,2,3]' for a pure array.
  v_vec := (p_embedding::text)::vector(1024);
  update public.notes
     set embedding = v_vec,
         embedding_stale = false
   where id = p_note_id;
end; $$;

-- security definer runs as the postgres superuser; gate access to authenticated
-- + service_role. The edge function uses the service_role key.
revoke all on function public.set_note_embedding(uuid, jsonb) from public, anon;
grant execute on function public.set_note_embedding(uuid, jsonb) to authenticated, service_role;