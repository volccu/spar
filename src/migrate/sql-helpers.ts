// Pure helpers used by scripts/dump-to-supabase.ts to build a Postgres dump
// from the Phase 0 SQLite notes.db. Kept dependency-free and exported so the
// escaping/array-mapping logic can be unit-tested without a database.

export function sqlString(s: string | null | undefined): string {
  if (s === null || s === undefined) return "null";
  return "'" + s.replace(/'/g, "''") + "'";
}

export function sqlBool(n: number | boolean): string {
  return n ? "true" : "false";
}

// Convert a SQLite JSON-array string ('["a","b"]') to a Postgres text[] literal
// using ARRAY[...]::text[]. Handles any character (including single quotes,
// commas, newlines) safely via sqlString. Empty/null -> ARRAY[]::text[] to
// satisfy the NOT NULL default on notes.tags.
export function sqlTags(json: string | null): string {
  let arr: string[] = [];
  if (json) {
    try { arr = JSON.parse(json) as string[]; } catch { arr = []; }
  }
  if (arr.length === 0) return "ARRAY[]::text[]";
  return "ARRAY[" + arr.map(sqlString).join(",") + "]::text[]";
}

export function sqlTimestamp(iso: string | null): string {
  if (!iso) return "now()";
  return sqlString(iso) + "::timestamptz";
}