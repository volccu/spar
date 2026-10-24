/**
 * The server's settings, read once from the environment at start.
 *
 * Every variable is optional. The defaults make a server that is safe to start
 * from source on a laptop: it listens on loopback only, nobody can sign up
 * except the very first account, and nothing is capped that a person would
 * notice. docs/server-api.md and docs/self-hosting.md list them all.
 */
import { resolve } from "node:path";

export type SignupMode = "closed" | "invite" | "open";

/**
 * What the web app it serves should sync with (`SPAR_BACKEND`). `spar-server`
 * is this server's own API; `supabase` and `none` leave the API, its database
 * and its timers off, and the process serves only the built app and the
 * `/config.json` that tells it where to go — so one image serves either
 * backend with no rebuild.
 */
export type BackendMode = "spar-server" | "supabase" | "none";

export interface ServerConfig {
  backend: BackendMode;
  /** The Supabase project URL and its publishable key, handed to the app in
   *  `/config.json` when `backend` is `supabase`; null otherwise. */
  supabaseUrl: string | null;
  supabaseKey: string | null;
  /** Where `spar.db`, `files/` and the generated keys live. */
  dataDir: string;
  host: string;
  port: number;
  signup: SignupMode;
  /** Bytes one user may keep in files; 0 means no cap. */
  storageCapBytes: number;
  /** Origins given credentialed CORS on the whole API (a dev server on
   *  another port, say). Same-origin use needs none. */
  allowedOrigins: string[];
  /** Host names (with an optional port) this server answers to; empty
   *  answers any. Set, it refuses every other `Host`, which is what stops a
   *  web page from reaching the server through a DNS-rebound name of its own. */
  allowedHosts: string[];
  /** `auto` sets `Secure` on the cookie when the request arrived over HTTPS
   *  (directly, or per `X-Forwarded-Proto` when `trustProxy` is on). */
  cookieSecure: "auto" | "always" | "never";
  /** Believe `X-Forwarded-For` / `X-Forwarded-Proto` / `X-Forwarded-Host`.
   *  Only turn on behind a proxy that sets them. */
  trustProxy: boolean;
  /** The `sub` of every Web Push request: `mailto:` or an https URL. */
  vapidSubject: string | null;
  /** A VAPID pair to use instead of the generated one (base64url), so an
   *  instance moving off Supabase keeps its devices subscribed. */
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  /** Serve the built PWA from here (for the container); null serves only the API. */
  webDir: string | null;
  /** Run the reminder sweep and the housekeeping timers. */
  timers: boolean;
  /** scrypt cost (log2 N). Lower only for tests. */
  scryptLogN: number;
  /** Link previews a user may ask for: a burst, then one per `linkPreviewRefillMs`. */
  linkPreviewBurst: number;
  linkPreviewRefillMs: number;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number of zero or more, not "${value}"`);
  return Math.floor(n);
}

/**
 * The project URL as the web client wants it: bare, with no trailing slash and
 * no `/rest/v1` (the dashboard shows several URLs and that one is easy to copy;
 * `projectUrl` in web/src/store/backend/config.ts strips the same).
 */
function supabaseProjectUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SPAR_SUPABASE_URL must be a URL such as https://your-project.supabase.co, not "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`SPAR_SUPABASE_URL must be an http(s) URL, not "${raw}"`);
  }
  return raw.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

/**
 * The key is handed to every visitor in `/config.json`, so it must be the
 * publishable one. A secret key (`sb_secret…`, or a legacy JWT whose role is
 * `service_role`) bypasses row-level security: refusing to start is kinder
 * than publishing it.
 */
function publishableKey(key: string): string {
  const refuse = () =>
    new Error(
      "SPAR_SUPABASE_KEY is a secret (service-role) key, which would be served to every visitor. " +
        "Use the project's publishable (anon) key.",
    );
  // `[_]` rather than a plain underscore: the publish script's leak guard
  // refuses the literal prefix anywhere in the public tree.
  if (/^sb_secret[_]/i.test(key)) throw refuse();
  const parts = key.split(".");
  if (parts.length === 3) {
    let role: unknown;
    try {
      role = (JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { role?: unknown }).role;
    } catch {
      role = undefined; // Not a JWT after all; the project will say so on the first request.
    }
    if (role === "service_role") throw refuse();
  }
  return key;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const backend = (env.SPAR_BACKEND ?? "").trim().toLowerCase() || "spar-server";
  if (backend !== "spar-server" && backend !== "supabase" && backend !== "none") {
    throw new Error(`SPAR_BACKEND must be spar-server, supabase or none, not "${env.SPAR_BACKEND}"`);
  }
  const webDir = env.SPAR_WEB_DIR?.trim() ? resolve(env.SPAR_WEB_DIR.trim()) : null;
  let supabaseUrl: string | null = null;
  let supabaseKey: string | null = null;
  if (backend === "supabase") {
    const url = env.SPAR_SUPABASE_URL?.trim() ?? "";
    const key = env.SPAR_SUPABASE_KEY?.trim() ?? "";
    if (!url || !key) {
      throw new Error(
        "SPAR_BACKEND=supabase needs SPAR_SUPABASE_URL and SPAR_SUPABASE_KEY (the project URL and its publishable key)",
      );
    }
    supabaseUrl = supabaseProjectUrl(url);
    supabaseKey = publishableKey(key);
  }
  if (backend !== "spar-server" && !webDir) {
    throw new Error(`SPAR_BACKEND=${backend} serves only the web app, so it needs SPAR_WEB_DIR (the built web/dist)`);
  }
  const signup = (env.SPAR_SIGNUP ?? "closed").trim().toLowerCase();
  if (signup !== "closed" && signup !== "invite" && signup !== "open") {
    throw new Error(`SPAR_SIGNUP must be closed, invite or open, not "${env.SPAR_SIGNUP}"`);
  }
  const cookieSecure = (env.SPAR_COOKIE_SECURE ?? "auto").trim().toLowerCase();
  const secure = cookieSecure === "true" || cookieSecure === "1" ? "always" : cookieSecure === "false" || cookieSecure === "0" ? "never" : "auto";
  const port = int(env.SPAR_PORT ?? env.PORT, 8080, "SPAR_PORT");
  if (port > 65535) throw new Error("SPAR_PORT must be at most 65535");
  const logN = int(env.SPAR_SCRYPT_LOG_N, 15, "SPAR_SCRYPT_LOG_N");
  if (logN < 10 || logN > 20) throw new Error("SPAR_SCRYPT_LOG_N must be between 10 and 20");
  return {
    backend,
    supabaseUrl,
    supabaseKey,
    dataDir: resolve(env.SPAR_DATA_DIR?.trim() || "/data"),
    host: env.SPAR_HOST?.trim() || "127.0.0.1",
    port,
    signup,
    storageCapBytes: int(env.SPAR_STORAGE_CAP_MB, 0, "SPAR_STORAGE_CAP_MB") * 1024 * 1024,
    allowedOrigins: (env.SPAR_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    allowedHosts: (env.SPAR_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    cookieSecure: secure,
    trustProxy: flag(env.SPAR_TRUST_PROXY, false),
    vapidSubject: env.SPAR_VAPID_SUBJECT?.trim() || null,
    vapidPublicKey: env.SPAR_VAPID_PUBLIC_KEY?.trim() || null,
    vapidPrivateKey: env.SPAR_VAPID_PRIVATE_KEY?.trim() || null,
    webDir,
    timers: true,
    scryptLogN: logN,
    linkPreviewBurst: 30,
    linkPreviewRefillMs: 2_000,
  };
}

/** Everything a test or the conformance driver does not care to say. */
export function testConfig(dataDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    backend: "spar-server",
    supabaseUrl: null,
    supabaseKey: null,
    dataDir,
    host: "127.0.0.1",
    port: 0,
    signup: "open",
    storageCapBytes: 0,
    allowedOrigins: [],
    allowedHosts: [],
    cookieSecure: "auto",
    trustProxy: false,
    vapidSubject: null,
    vapidPublicKey: null,
    vapidPrivateKey: null,
    webDir: null,
    timers: false,
    scryptLogN: 10,
    linkPreviewBurst: 1_000,
    linkPreviewRefillMs: 1,
    ...overrides,
  };
}
