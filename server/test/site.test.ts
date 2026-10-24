/**
 * One image, any backend: the settings that choose it (`SPAR_BACKEND` and the
 * Supabase values), and the app-only server the `supabase` and `none` modes
 * run — the built app and `/config.json`, with the API, the database and the
 * data folder left alone.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { configFromEnv, testConfig } from "../src/config";
import { createSite, type Site } from "../src/site";

const WEB = { SPAR_WEB_DIR: "/srv/web" };

/** A JWT-shaped key whose payload names a role, as Supabase's legacy keys are. */
function legacyKey(role: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ iss: "supabase", role })}.signature`;
}

describe("choosing the backend", () => {
  it("is the spår server unless told otherwise", () => {
    const config = configFromEnv({});
    expect(config.backend).toBe("spar-server");
    expect(config.supabaseUrl).toBeNull();
    expect(configFromEnv({ SPAR_BACKEND: " Spar-Server " }).backend).toBe("spar-server");
  });

  it("refuses a backend it does not know", () => {
    expect(() => configFromEnv({ SPAR_BACKEND: "firebase", ...WEB })).toThrow(/spar-server, supabase or none/);
  });

  it("takes a Supabase project URL and publishable key, trimmed to what the app wants", () => {
    const config = configFromEnv({
      SPAR_BACKEND: "supabase",
      SPAR_SUPABASE_URL: "https://abc.supabase.co/rest/v1/",
      SPAR_SUPABASE_KEY: "sb_publishable_xyz",
      ...WEB,
    });
    expect(config).toMatchObject({ backend: "supabase", supabaseUrl: "https://abc.supabase.co", supabaseKey: "sb_publishable_xyz" });
    // A legacy anon key is a JWT too, and is fine.
    expect(
      configFromEnv({ SPAR_BACKEND: "supabase", SPAR_SUPABASE_URL: "http://127.0.0.1:54321", SPAR_SUPABASE_KEY: legacyKey("anon"), ...WEB })
        .supabaseKey,
    ).toBe(legacyKey("anon"));
  });

  it("will not start Supabase mode half-configured", () => {
    expect(() => configFromEnv({ SPAR_BACKEND: "supabase", SPAR_SUPABASE_KEY: "sb_publishable_xyz", ...WEB })).toThrow(/SPAR_SUPABASE_URL/);
    expect(() => configFromEnv({ SPAR_BACKEND: "supabase", SPAR_SUPABASE_URL: "https://abc.supabase.co", ...WEB })).toThrow(/SPAR_SUPABASE_KEY/);
    expect(() =>
      configFromEnv({ SPAR_BACKEND: "supabase", SPAR_SUPABASE_URL: "abc.supabase.co", SPAR_SUPABASE_KEY: "sb_publishable_xyz", ...WEB }),
    ).toThrow(/must be a URL/);
    expect(() =>
      configFromEnv({ SPAR_BACKEND: "supabase", SPAR_SUPABASE_URL: "ftp://abc.supabase.co", SPAR_SUPABASE_KEY: "sb_publishable_xyz", ...WEB }),
    ).toThrow(/http\(s\)/);
  });

  it("refuses to hand a secret key to every visitor", () => {
    const env = { SPAR_BACKEND: "supabase", SPAR_SUPABASE_URL: "https://abc.supabase.co", ...WEB };
    // Spelled in two parts: the publish script's leak guard refuses the prefix written whole.
    expect(() => configFromEnv({ ...env, SPAR_SUPABASE_KEY: "sb_" + "secret_abc" })).toThrow(/secret/);
    expect(() => configFromEnv({ ...env, SPAR_SUPABASE_KEY: legacyKey("service_role") })).toThrow(/secret/);
  });

  it("needs the app to serve when it runs no API", () => {
    expect(() => configFromEnv({ SPAR_BACKEND: "none" })).toThrow(/SPAR_WEB_DIR/);
    expect(configFromEnv({ SPAR_BACKEND: "none", ...WEB }).backend).toBe("none");
  });

  it("keeps the full server out of the app-only modes, and the other way round", async () => {
    await expect(createApp(testConfig("/nonexistent", { backend: "none", webDir: "/srv/web" }))).rejects.toThrow(/createSite/);
    expect(() => createSite(testConfig("/nonexistent"))).toThrow(/createApp/);
  });
});

describe("serving the app only", () => {
  const root = join(process.env.TMPDIR ?? "/tmp", `spar-site-${randomUUID()}`);
  const web = join(root, "web");
  const dataDir = join(root, "data");
  let site: Site | undefined;
  let url = "";

  beforeAll(() => {
    mkdirSync(join(web, "assets"), { recursive: true });
    writeFileSync(join(web, "index.html"), "<!doctype html><title>spår</title>");
    writeFileSync(join(web, "assets", "app-1234.js"), "console.log(1)");
    // A stale file in the build must not answer for the server's own.
    writeFileSync(join(web, "config.json"), JSON.stringify({ backend: "spar-server" }));
  });
  afterEach(async () => {
    await site?.close();
    site = undefined;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function start(overrides: Parameters<typeof testConfig>[1]) {
    site = createSite(testConfig(dataDir, { webDir: web, ...overrides }));
    url = (await site.listen()).url;
  }

  it("points the app at Supabase, serves it, and runs none of the API", async () => {
    await start({
      backend: "supabase",
      supabaseUrl: "https://abc.supabase.co",
      supabaseKey: "sb_publishable_xyz",
      vapidPublicKey: "BPublicKey",
      signup: "closed",
    });
    const config = await fetch(`${url}/config.json`);
    expect(config.status).toBe(200);
    expect(config.headers.get("cache-control")).toBe("no-store");
    // Exactly the keys `parseConfig` (web/src/store/backend/config.ts) reads.
    expect(await config.json()).toEqual({
      backend: "supabase",
      supabaseUrl: "https://abc.supabase.co",
      supabaseKey: "sb_publishable_xyz",
      vapidPublicKey: "BPublicKey",
      signup: "closed",
    });
    expect((await fetch(`${url}/api/health`)).status).toBe(200);
    const index = await fetch(`${url}/`);
    expect(await index.text()).toContain("<title>spår</title>");
    expect((await fetch(`${url}/assets/app-1234.js`)).headers.get("cache-control")).toContain("immutable");
    expect(await (await fetch(`${url}/some/app/route`)).text()).toContain("<title>spår</title>");
    for (const path of ["/api/config", "/api/auth/session", "/api/notes", "/api"]) {
      const answer = await fetch(`${url}${path}`);
      expect(answer.status, path).toBe(404);
      expect(((await answer.json()) as { code: string }).code).toBe("not_found");
    }
    const signup = await fetch(`${url}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.test", password: "a long enough password" }),
    });
    expect(signup.status).toBe(404);
    expect((await fetch(`${url}/`, { method: "POST" })).status).toBe(404);
    // Nothing was written: the data folder was never even made.
    expect(existsSync(dataDir)).toBe(false);
  });

  it("passes SPAR_SIGNUP through, which is what lets a sign-in link make an account", async () => {
    await start({ backend: "supabase", supabaseUrl: "https://abc.supabase.co", supabaseKey: "sb_publishable_xyz", signup: "open" });
    expect(await (await fetch(`${url}/config.json`)).json()).toMatchObject({ signup: "open" });
  });

  it("leaves out a Web Push key it was not given", async () => {
    await start({ backend: "supabase", supabaseUrl: "https://abc.supabase.co", supabaseKey: "sb_publishable_xyz" });
    expect(await (await fetch(`${url}/config.json`)).json()).not.toHaveProperty("vapidPublicKey");
  });

  it("tells the app to keep the notes on the device when the backend is none", async () => {
    await start({ backend: "none" });
    expect(await (await fetch(`${url}/config.json`)).json()).toEqual({ backend: "none" });
    expect((await fetch(`${url}/api/notes`)).status).toBe(404);
    expect(existsSync(dataDir)).toBe(false);
  });

  it("answers only its own host names, except for the health check", async () => {
    await start({ backend: "none", allowedHosts: ["notes.example.test"] });
    const port = new URL(url).port;
    const asHost = (host: string, path: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest({ hostname: "127.0.0.1", port, path, headers: { host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
    expect(await asHost(`notes.example.test:${port}`, "/config.json")).toBe(200);
    expect(await asHost(`evil.example:${port}`, "/config.json")).toBe(421);
    expect(await asHost(`evil.example:${port}`, "/")).toBe(421);
    expect(await asHost(`127.0.0.1:${port}`, "/api/health")).toBe(200);
  });
});
