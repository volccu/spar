/**
 * a push endpoint that never answers wedges the
 * reminder sweep for good.
 *
 * `sendPush` (supabase/functions/_shared/webpush.ts) calls the transport with
 * no timeout, and the server's transport (`pinnedFetchLike`) adds none. One
 * subscription whose host accepts the connection and says nothing makes
 * `Push.sweep()` await forever; `sweeping` stays true, so every later sweep
 * returns at once with {due:0}, and no reminder rings for anyone until the
 * process restarts. (On Supabase the same missing timeout means the function
 * is killed before it records deliveries, so reminders already sent to the
 * healthy devices go out again every minute.)
 */
import { createServer as createTcpServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { bytesToB64u } from "../../supabase/functions/_shared/webpush";
import { Push } from "../src/push";
import { pinnedFetchLike } from "../src/pinnedFetch";
import { Client, note, startServer, type Running } from "./helpers";

describe("the reminder sweep and a silent push service", () => {
  let s: Running;
  let silent: Server | undefined;
  afterEach(async () => {
    await s?.close();
    silent?.close();
  });

  it("gives up on an endpoint that never answers, and carries on", async () => {
    silent = createTcpServer(() => undefined); // accepts, never replies
    await new Promise<void>((resolve) => silent!.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as AddressInfo).port;

    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const keys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const p256dh = bytesToB64u(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
    const auth = bytesToB64u(crypto.getRandomValues(new Uint8Array(16)));
    expect(
      (await a.request("POST", "/api/push/subscribe", { endpoint: "https://push.example.test/stuck", p256dh, auth })).status,
    ).toBe(204);
    await a.request("POST", "/api/notes", { rows: [note({ reminder_at: new Date(Date.now() - 60_000).toISOString() })] });

    // The real transport, pointed (by rewriting the URL) at the silent server.
    const real = pinnedFetchLike({ resolve: async () => ["127.0.0.1"], allowed: () => true, allowedPort: () => true });
    const transport = ((_url: string, init?: RequestInit) => real(`http://page.test:${port}/`, init)) as unknown as typeof fetch;
    const push = new Push(s.app.db, s.app.clock, () => s.app.vapidKeys(), transport);

    const hung = Symbol("hung");
    const quiet = console.error;
    console.error = () => undefined;
    try {
      const outcome = await Promise.race([push.sweep(), new Promise((r) => setTimeout(() => r(hung), 20_000))]);
      expect(outcome).not.toBe(hung); // a sweep must end, whatever a push service does
    } finally {
      console.error = quiet;
    }
  }, 30_000);
});
