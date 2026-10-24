/**
 * A `fetch` for addresses a user supplied, that cannot be turned against the
 * server's own network.
 *
 * The Supabase function checks a name's DNS answers and then calls `fetch`,
 * which resolves the name **again** — so a name that answers a public address
 * to the check and a private one to the fetch (DNS rebinding) walks straight
 * through. Here the name is resolved once, every answer is checked, and the
 * connection is made to the checked address itself: the socket's `lookup` is
 * replaced by one that can only return it. TLS still verifies the certificate
 * against the name, so pinning costs nothing in authenticity.
 *
 * It never follows a redirect (the caller walks them, re-checking each hop),
 * and it decompresses the body as `fetch` would.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isPrivateAddress, publicUrlShape } from "./netguard";

/** The address is not a public web address (answered 400 by link previews). */
export class NotPublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotPublicError";
  }
}

export interface PinnedFetchDeps {
  /** Every address a name resolves to. */
  resolve: (host: string) => Promise<string[]>;
  /** Whether the server may connect to this address. */
  allowed: (address: string) => boolean;
  /** Whether the server may connect to this port. */
  allowedPort: (port: number) => boolean;
}

const DNS_TIMEOUT_MS = 5_000;

export async function systemResolve(host: string): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_TIMEOUT_MS);
  });
  try {
    const answers = await Promise.race([dnsLookup(host, { all: true, verbatim: true }), timeout]);
    return answers.map((a) => a.address);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Only the two standard web ports. A "public" address can still be this very
 * machine — its own public IP, reached from inside, skips the firewall that
 * guards its other ports from the internet — so a user-supplied URL may not
 * name any port a web page is not normally served on.
 */
export const WEB_PORTS: ReadonlySet<number> = new Set([80, 443]);

export const defaultDeps: PinnedFetchDeps = {
  resolve: systemResolve,
  allowed: (address) => !isPrivateAddress(address),
  allowedPort: (port) => WEB_PORTS.has(port),
};

/**
 * The one address this URL may be fetched from, after the shape check and a
 * check of **every** address its name resolves to. Throws `NotPublicError`.
 */
export async function checkedAddress(url: URL, deps: PinnedFetchDeps): Promise<string> {
  if (!publicUrlShape(url.toString())) throw new NotPublicError("Only public http(s) URLs are supported");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!deps.allowedPort(port)) throw new NotPublicError("Only the standard web ports (80 and 443) are supported");
  const host = url.hostname.replace(/\.+$/, "");
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await deps.resolve(host);
    } catch {
      throw new NotPublicError("The host name does not resolve");
    }
  }
  if (addresses.length === 0) throw new NotPublicError("The host name does not resolve");
  if (addresses.some((address) => !deps.allowed(address))) {
    throw new NotPublicError("The host name resolves to an address that is not public");
  }
  return addresses[0];
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/** The body, decompressed. `pipeline` (not `pipe`) so a reset connection
 *  errors the decompressor too, instead of leaving a reader waiting forever. */
function decoded(res: IncomingMessage): Readable {
  const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const ignore = () => undefined;
  if (encoding === "gzip" || encoding === "x-gzip") return pipeline(res, createGunzip(), ignore);
  if (encoding === "deflate") return pipeline(res, createInflate(), ignore);
  if (encoding === "br") return pipeline(res, createBrotliDecompress(), ignore);
  return res;
}

export interface PinnedInit {
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  signal?: AbortSignal;
}

/**
 * One request to a public address, pinned to the address that was checked.
 * Resolves to a standard `Response` (redirects are returned, not followed).
 */
export async function pinnedFetch(input: string | URL, init: PinnedInit = {}, deps: PinnedFetchDeps = defaultDeps): Promise<Response> {
  const url = new URL(String(input));
  const address = await checkedAddress(url, deps);
  const family = isIP(address) === 6 ? 6 : 4;
  const host = url.hostname.replace(/\.+$/, "");
  const pinned: LookupFunction = (_name, options, callback) => {
    const cb = callback as (...args: unknown[]) => void;
    if ((options as { all?: boolean }).all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: { "accept-encoding": "gzip, deflate, br", ...init.headers, host: url.host },
        lookup: pinned,
        agent: false,
        signal: init.signal,
        ...(url.protocol === "https:" && !isIP(host) ? { servername: host } : {}),
      },
      (res) => {
        // Errors reach the reader through the web stream below; this listener
        // only keeps an error on a body nobody reads from being fatal.
        res.on("error", () => undefined);
        const status = res.statusCode ?? 502;
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
        }
        headers.delete("content-encoding");
        headers.delete("content-length");
        if (NULL_BODY.has(status) || init.method === "HEAD") {
          res.resume();
          resolve(new Response(null, { status: status < 200 ? 502 : status, headers }));
          return;
        }
        const body = Readable.toWeb(decoded(res)) as ReadableStream<Uint8Array>;
        try {
          resolve(new Response(body, { status: status >= 200 && status <= 599 ? status : 502, headers }));
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.end(init.body);
    else req.end();
  });
}

/** `pinnedFetch` in the shape of the global `fetch`, for code written against it. */
export function pinnedFetchLike(deps: PinnedFetchDeps = defaultDeps): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = init?.body;
    return pinnedFetch(
      url,
      {
        method: init?.method,
        headers,
        body: body instanceof Uint8Array || typeof body === "string" ? body : undefined,
        signal: init?.signal ?? undefined,
      },
      deps,
    );
  }) as typeof fetch;
}
