/**
 * The reminder sweep, end to end, with a push service of our own standing in
 * for Google's or Mozilla's: the transport is replaced, and the test holds the
 * browser's private key, so it can decrypt what the server sent (RFC 8291) and
 * read the notification the service worker would show.
 */
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { bytesToB64u } from "../../supabase/functions/_shared/webpush";
import { GRACE_SECONDS } from "../src/push";
import { formatInstant } from "../src/time";
import { Client, note, startServer, type Running } from "./helpers";

const subtle = webcrypto.subtle;
const enc = new TextEncoder();

interface Browser {
  keys: webcrypto.CryptoKeyPair;
  publicRaw: Uint8Array;
  auth: Uint8Array;
}

async function browser(): Promise<Browser> {
  const keys = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  return {
    keys,
    publicRaw: new Uint8Array(await subtle.exportKey("raw", keys.publicKey)),
    auth: webcrypto.getRandomValues(new Uint8Array(16)),
  };
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, new Uint8Array([...info, 1]))).subarray(0, length);
}

/** RFC 8291 decryption, as the browser does it. */
async function decrypt(b: Browser, body: Uint8Array): Promise<unknown> {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const serverKey = await subtle.importKey("raw", serverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: serverKey }, b.keys.privateKey, 256));
  const ikm = await hkdf(b.auth, shared, new Uint8Array([...enc.encode("WebPush: info\0"), ...b.publicRaw, ...serverPublic]), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const padded = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
  const end = padded.lastIndexOf(2);
  return JSON.parse(new TextDecoder().decode(padded.subarray(0, end)));
}

interface Sent {
  url: string;
  headers: Headers;
  body: Uint8Array;
}

function pushService(status: (url: string) => number) {
  const sent: Sent[] = [];
  const transport = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, headers: new Headers(init?.headers), body: new Uint8Array(init?.body as Uint8Array) });
    return new Response(null, { status: status(url) });
  }) as typeof fetch;
  return { sent, transport };
}

async function subscribe(c: Client, b: Browser, endpoint: string) {
  const answer = await c.request("POST", "/api/push/subscribe", {
    endpoint,
    p256dh: bytesToB64u(b.publicRaw),
    auth: bytesToB64u(b.auth),
    user_agent: "test",
    seen_at: new Date().toISOString(),
    failed_at: null,
  });
  expect(answer.status).toBe(204);
}

describe("the reminder sweep", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("sends a due reminder to every live device, readable only by the browser, once", async () => {
    const service = pushService(() => 201);
    s = await startServer({ vapidSubject: "mailto:owner@example.test" }, { pushTransport: service.transport });
    const a = new Client(s.url);
    await a.signUp();
    const phone = await browser();
    const laptop = await browser();
    await subscribe(a, phone, "https://push.example.test/phone");
    await subscribe(a, laptop, "https://push.example.test/laptop");
    const anchor = new Date(Date.now() - 5 * 60_000).toISOString();
    const n = note({ raw_content: "Call the dentist\nabout Tuesday", body: "Call the dentist\nabout Tuesday", reminder_at: anchor });
    await a.request("POST", "/api/notes", { rows: [n] });

    expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 2, retired: 0 });
    expect(service.sent.map((x) => x.url).sort()).toEqual(["https://push.example.test/laptop", "https://push.example.test/phone"]);
    const phoneCopy = service.sent.find((x) => x.url.endsWith("/phone"))!;
    expect(phoneCopy.headers.get("urgency")).toBe("high");
    expect(phoneCopy.headers.get("content-encoding")).toBe("aes128gcm");
    expect(Number(phoneCopy.headers.get("ttl"))).toBeGreaterThan(GRACE_SECONDS - 400);
    expect(phoneCopy.headers.get("authorization")).toMatch(new RegExp(`^vapid t=.+, k=${s.app.vapidPublicKey}$`));
    const payload = await decrypt(phone, phoneCopy.body);
    expect(payload).toEqual({
      note_id: n.id,
      title: "Call the dentist",
      body: "about Tuesday",
      at: formatInstant(Date.parse(anchor) * 1000),
      actions: [
        { action: "later", title: "Later" },
        { action: "done", title: "Done" },
      ],
    });

    // Recorded: the next minute sends nothing.
    expect(await s.app.push.sweep()).toEqual({ due: 0, sent: 0, retired: 0 });
    expect(service.sent).toHaveLength(2);
    // And the note itself was never written.
    const [row] = (await a.request("POST", "/api/notes/by-id", { ids: [n.id] })).body?.notes as { updated_at: string }[];
    expect(Date.parse(row.updated_at)).toBe(Date.parse(String(n.updated_at)));
  });

  it("tries again only the device whose push service failed, and then closes the occurrence", async () => {
    let laptopUp = false;
    const service = pushService((url) => (url.endsWith("/laptop") && !laptopUp ? 503 : 201));
    s = await startServer({}, { pushTransport: service.transport });
    const a = new Client(s.url);
    await a.signUp();
    await subscribe(a, await browser(), "https://push.example.test/phone");
    await subscribe(a, await browser(), "https://push.example.test/laptop");
    await a.request("POST", "/api/notes", { rows: [note({ reminder_at: new Date(Date.now() - 60_000).toISOString() })] });

    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 1, retired: 0 });
    } finally {
      console.error = quiet;
    }
    // Still owed to the laptop, and only to the laptop.
    laptopUp = true;
    service.sent.length = 0;
    expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 1, retired: 0 });
    expect(service.sent.map((x) => x.url)).toEqual(["https://push.example.test/laptop"]);
    // Every device has it now.
    expect(await s.app.push.sweep()).toEqual({ due: 0, sent: 0, retired: 0 });
  });

  it("offers no Later or Done on a repeating reminder", async () => {
    const service = pushService(() => 201);
    s = await startServer({}, { pushTransport: service.transport });
    const a = new Client(s.url);
    await a.signUp();
    const phone = await browser();
    await subscribe(a, phone, "https://push.example.test/phone");
    await a.request("POST", "/api/notes", {
      rows: [note({ reminder_at: new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString(), reminder_repeat: "daily" })],
    });
    await s.app.push.sweep();
    expect(((await decrypt(phone, service.sent[0].body)) as { actions: unknown[] }).actions).toEqual([]);
  });

  it("retires an endpoint the push service says is gone, and keeps the reminder due while nothing took it", async () => {
    const service = pushService(() => 410);
    s = await startServer({}, { pushTransport: service.transport });
    const a = new Client(s.url);
    await a.signUp();
    await subscribe(a, await browser(), "https://push.example.test/dead");
    await a.request("POST", "/api/notes", { rows: [note({ reminder_at: new Date(Date.now() - 60_000).toISOString() })] });
    expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 0, retired: 1 });
    expect(s.app.push.all(a.userId)[0].failed_at).not.toBeNull();
    // Still due (nothing accepted it); no live device now, so nothing is sent.
    expect(s.app.push.due()).toHaveLength(1);
    expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 0, retired: 0 });
    expect(service.sent).toHaveLength(1);
  });

  it("never sends one user's reminder to another user's device", async () => {
    const service = pushService(() => 201);
    s = await startServer({}, { pushTransport: service.transport });
    const a = new Client(s.url);
    await a.signUp();
    const b = new Client(s.url);
    await b.signUp();
    await subscribe(b, await browser(), "https://push.example.test/b");
    await a.request("POST", "/api/notes", { rows: [note({ reminder_at: new Date(Date.now() - 60_000).toISOString() })] });
    expect(await s.app.push.sweep()).toEqual({ due: 1, sent: 0, retired: 0 });
    expect(service.sent).toEqual([]);
  });

  it("does not send to an endpoint whose name resolves to a private address", async () => {
    // The default transport: the pinned fetch, with a resolver that points the
    // push service's name at the metadata address.
    s = await startServer();
    const { Push } = await import("../src/push");
    const { pinnedFetchLike } = await import("../src/pinnedFetch");
    const guarded = new Push(s.app.db, s.app.clock, () => s.app.vapidKeys(), pinnedFetchLike({
      resolve: async () => ["169.254.169.254"],
      allowed: (address) => !["169.254.169.254"].includes(address),
      allowedPort: () => true,
    }));
    const a = new Client(s.url);
    await a.signUp();
    await subscribe(a, await browser(), "https://push.example.test/rebound");
    await a.request("POST", "/api/notes", { rows: [note({ reminder_at: new Date(Date.now() - 60_000).toISOString() })] });
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      expect(await guarded.sweep()).toEqual({ due: 1, sent: 0, retired: 0 });
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
  });
});
