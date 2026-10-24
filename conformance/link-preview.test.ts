/**
 * Contract: "Link previews" — the request and answer shapes, and the
 * protections that keep the endpoint from being used to reach private
 * addresses.
 *
 * Everything in the first two blocks is answered before the endpoint makes any
 * outbound request, so it runs without internet access. The last block fetches
 * real public pages and runs only with SPAR_CONFORMANCE_INTERNET=1. On the
 * Supabase driver the endpoint is the `link-preview` edge function served by
 * the local stack's edge runtime; set SPAR_CONFORMANCE_LINK_PREVIEW=0 to skip
 * the file where no edge runtime is available.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { Session } from "./driver";
import { useDriver, users } from "./support";

const driver = useDriver();
let a: Session;

beforeAll(async () => {
  if (driver.can.linkPreview) [a] = await users(driver, 1);
});

describe.skipIf(!driver.can.linkPreview)("asking", () => {
  it("refuses a caller with no user session", async () => {
    const answer = await a.linkPreview({ url: "https://example.com/", anonymous: true });
    expect(answer.status).toBe(401);
  });

  it("answers only POST", async () => {
    const answer = await a.linkPreview({ url: "https://example.com/", method: "GET" });
    expect(answer.status).toBe(405);
  });

  it("answers the preflight", async () => {
    const answer = await a.linkPreview({ url: null, method: "OPTIONS" });
    expect(answer.status).toBe(200);
  });

  it("refuses a body that is not JSON with 400", async () => {
    const answer = await a.linkPreview({ url: null, rawBody: "{not json" });
    expect(answer.status).toBe(400);
  });

  // The origin allow-list: only observable where nothing in front of the
  // endpoint rewrites the header (see `can.observeCors` in driver.ts).
  it.skipIf(!driver.can.observeCors)("names no origin it has not been told to allow", async () => {
    const answer = await a.linkPreview({ url: "http://127.0.0.1/", origin: "https://not-allowed.example" });
    expect(answer.allowOrigin).toBeNull();
  });

  it.skipIf(!driver.can.observeCors)("allows the local development origin", async () => {
    const answer = await a.linkPreview({ url: "http://127.0.0.1/", origin: "http://localhost:5173" });
    expect(answer.allowOrigin).toBe("http://localhost:5173");
  });
});

describe.skipIf(!driver.can.linkPreview)("refusing what is not a public web address", () => {
  const refused: [string, unknown][] = [
    ["a missing url", undefined],
    ["a url that is not a string", 42],
    ["text that is not a url", "not a url at all"],
    ["a scheme other than http(s)", "ftp://example.com/file"],
    ["a javascript: url", "javascript:alert(1)"],
    ["credentials in the url", "https://user:secret@example.com/"],
    ["localhost", "http://localhost/"],
    ["a .localhost name", "http://app.localhost/"],
    ["a .local name", "http://printer.local/"],
    ["the cloud metadata name", "http://metadata.google.internal/computeMetadata/v1/"],
    ["loopback", "http://127.0.0.1/"],
    ["a private range (10/8)", "http://10.1.2.3/"],
    ["a private range (172.16/12)", "http://172.16.0.1/"],
    ["a private range (192.168/16)", "http://192.168.1.1/"],
    ["link-local and metadata", "http://169.254.169.254/latest/meta-data/"],
    ["carrier-grade NAT", "http://100.64.0.1/"],
    ["this network", "http://0.0.0.0/"],
    ["a benchmark range", "http://198.18.0.1/"],
    ["multicast", "http://224.0.0.1/"],
    ["a decimal integer host", "http://2130706433/"],
    ["a hexadecimal integer host", "http://0x7f000001/"],
    ["an IPv6 loopback literal", "http://[::1]/"],
    ["an IPv4-mapped IPv6 literal", "http://[::ffff:127.0.0.1]/"],
    ["a public IPv6 literal (every literal is refused)", "http://[2606:4700:4700::1111]/"],
    ["a name that does not resolve", "https://no-such-host.invalid/"],
  ];
  for (const [why, url] of refused) {
    it(`refuses ${why} with 400`, async () => {
      const answer = await a.linkPreview({ url });
      expect(answer.status).toBe(400);
      expect(typeof answer.body?.error).toBe("string");
    });
  }
});

describe.skipIf(!driver.can.linkPreview || !driver.can.linkPreviewNetwork)("unfurling real pages", () => {
  it("answers a web page with its url, title, description and picture fields", async () => {
    const answer = await a.linkPreview({ url: "https://example.com/" });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ url: "https://example.com/" });
    expect(typeof answer.body?.title).toBe("string");
    expect((answer.body?.title as string).length).toBeGreaterThan(0);
    expect((answer.body?.title as string).length).toBeLessThanOrEqual(200);
    expect("description" in (answer.body ?? {})).toBe(true);
    expect("image" in (answer.body ?? {})).toBe(true);
  });

  it("never fetches a picture for a re-check", async () => {
    const answer = await a.linkPreview({ url: "https://example.com/", check: true });
    expect(answer.status).toBe(200);
    expect(answer.body?.image).toBeNull();
  });

  it("answers a page that is gone with 200 and gone: true", async () => {
    const answer = await a.linkPreview({ url: "https://httpbin.org/status/404" });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ gone: true, status: 404, title: "", description: null, image: null });
  });

  it("answers something that is not a web page with 415", async () => {
    const answer = await a.linkPreview({ url: "https://httpbin.org/json" });
    expect(answer.status).toBe(415);
  });

  it("answers any other upstream failure with 502", async () => {
    const answer = await a.linkPreview({ url: "https://httpbin.org/status/503" });
    expect(answer.status).toBe(502);
  });
});
