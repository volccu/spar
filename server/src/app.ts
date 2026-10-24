/**
 * The spår server: one process, one port, one SQLite file.
 *
 * `createApp` wires the pieces together and answers every route documented in
 * docs/server-api.md. It is used by `main.ts` (the real server), by the
 * conformance driver (conformance/drivers/spar-server.ts), and by the server's
 * own tests, which is why nothing in here reads the environment.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pipeline } from "node:stream";
import { TLSSocket } from "node:tls";
import { allowedOrigins as linkPreviewOrigins } from "../../supabase/functions/_shared/origins";
import type { VapidKeys } from "../../supabase/functions/_shared/webpush";
import { exportArchive } from "./account";
import {
  Accounts,
  COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  type SessionInfo,
  type User,
} from "./auth";
import { Canvases, canvasJson, Prefs, prefsJson } from "./canvases";
import type { ServerConfig } from "./config";
import { openDb, type Db } from "./db";
import { EventHub, type Signal } from "./events";
import { FileStore, MAX_FILE_BYTES, parseFilePath } from "./files";
import {
  badRequest,
  HEALTH_PATH,
  hostAllowed,
  HttpError,
  isJsonRequest,
  parseCookies,
  readObject,
  requestHost,
  Router,
  type RouteMatch,
  sendError,
  sendJson,
  sendNoContent,
  sendRawJson,
  serializeCookie,
  wrongHost,
} from "./http";
import { ensureDataDir, sessionSecret, vapidKeys } from "./keys";
import { LinkPreviewer } from "./linkPreview";
import { Notes, noteJson, tombstoneJson, type Cursor } from "./notes";
import { defaultDeps, pinnedFetchLike, type PinnedFetchDeps } from "./pinnedFetch";
import { Push } from "./push";
import { TokenBucket, WindowCounter } from "./ratelimit";
import { serveStatic } from "./static";
import { createClock, formatInstant, parseInstant, type Micros } from "./time";
import { isUuid } from "./values";

export const API_VERSION = 1;

const KIB = 1024;
const MIB = 1024 * KIB;
/** A batch of up to this many rows per upload. The client sends 500. */
export const MAX_BATCH = 1000;
/** Rows per pull page, at most. */
export const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

export interface AppOptions {
  /** How pushes go out. Defaults to the pinned fetch. */
  pushTransport?: typeof fetch;
  /** How link previews resolve and which addresses they may reach. */
  linkPreviewDeps?: PinnedFetchDeps;
  /** The wall clock, in milliseconds. */
  now?: () => number;
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  ip: string;
  session: SessionInfo | null;
}

export interface App {
  server: Server;
  config: ServerConfig;
  db: Db;
  notes: Notes;
  canvases: Canvases;
  prefs: Prefs;
  push: Push;
  files: FileStore;
  accounts: Accounts;
  hub: EventHub;
  vapidPublicKey: string;
  /** The key pair and subject the sweep signs with. */
  vapidKeys(): VapidKeys;
  clock: () => Micros;
  listen(): Promise<{ host: string; port: number; url: string }>;
  close(): Promise<void>;
}

function userJson(user: User) {
  return { id: user.id, email: user.email, is_admin: user.is_admin, created_at: formatInstant(user.created_at) };
}

const MIN_INSTANT = Number.MIN_SAFE_INTEGER;

/** A cursor from query parameters `<prefix>at` and `<prefix>id` (§6.1). */
function cursorFrom(query: URLSearchParams, prefix: string): Cursor {
  const atText = query.get(`${prefix}at`);
  const idText = query.get(`${prefix}id`);
  let at = MIN_INSTANT;
  if (atText !== null && atText !== "") {
    const parsed = parseInstant(atText);
    if (parsed === null) throw badRequest(`${prefix}at must be an RFC 3339 instant`, "invalid_cursor");
    at = parsed;
  }
  let id: string | null = null;
  if (idText !== null && idText !== "") {
    if (!isUuid(idText)) throw badRequest(`${prefix}id must be a UUID`, "invalid_cursor");
    id = idText.toLowerCase();
  }
  return { at, id };
}

function limitFrom(query: URLSearchParams): number {
  const text = query.get("limit");
  if (text === null || text === "") return DEFAULT_LIMIT;
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw badRequest(`limit must be an integer from 1 to ${MAX_LIMIT}`, "invalid_limit");
  }
  return n;
}

function rowsFrom(body: Record<string, unknown>): unknown[] {
  const rows = body.rows;
  if (!Array.isArray(rows)) throw badRequest("The body must be {\"rows\": [...]}");
  if (rows.length > MAX_BATCH) throw badRequest(`At most ${MAX_BATCH} rows per upload`, "batch_too_large");
  return rows;
}

export async function createApp(config: ServerConfig, options: AppOptions = {}): Promise<App> {
  if (config.backend !== "spar-server") {
    throw new Error(`SPAR_BACKEND=${config.backend} runs no API; serve the app with createSite (site.ts)`);
  }
  ensureDataDir(config.dataDir);
  const db = openDb(join(config.dataDir, "spar.db"));
  const clock = createClock(options.now ?? Date.now);
  const secret = sessionSecret(config.dataDir);
  const generated = await vapidKeys(config.dataDir);
  const accounts = new Accounts(db, secret, clock, config.scryptLogN);
  const notes = new Notes(db, clock);
  const canvases = new Canvases(db, clock);
  const prefs = new Prefs(db, clock);
  const files = new FileStore(config.dataDir, db, clock, config.storageCapBytes);
  const hub = new EventHub();
  const linkDeps = options.linkPreviewDeps ?? defaultDeps;
  const previewer = new LinkPreviewer(linkDeps);

  const vapidPair =
    config.vapidPublicKey && config.vapidPrivateKey
      ? { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey }
      : generated;
  const vapidSubject = (): string => {
    if (config.vapidSubject) return config.vapidSubject;
    const admin = db.prepare("select email from users where is_admin = 1 order by created_at limit 1").get() as
      | { email: string }
      | undefined;
    return admin ? `mailto:${admin.email}` : "mailto:webpush@example.invalid";
  };
  const push = new Push(db, clock, () => ({ ...vapidPair, subject: vapidSubject() }), options.pushTransport ?? pinnedFetchLike());

  const loginByIp = new WindowCounter(50, 15 * 60_000);
  const loginFailures = new WindowCounter(10, 15 * 60_000);
  const signupByIp = new WindowCounter(20, 60 * 60_000);
  const previews = new TokenBucket(config.linkPreviewBurst, config.linkPreviewRefillMs);
  const explicitOrigins = new Set(config.allowedOrigins);
  const allowedHosts = new Set(config.allowedHosts);
  const previewOrigins = linkPreviewOrigins(config.allowedOrigins.join(","));

  // ---- helpers ------------------------------------------------------------

  const secureRequest = (req: IncomingMessage): boolean => {
    if (config.cookieSecure === "always") return true;
    if (config.cookieSecure === "never") return false;
    if (req.socket instanceof TLSSocket) return true;
    return config.trustProxy && String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
  };

  // The RIGHTMOST forwarded address: the one the proxy beside us saw. Every
  // entry left of it was written by the client, and the usual
  // `$proxy_add_x_forwarded_for` keeps whatever the client sent, so reading the
  // leftmost let anyone pick a fresh address per attempt and walk past the
  // sign-in limits (audit SEC-4).
  const clientIp = (req: IncomingMessage): string => {
    if (config.trustProxy) {
      const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((part) => part.trim()).filter(Boolean).pop();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress ?? "unknown";
  };

  const setSessionCookie = (ctx: Ctx, token: string) => {
    ctx.res.setHeader(
      "set-cookie",
      serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds: COOKIE_MAX_AGE_SECONDS, secure: secureRequest(ctx.req) }),
    );
  };

  const clearSessionCookie = (ctx: Ctx) => {
    ctx.res.setHeader("set-cookie", serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: secureRequest(ctx.req) }));
  };

  const requireUser = (ctx: Ctx): SessionInfo => {
    if (!ctx.session) throw new HttpError(401, "unauthenticated", "Sign in first");
    return ctx.session;
  };

  const ownHost = (req: IncomingMessage): string => requestHost(req, config.trustProxy);

  /**
   * Cross-site request forgery: a state-changing request must be one a plain
   * HTML form cannot send (JSON, or the custom header, both of which force a
   * CORS preflight cross-origin), and when the browser names its origin, that
   * origin must be this server or one it was told to trust. The cookie's
   * SameSite=Lax is a third wall behind these two.
   */
  const checkCsrf = (ctx: Ctx, extraOrigins?: Set<string>) => {
    const method = ctx.req.method ?? "GET";
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    if (!isJsonRequest(ctx.req) && ctx.req.headers["x-spar-request"] !== "1") {
      throw new HttpError(403, "csrf", "Send Content-Type: application/json or X-Spar-Request: 1");
    }
    const origin = ctx.req.headers.origin;
    if (origin === undefined) return;
    let host: string;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      host = "";
    }
    if (host && host === ownHost(ctx.req)) return;
    if (explicitOrigins.has(origin) || extraOrigins?.has(origin)) return;
    throw new HttpError(403, "csrf", "That origin may not make changes here");
  };

  const publishAfter = (owner: string, signals: Signal[]) => {
    // After the commit, so a client told "something changed" always finds it.
    hub.publish(owner, signals);
  };

  // In the web client's own `/config.json` format (`parseConfig` in
  // web/src/store/backend/config.ts reads `backend`, `vapidPublicKey` and
  // `signup`, and ignores keys it does not know), so a runtime-config build
  // this server serves finds its backend with no file written for it.
  const publicConfig = () => ({
    backend: "spar-server",
    signup: config.signup,
    vapidPublicKey: vapidPair.publicKey,
    firstAccount: accounts.userCount() === 0,
    api: "/api",
    apiVersion: API_VERSION,
    maxFileBytes: MAX_FILE_BYTES,
    storageCapBytes: config.storageCapBytes,
  });

  /** Every row of a user's, in one transaction; the caller removes the files. */
  const deleteAccount = (userId: string) => {
    db.transaction(() => {
      // Foreign keys cascade from `users`; the explicit deletes keep this
      // correct even on a database opened without them.
      for (const table of ["reminder_deliveries", "canvases", "notes", "tombstones", "prefs_history", "prefs", "push_subscriptions", "files", "sessions"]) {
        const column = table === "sessions" ? "user_id" : "owner_id";
        db.prepare(`delete from ${table} where ${column} = ?`).run(userId);
      }
      db.prepare("delete from users where id = ?").run(userId);
    })();
    hub.close(userId);
  };

  // ---- routes -------------------------------------------------------------

  const router = new Router<Ctx>();

  router.add("GET", HEALTH_PATH, (ctx) => sendJson(ctx.res, 200, { ok: true }));
  router.add("GET", "/api/config", (ctx) => sendJson(ctx.res, 200, publicConfig()));
  router.add("GET", "/config.json", (ctx) => sendJson(ctx.res, 200, publicConfig()));

  // Accounts
  router.add("GET", "/api/auth/session", (ctx) => {
    sendJson(ctx.res, 200, { user: ctx.session ? userJson(ctx.session.user) : null });
  });

  router.add("POST", "/api/auth/signup", async (ctx) => {
    checkCsrf(ctx);
    if (signupByIp.blocked(ctx.ip)) {
      throw new HttpError(429, "rate_limited", "Too many sign-ups from here; try again later", {}, {
        "retry-after": String(Math.ceil(signupByIp.retryAfterMs(ctx.ip) / 1000)),
      });
    }
    const body = await readObject(ctx.req, 16 * KIB);
    signupByIp.hit(ctx.ip);
    const user = await accounts.signUp(body.email, body.password, { mode: config.signup, invite: body.invite });
    if (ctx.session) accounts.endSession(ctx.session.tokenHash);
    setSessionCookie(ctx, accounts.createSession(user.id, ctx.req.headers["user-agent"]));
    sendJson(ctx.res, 201, { user: userJson(user) });
  });

  router.add("POST", "/api/auth/login", async (ctx) => {
    checkCsrf(ctx);
    const body = await readObject(ctx.req, 16 * KIB);
    // Failures count per address AND per email, not per email alone: keyed on
    // the email, ten wrong guesses from anyone locked its owner out with the
    // right password in hand (audit SEC-4). Each address still has its own
    // ceiling across every email (`loginByIp`).
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    const failureKey = JSON.stringify([ctx.ip, email]);
    const blockedFor = Math.max(loginByIp.retryAfterMs(ctx.ip), loginFailures.retryAfterMs(failureKey));
    if (blockedFor > 0) {
      throw new HttpError(429, "rate_limited", "Too many sign-in attempts; try again later", {}, {
        "retry-after": String(Math.ceil(blockedFor / 1000)),
      });
    }
    loginByIp.hit(ctx.ip);
    const user = await accounts.checkPassword(body.email, body.password);
    if (!user) {
      loginFailures.hit(failureKey);
      throw new HttpError(401, "invalid_credentials", "That email and password do not match an account");
    }
    loginFailures.reset(failureKey);
    if (ctx.session) accounts.endSession(ctx.session.tokenHash);
    setSessionCookie(ctx, accounts.createSession(user.id, ctx.req.headers["user-agent"]));
    sendJson(ctx.res, 200, { user: userJson(user) });
  });

  router.add("POST", "/api/auth/logout", (ctx) => {
    checkCsrf(ctx);
    if (ctx.session) {
      accounts.endSession(ctx.session.tokenHash);
      hub.close(ctx.session.user.id, ctx.session.tokenHash);
    }
    clearSessionCookie(ctx);
    sendNoContent(ctx.res);
  });

  router.add("POST", "/api/auth/password", async (ctx) => {
    checkCsrf(ctx);
    const { user, tokenHash } = requireUser(ctx);
    const body = await readObject(ctx.req, 16 * KIB);
    if (!(await accounts.verifyUserPassword(user.id, body.current_password))) {
      throw new HttpError(403, "invalid_credentials", "The current password is not right");
    }
    await accounts.setPassword(user.id, body.new_password);
    accounts.endSessionsOf(user.id, tokenHash);
    sendNoContent(ctx.res);
  });

  // Live updates
  router.add("GET", "/api/events", (ctx) => {
    const { user, tokenHash } = requireUser(ctx);
    ctx.res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    ctx.res.write("retry: 3000\n\nevent: ready\ndata: {}\n\n");
    const remove = hub.add(user.id, tokenHash, ctx.res);
    ctx.req.socket.setTimeout(0);
    ctx.res.on("close", remove);
  });

  // Notes
  router.add("POST", "/api/notes", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    const rows = rowsFrom(await readObject(ctx.req, 64 * MIB));
    const result = db.transaction(() => notes.upsert(user.id, rows))();
    publishAfter(user.id, result.signals);
    sendJson(ctx.res, 200, { count: rows.length });
  });

  router.add("GET", "/api/notes", (ctx) => {
    const { user } = requireUser(ctx);
    const rows = notes.pull(user.id, cursorFrom(ctx.url.searchParams, "after_"), limitFrom(ctx.url.searchParams));
    sendRawJson(ctx.res, 200, `{"notes":[${rows.map(noteJson).join(",")}]}`);
  });

  router.add("POST", "/api/notes/by-id", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    const body = await readObject(ctx.req, 1 * MIB);
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length > MAX_LIMIT || !ids.every((id) => typeof id === "string")) {
      throw badRequest(`ids must be an array of at most ${MAX_LIMIT} strings`);
    }
    const valid = [...new Set((ids as string[]).filter(isUuid).map((id) => id.toLowerCase()))];
    const rows = notes.byIds(user.id, valid);
    sendRawJson(ctx.res, 200, `{"notes":[${rows.map(noteJson).join(",")}]}`);
  });

  router.add("GET", "/api/notes/:id/state", (ctx, m) => {
    const { user } = requireUser(ctx);
    const state = isUuid(m.params.id) ? notes.state(user.id, m.params.id.toLowerCase()) : null;
    sendRawJson(
      ctx.res,
      200,
      state
        ? `{"state":{"id":${JSON.stringify(state.id)},"status":${JSON.stringify(state.status)},"field_updated_at":${state.field_updated_at}}}`
        : `{"state":null}`,
    );
  });

  router.add("PATCH", "/api/notes/:id", async (ctx, m) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    if (!isUuid(m.params.id)) throw badRequest("The note id must be a UUID", "invalid_id");
    const body = await readObject(ctx.req, 64 * MIB);
    const result = db.transaction(() => notes.patch(user.id, m.params.id.toLowerCase(), body))();
    publishAfter(user.id, result.signals);
    sendNoContent(ctx.res);
  });

  router.add("POST", "/api/notes/:id/destroy", async (ctx, m) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    const body = await readObject(ctx.req, 16 * KIB);
    const expected = parseInstant(body.expected_updated_at);
    if (expected === null) throw badRequest("expected_updated_at must be an RFC 3339 instant", "invalid_instant");
    if (!isUuid(m.params.id)) {
      sendJson(ctx.res, 200, { deleted: false });
      return;
    }
    const id = m.params.id.toLowerCase();
    const signals = db.transaction(() => notes.destroy(user.id, id, expected))();
    if (signals) {
      await files.removeNote(user.id, id);
      publishAfter(user.id, signals);
    }
    sendJson(ctx.res, 200, { deleted: signals !== null });
  });

  router.add("GET", "/api/tombstones", (ctx) => {
    const { user } = requireUser(ctx);
    const rows = notes.pullTombstones(user.id, cursorFrom(ctx.url.searchParams, "after_"), limitFrom(ctx.url.searchParams));
    sendRawJson(ctx.res, 200, `{"tombstones":[${rows.map(tombstoneJson).join(",")}]}`);
  });

  router.add("GET", "/api/changes", (ctx) => {
    const { user } = requireUser(ctx);
    const q = ctx.url.searchParams;
    const limit = limitFrom(q);
    const nCursor = cursorFrom(q, "notes_");
    const tCursor = cursorFrom(q, "tombstones_");
    const fCursor = cursorFrom(q, "folders_");
    // One read transaction: the four answers describe one moment.
    const text = db.transaction(() => {
      const noteRows = notes.pull(user.id, nCursor, limit);
      const stones = notes.pullTombstones(user.id, tCursor, limit);
      const folders = canvases.pull(user.id, fCursor, limit);
      const row = prefs.read(user.id);
      return (
        `{"notes":[${noteRows.map(noteJson).join(",")}],"tombstones":[${stones.map(tombstoneJson).join(",")}],` +
        `"folders":[${folders.map(canvasJson).join(",")}],"prefs":${row ? prefsJson(row) : "null"}}`
      );
    })();
    sendRawJson(ctx.res, 200, text);
  });

  // Canvases
  router.add("POST", "/api/canvases", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    const rows = rowsFrom(await readObject(ctx.req, 16 * MIB));
    const signals = db.transaction(() => canvases.upsert(user.id, rows))();
    publishAfter(user.id, signals);
    sendJson(ctx.res, 200, { count: rows.length });
  });

  router.add("GET", "/api/canvases", (ctx) => {
    const { user } = requireUser(ctx);
    const rows = canvases.pull(user.id, cursorFrom(ctx.url.searchParams, "after_"), limitFrom(ctx.url.searchParams));
    sendRawJson(ctx.res, 200, `{"canvases":[${rows.map(canvasJson).join(",")}]}`);
  });

  // Preferences
  router.add("GET", "/api/prefs", (ctx) => {
    const { user } = requireUser(ctx);
    const row = prefs.read(user.id);
    sendRawJson(ctx.res, 200, `{"prefs":${row ? prefsJson(row) : "null"}}`);
  });

  router.add("PUT", "/api/prefs", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    const body = await readObject(ctx.req, 4 * MIB);
    const signals = db.transaction(() => prefs.upsert(user.id, body))();
    publishAfter(user.id, signals);
    const row = prefs.read(user.id);
    sendRawJson(ctx.res, 200, `{"prefs":${row ? prefsJson(row) : "null"}}`);
  });

  // Push
  router.add("POST", "/api/push/subscribe", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    push.subscribe(user.id, await readObject(ctx.req, 16 * KIB));
    sendNoContent(ctx.res);
  });

  router.add("POST", "/api/push/unsubscribe", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    push.unsubscribe(user.id, (await readObject(ctx.req, 16 * KIB)).endpoint);
    sendNoContent(ctx.res);
  });

  // Files
  const fileFor = (ctx: Ctx, match: RouteMatch) => {
    const { user } = requireUser(ctx);
    const file = parseFilePath(match.rest, true);
    return { user, file: file && file.owner === user.id ? file : null };
  };

  router.add("PUT", "/api/files/*", async (ctx, m) => {
    checkCsrf(ctx);
    const { file } = fileFor(ctx, m);
    if (!file) {
      ctx.req.resume();
      throw new HttpError(403, "forbidden_path", "Files go under <your user id>/<note id>/<attachment id>");
    }
    await files.write(file, ctx.req);
    sendNoContent(ctx.res);
  });

  router.add("GET", "/api/files/*", async (ctx, m) => {
    const { file } = fileFor(ctx, m);
    const found = file ? await files.open(file) : null;
    if (!found) throw new HttpError(404, "not_found", "Object not found");
    ctx.res.writeHead(200, {
      "content-type": found.type,
      "content-length": found.size,
      // Never rendered as a page of this origin, whatever it claims to be.
      "content-disposition": "attachment",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
    });
    if (ctx.req.method === "HEAD") {
      ctx.res.end();
      return;
    }
    const stream = found.stream();
    // `pipe` leaves the file open when the client hangs up mid-download;
    // `pipeline` closes both ends whichever one stops first.
    pipeline(stream, ctx.res, () => undefined);
  });

  router.add("POST", "/api/files/remove", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    const body = await readObject(ctx.req, 1 * MIB);
    const paths = body.paths;
    if (!Array.isArray(paths) || paths.length > MAX_BATCH || !paths.every((p) => typeof p === "string")) {
      throw badRequest(`paths must be an array of at most ${MAX_BATCH} strings`);
    }
    const mine = (paths as string[]).map((p) => parseFilePath(p, false)).filter((f) => f !== null && f.owner === user.id);
    await files.remove(mine as NonNullable<(typeof mine)[number]>[]);
    sendNoContent(ctx.res);
  });

  // Link previews (§13). CORS here follows the contract: the allow-list plus
  // the local dev server, with no credentials.
  const previewCors = (ctx: Ctx) => {
    const origin = ctx.req.headers.origin;
    ctx.res.setHeader("access-control-allow-headers", "authorization, x-client-info, apikey, content-type, x-spar-request");
    ctx.res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    ctx.res.setHeader("vary", "Origin");
    if (origin && previewOrigins.has(origin)) {
      ctx.res.setHeader("access-control-allow-origin", origin);
      if (explicitOrigins.has(origin)) ctx.res.setHeader("access-control-allow-credentials", "true");
    }
  };
  const previewAnswer = (ctx: Ctx, status: number, body: unknown) => {
    previewCors(ctx);
    sendJson(ctx.res, status, body);
  };
  router.add("OPTIONS", "/api/link-preview", (ctx) => previewAnswer(ctx, 200, { ok: true }));
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
    router.add(method, "/api/link-preview", (ctx) => previewAnswer(ctx, 405, { error: "Method Not Allowed" }));
  }
  router.add("POST", "/api/link-preview", async (ctx) => {
    previewCors(ctx);
    if (!ctx.session) {
      sendJson(ctx.res, 401, { error: "Authentication required" });
      return;
    }
    checkCsrf(ctx, previewOrigins);
    let body: Record<string, unknown>;
    try {
      body = await readObject(ctx.req, 64 * KIB);
    } catch (error) {
      if (error instanceof HttpError && error.status === 413) throw error;
      sendJson(ctx.res, 400, { error: "Invalid JSON body" });
      return;
    }
    const wait = previews.take(ctx.session.user.id);
    if (wait > 0) {
      throw new HttpError(429, "rate_limited", "Too many link previews; try again shortly", {}, {
        "retry-after": String(Math.ceil(wait / 1000)),
      });
    }
    const answer = await previewer.preview(body);
    sendJson(ctx.res, answer.status, answer.body);
  });

  // The account
  router.add("GET", "/api/account", (ctx) => {
    const { user } = requireUser(ctx);
    sendJson(ctx.res, 200, {
      user: userJson(user),
      storage: { used_bytes: files.used(user.id), cap_bytes: config.storageCapBytes },
    });
  });

  router.add("GET", "/api/account/export", async (ctx) => {
    const { user } = requireUser(ctx);
    const { bytes, fileName } = await exportArchive(
      user.id,
      { notes: notes.all(user.id), prefs: prefs.read(user.id), canvases: canvases.all(user.id) },
      files,
    );
    ctx.res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": bytes.length,
      "content-disposition": `attachment; filename="spar-export.zip"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "no-store",
    });
    ctx.res.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });

  router.add("POST", "/api/account/delete", async (ctx) => {
    checkCsrf(ctx);
    const { user } = requireUser(ctx);
    const body = await readObject(ctx.req, 16 * KIB);
    if (!(await accounts.verifyUserPassword(user.id, body.password))) {
      throw new HttpError(403, "invalid_credentials", "The password is not right");
    }
    deleteAccount(user.id);
    await files.removeOwner(user.id);
    clearSessionCookie(ctx);
    sendNoContent(ctx.res);
  });

  // ---- the request loop ----------------------------------------------------

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // A client that hangs up mid-answer makes a later write fail; that is the
    // client's business, never a reason for the process to fall over.
    res.on("error", () => undefined);
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendError(res, badRequest("Bad request URL"));
      return;
    }
    const path = url.pathname;
    res.setHeader("x-content-type-options", "nosniff");
    if (!hostAllowed(req, path, allowedHosts, config.trustProxy)) {
      req.resume();
      sendError(res, wrongHost());
      return;
    }
    const isApi = path === "/api" || path.startsWith("/api/") || path === "/config.json";
    if (!isApi) {
      if (config.webDir && (req.method === "GET" || req.method === "HEAD")) {
        await serveStatic(req, res, config.webDir, path);
      } else {
        sendError(res, new HttpError(404, "not_found", "Not found"));
      }
      return;
    }

    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    const origin = req.headers.origin;
    if (origin && explicitOrigins.has(origin) && path !== "/api/link-preview") {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-credentials", "true");
      res.setHeader("vary", "Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("access-control-allow-headers", "content-type, x-spar-request");
        res.setHeader("access-control-max-age", "600");
        sendNoContent(res);
        return;
      }
    }

    const found = router.find(req.method ?? "GET", path);
    if (!found) {
      req.resume();
      sendError(res, new HttpError(404, "not_found", "No such endpoint"));
      return;
    }
    if ("allowed" in found) {
      req.resume();
      sendError(res, new HttpError(405, "method_not_allowed", "Method not allowed", {}, { allow: found.allowed.join(", ") }));
      return;
    }
    const ctx: Ctx = {
      req,
      res,
      url,
      ip: clientIp(req),
      session: accounts.session(parseCookies(req.headers.cookie).get(SESSION_COOKIE)),
    };
    await found.handler(ctx, found.match);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendError(res, error);
        return;
      }
      console.error("request failed:", error);
      sendError(res, new HttpError(500, "internal", "Something went wrong on the server"));
    });
  });
  server.requestTimeout = 10 * 60_000;
  server.headersTimeout = 60_000;

  // ---- timers ---------------------------------------------------------------

  const timers: NodeJS.Timeout[] = [];
  const housekeeping = () => {
    try {
      notes.pruneTombstones();
      accounts.pruneSessions();
      loginByIp.sweep();
      loginFailures.sweep();
      signupByIp.sweep();
      previews.sweep();
    } catch (error) {
      console.error("housekeeping failed:", error);
    }
  };
  const sweep = () => {
    push.sweep().catch((error: unknown) => console.error("reminder sweep failed:", error));
  };

  return {
    server,
    config,
    db,
    notes,
    canvases,
    prefs,
    push,
    files,
    accounts,
    hub,
    vapidPublicKey: vapidPair.publicKey,
    vapidKeys: () => ({ ...vapidPair, subject: vapidSubject() }),
    clock,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      timers.push(setInterval(() => hub.heartbeat((hash) => accounts.sessionExists(hash)), 25_000));
      if (config.timers) {
        housekeeping();
        timers.push(setInterval(housekeeping, 60 * 60_000));
        timers.push(setTimeout(sweep, 5_000));
        timers.push(setInterval(sweep, 60_000));
      }
      for (const timer of timers) timer.unref();
      const address = server.address() as AddressInfo;
      const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
      return { host: address.address, port: address.port, url: `http://${host}:${address.port}` };
    },
    async close() {
      for (const timer of timers) clearInterval(timer);
      hub.closeAll();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      db.close();
    },
  };
}
