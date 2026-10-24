import type { Cursor } from "../cursors";
import { FILE_REQUEST_MS, deadlineFor, withDeadline } from "../deadline";
import {
  browserStorage,
  clearMarker,
  readMarker,
  SERVER_SESSION_KEY,
  writeMarker,
  type MarkerStorage,
} from "./marker";
import type {
  Answer,
  AuthSession,
  Backend,
  BackendFailure,
  LinkPreviewFailure,
  NewAccount,
  Outcome,
  RealtimeTable,
  Row,
  SignupMode,
  SignupState,
} from "./types";

/**
 * The spår server backend: every operation of `Backend` (`types.ts`) spelled
 * as the HTTP call `docs/server-api.md` documents — that document is the whole
 * contract, and its "Mapping the client's operations" table is this file in
 * prose. Nothing here decides anything about sync; like `supabaseBackend.ts`,
 * it only translates.
 *
 * Reached only on a build with `VITE_RUNTIME_CONFIG=1` whose `/config.json`
 * says `"backend": "spar-server"`, through a dynamic import in `getBackend`,
 * so no other build carries it (`buildInvariants.test.ts`). It imports nothing
 * but types and the session marker, so it also runs in Node, where the
 * server's own suite drives it against a real server (`server/test/`).
 *
 * Four things it does that the Supabase client did for itself:
 *
 * - **The session.** It is an httpOnly cookie the browser sends on its own;
 *   script cannot read it, so who is signed in is kept in a marker
 *   (`marker.ts`) — written at sign-in, read synchronously by
 *   `hasStoredSession` so a signed-in device paints first, confirmed with the
 *   server once per load, and cleared on sign-out, on deletion and on any 401.
 *   Another tab's sign-in or sign-out arrives through the `storage` event.
 * - **The codes.** The store decides on Postgres codes (`types.ts`), so a row
 *   refusal (`409 row_refused`) is reported as `23000` — class 23, which
 *   `namesTheRow` charges to the row — and every other failure carries its
 *   HTTP status as text, or no code when nothing answered. No capability is
 *   ever reported missing: the server ships with the client.
 * - **The clock.** Every answer's `Date` header goes to `onDate`
 *   (`noteServerDate`), which is what the trash sweep and the pull cursor lean
 *   on (`store/serverClock.ts`).
 * - **Live updates.** One Server-Sent Events stream, shared by every
 *   `subscribe`, opened while anybody listens and somebody is signed in,
 *   reopened with a growing wait when it drops. It is read with a streaming
 *   `fetch` rather than `EventSource`, because only `fetch` says *why* a
 *   stream would not open: a 401 is a session that ended, not a network to
 *   retry against.
 */

export interface SparServerOptions {
  /** Where the API is; empty for the page's own origin (the served app). */
  base?: string;
  /** The fetch to use; read at call time from the global when absent. */
  fetch?: typeof fetch;
  /** Where the session marker lives; the browser's `localStorage` by default. */
  storage?: MarkerStorage | null;
  /** Told every answer's `Date` header — `noteServerDate` in the app. */
  onDate?: (date: string | null) => void;
  /** Where another tab's `storage` events arrive; the window by default. */
  events?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
  /** The stream's reconnect waits: the first, doubling up to the last. */
  backoff?: { firstMs: number; maxMs: number };
}

const JSON_TYPE = "application/json";
/** The server takes at most this many rows, ids or paths per request. */
const MAX_BATCH = 1000;
const BACKOFF = { firstMs: 1000, maxMs: 30_000 };

/** The row refusal's code, in Postgres's words (`namesTheRow` in `sync.ts`). */
export const ROW_REFUSED_CODE = "23000";

type Body = Record<string, unknown> | null;

/** A request that went out and was answered, or never was. */
type Reply =
  | { response: Response; body: Body; failed: null }
  | { response: null; body: null; failed: string };

async function readBody(response: Response): Promise<Body> {
  try {
    const text = await response.text();
    if (!text) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const words = (body: Body): string | null =>
  typeof body?.error === "string" && body.error !== "" ? body.error : null;

/** A failed answer, read the way the store reads a failure. */
function failureOf(reply: Reply): BackendFailure {
  if (!reply.response) return { message: `The server could not be reached: ${reply.failed}`, code: null };
  const { status } = reply.response;
  const code = reply.body?.code;
  const message = words(reply.body) ?? `The server answered ${status}`;
  if (status === 409 && code === "row_refused") return { message, code: ROW_REFUSED_CODE };
  return { message, code: String(status) };
}

/** A keyset cursor as query parameters; one with no id is sent without it. */
function cursorParams(query: URLSearchParams, prefix: string, cursor: Cursor): void {
  if (cursor.at) query.set(`${prefix}at`, cursor.at);
  if (cursor.id) query.set(`${prefix}id`, cursor.id);
}

/** A storage path as a URL: each segment percent-encoded on its own. */
const filePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += MAX_BATCH) out.push(items.slice(i, i + MAX_BATCH));
  return out;
}

function minutes(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 60) return "a minute";
  const n = Math.ceil(seconds / 60);
  return `${n} minutes`;
}

/**
 * Why a sign-in or a new account was refused, in the app's words. Each one
 * says what to do next (web/CLAUDE.md, "a failure says what to do next").
 */
function accountMessage(reply: Reply, making: boolean): string {
  if (!reply.response) return "The server did not answer. Check the connection and try again.";
  const { status } = reply.response;
  const code = reply.body?.code;
  if (status === 429) {
    return `Too many tries. Wait ${minutes(reply.response.headers.get("retry-after"))} and try again.`;
  }
  if (!making && status === 401) return "That email and password do not match an account here.";
  if (code === "signup_closed") {
    return "This server is not making new accounts. Whoever runs it can make one for you.";
  }
  if (code === "invite_required") return "That invite code is not one this server knows, or it has been used.";
  if (code === "email_taken") return "There is already an account for that address. Sign in instead.";
  if (code === "weak_password") return "The password needs at least 8 characters.";
  if (code === "invalid_email") return "That is not an email address this server can take.";
  return words(reply.body) ?? `The server answered ${status}. Try again.`;
}

const SIGNUPS: readonly SignupMode[] = ["closed", "invite", "open"];

/** One `event:`/`data:` block of the stream, or null for a comment or a ping. */
function parseEvent(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length === 0 && event === "message" ? null : { event, data: data.join("\n") };
}

export function sparServerBackend(
  config: { signup?: SignupMode },
  options: SparServerOptions = {},
): Backend {
  const base = (options.base ?? "").replace(/\/+$/, "");
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const onDate = options.onDate ?? (() => {});
  const backoff = options.backoff ?? BACKOFF;
  const events =
    options.events === undefined
      ? typeof window === "undefined"
        ? null
        : window
      : options.events;
  // Same-origin is the served app; a development server on another origin
  // has to send the cookie across (`SPAR_ALLOWED_ORIGINS`, server-api.md).
  const credentials: RequestCredentials = base === "" ? "same-origin" : "include";
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? fetch)(input, init);

  // ---- the session ---------------------------------------------------------

  /** Who is signed in, as far as this device knows. Starts from the marker. */
  let current: AuthSession | null = null;
  {
    const id = readMarker(storage);
    if (id) current = { user: { id } };
  }
  let confirmed: Promise<AuthSession | null> | null = null;
  /**
   * Moves on every change of who is signed in, so the server's answer to a
   * question asked before a sign-in cannot undo the sign-in when it lands.
   */
  let epoch = 0;
  const listeners = new Set<(session: AuthSession | null) => void>();

  /** Sets who is signed in; tells the listeners only when that changed. */
  function become(id: string | null, persist = true): void {
    epoch += 1;
    const before = current?.user.id ?? null;
    current = id ? { user: { id } } : null;
    if (persist) {
      if (id) writeMarker(storage, id);
      else clearMarker(storage);
    }
    if (id) ensureStream();
    else closeStream();
    if (before === id) return;
    for (const listener of [...listeners]) listener(current);
  }

  /** A 401 anywhere means the session is gone (server-api.md, "Accounts"). */
  function lost(): void {
    if (current) become(null);
  }

  // Another tab signing in or out: the marker is the one thing they share.
  const onStorage = (event: Event) => {
    const { key, newValue } = event as StorageEvent;
    if (key !== SERVER_SESSION_KEY && key !== null) return;
    const id = key === null ? null : readMarker({ getItem: () => newValue, setItem() {}, removeItem() {} });
    become(id, false);
  };
  events?.addEventListener("storage", onStorage);

  // ---- requests ------------------------------------------------------------

  async function call(
    method: string,
    path: string,
    init: { json?: unknown; bytes?: Blob; contentType?: string } = {},
  ): Promise<Reply> {
    const headers: Record<string, string> = {};
    let body: BodyInit | undefined;
    if (init.bytes !== undefined) {
      body = init.bytes;
      headers["content-type"] = init.contentType || "application/octet-stream";
      // Not JSON, so the header is what tells the server a form did not send it.
      headers["x-spar-request"] = "1";
    } else if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers["content-type"] = JSON_TYPE;
    }
    let response: Response;
    try {
      response = await doFetch(
        `${base}${path}`,
        // Given up when stuck (store/deadline.ts); file bytes get longer.
        withDeadline(
          { method, headers, body, credentials, cache: "no-store" },
          init.bytes !== undefined ? FILE_REQUEST_MS : deadlineFor(body),
        ),
      );
    } catch (error) {
      return { response: null, body: null, failed: error instanceof Error ? error.message : String(error) };
    }
    onDate(response.headers.get("date"));
    // A wrong password at sign-in is a 401 too, and is not a session ending.
    if (response.status === 401 && path !== "/api/auth/login") lost();
    return { response, body: await readBody(response), failed: null };
  }

  /** A write: no error when the server said 2xx. */
  async function outcome(method: string, path: string, json?: unknown): Promise<Outcome> {
    const reply = await call(method, path, { json });
    return { error: reply.response?.ok ? null : failureOf(reply) };
  }

  /** A read: the named key of the answer, or the failure. */
  async function answer<T>(method: string, path: string, key: string, json?: unknown): Promise<Answer<T>> {
    const reply = await call(method, path, { json });
    if (!reply.response?.ok) return { data: null, error: failureOf(reply) };
    return { data: (reply.body?.[key] ?? null) as T | null, error: null };
  }

  function page(path: string, after: Cursor, limit: number): string {
    const query = new URLSearchParams();
    cursorParams(query, "after_", after);
    query.set("limit", String(limit));
    return `${path}?${query}`;
  }

  // ---- live updates ----------------------------------------------------------

  const subscribers = new Set<{ table: RealtimeTable; onSignal: (row: unknown) => void }>();
  let stream: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  /** Said once per run of failures, as a channel that will not open is (supabaseBackend). */
  let complained = false;

  function closeStream(): void {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    stream?.abort();
    stream = null;
    attempt = 0;
  }

  function ensureStream(): void {
    if (stream || retryTimer !== null || subscribers.size === 0 || !current) return;
    void openStream();
  }

  function retryLater(): void {
    if (subscribers.size === 0 || !current || retryTimer !== null) return;
    const wait = Math.min(backoff.maxMs, backoff.firstMs * 2 ** attempt);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      ensureStream();
    }, wait);
  }

  function dispatch(data: string): void {
    let signal: { table?: unknown; new?: unknown; old?: unknown };
    try {
      signal = JSON.parse(data) as typeof signal;
    } catch {
      return;
    }
    for (const subscriber of [...subscribers]) {
      if (subscriber.table !== signal.table) continue;
      try {
        subscriber.onSignal(signal.new ?? signal.old ?? null);
      } catch (error) {
        console.error("a live update handler failed", error);
      }
    }
  }

  async function openStream(): Promise<void> {
    const controller = new AbortController();
    stream = controller;
    let why: string;
    try {
      const response = await doFetch(`${base}/api/events`, {
        headers: { accept: "text/event-stream" },
        credentials,
        cache: "no-store",
        signal: controller.signal,
      });
      onDate(response.headers.get("date"));
      if (response.status === 401) {
        if (stream === controller) stream = null;
        lost();
        return;
      }
      if (!response.ok || !response.body) throw new Error(`the stream answered ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const block = parseEvent(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (!block) continue;
          if (block.event === "ready") {
            attempt = 0;
            complained = false;
          } else if (block.event === "change") dispatch(block.data);
        }
      }
      why = "the server closed it";
    } catch (error) {
      if (controller.signal.aborted) return;
      why = error instanceof Error ? error.message : String(error);
    }
    if (stream !== controller) return;
    stream = null;
    // Nothing on screen says live updates are off: the backstop tick keeps the
    // app in step. The console is where "why is it a tick behind" is answered.
    if (!complained) console.error(`live updates not available (${why}); trying again`);
    complained = true;
    retryLater();
  }

  /** Sign-in and sign-up answer alike: the user, and the cookie beside it. */
  function signedIn(reply: Reply, making: boolean): Outcome {
    const user = reply.body?.user as { id?: unknown } | undefined;
    if (reply.response?.ok && typeof user?.id === "string") {
      confirmed = Promise.resolve({ user: { id: user.id } });
      become(user.id);
      return { error: null };
    }
    return { error: { message: accountMessage(reply, making), code: reply.response ? String(reply.response.status) : null } };
  }

  /** Asks the server who the cookie belongs to, once per load. */
  async function confirm(): Promise<AuthSession | null> {
    const asked = epoch;
    const reply = await call("GET", "/api/auth/session");
    // No answer: the marker stands, and the next request will tell. Somebody
    // signed in or out meanwhile: that is newer than this answer.
    if (!reply.response?.ok || epoch !== asked) return current;
    const user = reply.body?.user as { id?: unknown } | null | undefined;
    become(typeof user?.id === "string" ? user.id : null);
    return current;
  }

  // ---- the backend ---------------------------------------------------------

  return {
    kind: "spar-server",
    auth: {
      kind: "password",
      signupState: async (): Promise<SignupState> => {
        // The API's own address rather than `/config.json`, which a service
        // worker or a proxy may have kept: whether the first account exists
        // changes the moment it is made.
        const reply = await call("GET", "/api/config");
        const mode = SIGNUPS.find((m) => m === reply.body?.signup) ?? config.signup ?? "closed";
        return { mode, firstAccount: reply.response?.ok === true && reply.body?.firstAccount === true };
      },
      signIn: async (email: string, password: string): Promise<Outcome> => {
        const reply = await call("POST", "/api/auth/login", { json: { email, password } });
        return signedIn(reply, false);
      },
      signUp: async (account: NewAccount): Promise<Outcome> => {
        const reply = await call("POST", "/api/auth/signup", {
          json: {
            email: account.email,
            password: account.password,
            ...(account.invite ? { invite: account.invite } : {}),
          },
        });
        return signedIn(reply, true);
      },
    },

    account: {
      delete: async (password: string): Promise<Outcome> => {
        const reply = await call("POST", "/api/account/delete", { json: { password } });
        if (reply.response?.ok) {
          become(null);
          return { error: null };
        }
        if (reply.body?.code === "invalid_credentials") {
          return { error: { message: "That password is not right, so nothing was deleted.", code: "403" } };
        }
        return { error: failureOf(reply) };
      },
    },

    session: async () => {
      confirmed ??= confirm();
      // A device with a marker paints and syncs as that person at once; the
      // server's answer arrives behind it and corrects it if it must.
      return current ?? confirmed;
    },
    onSessionChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signOut: async (): Promise<Outcome> => {
      const reply = await call("POST", "/api/auth/logout", { json: {} });
      // Offline, the session stays: a sign-out that did not happen must not
      // look like one that did (`useAuth`'s signOut).
      if (!reply.response?.ok) return { error: failureOf(reply) };
      become(null);
      return { error: null };
    },

    probeColumn: async () => ({ error: null }),

    upsertNotes: (rows) => outcome("POST", "/api/notes", { rows }),
    pullNotes: (_columns, after, limit) => answer<Row[]>("GET", page("/api/notes", after, limit), "notes"),
    notesById: async (_columns, ids) => {
      const found: Row[] = [];
      for (const part of chunks(ids)) {
        const { data, error } = await answer<Row[]>("POST", "/api/notes/by-id", "notes", { ids: part });
        if (error) return { data: null, error };
        found.push(...(data ?? []));
      }
      return { data: found, error: null };
    },
    noteState: (id) => answer<Row>("GET", `/api/notes/${encodeURIComponent(id)}/state`, "state"),
    patchNote: (id, patch) => outcome("PATCH", `/api/notes/${encodeURIComponent(id)}`, patch),
    permanentlyDeleteNote: (id, expectedUpdatedAt) =>
      answer<boolean>("POST", `/api/notes/${encodeURIComponent(id)}/destroy`, "deleted", {
        expected_updated_at: expectedUpdatedAt,
      }),
    pullTombstones: (after, limit) =>
      answer<Row[]>("GET", page("/api/tombstones", after, limit), "tombstones"),
    pullChanges: async ({ notes, tombstones, folders, limit }) => {
      const query = new URLSearchParams();
      cursorParams(query, "notes_", notes);
      cursorParams(query, "tombstones_", tombstones);
      cursorParams(query, "folders_", folders);
      query.set("limit", String(limit));
      const reply = await call("GET", `/api/changes?${query}`);
      if (!reply.response?.ok) return { data: null, error: failureOf(reply) };
      return { data: reply.body, error: null };
    },

    upsertCanvases: (rows) => outcome("POST", "/api/canvases", { rows }),
    pullCanvases: (_columns, after, limit) =>
      answer<Row[]>("GET", page("/api/canvases", after, limit), "canvases"),

    upsertPrefs: (row) => outcome("PUT", "/api/prefs", row),
    writePrefsIf: async (row, readAt) => {
      const reply = await call("PUT", "/api/prefs", { json: { ...row, expected_updated_at: readAt } });
      if (reply.response?.ok) return { data: true, error: null };
      if (reply.response?.status === 412) return { data: false, error: null };
      return { data: null, error: failureOf(reply) };
    },
    readPrefs: () => answer<Row>("GET", "/api/prefs", "prefs"),

    // The server knows the owner from the cookie; the Supabase row names it.
    upsertPushSubscription: (row) => {
      const { owner_id: _owner, ...subscription } = row;
      return outcome("POST", "/api/push/subscribe", subscription);
    },
    deletePushSubscription: (endpoint) => outcome("POST", "/api/push/unsubscribe", { endpoint }),

    uploadFile: async (path, bytes, contentType) => {
      const reply = await call("PUT", `/api/files/${filePath(path)}`, { bytes, contentType });
      if (reply.response?.ok) return { error: null };
      const status = reply.response?.status;
      if (status === 413) return { error: { message: "too large for this server (50 MB a file)", code: "413" } };
      if (status === 507) {
        return { error: { message: "no room left on this server for your files", code: "507" } };
      }
      return { error: failureOf(reply) };
    },
    downloadFile: async (path) => {
      let response: Response;
      try {
        response = await doFetch(
          `${base}/api/files/${filePath(path)}`,
          withDeadline({ credentials, cache: "no-store" }, FILE_REQUEST_MS),
        );
      } catch (error) {
        return { data: null, error: failureOf({ response: null, body: null, failed: String(error) }) };
      }
      onDate(response.headers.get("date"));
      if (response.status === 401) lost();
      if (!response.ok) {
        return { data: null, error: failureOf({ response, body: await readBody(response), failed: null }) };
      }
      return { data: await response.blob(), error: null };
    },
    removeFiles: async (paths) => {
      for (const part of chunks(paths)) {
        const result = await outcome("POST", "/api/files/remove", { paths: part });
        if (result.error) return result;
      }
      return { error: null };
    },

    linkPreview: async <T>(request: { url: string; check?: true }) => {
      const reply = await call("POST", "/api/link-preview", {
        json: request.check ? { url: request.url, check: true } : { url: request.url },
      });
      if (!reply.response) {
        const error: LinkPreviewFailure = { message: reply.failed, answered: false, status: null };
        return { data: null, error };
      }
      if (reply.response.status === 200) return { data: reply.body as T | null, error: null };
      const error: LinkPreviewFailure = {
        message: words(reply.body) ?? `The server answered ${reply.response.status}`,
        answered: true,
        status: reply.response.status,
      };
      return { data: null, error };
    },

    subscribe: (table, onSignal) => {
      const subscriber = { table, onSignal };
      subscribers.add(subscriber);
      ensureStream();
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) closeStream();
      };
    },
  };
}
