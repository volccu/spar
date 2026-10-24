import { getSupabase } from "../supabase";
import { afterShell } from "../shell";
import { noteServerDate } from "../serverClock";
import { RUNTIME_CONFIG, loadBackendConfig } from "./config";
import type { Backend } from "./types";
import { DEMO } from "../../lib/demo";

export type * from "./types";

/** The spår server backend, made once: it holds the session and the one event stream. */
let sparServer: Promise<Backend> | null = null;

/**
 * The backend this session syncs with, or null when there is none — the
 * device keeps the notes and nothing here is ever asked.
 *
 * Every store module reaches the server through this and nothing else. It is
 * the same accessor `getSupabase` always was, one level up: asynchronous,
 * nullable, and not started until the archive is on screen.
 *
 * On a build without runtime configuration it is `getSupabase` and a wrapper
 * around what it returns, nothing more — the wrapper rides in the Supabase
 * client's own chunk, so reaching it costs no request the client did not
 * already make. On a build with it, `/config.json` decides first
 * (`backend/config.ts`), and a spår server is reached through a chunk of its
 * own — one object for the session, like the Supabase wrapper, because it is
 * what holds who is signed in and the one event stream every table shares.
 */
export async function getBackend(): Promise<Backend | null> {
  // The public demo has no server by definition, and saying so here lets the
  // bundler leave the Supabase client and its backend out of it altogether
  // (`lib/demo.ts`). Gone from every other build, where `DEMO` is false.
  if (DEMO) return null;
  if (RUNTIME_CONFIG) {
    await afterShell();
    const config = await loadBackendConfig();
    if (config.backend === "none") return null;
    if (config.backend === "spar-server") {
      sparServer ??= import("./sparServerBackend").then(({ sparServerBackend }) =>
        sparServerBackend(config, { onDate: noteServerDate }),
      );
      return sparServer;
    }
  }
  const client = await getSupabase();
  if (!client) return null;
  const { supabaseBackend } = await import("./supabaseBackend");
  return supabaseBackend(client);
}
