// webpush.ts — Web Push, written out rather than imported.
//
// Two specs, both small, both fiddly, and between them the entire reason a
// reminder cannot be sent from Postgres:
//
//   RFC 8291 — the payload is encrypted end to end with a key only the
//              subscribing browser holds, so the push service that carries it
//              (Google, Mozilla, Apple) cannot read the note.
//   RFC 8292 — the request is signed with our own key, so the push service can
//              tell one sender from another and rate-limit accordingly.
//
// This is written against WebCrypto instead of pulling a library because the
// libraries in this space are Node-shaped, the parts we need are about a
// hundred lines, and a dependency that only fails once deployed is worse than
// code that can be read. Everything here is standard: ECDH on P-256, HKDF over
// HMAC-SHA256, AES-128-GCM, and an ES256 JWT.

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// base64url, in both directions
// ---------------------------------------------------------------------------
// Push keys arrive as base64url without padding and have to go back out the
// same way. `btoa`/`atob` speak base64 with padding, so both ends need fixing.
export function b64uToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bytesToB64u(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HKDF (RFC 5869), the two-step form the push spec uses
// ---------------------------------------------------------------------------
// Every output this file needs is 32 bytes or fewer, so expand never runs past
// its first block and the counter is always a literal 0x01. Written as one
// round deliberately: a loop here would be dead code pretending to be general.
async function hmac(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  if (length > 32) throw new Error("hkdf: one block only");
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.subarray(0, length);
}

// ---------------------------------------------------------------------------
// The subscription, as the browser handed it over
// ---------------------------------------------------------------------------
export interface PushSubscription {
  endpoint: string;
  /** The browser's public key for this endpoint, base64url, 65 raw bytes. */
  p256dh: string;
  /** The browser's authentication secret, base64url, 16 raw bytes. */
  auth: string;
}

export interface VapidKeys {
  /** base64url, 65 raw bytes — the uncompressed P-256 point. */
  publicKey: string;
  /** base64url, 32 raw bytes — the private scalar. */
  privateKey: string;
  /** `mailto:` or an https URL. The push service uses it to contact us. */
  subject: string;
}

// ---------------------------------------------------------------------------
// RFC 8291 — encrypt the payload for one subscription
// ---------------------------------------------------------------------------
async function encryptPayload(
  sub: PushSubscription,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(sub.p256dh);
  const authSecret = b64uToBytes(sub.auth);

  // A fresh sender keypair per message. Reusing one would let the push service
  // link two notifications as coming from the same conversation.
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256),
  );

  // The key derivation is two HKDFs stacked. The first mixes in the browser's
  // auth secret and both public keys, which is what binds this ciphertext to
  // this subscription — the same shared secret with a different auth secret
  // yields a different key.
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  // 0x02 is the padding delimiter for a final record. There is only ever one
  // record here: the whole point of a push payload is that it is small.
  const padded = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, padded),
  );

  // The aes128gcm header (RFC 8188 §2.1): salt, record size, then the sender's
  // public key with its own length byte, so the receiver can derive the same
  // key with nothing but the body.
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// ---------------------------------------------------------------------------
// RFC 8292 — sign the request so the push service knows who is sending
// ---------------------------------------------------------------------------
async function vapidHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  // Twelve hours. The spec caps it at 24; sitting well under means a slow
  // retry by the push service never trips over an expiry we chose.
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  };
  const signingInput = `${bytesToB64u(enc.encode(JSON.stringify(header)))}.${bytesToB64u(
    enc.encode(JSON.stringify(payload)),
  )}`;

  // WebCrypto will not take a bare private scalar, so the key goes in as a JWK
  // built from the scalar plus the public point we already publish.
  const pub = b64uToBytes(keys.publicKey);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: keys.privateKey,
    x: bytesToB64u(pub.subarray(1, 33)),
    y: bytesToB64u(pub.subarray(33, 65)),
    ext: true,
  };
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto returns the raw r||s pair, which is exactly what JOSE wants —
  // no DER unwrapping, unlike most server-side crypto libraries.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, enc.encode(signingInput)),
  );
  return `vapid t=${signingInput}.${bytesToB64u(sig)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------
export interface SendResult {
  ok: boolean;
  status: number;
  /** True when the push service says this endpoint is finished for good. */
  gone: boolean;
  error?: string;
}

/**
 * Deliver one payload to one subscription.
 *
 * 404 and 410 are the two answers that mean the subscription is dead rather
 * than the send having failed — the browser was uninstalled, the site data
 * cleared, or the endpoint rotated. The caller retires those; everything else
 * is a transient failure worth leaving alone, because the sweep runs again in
 * a minute and a reminder is only worth so much noise.
 *
 * **`ttlSeconds` has no default, and that is the fix for a real failure.** It
 * used to default to twelve hours, a number chosen here with no knowledge of
 * what was being sent — while `due_reminders` (migration 0020) keeps a
 * reminder due for a full day and `send-reminders` writes `reminder_deliveries`
 * on the push service's **201**, which means *accepted*, not *delivered*, and
 * never retries afterwards. A phone switched off from 08:45 to 22:00 therefore
 * had its 09:00 reminder expire at the push service at 21:00, already booked as
 * sent, and it simply never arrived. Nothing logged it: from this side the send
 * succeeded, and from the phone's side there was never anything to see.
 *
 * The TTL is how long the push service may hold the message for a device that
 * is not reachable (RFC 8030 §5.2), so it is a fact about *what is being sent*
 * and only the caller knows it. Requiring it is what stops the next caller
 * inheriting a number that quietly disagrees with its own idea of how long the
 * thing is worth showing.
 *
 * It is unrelated to the twelve hours in `vapidHeader` above: that is the JWT's
 * own expiry and is checked by the push service when this request **arrives**,
 * not when the message is finally delivered, so a TTL longer than it is
 * perfectly ordinary. Do not "fix" one to match the other.
 */
/**
 * Whether an endpoint is one a push may be sent to at all: https, on the
 * standard port, with no credentials (audit 2026-10-10, SEC-3). Every push
 * service a browser hands out (Google, Mozilla, Apple, Microsoft) is that; the
 * table holds whatever a signed-in client wrote, and `push_subscriptions` has
 * a CHECK for the scheme since migration 0029. Written here rather than
 * imported from `netguard.ts` because the spår server imports this file too,
 * and a `.ts` import between the two would satisfy one and not the other.
 */
export function pushEndpointOk(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && (url.port === "" || url.port === "443") && !url.username && !url.password;
}

const SEND_TIMEOUT_MS = 10_000;

/** The start of an error body, for the log. A body that stalls or fails is
 *  simply left out; the send's own timeout is what ends a stalled read. */
async function boundedText(res: Response): Promise<string | undefined> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return undefined;
  }
}

export async function sendPush(
  sub: PushSubscription,
  payload: unknown,
  keys: VapidKeys,
  ttlSeconds: number,
  // How the request goes out. The edge function leaves it as the platform's
  // own `fetch`; the spår server (server/src/push.ts) passes one pinned to a
  // checked public address, because there the endpoint is a URL a user handed
  // in and the server's own network is reachable from where it runs.
  transport: typeof fetch = fetch,
): Promise<SendResult> {
  // Refused before anything is encrypted or sent, and reported `gone` so the
  // caller retires the row instead of offering it again every minute.
  if (!pushEndpointOk(sub.endpoint)) {
    return { ok: false, status: 0, gone: true, error: "the endpoint is not an https push service" };
  }
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
    const auth = await vapidHeader(sub.endpoint, keys);
    const res = await transport(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttlSeconds),
        // "high", not "normal" (RFC 8030 §5.3). Everything sent through here
        // is a reminder, and a reminder is the one thing this app is allowed
        // to interrupt with. A normal-urgency push is exactly what a phone in
        // Doze is permitted to hold back until it next wakes for something
        // else — which read, from the outside, as "the notification came
        // late and never rang". High is the level the push services carry
        // straight through and wake the device for.
        Urgency: "high",
      },
      body,
      // A push service that accepts the connection and then says nothing would
      // hold the whole sweep (and the edge function) open for ever. A send that
      // runs out of time is a failed send: not delivered, tried again later.
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return {
      ok: res.ok,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
      error: res.ok ? undefined : await boundedText(res),
    };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String(e) };
  }
}
