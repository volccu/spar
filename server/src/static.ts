/**
 * Serving the built PWA (`web/dist/`) from the same port as the API, so one
 * container is the whole instance and the session cookie is same-origin.
 *
 * Only what `SPAR_WEB_DIR` holds is reachable: the path is resolved and must
 * stay inside that folder. A path that names no file falls back to
 * `index.html`, as a single-page app needs. Hashed assets are cached for a
 * year; the page, the service workers and the manifest never, so a deploy is
 * picked up on the next open — the same policy as `deploy/nginx.conf`.
 */
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, posix, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

const NEVER_CACHE = new Set(["/index.html", "/sw.js", "/push-sw.js", "/share-sw.js", "/manifest.webmanifest", "/registerSW.js"]);

async function fileAt(root: string, path: string): Promise<{ path: string; size: number } | null> {
  const full = resolve(root, `.${path}`);
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    const info = await stat(full);
    return info.isFile() ? { path: full, size: info.size } : null;
  } catch {
    return null;
  }
}

export async function serveStatic(req: IncomingMessage, res: ServerResponse, webDir: string, rawPath: string): Promise<void> {
  const root = resolve(webDir);
  let path: string;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    path = "/";
  }
  if (path.includes("\0")) path = "/";
  // A URL path, so always forward slashes: `join` on Windows made `\index.html`,
  // which missed NEVER_CACHE and cached the page for an hour (audit CODE-7).
  let served = path.endsWith("/") ? posix.join(path, "index.html") : path;
  let found = await fileAt(root, served);
  if (!found) {
    // Anything that is not a file is a route inside the app.
    found = await fileAt(root, "/index.html");
    served = "/index.html";
  }
  if (!found) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const cache = NEVER_CACHE.has(served)
    ? "no-cache"
    : served.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=3600";
  res.writeHead(200, {
    "content-type": TYPES[extname(found.path).toLowerCase()] ?? "application/octet-stream",
    "content-length": found.size,
    "cache-control": cache,
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  // `pipeline`, not `pipe`: a client that hangs up must not leave the file open.
  pipeline(createReadStream(found.path), res, () => undefined);
}
