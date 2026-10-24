/**
 * The same process with the spår server switched off: `SPAR_BACKEND=supabase`
 * or `none`. It serves the built app and the `/config.json` that points it at
 * its backend, and nothing else — no API, no database, no timers, and not one
 * write to the data folder — so the one container image serves an instance
 * that syncs through Supabase (or not at all) with no rebuild.
 *
 * `/api/health` still answers, for the container's healthcheck. Every other
 * `/api/…` path is a 404: the app in these modes never asks for one, and a
 * client that does is pointed at the wrong server.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ServerConfig } from "./config";
import { HEALTH_PATH, hostAllowed, HttpError, sendError, sendJson, wrongHost } from "./http";
import { serveStatic } from "./static";

export interface Site {
  server: Server;
  config: ServerConfig;
  listen(): Promise<{ host: string; port: number; url: string }>;
  close(): Promise<void>;
}

/**
 * `/config.json` in the web client's own format (`parseConfig` in
 * web/src/store/backend/config.ts). The Supabase values are public by design:
 * the project URL and its publishable key are what every Supabase web app
 * ships to the browser; row-level security is what guards the data.
 */
export function siteConfig(config: ServerConfig): Record<string, string> {
  if (config.backend === "supabase") {
    return {
      backend: "supabase",
      supabaseUrl: config.supabaseUrl ?? "",
      supabaseKey: config.supabaseKey ?? "",
      ...(config.vapidPublicKey ? { vapidPublicKey: config.vapidPublicKey } : {}),
      // Only "open" lets a sign-in link make an account (`supabaseBackend.ts`);
      // the project's own dashboard setting still has the last word.
      signup: config.signup,
    };
  }
  return { backend: "none" };
}

export function createSite(config: ServerConfig): Site {
  if (config.backend === "spar-server") throw new Error("SPAR_BACKEND=spar-server is the full server; use createApp");
  if (!config.webDir) throw new Error(`SPAR_BACKEND=${config.backend} needs SPAR_WEB_DIR`);
  const webDir = config.webDir;
  const allowedHosts = new Set(config.allowedHosts);
  const answer = siteConfig(config);

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    res.on("error", () => undefined);
    req.resume();
    let path: string;
    try {
      path = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      sendError(res, new HttpError(400, "bad_request", "Bad request URL"));
      return;
    }
    res.setHeader("x-content-type-options", "nosniff");
    if (!hostAllowed(req, path, allowedHosts, config.trustProxy)) {
      sendError(res, wrongHost());
      return;
    }
    const method = req.method ?? "GET";
    const read = method === "GET" || method === "HEAD";
    const isApi = path === "/api" || path.startsWith("/api/") || path === "/config.json";
    if (isApi) {
      res.setHeader("cache-control", "no-store");
      res.setHeader("referrer-policy", "no-referrer");
      if (read && path === HEALTH_PATH) {
        sendJson(res, 200, { ok: true });
      } else if (read && path === "/config.json") {
        sendJson(res, 200, answer);
      } else {
        sendError(
          res,
          new HttpError(404, "not_found", `This instance syncs through ${config.backend === "supabase" ? "Supabase" : "nothing"}; the spår server API is off`),
        );
      }
      return;
    }
    if (!read) {
      sendError(res, new HttpError(404, "not_found", "Not found"));
      return;
    }
    await serveStatic(req, res, webDir, path);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error("request failed:", error);
      sendError(res, new HttpError(500, "internal", "Something went wrong on the server"));
    });
  });
  server.headersTimeout = 60_000;

  return {
    server,
    config,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address() as AddressInfo;
      const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
      return { host: address.address, port: address.port, url: `http://${host}:${address.port}` };
    },
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
