/**
 * a hostile page freezes the whole server.
 *
 * `readMeta` (supabase/functions/_shared/pageMeta.ts) scans the fetched HTML
 * with `/<meta\b[^>]*>/gi`, `/<link\b[^>]*>/gi` and `/<title\b[^>]*>([\s\S]*?)<\/title>/i`.
 * With no closing `>` (or `</title>`) each of the thousands of start points
 * scans to the end of the page: quadratic. A 512 KiB page (the server's own
 * cap) blocks the single Node thread for 15-60 s, so no request, sync or
 * reminder sweep is served meanwhile.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LinkPreviewer } from "../src/linkPreview";
import { readMeta } from "../../supabase/functions/_shared/pageMeta";

let server: Server;
let port = 0;
// 160 KiB: ~4 s of freeze today, so the test fails quickly; the real cap is 512 KiB.
const BOMB = `<html><head>${"<meta ".repeat(Math.floor((160 * 1024) / 6))}`;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(BOMB);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => new Promise<void>((resolve) => server.close(() => resolve())));

describe("a page with unclosed tags", () => {
  it("is parsed in linear time (readMeta)", () => {
    const started = Date.now();
    readMeta(BOMB);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("does not stall the event loop while the server previews it", async () => {
    let worstGap = 0;
    let last = Date.now();
    const beat = setInterval(() => {
      const now = Date.now();
      worstGap = Math.max(worstGap, now - last);
      last = now;
    }, 20);
    const previewer = new LinkPreviewer({
      resolve: async () => ["127.0.0.1"],
      allowed: () => true,
      allowedPort: () => true,
    });
    await previewer.preview({ url: `http://page.test:${port}/x`, check: true });
    await new Promise((r) => setTimeout(r, 50)); // let a late tick record the stall
    clearInterval(beat);
    expect(worstGap).toBeLessThan(500);
  });
});
