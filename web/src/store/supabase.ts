import type { SupabaseClient } from "@supabase/supabase-js";
import { noteServerDate } from "./serverClock";
import { FILE_REQUEST_MS, deadlineFor, withDeadline } from "./deadline";
import { afterShell } from "./shell";
import { RUNTIME_CONFIG, loadBackendConfig, projectUrl } from "./backend/config";
import { DEMO } from "../lib/demo";

export { shellReady } from "./shell";

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** The bare project URL; a copied `/rest/v1` suffix is stripped (`projectUrl`). */
const url = projectUrl(rawUrl);

/**
 * Sync is optional. With no keys configured the app still works completely —
 * it just keeps notes on this device only. Nothing in the UI may assume a
 * server is present (SPEC §2.6).
 *
 * This is what the build's own variables say. A build that reads
 * `/config.json` (`backend/config.ts`) learns its backend later, and asks
 * `getBackend` rather than this.
 */
export const syncConfigured = Boolean(url && key);

let clientPromise: Promise<SupabaseClient | null> | null = null;

/**
 * The sync client, reached through a dynamic import so `@supabase/supabase-js`
 * (~56 kB gzipped — a third of what the first paint used to parse) rides in
 * its own chunk instead of the initial bundle. The 90% path is local and
 * never needed it; everything that talks to the server is already async and
 * already treats the client as nullable, so awaiting the accessor is the
 * same shape those call sites always had. It is not started until the archive
 * is on screen (`store/shell.ts`).
 *
 * One promise for the whole session: `createClient` must run exactly once,
 * or two GoTrue instances end up contesting a single storage key. The chunk
 * is precached by the service worker (unlike the PDF viewer, which is
 * excluded by name), so offline sign-in keeps working.
 *
 * Only `store/backend/` calls this; the store reaches the server through
 * `getBackend`.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  // No client in the public demo, and none of its code in the demo's bundle
  // (`lib/demo.ts`); folded away everywhere else.
  if (DEMO) return Promise.resolve(null);
  if (RUNTIME_CONFIG) {
    // The project comes from `/config.json`, read after the shell like the
    // client itself, so the one promise still covers the whole session.
    clientPromise ??= afterShell()
      .then(loadBackendConfig)
      .then((config) =>
        config.backend === "supabase" && config.supabaseUrl && config.supabaseKey
          ? connect(config.supabaseUrl, config.supabaseKey)
          : null,
      );
    return clientPromise;
  }
  if (!syncConfigured) return Promise.resolve(null);
  clientPromise ??= afterShell().then(() => connect(url!, key!));
  return clientPromise;
}

function connect(projectUrl: string, projectKey: string): Promise<SupabaseClient> {
  return import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(projectUrl, projectKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      global: { fetch: readingTheClock },
    }),
  );
}

/**
 * Every answer the server gives is also a reading of its clock, and the
 * reading is free — see `store/serverClock.ts` for what it is for.
 */
const readingTheClock: typeof fetch = async (input, init) => {
  // Given up when stuck (store/deadline.ts); storage carries the files.
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const ms = url.includes("/storage/v1/") ? FILE_REQUEST_MS : deadlineFor(init?.body);
  const answer = await fetch(input, withDeadline(init, ms));
  noteServerDate(answer.headers.get("date"));
  return answer;
};
