/**
 * Link previews against a page server of our own on loopback. The tests stand
 * a made-up name (`page.test`) on 127.0.0.1 and tell the fetcher that one
 * address is "public", so everything below the address check runs for real:
 * pinning, redirects, re-checks, the answers, the limits.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LinkPreviewer } from "../src/linkPreview";
import { checkedAddress, defaultDeps, NotPublicError, pinnedFetch, type PinnedFetchDeps } from "../src/pinnedFetch";

let server: Server;
let port = 0;
let seenHosts: string[] = [];
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

function page(res: ServerResponse, html: string, headers: Record<string, string> = {}) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(html);
}

function route(req: IncomingMessage, res: ServerResponse) {
  seenHosts.push(String(req.headers.host));
  const url = new URL(req.url ?? "/", "http://x");
  switch (url.pathname) {
    case "/article":
      return page(
        res,
        `<html><head><title>Plain &amp; simple</title>
         <meta property="og:title" content="The &lt;real&gt; title">
         <meta name="description" content="What it is about">
         <meta property="og:image" content="/missing.png">
         <meta name="twitter:image" content="/pixel.png"></head><body>…</body></html>`,
      );
    case "/pixel.png":
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PIXEL);
    case "/missing.png":
      res.writeHead(404);
      return res.end();
    case "/gzipped":
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      return res.end(gzipSync("<title>Squeezed</title>"));
    case "/huge":
      return page(res, `<title>Long read</title>${"x".repeat(2 * 1024 * 1024)}`);
    case "/late-tags":
      return page(res, `<title>Early</title>${"x".repeat(600 * 1024)}<meta property="og:title" content="Late">`);
    case "/untitled":
      return page(res, "<p>no title here</p>");
    case "/gone":
      res.writeHead(410);
      return res.end();
    case "/forbidden":
      res.writeHead(403);
      return res.end();
    case "/json":
      res.writeHead(200, { "content-type": "application/json" });
      return res.end("{}");
    case "/hop": {
      const n = Number(url.searchParams.get("n") ?? 0);
      res.writeHead(302, { location: n > 0 ? `/hop?n=${n - 1}` : "/article" });
      return res.end();
    }
    case "/to-private":
      res.writeHead(302, { location: `http://inside.test:${port}/article` });
      return res.end();
    case "/to-literal":
      res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    default:
      res.writeHead(404);
      return res.end();
  }
}

beforeAll(async () => {
  server = createServer(route);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** `page.test` is our loopback server, allowed; `inside.test` is "private". */
function deps(overrides: Partial<PinnedFetchDeps> = {}): PinnedFetchDeps & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    resolve: async (host) => {
      lookups.push(host);
      if (host === "page.test") return ["127.0.0.1"];
      if (host === "inside.test") return ["10.0.0.7"];
      if (host === "mixed.test") return ["127.0.0.1", "192.168.0.9"];
      if (host === "nat64.test") return ["64:ff9b::a00:7"];
      throw new Error("ENOTFOUND");
    },
    allowed: (address) => address === "127.0.0.1",
    allowedPort: () => true,
    ...overrides,
  };
}

const at = (path: string) => `http://page.test:${port}${path}`;

describe("pinning", () => {
  it("resolves once per request and connects to the checked address, sending the name as Host", async () => {
    seenHosts = [];
    const d = deps();
    const response = await pinnedFetch(at("/article"), {}, d);
    expect(response.status).toBe(200);
    await response.text();
    expect(d.lookups).toEqual(["page.test"]);
    expect(seenHosts).toEqual([`page.test:${port}`]);
  });

  it("cannot be rebound: a name answering differently the second time is never asked twice", async () => {
    let calls = 0;
    const d = deps({
      resolve: async () => {
        calls += 1;
        // First answer checked and used; any later answer would be private.
        return calls === 1 ? ["127.0.0.1"] : ["10.0.0.1"];
      },
    });
    const response = await pinnedFetch(at("/article"), {}, d);
    expect(response.status).toBe(200);
    await response.text();
    expect(calls).toBe(1);
  });

  it("refuses a name when any of its addresses is private", async () => {
    await expect(checkedAddress(new URL(`http://mixed.test:${port}/`), deps())).rejects.toBeInstanceOf(NotPublicError);
  });

  it("refuses a NAT64 address that embeds a private IPv4 address", async () => {
    await expect(checkedAddress(new URL("http://nat64.test/"), { ...defaultDeps, resolve: async () => ["64:ff9b::a00:7"] })).rejects.toBeInstanceOf(
      NotPublicError,
    );
    await expect(checkedAddress(new URL("http://6to4.test/"), { ...defaultDeps, resolve: async () => ["2002:a00:7::1"] })).rejects.toBeInstanceOf(
      NotPublicError,
    );
  });

  it("refuses any port but the two standard web ones, before resolving", async () => {
    const d = { ...defaultDeps, resolve: async () => ["1.1.1.1"] };
    await expect(checkedAddress(new URL("http://example.test:6379/"), d)).rejects.toBeInstanceOf(NotPublicError);
    await expect(checkedAddress(new URL("https://example.test:8443/"), d)).rejects.toBeInstanceOf(NotPublicError);
    expect(await checkedAddress(new URL("http://example.test/"), d)).toBe("1.1.1.1");
    expect(await checkedAddress(new URL("https://example.test:443/"), d)).toBe("1.1.1.1");
  });

  it("refuses a name that does not resolve", async () => {
    await expect(checkedAddress(new URL("http://nowhere.test/"), deps())).rejects.toBeInstanceOf(NotPublicError);
  });
});

describe("the preview", () => {
  const previewer = () => new LinkPreviewer(deps());

  it("reads the title, the description and the first picture that actually arrives", async () => {
    const answer = await previewer().preview({ url: at("/article") });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ url: at("/article"), title: "The <real> title", description: "What it is about" });
    expect(answer.body.image).toBe(`data:image/png;base64,${PIXEL.toString("base64")}`);
  });

  it("fetches no picture for a re-check", async () => {
    const answer = await previewer().preview({ url: at("/article"), check: true });
    expect(answer.status).toBe(200);
    expect(answer.body.image).toBeNull();
  });

  it("decompresses a gzipped page", async () => {
    const answer = await previewer().preview({ url: at("/gzipped") });
    expect(answer.body.title).toBe("Squeezed");
  });

  it("reads a long page's head and stops", async () => {
    const answer = await previewer().preview({ url: at("/huge") });
    expect(answer.status).toBe(200);
    expect(answer.body.title).toBe("Long read");
  });

  it("reads no further than half a megabyte into a page", async () => {
    const answer = await previewer().preview({ url: at("/late-tags") });
    expect(answer.body.title).toBe("Early");
  });

  it("falls back to the host for a page with no title", async () => {
    expect((await previewer().preview({ url: at("/untitled") })).body.title).toBe("page.test");
  });

  it("follows up to three redirects, re-checking each, and reports the final address", async () => {
    const answer = await previewer().preview({ url: at("/hop?n=2") });
    expect(answer.status).toBe(200);
    expect(answer.body.url).toBe(at("/article"));
    expect((await previewer().preview({ url: at("/hop?n=3") })).status).toBe(502);
  });

  it("refuses a redirect into a private address, by name or by literal", async () => {
    expect((await previewer().preview({ url: at("/to-private") })).status).toBe(400);
    expect((await previewer().preview({ url: at("/to-literal") })).status).toBe(400);
  });

  it("answers 404/410 as gone, other failures as 502, and non-pages as 415", async () => {
    expect(await previewer().preview({ url: at("/gone") })).toEqual({
      status: 200,
      body: { url: at("/gone"), title: "", description: null, image: null, gone: true, status: 410 },
    });
    expect((await previewer().preview({ url: at("/forbidden") })).status).toBe(502);
    expect((await previewer().preview({ url: at("/json") })).status).toBe(415);
  });

  it("answers an unreachable port as 502, not as a private address", async () => {
    const answer = await previewer().preview({ url: "http://page.test:1/" });
    expect(answer.status).toBe(502);
  });
});
