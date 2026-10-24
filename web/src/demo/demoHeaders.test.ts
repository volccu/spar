// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The public demo's `_headers` (web/demo-site/, copied into the demo's output
 * for Cloudflare Pages) against the headers the app is served with everywhere
 * else.
 *
 * The demo is allowed exactly two differences in its Content-Security-Policy,
 * both of them narrowings: it connects to nothing but its own address (there is
 * no server behind it), and it loads no picture from elsewhere (no link preview
 * is ever fetched there). Every other directive, and every other security
 * header, must say what the owner's nginx says — so a hardening made in one is
 * not silently missing from the other.
 */

const HEADERS = join(__dirname, "..", "..", "demo-site", "_headers");
// The owner's deployment. It is not in the public tree, and then the
// comparison stands down and only the demo's own promises are checked.
const NGINX = join(__dirname, "..", "..", "..", "deploy", "nginx.conf");

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values.join(" ")];
      }),
  );
}

/** Every `Name: value` under the `/*` block. */
function demoHeaders(): Map<string, string> {
  const lines = readFileSync(HEADERS, "utf8").split("\n");
  const out = new Map<string, string>();
  let inAll = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inAll = line.trim() === "/*";
    else if (inAll && line.trim() && !line.trim().startsWith("#")) {
      const at = line.indexOf(":");
      out.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
  }
  return out;
}

function nginxHeaders(): Map<string, string> {
  const conf = readFileSync(NGINX, "utf8");
  return new Map(
    [...conf.matchAll(/add_header\s+(\S+)\s+"([^"]*)"\s+always;/g)].map((m) => [m[1], m[2]]),
  );
}

describe("the demo's headers", () => {
  const demo = demoHeaders();
  const csp = directives(demo.get("Content-Security-Policy") ?? "");

  it("connects to nothing but its own address, and loads no picture from elsewhere", () => {
    expect(csp.get("connect-src")).toBe("'self'");
    expect(csp.get("img-src")).toBe("'self' data: blob:");
    expect(csp.get("frame-ancestors")).toBe("'none'");
    expect(csp.get("object-src")).toBe("'none'");
  });

  // Audit SEC-8: a link opened from a note told the site it went to which
  // host the app lives on. `same-origin` sends nothing to any other site.
  it("sends no referrer to any other site", () => {
    expect(demo.get("Referrer-Policy")).toBe("same-origin");
  });

  it.runIf(existsSync(NGINX))("says everything else exactly as the owner's nginx does", () => {
    const owner = nginxHeaders();
    const ownerCsp = directives(owner.get("Content-Security-Policy") ?? "");
    expect(ownerCsp.size).toBeGreaterThan(5);
    for (const [name, value] of ownerCsp) {
      if (name === "connect-src" || name === "img-src") continue;
      expect(csp.get(name), name).toBe(value);
    }
    expect([...csp.keys()].sort()).toEqual([...ownerCsp.keys()].sort());
    for (const [name, value] of owner) {
      if (name === "Content-Security-Policy" || name === "Cache-Control" || name === "Permissions-Policy") continue;
      expect(demo.get(name), name).toBe(value);
    }
  });

  // The creature's weather (2026-10-23) is the owner's app alone: its nginx
  // lets this site ask where the device is, and the demo, which has no weather,
  // still refuses. Camera and microphone stay refused in both.
  it.runIf(existsSync(NGINX))("asks for a location only in the owner's app, never in the demo", () => {
    expect(demo.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(nginxHeaders().get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=(self)");
  });
});
