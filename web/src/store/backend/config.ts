/**
 * Which backend this build talks to, and where it learns that.
 *
 * **A build with its values baked in never asks.** The owner's build — and any
 * build made from `web/.env` — reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
 * at build time exactly as it always has: Supabase when both are set, this
 * device alone when they are not. Nothing is fetched, and nothing here reaches
 * its first paint (`RUNTIME_CONFIG` is replaced by a literal `false` at build
 * time, so the loader below is dropped from that bundle altogether —
 * `buildInvariants.test.ts` checks the bundle for it).
 *
 * **A build made with `VITE_RUNTIME_CONFIG=1` asks the server it is served
 * from.** That is the container image's build: one bundle for every
 * installation, so the backend cannot be baked in. It reads `/config.json`,
 * which the container writes at startup from its environment:
 *
 * ```json
 * {
 *   "backend": "spar-server",          // "supabase" | "spar-server" | "none"
 *   "supabaseUrl": "https://….supabase.co",   // backend "supabase" only
 *   "supabaseKey": "sb_publishable_…",        // backend "supabase" only
 *   "vapidPublicKey": "B…",            // optional; without it reminders do not ring
 *   "signup": "closed"                 // "closed" | "invite" | "open"; on Supabase only "open" means anything
 * }
 * ```
 *
 * Every key but `backend` is optional, and a value that is missing or not
 * understood falls back to the build's own variable for it. The file is asked
 * for **after the archive is on screen** (`afterShell`) and gates only sync and
 * sign-in, never paint — the same rule the Supabase client already keeps. A
 * file that cannot be fetched (offline) falls back to the last one this browser
 * read, then to the build's variables; one that is absent or unreadable falls
 * back to the build's variables. See `docs/self-hosting.md`.
 */

export type BackendKind = "supabase" | "spar-server" | "none";

/** Who may make an account on a spår server. The server's own answer wins. */
export type SignupMode = "closed" | "invite" | "open";

export interface BackendConfig {
  backend: BackendKind;
  supabaseUrl?: string;
  supabaseKey?: string;
  vapidPublicKey?: string;
  signup?: SignupMode;
}

/**
 * Whether this build reads `/config.json`. Replaced by a literal at build time,
 * so every branch it guards is dropped from a build that does not opt in.
 */
export const RUNTIME_CONFIG: boolean = import.meta.env.VITE_RUNTIME_CONFIG === "1";

/**
 * The dashboard shows several URLs and it is easy to copy the REST one. The
 * client wants the bare project URL and appends its own paths, so a copied
 * `/rest/v1` suffix produces 404s on both data and sign-in. Strip it rather
 * than fail in a way that looks like a broken login.
 */
export function projectUrl(raw: string | undefined): string | undefined {
  return raw?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

/** What the build's own variables say. Read on each call, so a test can set them. */
export function buildConfig(): BackendConfig {
  const env = import.meta.env;
  const supabaseUrl = projectUrl(env.VITE_SUPABASE_URL as string | undefined) || undefined;
  const supabaseKey = (env.VITE_SUPABASE_ANON_KEY as string | undefined) || undefined;
  const vapidPublicKey = ((env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? "").trim();
  return {
    backend: supabaseUrl && supabaseKey ? "supabase" : "none",
    supabaseUrl,
    supabaseKey,
    ...(vapidPublicKey ? { vapidPublicKey } : {}),
  };
}

const KINDS: readonly BackendKind[] = ["supabase", "spar-server", "none"];
const SIGNUPS: readonly SignupMode[] = ["closed", "invite", "open"];

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * A `/config.json` read into a config, over the build's own values. Null when
 * it names no backend this client knows, which is treated as no file at all:
 * guessing a backend from a half-written file is how a phone ends up signing
 * in to the wrong place.
 */
export function parseConfig(raw: unknown, fallback: BackendConfig = buildConfig()): BackendConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const file = raw as Record<string, unknown>;
  const backend = KINDS.find((kind) => kind === file.backend);
  if (!backend) return null;
  const signup = SIGNUPS.find((mode) => mode === file.signup);
  const config: BackendConfig = {
    backend,
    supabaseUrl: projectUrl(text(file.supabaseUrl)) ?? fallback.supabaseUrl,
    supabaseKey: text(file.supabaseKey) ?? fallback.supabaseKey,
  };
  const vapid = text(file.vapidPublicKey) ?? fallback.vapidPublicKey;
  if (vapid) config.vapidPublicKey = vapid;
  if (signup) config.signup = signup;
  // Supabase with no project to reach is not a backend; the device keeps the
  // notes rather than failing every request it makes.
  if (backend === "supabase" && !(config.supabaseUrl && config.supabaseKey)) config.backend = "none";
  return config;
}

/** The last `/config.json` this browser read, for an open with no network. */
const LAST_CONFIG = "spar.config";
const CONFIG_WAIT_MS = 5000;

function remembered(): BackendConfig | null {
  try {
    const raw = localStorage.getItem(LAST_CONFIG);
    return raw ? parseConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function remember(raw: unknown): void {
  try {
    localStorage.setItem(LAST_CONFIG, JSON.stringify(raw));
  } catch {
    // Asked again on the next open, which is all this saves.
  }
}

/** Reads `/config.json`. Never throws: every failure has a fallback. */
export async function fetchRuntimeConfig(): Promise<BackendConfig> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CONFIG_WAIT_MS);
  let answer: Response;
  try {
    answer = await fetch("/config.json", { cache: "no-store", signal: abort.signal });
  } catch {
    // No answer at all — offline, most likely. The last file read here is a
    // better guess than the build's empty variables, which would drop a
    // signed-in device to device-only for as long as it is on a plane.
    return remembered() ?? buildConfig();
  } finally {
    clearTimeout(timer);
  }
  if (!answer.ok) return buildConfig();
  try {
    const raw: unknown = await answer.json();
    const config = parseConfig(raw);
    if (!config) return buildConfig();
    remember(raw);
    return config;
  } catch {
    return buildConfig();
  }
}

let loaded: BackendConfig | null = null;
let loading: Promise<BackendConfig> | null = null;

/**
 * The backend configuration, read once per session.
 *
 * A build without `VITE_RUNTIME_CONFIG` answers from its own variables and
 * fetches nothing; `backend.test.ts` holds that.
 */
export function loadBackendConfig(): Promise<BackendConfig> {
  // A conditional expression rather than an early return, so the bundler can
  // see the fetch is unreachable in a build that does not opt in and drop it.
  return RUNTIME_CONFIG
    ? (loading ??= fetchRuntimeConfig().then((config) => (loaded = config)))
    : Promise.resolve(buildConfig());
}

/**
 * The configuration if it is known yet, synchronously — for the few checks that
 * cannot wait (`pushSupported`). Always known on a build without runtime
 * configuration; null on one with it until `/config.json` has been read.
 */
export function knownConfig(): BackendConfig | null {
  return RUNTIME_CONFIG ? loaded : buildConfig();
}
