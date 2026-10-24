import { getBackend } from "./backend";

/**
 * One definition of "does this server have that yet?", for every sync path.
 *
 * The client deploys from one place and the schema migrates from another, so
 * for some window they disagree and the app must not care. Asking for a column
 * that is not there fails the *whole* request — one statement, every row — so
 * each post-launch column is asked about once, cheaply, and the answer is
 * remembered for the session.
 *
 * The subtle half is *when a "no" may be remembered*, and it is the reason this
 * lives in its own file. A "no" used to be cached whichever way the request
 * failed, so a single blip on the very first tick after sign-in downgraded the
 * protocol for the entire session: files stopped uploading, deletes stopped
 * propagating, and per-field merging silently fell back to whole-row
 * last-write-wins. All of it invisible, and all of it fixed by a reload nobody
 * knew to do. A transient failure must therefore cache nothing, so the next
 * tick asks again.
 *
 * That fix was made once, for notes, and the canvas and board paths kept the
 * original `hasX = !error` — so one dropped connection on the first tick still
 * stopped canvases and the whole board shelf from syncing for the rest of the
 * session, silently. Written three times, a rule this subtle gets fixed once.
 * Everything that needs the answer imports it from here.
 */

/**
 * The errors that actually mean "this server has not been migrated yet", as
 * opposed to "ask me again in a moment".
 *
 * Postgres says `42703` for a column that is not there, `42P01` for a table
 * and `42883` for a function; PostgREST answers `PGRST204`/`PGRST205` for the
 * first two and `PGRST202` for the third from its own schema cache before the
 * statement is ever sent.
 */
const MISSING = /^(42703|42P01|42883|PGRST20[245])$/;

export function reallyMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code) return MISSING.test(code);
  // Older PostgREST builds answer without a code. The message still names it.
  const message = (error as { message?: string } | null)?.message ?? "";
  return /does not exist|could not find the (table|column|function)/i.test(message);
}

/**
 * Asks once and reports whether the answer is worth remembering.
 *
 * `remember` is false for a transient failure, which is the whole point: the
 * caller keeps its cache at `null` and asks again next tick.
 */
export async function probe(
  cached: boolean | null,
  ask: () => Promise<{ error: unknown }>,
): Promise<{ known: boolean; remember: boolean }> {
  if (cached !== null) return { known: cached, remember: false };
  if (!(await getBackend())) return { known: false, remember: false };
  const { error } = await ask();
  if (!error) return { known: true, remember: true };
  return { known: false, remember: reallyMissing(error) };
}

/**
 * Probe a single column of a single table.
 *
 * Always name the column the caller is about to *read*, never merely the table
 * it lives on: `prefs` arrived in migration 0014 and `prefs.boards` only in
 * 0016, so a probe for the table passed against a half-migrated server and
 * every read after it failed on the column.
 */
export function columnProbe(table: string, name: string): () => Promise<{ error: unknown }> {
  return async () => (await getBackend())!.probeColumn(table, name);
}
