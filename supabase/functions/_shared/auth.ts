import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Returns the authenticated user's ID, never accepting an anonymous token. */
export async function userIdFromRequest(req: Request): Promise<string | null> {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return null;

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  return error ? null : data.user?.id ?? null;
}
