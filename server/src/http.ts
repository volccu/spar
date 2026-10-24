/**
 * The small HTTP layer: errors that know their status, bounded body reading,
 * JSON answers, cookies and a router. node:http underneath and nothing else —
 * the server has a couple of dozen routes, and a framework would be more code
 * to audit than the routes themselves.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, code = "bad_request") => new HttpError(400, code, message);

/**
 * A row the server read and declined: the contract's **row refusal**
 * (docs/sync-contract.md §3.5). Always HTTP 409 with `code: "row_refused"`, so
 * a client can tell it from every failure that is about the request.
 */
export function rowRefused(reason: string, message: string, id?: string): HttpError {
  return new HttpError(409, "row_refused", message, { reason, ...(id ? { id } : {}) });
}

/** Reads the whole body, refusing (413) past `limit` bytes without buffering the rest. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new HttpError(413, "too_large", `The request body is larger than ${limit} bytes`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > limit) {
      req.resume();
      throw new HttpError(413, "too_large", `The request body is larger than ${limit} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export function isJsonRequest(req: IncomingMessage): boolean {
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json";
}

export async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw badRequest("The body is not valid JSON", "invalid_json");
  }
}

/** A JSON object body, or 400. */
export async function readObject(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const value = await readJson(req, limit);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("The body must be a JSON object");
  return value as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  sendRawJson(res, status, JSON.stringify(body));
}

/** Sends JSON text that is already serialised (the pulls build theirs by hand). */
export function sendRawJson(res: ServerResponse, status: number, text: string): void {
  const bytes = Buffer.from(text, "utf8");
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": bytes.length });
  res.end(bytes);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export function sendError(res: ServerResponse, error: HttpError): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
  sendJson(res, error.status, { error: error.message, code: error.code, ...error.extra });
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || out.has(name)) continue;
    out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

/** The host name (and port) a request was sent to, per `X-Forwarded-Host` behind a trusted proxy. */
export function requestHost(req: IncomingMessage, trustProxy: boolean): string {
  const forwarded = trustProxy ? String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim() : "";
  return (forwarded || String(req.headers.host ?? "")).toLowerCase();
}

/** The one path answered whatever the `Host`: it says nothing, and a container's healthcheck asks by address. */
export const HEALTH_PATH = "/api/health";

/**
 * `SPAR_ALLOWED_HOSTS`: an empty list answers any host; otherwise the request's
 * host, with or without its port, must be on it. The health check is exempt.
 */
export function hostAllowed(req: IncomingMessage, path: string, allowed: ReadonlySet<string>, trustProxy: boolean): boolean {
  if (allowed.size === 0 || path === HEALTH_PATH) return true;
  const host = requestHost(req, trustProxy);
  return allowed.has(host) || allowed.has(host.replace(/:\d+$/, ""));
}

export const wrongHost = () => new HttpError(421, "wrong_host", "This server does not answer to that host name");

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${options.maxAgeSeconds}`];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RouteMatch {
  params: Record<string, string>;
  /** The rest of the path for a route ending in `*`, still percent-encoded. */
  rest: string;
}

type Handler<C> = (ctx: C, match: RouteMatch) => Promise<void> | void;

interface Route<C> {
  method: string;
  segments: string[];
  wildcard: boolean;
  handler: Handler<C>;
}

export class Router<C> {
  private routes: Route<C>[] = [];

  add(method: string, pattern: string, handler: Handler<C>): this {
    const wildcard = pattern.endsWith("/*");
    const segments = (wildcard ? pattern.slice(0, -2) : pattern).split("/").filter(Boolean);
    this.routes.push({ method, segments, wildcard, handler });
    return this;
  }

  /**
   * The route for a path: `{handler, match}`, or which methods the path does
   * answer (for a 405), or null when nothing lives there.
   */
  find(method: string, path: string): { handler: Handler<C>; match: RouteMatch } | { allowed: string[] } | null {
    const parts = path.split("/").filter(Boolean);
    const allowed: string[] = [];
    for (const route of this.routes) {
      const match = matchRoute(route, parts);
      if (!match) continue;
      if (route.method === method || (method === "HEAD" && route.method === "GET")) return { handler: route.handler, match };
      allowed.push(route.method);
    }
    return allowed.length > 0 ? { allowed } : null;
  }
}

function matchRoute<C>(route: Route<C>, parts: string[]): RouteMatch | null {
  if (route.wildcard ? parts.length <= route.segments.length : parts.length !== route.segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < route.segments.length; i++) {
    const want = route.segments[i];
    if (want.startsWith(":")) {
      let value: string;
      try {
        value = decodeURIComponent(parts[i]);
      } catch {
        return null;
      }
      params[want.slice(1)] = value;
    } else if (want !== parts[i]) {
      return null;
    }
  }
  return { params, rest: parts.slice(route.segments.length).join("/") };
}
