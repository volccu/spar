/**
 * The HTTP surface beyond the sync contract: accounts and sessions, the
 * request-forgery and size guards, files on disk, the export, the deletion,
 * the public configuration and the static app.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client, note, startServer, type Running } from "./helpers";

describe("accounts", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("lets the first account in whatever the sign-up setting, makes it the admin, and closes the door behind it", async () => {
    s = await startServer({ signup: "closed" });
    const config = await new Client(s.url).request("GET", "/api/config");
    expect(config.body).toMatchObject({ backend: "spar-server", signup: "closed", firstAccount: true });
    // The keys the web client's `parseConfig` (web/src/store/backend/config.ts) reads.
    expect(config.body?.vapidPublicKey).toBe(s.app.vapidPublicKey);
    expect((await new Client(s.url).request("GET", "/config.json")).body).toEqual(config.body);
    const first = new Client(s.url);
    expect((await first.signUp()).status).toBe(201);
    expect((await first.request("GET", "/api/auth/session")).body).toMatchObject({ user: { is_admin: true } });
    const second = new Client(s.url);
    const refused = await second.signUp();
    expect(refused.status).toBe(403);
    expect(refused.body?.code).toBe("signup_closed");
    expect((await new Client(s.url).request("GET", "/api/config")).body?.firstAccount).toBe(false);
  });

  it("takes an invite code once in invite mode", async () => {
    s = await startServer({ signup: "invite" });
    await new Client(s.url).signUp();
    const { code } = s.app.accounts.createInvite(7);
    expect((await new Client(s.url).signUp(undefined, undefined, "wrong")).body?.code).toBe("invite_required");
    expect((await new Client(s.url).signUp(undefined, undefined, code)).status).toBe(201);
    expect((await new Client(s.url).signUp(undefined, undefined, code)).status).toBe(403);
  });

  it("refuses a weak password, a bad address and a taken one", async () => {
    s = await startServer();
    expect((await new Client(s.url).signUp("someone@example.test", "short")).body?.code).toBe("weak_password");
    expect((await new Client(s.url).signUp("not an email", "long enough password")).body?.code).toBe("invalid_email");
    await new Client(s.url).signUp("taken@example.test");
    expect((await new Client(s.url).signUp("TAKEN@example.test")).status).toBe(409);
  });

  // Audit SEC-4: ten wrong guesses from a stranger used to lock the owner out
  // with the right password in hand, and the stranger chose their own address.
  it("lets the right password in from elsewhere while a stranger's wrong guesses are refused", async () => {
    s = await startServer({ trustProxy: true });
    await new Client(s.url).signUp("owner@example.test", "the owner's password");
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    const stranger = new Client(s.url);
    for (let i = 0; i < 10; i++) {
      const answer = await stranger.request("POST", "/api/auth/login", { email: "owner@example.test", password: `guess ${i}` }, from("203.0.113.9"));
      expect(answer.status).toBe(401);
    }
    const blocked = await stranger.request("POST", "/api/auth/login", { email: "owner@example.test", password: "guess 10" }, from("203.0.113.9"));
    expect(blocked.status).toBe(429);
    const owner = new Client(s.url);
    const signedIn = await owner.request("POST", "/api/auth/login", { email: "owner@example.test", password: "the owner's password" }, from("198.51.100.7"));
    expect(signedIn.status).toBe(200);
  });

  it("reads the client from the rightmost forwarded address, which the client cannot choose", async () => {
    s = await startServer({ trustProxy: true });
    const c = new Client(s.url);
    // A made-up address on the left of every attempt, and a different email
    // each time; only the proxy's own entry on the right stays the same, and
    // it alone carries the address's ceiling of 50 attempts.
    for (let i = 0; i < 50; i++) {
      const answer = await c.request("POST", "/api/auth/login", { email: `nobody-${i}@example.test`, password: "a guess" }, {
        "x-forwarded-for": `10.0.${i}.1, 203.0.113.9`,
      });
      expect(answer.status).toBe(401);
    }
    const blocked = await c.request("POST", "/api/auth/login", { email: "nobody-50@example.test", password: "a guess" }, {
      "x-forwarded-for": "10.9.9.9, 203.0.113.9",
    });
    expect(blocked.status).toBe(429);
  });

  it("signs in and out with an httpOnly, SameSite=Lax cookie, Secure only over HTTPS", async () => {
    s = await startServer({ trustProxy: true });
    const a = new Client(s.url);
    await a.signUp("me@example.test", "correct horse battery");
    const login = await fetch(`${s.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Me@Example.test", password: "correct horse battery" }),
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^spar_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    const proxied = await fetch(`${s.url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ email: "me@example.test", password: "correct horse battery" }),
    });
    expect(proxied.headers.get("set-cookie")).toMatch(/; Secure$/);

    const b = new Client(s.url);
    expect((await b.logIn("me@example.test", "correct horse battery")).status).toBe(200);
    const kept = b.cookie;
    expect((await b.request("POST", "/api/auth/logout", {})).status).toBe(204);
    expect((await b.request("GET", "/api/notes", undefined, { cookie: kept ?? "" })).status).toBe(401);
    expect((await a.request("GET", "/api/notes")).status).toBe(200);
  });

  it("stores no session token and no password in the clear", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp("clear@example.test", "a password in the clear");
    const token = (a.cookie ?? "").split("=")[1];
    const dump = JSON.stringify([
      s.app.db.prepare("select * from sessions").all(),
      s.app.db.prepare("select * from users").all(),
    ]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain("a password in the clear");
  });

  it("answers a wrong password as a miss, and slows a guesser down", async () => {
    s = await startServer();
    await new Client(s.url).signUp("target@example.test", "the right password");
    const guesser = new Client(s.url);
    for (let i = 0; i < 10; i++) expect((await guesser.logIn("target@example.test", `guess ${i}`)).status).toBe(401);
    const blocked = await guesser.logIn("target@example.test", "the right password");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await guesser.logIn("nobody@example.test", "whatever it is")).status).toBe(401);
  });

  it("changes a password and signs out every other session", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp("change@example.test", "the first password");
    const other = new Client(s.url);
    await other.logIn("change@example.test", "the first password");
    expect((await a.request("POST", "/api/auth/password", { current_password: "nope nope", new_password: "x".repeat(12) })).status).toBe(403);
    expect((await a.request("POST", "/api/auth/password", { current_password: "the first password", new_password: "the second password" })).status).toBe(204);
    expect((await a.request("GET", "/api/notes")).status).toBe(200);
    expect((await other.request("GET", "/api/notes")).status).toBe(401);
    expect((await new Client(s.url).logIn("change@example.test", "the second password")).status).toBe(200);
  });
});

describe("guards", () => {
  let s: Running;
  let a: Client;
  beforeAll(async () => {
    s = await startServer({ allowedOrigins: ["https://notes.example.test"] });
    a = new Client(s.url);
    await a.signUp();
  });
  afterAll(async () => s.close());

  it("refuses a state-changing request a plain form could send", async () => {
    const form = await a.request("PUT", "/api/prefs", "boards=[]", { "content-type": "application/x-www-form-urlencoded" });
    expect(form.status).toBe(403);
    expect(form.body?.code).toBe("csrf");
    const plain = await a.request("POST", "/api/notes", JSON.stringify({ rows: [] }), { "content-type": "text/plain" });
    expect(plain.status).toBe(403);
  });

  it("refuses a change from a foreign origin, and takes one from its own or a trusted one", async () => {
    const host = new URL(s.url).host;
    expect((await a.request("PUT", "/api/prefs", { boards: [] }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await a.request("PUT", "/api/prefs", { boards: [] }, { origin: "null" })).status).toBe(403);
    expect((await a.request("PUT", "/api/prefs", { boards: [] }, { origin: `http://${host}` })).status).toBe(200);
    const trusted = await a.request("PUT", "/api/prefs", { boards: [] }, { origin: "https://notes.example.test" });
    expect(trusted.status).toBe(200);
    expect(trusted.headers.get("access-control-allow-origin")).toBe("https://notes.example.test");
    expect(trusted.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("answers a trusted origin's preflight, and nobody else's", async () => {
    const ok = await fetch(`${s.url}/api/notes`, { method: "OPTIONS", headers: { origin: "https://notes.example.test" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-headers")).toContain("x-spar-request");
    const other = await fetch(`${s.url}/api/notes`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a body past its limit before reading it", async () => {
    const big = await a.request("PUT", "/api/prefs", { boards: ["x".repeat(5 * 1024 * 1024)] });
    expect(big.status).toBe(413);
  });

  it("refuses an unknown column, a bad cursor and a limit past the page size", async () => {
    expect((await a.request("POST", "/api/notes", { rows: [{ ...note(), owner_id: randomUUID() }] })).status).toBe(400);
    expect((await a.request("GET", "/api/notes?after_at=yesterday")).status).toBe(400);
    expect((await a.request("GET", "/api/notes?after_id=nope")).status).toBe(400);
    expect((await a.request("GET", "/api/notes?limit=1001")).status).toBe(400);
    expect((await a.request("GET", "/api/notes?limit=0")).status).toBe(400);
  });

  it("refuses a row of the wrong type as a row, naming it", async () => {
    const bad = note({ priority: "high" });
    const answer = await a.request("POST", "/api/notes", { rows: [bad] });
    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ code: "row_refused", reason: "invalid", id: bad.id });
    const nul = await a.request("POST", "/api/notes", { rows: [note({ body: "a\u0000b" })] });
    expect(nul.status).toBe(409);
  });

  it("answers an unknown endpoint 404 and a wrong method 405", async () => {
    expect((await a.request("GET", "/api/nothing")).status).toBe(404);
    const wrong = await a.request("DELETE", "/api/notes");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toContain("GET");
  });

  it("sends a Date header on every answer, errors included", async () => {
    expect((await a.request("GET", "/api/nothing")).headers.get("date")).toBeTruthy();
    expect((await new Client(s.url).request("GET", "/api/notes")).headers.get("date")).toBeTruthy();
  });

  it("refuses a push endpoint that is not a public https address", async () => {
    const sub = { p256dh: "BKey", auth: "auth", user_agent: null, seen_at: "2031-01-01T00:00:00Z", failed_at: null };
    for (const endpoint of ["http://push.example.test/x", "https://push.example.test:8443/x", "https://127.0.0.1/x", "https://localhost/x", "https://[::1]/x", "not a url"]) {
      expect((await a.request("POST", "/api/push/subscribe", { ...sub, endpoint })).status, endpoint).toBe(400);
    }
    expect((await a.request("POST", "/api/push/subscribe", { ...sub, endpoint: "https://push.example.test/x" })).status).toBe(204);
  });
});

describe("host names", () => {
  let s: Running;
  afterAll(async () => s?.close());

  /** `fetch` will not send a Host of our choosing (a forbidden header); node:http will. */
  function asHost(base: string, host: string, method: string, path: string, body?: string): Promise<number> {
    const url = new URL(base);
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path,
          method,
          headers: { host, origin: `http://${host}`, "content-type": "application/json" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }

  it("answers only the host names it was given, so a rebound name reaches nothing", async () => {
    s = await startServer({ allowedHosts: ["notes.example.test", "127.0.0.1"] });
    const port = new URL(s.url).port;
    expect((await fetch(`${s.url}/api/config`)).status).toBe(200);
    expect(await asHost(s.url, `notes.example.test:${port}`, "GET", "/api/config")).toBe(200);
    const signup = JSON.stringify({ email: "attacker@example.test", password: "a long enough password" });
    expect(await asHost(s.url, `evil.example:${port}`, "POST", "/api/auth/signup", signup)).toBe(421);
    expect(s.app.accounts.userCount()).toBe(0);
    // The health check says nothing and is asked by address (a container's
    // healthcheck), so it answers whatever the Host.
    expect(await asHost(s.url, `localhost:${port}`, "GET", "/api/health")).toBe(200);
    expect(await asHost(s.url, `localhost:${port}`, "GET", "/api/config")).toBe(421);
  });
});

describe("files", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("serves a file only as a download, never as a page of this origin", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const path = `${a.userId}/${randomUUID()}/${randomUUID()}`;
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    expect((await a.request("PUT", `/api/files/${path}`, html, { "content-type": "text/html" })).status).toBe(204);
    const got = await a.request("GET", `/api/files/${path}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-disposition")).toBe("attachment");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses an upload with neither JSON nor the custom header", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const answer = await fetch(`${s.url}/api/files/${a.userId}/n/f`, {
      method: "PUT",
      headers: { cookie: a.cookie ?? "", "content-type": "image/png" },
      body: new Uint8Array(3),
    });
    expect(answer.status).toBe(403);
  });

  it("cannot be walked out of: every traversal spelling is refused and nothing lands outside", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    for (const path of [
      `${a.userId}/..%2f..%2f/x`,
      `${a.userId}/%2e%2e/x`,
      `${a.userId}/n/..%2Fescape`,
      `${a.userId}/n/a%5Cb`,
      `${a.userId}/n/a/b`,
      `${a.userId}/n`,
      `..%2F${a.userId}/n/f`,
    ]) {
      const answer = await a.request("PUT", `/api/files/${path}`, new Uint8Array([1]));
      expect([400, 403, 404], path).toContain(answer.status);
    }
    expect(existsSync(join(s.dataDir, "escape"))).toBe(false);
    expect(existsSync(join(s.dataDir, "files", "escape"))).toBe(false);
  });

  it("keeps a user under their storage cap", async () => {
    s = await startServer({ storageCapBytes: 10 });
    const a = new Client(s.url);
    await a.signUp();
    const note = randomUUID();
    expect((await a.request("PUT", `/api/files/${a.userId}/${note}/one`, new Uint8Array(6))).status).toBe(204);
    // Replacing a file counts only the difference.
    expect((await a.request("PUT", `/api/files/${a.userId}/${note}/one`, new Uint8Array(8))).status).toBe(204);
    const over = await a.request("PUT", `/api/files/${a.userId}/${note}/two`, new Uint8Array(4));
    expect(over.status).toBe(507);
    expect(over.body?.code).toBe("storage_full");
    expect((await a.request("GET", "/api/account")).body).toMatchObject({ storage: { used_bytes: 8, cap_bytes: 10 } });
  });

  it("goes with its note when the note is permanently deleted", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const n = note({ status: "trashed" });
    await a.request("POST", "/api/notes", { rows: [n] });
    const path = `${a.userId}/${n.id}/${randomUUID()}`;
    await a.request("PUT", `/api/files/${path}`, new Uint8Array([1, 2, 3]));
    const deleted = await a.request("POST", `/api/notes/${n.id}/destroy`, { expected_updated_at: n.updated_at });
    expect(deleted.body).toEqual({ deleted: true });
    expect((await a.request("GET", `/api/files/${path}`)).status).toBe(404);
    expect(existsSync(join(s.dataDir, "files", a.userId, String(n.id)))).toBe(false);
  });

  // Windows has no owner-only mode bits to read back (audit CODE-7).
  it.skipIf(process.platform === "win32")("writes files and the database owner-only", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const path = `${a.userId}/${randomUUID()}/f`;
    await a.request("PUT", `/api/files/${path}`, new Uint8Array([1]));
    expect(statSync(join(s.dataDir, "files", ...path.split("/"))).mode & 0o077).toBe(0);
    expect(statSync(join(s.dataDir, "spar.db")).mode & 0o077).toBe(0);
    expect(statSync(join(s.dataDir, "vapid.json")).mode & 0o077).toBe(0);
    expect(statSync(join(s.dataDir, "session-secret")).mode & 0o077).toBe(0);
  });
});

/** The entries of a stored (uncompressed) zip, which is what the export writes. */
function zipEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    out.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

describe("the account", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("exports everything as the app's own archive, files included", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const board = randomUUID();
    await a.request("PUT", "/api/prefs", { boards: [{ id: board, name: "Recipes", position: 0 }], updated_at: "2031-01-01T00:00:00Z" });
    const withFile = note({ raw_content: "Bread\nflour, water", body: "Bread\nflour, water, salt", board_id: board });
    const path = `${a.userId}/${withFile.id}/${randomUUID()}`;
    withFile.attachments = [{ id: "att", name: "loaf.jpg", mime: "image/jpeg", size: 3, width: 1, height: 1, thumb: null, path, added_at: "2031-01-01T00:00:00Z" }];
    await a.request("POST", "/api/notes", { rows: [withFile, note({ raw_content: "archived one", body: "archived one", status: "archived" })] });
    await a.request("PUT", `/api/files/${path}`, new Uint8Array([7, 8, 9]));

    const response = await fetch(`${s.url}/api/account/export`, { headers: { cookie: a.cookie ?? "" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const entries = zipEntries(new Uint8Array(await response.arrayBuffer()));
    const names = [...entries.keys()];
    expect(names.some((n) => /\/Recipes\/.* Bread\.md$/.test(n))).toBe(true);
    expect(names.some((n) => /\/Recipes\/.* Bread \(original\)\.md$/.test(n))).toBe(true);
    expect(names.some((n) => /\/Archive\/.* archived one\.md$/.test(n))).toBe(true);
    const file = names.find((n) => n.endsWith("/loaf.jpg"));
    expect(file && [...entries.get(file)!]).toEqual([7, 8, 9]);
    const json = JSON.parse(new TextDecoder().decode(entries.get(names.find((n) => n.endsWith("/spår.json"))!)));
    expect(json.notes).toHaveLength(2);
    expect(json.folders[0].name).toBe("Recipes");
  });

  it("deletes every row and file of the user, and only theirs", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp("leaving@example.test", "leaving for good now");
    const b = new Client(s.url);
    await b.signUp();
    const mine = note({ status: "trashed" });
    const theirs = note();
    await a.request("POST", "/api/notes", { rows: [mine] });
    await b.request("POST", "/api/notes", { rows: [theirs] });
    await a.request("PUT", "/api/prefs", { boards: [] });
    await a.request("POST", "/api/canvases", { rows: [{ id: mine.id, items: [], strokes: [], image_widths: {}, text_elements: [] }] });
    await a.request("PUT", `/api/files/${a.userId}/${mine.id}/f`, new Uint8Array([1]));
    await a.request("POST", "/api/push/subscribe", {
      endpoint: "https://push.example.test/leaving",
      p256dh: "BKey",
      auth: "auth",
      user_agent: null,
      seen_at: "2031-01-01T00:00:00Z",
      failed_at: null,
    });

    expect((await a.request("POST", "/api/account/delete", { password: "not it at all" })).status).toBe(403);
    const gone = await a.request("POST", "/api/account/delete", { password: "leaving for good now" });
    expect(gone.status).toBe(204);
    expect(gone.headers.get("set-cookie")).toMatch(/Max-Age=0/);

    for (const table of ["users", "sessions", "notes", "canvases", "prefs", "prefs_history", "push_subscriptions", "files", "tombstones"]) {
      const column = table === "users" ? "id" : table === "sessions" ? "user_id" : "owner_id";
      const left = s.app.db.prepare(`select count(*) as n from ${table} where ${column} = ?`).get(a.userId) as { n: number };
      expect(left.n, table).toBe(0);
    }
    expect(existsSync(join(s.dataDir, "files", a.userId))).toBe(false);
    expect((await b.request("POST", "/api/notes/by-id", { ids: [theirs.id] })).body?.notes).toHaveLength(1);
    expect((await new Client(s.url).logIn("leaving@example.test", "leaving for good now")).status).toBe(401);
  });
});

/**
 * Audit DATA-9 (2026-10-10): the spår server keeps every folder list the
 * preferences row replaced, as Supabase does (migrations 0027, 0028) — only
 * when a folder's id, name, mark, tint or kind changed (audit SEC-9).
 */
describe("the folder list's history", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("keeps the list a change replaced, and skips a reorder, a lens move and a date", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const history = () =>
      s.app.db.prepare("select boards from prefs_history where owner_id = ? order by id").all(a.userId) as { boards: string }[];
    const put = (body: Record<string, unknown>) => a.request("PUT", "/api/prefs", body);
    const recipes = { id: "b1", name: "Recipes", position: 0 };
    const work = { id: "b2", name: "Work", position: 1 };

    await put({ boards: [recipes, work] });
    expect(history()).toHaveLength(0); // nothing replaced yet

    await put({ boards: [{ ...work, position: 0 }, { ...recipes, position: 1 }] }); // reorder
    await put({ boards: [{ ...work, position: 0 }, { ...recipes, position: 1, awake: true }] }); // keep-awake
    await put({ boards: [{ ...work, position: 0 }, { ...recipes, position: 1, awake: true }, { id: "shelf-order", name: "Shelf order", position: 1_000_000, lenses: ["files"] }] }); // lens order
    await put({ inbox_since: "1970-01-01T00:00:00Z" });
    // The shelf-order entry is an entry of its own, so its arrival counts once.
    expect(history()).toHaveLength(1);

    const before = history().length;
    await put({ boards: [{ ...work, name: "Job" }, recipes] }); // rename, and the order entry gone
    await put({ boards: [{ ...work, name: "Job", color: "teal" }, recipes] }); // tint
    await put({ boards: [{ ...work, name: "Job", color: "teal", icon: "BookOpenIcon" }, recipes] }); // mark
    await put({ boards: [] }); // the wipe of 2026-10-09
    const rows = history();
    expect(rows).toHaveLength(before + 4);
    expect(JSON.parse(rows[rows.length - 1].boards)).toEqual([{ ...work, name: "Job", color: "teal", icon: "BookOpenIcon" }, recipes]);
  });

  it("is read by nobody but the server, and goes with the account", async () => {
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp(undefined, "leaving for good now");
    await a.request("PUT", "/api/prefs", { boards: [{ id: "b1", name: "Recipes", position: 0 }] });
    await a.request("PUT", "/api/prefs", { boards: [] });
    const count = () =>
      (s.app.db.prepare("select count(*) as n from prefs_history where owner_id = ?").get(a.userId) as { n: number }).n;
    expect(count()).toBe(1);
    expect((await a.request("GET", "/api/prefs_history")).status).toBe(404);
    expect((await a.request("POST", "/api/account/delete", { password: "leaving for good now" })).status).toBe(204);
    expect(count()).toBe(0);
  });
});

describe("serving the app", () => {
  let s: Running;
  afterAll(async () => s?.close());

  it("serves the built PWA beside the API, with an SPA fallback and nothing outside its folder", async () => {
    const web = join(process.env.TMPDIR ?? "/tmp", `spar-web-${randomUUID()}`);
    mkdirSync(join(web, "assets"), { recursive: true });
    writeFileSync(join(web, "index.html"), "<!doctype html><title>spår</title>");
    writeFileSync(join(web, "assets", "app-1234.js"), "console.log(1)");
    writeFileSync(join(web, "sw.js"), "self");
    s = await startServer({ webDir: web });

    const index = await fetch(`${s.url}/`);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    const asset = await fetch(`${s.url}/assets/app-1234.js`);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${s.url}/sw.js`)).headers.get("cache-control")).toBe("no-cache");
    const route = await fetch(`${s.url}/some/app/route`);
    expect(await route.text()).toContain("<title>spår</title>");
    const escape = await fetch(`${s.url}/..%2f..%2fetc%2fpasswd`);
    expect(await escape.text()).toContain("<title>spår</title>");
    const config = await fetch(`${s.url}/config.json`);
    expect(await config.json()).toMatchObject({ backend: "spar-server", api: "/api" });
  });
});
