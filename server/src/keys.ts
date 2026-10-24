/**
 * The two secrets an instance makes for itself on first boot and keeps in its
 * data folder: the session secret (a pepper on every stored session token and
 * invite code) and the Web Push (VAPID) key pair.
 *
 * Both are written owner-only (0600) and read back on every start, so a
 * restart keeps every session signed in and every phone subscribed. Losing
 * `vapid.json` means every device has to allow notifications again; losing
 * `session-secret` signs everybody out. Neither loses a note.
 */
import { randomBytes, webcrypto } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bytesToB64u } from "../../supabase/functions/_shared/webpush";

export interface VapidPair {
  publicKey: string;
  privateKey: string;
}

function writeSecret(path: string, content: string): void {
  // `wx`: never overwrite a secret that appeared between the check and here.
  writeFileSync(path, content, { mode: 0o600, flag: "wx" });
}

export function ensureDataDir(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(dataDir, "files"), { recursive: true, mode: 0o700 });
}

export function sessionSecret(dataDir: string): Buffer {
  const path = join(dataDir, "session-secret");
  if (!existsSync(path)) writeSecret(path, randomBytes(32).toString("base64url") + "\n");
  const secret = Buffer.from(readFileSync(path, "utf8").trim(), "base64url");
  if (secret.length < 32) throw new Error(`${path} holds fewer than 32 bytes; delete it to make a new one`);
  return secret;
}

/** A fresh P-256 pair in the two base64url forms Web Push speaks. */
export async function generateVapid(): Promise<VapidPair> {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  if (!jwk.d) throw new Error("the generated key has no private scalar");
  return { publicKey: bytesToB64u(raw), privateKey: jwk.d };
}

export async function vapidKeys(dataDir: string): Promise<VapidPair> {
  const path = join(dataDir, "vapid.json");
  if (!existsSync(path)) {
    const pair = await generateVapid();
    try {
      writeSecret(path, JSON.stringify(pair) + "\n");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<VapidPair>;
  if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") {
    throw new Error(`${path} is not a VAPID key pair`);
  }
  return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
}
