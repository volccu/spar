/**
 * Accounts: email and password, sessions, invites.
 *
 * Passwords are hashed with scrypt from node:crypto (N = 2^15, r = 8, p = 1 by
 * default), each with its own 16-byte salt, and the parameters are written
 * into the stored hash so they can be raised later without locking anyone out.
 *
 * A session is a random 256-bit token in an httpOnly cookie. The database
 * holds only an HMAC of it under the instance's session secret, so neither a
 * copy of `spar.db` alone nor a copy of the secret alone signs anybody in.
 * Invite codes are stored the same way.
 *
 * There is no email anywhere: no confirmation, no reset link. A forgotten
 * password is reset by whoever runs the instance, with the admin command line
 * (server/src/cli.ts).
 */
import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { Db } from "./db";
import { HttpError } from "./http";
import { DAY_US, type Micros } from "./time";
import type { SignupMode } from "./config";

export const SESSION_COOKIE = "spar_session";
/** A session not used for this long is gone. */
export const SESSION_IDLE_US = 180 * DAY_US;
/** How stale `last_seen_at` may get before a request refreshes it. */
const TOUCH_EVERY_US = 3_600_000_000;
/** The cookie itself outlives the idle window; the server decides expiry. */
export const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 1024;
const KEY_LENGTH = 32;

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function scryptOptions(logN: number, r: number, p: number): ScryptOptions {
  const N = 2 ** logN;
  // scrypt needs 128·N·r bytes; the default ceiling is exactly 32 MiB, which
  // the default cost would sit on.
  return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
}

export async function hashPassword(password: string, logN = 15): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize("NFC"), salt, KEY_LENGTH, scryptOptions(logN, 8, 1));
  return `scrypt$${logN}$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, logN, r, p, saltText, keyText] = parts;
  const expected = Buffer.from(keyText, "base64url");
  const key = await scryptAsync(
    password.normalize("NFC"),
    Buffer.from(saltText, "base64url"),
    expected.length,
    scryptOptions(Number(logN), Number(r), Number(p)),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Trimmed and lowercased, or null when it does not look like an address. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string") return "A password is required";
  if ([...value].length < MIN_PASSWORD) return `A password must be at least ${MIN_PASSWORD} characters long`;
  if (value.length > MAX_PASSWORD) return `A password must be at most ${MAX_PASSWORD} characters long`;
  return null;
}

export interface User {
  id: string;
  email: string;
  is_admin: boolean;
  created_at: Micros;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  is_admin: number;
  created_at: number;
}

export interface SessionInfo {
  user: User;
  tokenHash: string;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  is_admin: row.is_admin === 1,
  created_at: row.created_at,
});

export class Accounts {
  /** A hash to verify against when the email is unknown, so a miss costs what a hit does. */
  private decoy: Promise<string>;

  constructor(
    private readonly db: Db,
    private readonly secret: Buffer,
    private readonly now: () => Micros,
    private readonly logN: number,
  ) {
    this.decoy = hashPassword("decoy password, never anyone's", logN);
  }

  private keyed(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex");
  }

  userCount(): number {
    return (this.db.prepare("select count(*) as n from users").get() as { n: number }).n;
  }

  byEmail(email: string): User | null {
    const row = this.db.prepare("select * from users where email = ?").get(email) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  byId(id: string): User | null {
    const row = this.db.prepare("select * from users where id = ?").get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  list(): User[] {
    return (this.db.prepare("select * from users order by created_at").all() as UserRow[]).map(toUser);
  }

  /**
   * Makes an account. `mode` is the instance's sign-up setting; `admin: true`
   * (the command line) bypasses it. The very first account is always allowed
   * and is the instance's admin.
   */
  async signUp(
    emailInput: unknown,
    password: unknown,
    options: { mode: SignupMode; invite?: unknown; bypass?: boolean },
  ): Promise<User> {
    const email = normalizeEmail(emailInput);
    if (!email) throw new HttpError(400, "invalid_email", "That is not an email address");
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, "weak_password", problem);
    const inviteHash = typeof options.invite === "string" && options.invite ? this.keyed(options.invite.trim()) : null;
    // A sign-up the instance would refuse is refused before the password is
    // hashed: that is 32 MiB of scrypt, and a closed instance should not do it
    // for anyone who asks (audit SEC-4). The transaction below checks again,
    // and that is the check that decides.
    if (!options.bypass && this.userCount() > 0) this.admission(options.mode, inviteHash, this.now());
    const hash = await hashPassword(password as string, this.logN);
    const now = this.now();
    const id = randomUUID();
    // Everything that decides whether this account may exist is checked inside
    // one synchronous transaction, so two sign-ups racing for "the first
    // account" cannot both win it.
    return this.db.transaction(() => {
      const first = this.userCount() === 0;
      if (!first && !options.bypass) {
        const invite = this.admission(options.mode, inviteHash, now);
        if (invite) {
          this.db.prepare("update invites set used_at = ?, used_by = ? where code_hash = ?").run(now, id, invite);
        }
      }
      if (this.byEmail(email)) throw new HttpError(409, "email_taken", "An account with that email already exists");
      this.db
        .prepare("insert into users (id, email, password_hash, is_admin, created_at) values (?, ?, ?, ?, ?)")
        .run(id, email, hash, first ? 1 : 0, now);
      return { id, email, is_admin: first, created_at: now };
    })();
  }

  /**
   * Whether the sign-up setting lets a new (not first) account in: throws when
   * it does not, and returns the invite it would spend in `invite` mode.
   */
  private admission(mode: SignupMode, inviteHash: string | null, now: Micros): string | null {
    if (mode === "closed") throw new HttpError(403, "signup_closed", "This instance is not taking new accounts");
    if (mode !== "invite") return null;
    const invite = inviteHash
      ? (this.db
          .prepare("select code_hash from invites where code_hash = ? and used_at is null and expires_at > ?")
          .get(inviteHash, now) as { code_hash: string } | undefined)
      : undefined;
    if (!invite) throw new HttpError(403, "invite_required", "A valid invite code is required to sign up");
    return invite.code_hash;
  }

  /** The user, when the password is theirs; null otherwise, at the same cost either way. */
  async checkPassword(emailInput: unknown, password: unknown): Promise<User | null> {
    const email = normalizeEmail(emailInput);
    const row =
      email === null
        ? undefined
        : (this.db.prepare("select * from users where email = ?").get(email) as UserRow | undefined);
    const text = typeof password === "string" && password.length <= MAX_PASSWORD ? password : "";
    const ok = await verifyPassword(text, row?.password_hash ?? (await this.decoy));
    return row && ok && text ? toUser(row) : null;
  }

  async verifyUserPassword(userId: string, password: unknown): Promise<boolean> {
    const row = this.db.prepare("select * from users where id = ?").get(userId) as UserRow | undefined;
    const text = typeof password === "string" && password.length <= MAX_PASSWORD ? password : "";
    const ok = await verifyPassword(text, row?.password_hash ?? (await this.decoy));
    return Boolean(row && ok && text);
  }

  async setPassword(userId: string, password: unknown): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, "weak_password", problem);
    const hash = await hashPassword(password as string, this.logN);
    this.db.prepare("update users set password_hash = ? where id = ?").run(hash, userId);
  }

  /** Opens a session; returns the token for the cookie (the only copy anywhere). */
  createSession(userId: string, userAgent: string | undefined): string {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    this.db
      .prepare(
        "insert into sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) values (?, ?, ?, ?, ?, ?)",
      )
      .run(this.keyed(token), userId, now, now, now + SESSION_IDLE_US, (userAgent ?? "").slice(0, 300) || null);
    return token;
  }

  /** The signed-in user for a cookie token, or null. Refreshes an idle session. */
  session(token: string | undefined): SessionInfo | null {
    if (!token || token.length > 128) return null;
    const tokenHash = this.keyed(token);
    const row = this.db
      .prepare(
        `select u.*, s.last_seen_at as seen, s.expires_at as expires
           from sessions s join users u on u.id = s.user_id
          where s.token_hash = ?`,
      )
      .get(tokenHash) as (UserRow & { seen: number; expires: number }) | undefined;
    if (!row) return null;
    const now = this.now();
    if (row.expires <= now) {
      this.db.prepare("delete from sessions where token_hash = ?").run(tokenHash);
      return null;
    }
    if (now - row.seen > TOUCH_EVERY_US) {
      this.db
        .prepare("update sessions set last_seen_at = ?, expires_at = ? where token_hash = ?")
        .run(now, now + SESSION_IDLE_US, tokenHash);
    }
    return { user: toUser(row), tokenHash };
  }

  sessionExists(tokenHash: string): boolean {
    return Boolean(this.db.prepare("select 1 from sessions where token_hash = ? and expires_at > ?").get(tokenHash, this.now()));
  }

  endSession(tokenHash: string): void {
    this.db.prepare("delete from sessions where token_hash = ?").run(tokenHash);
  }

  /** Signs a user out everywhere, except (optionally) the session asking. */
  endSessionsOf(userId: string, keepTokenHash?: string): void {
    if (keepTokenHash) {
      this.db.prepare("delete from sessions where user_id = ? and token_hash <> ?").run(userId, keepTokenHash);
    } else {
      this.db.prepare("delete from sessions where user_id = ?").run(userId);
    }
  }

  pruneSessions(): number {
    return this.db.prepare("delete from sessions where expires_at <= ?").run(this.now()).changes;
  }

  /** A single-use invite code, valid for `days`. Returned once; stored only as a hash. */
  createInvite(days: number): { code: string; expires_at: Micros } {
    const code = randomBytes(12).toString("base64url");
    const now = this.now();
    const expires = now + Math.max(1, days) * DAY_US;
    this.db
      .prepare("insert into invites (code_hash, created_at, expires_at) values (?, ?, ?)")
      .run(this.keyed(code), now, expires);
    return { code, expires_at: expires };
  }

  listInvites(): { created_at: Micros; expires_at: Micros; used_at: Micros | null; used_by: string | null }[] {
    return this.db
      .prepare("select created_at, expires_at, used_at, used_by from invites order by created_at")
      .all() as { created_at: Micros; expires_at: Micros; used_at: Micros | null; used_by: string | null }[];
  }
}
