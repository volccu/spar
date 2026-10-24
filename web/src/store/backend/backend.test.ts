// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which backend a session talks to, and where it learns that.
 *
 * The line held here is the owner's: **a build with its values baked in never
 * asks the server for `/config.json`**, and answers from its own variables
 * exactly as it always did. Only a build made with `VITE_RUNTIME_CONFIG=1`
 * (the container's) reads the file, falls back when it cannot, and may be
 * pointed at a spår server (`sparServerBackend.test.ts` holds that adapter).
 *
 * Every case loads the modules afresh, because `RUNTIME_CONFIG` is read once,
 * when `config.ts` is first evaluated — as it is by the build.
 */

/** The client `getSupabase` hands back, standing in for supabase-js. */
const fake = vi.hoisted(() => ({ client: null as object | null, asked: 0 }));

vi.mock("../supabase", () => ({
  getSupabase: async () => {
    fake.asked += 1;
    return fake.client;
  },
}));

type Config = typeof import("./config");
type Index = typeof import("./index");

async function load(): Promise<{ config: Config; backend: Index }> {
  vi.resetModules();
  const shell = await import("../shell");
  // What `useNotes` does once the archive is on screen; the runtime path
  // waits for it before it asks for anything.
  shell.shellReady();
  return { config: await import("./config"), backend: await import("./index") };
}

let fetchCalls: string[];

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => {
  fake.client = null;
  fake.asked = 0;
  fetchCalls = [];
  localStorage.clear();
  // Every build variable starts empty, whatever web/.env holds on the machine
  // running the suite; a test that wants one sets it. Without this the
  // device-only cases pass in a bare checkout and fail on one with real keys.
  for (const name of [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_VAPID_PUBLIC_KEY",
    "VITE_RUNTIME_CONFIG",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      fetchCalls.push(String(input));
      throw new TypeError("offline");
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a build with its values baked in", () => {
  it("answers from its own variables and fetches nothing", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co/rest/v1/");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "publishable");
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", " vapid ");
    const { config, backend } = await load();

    expect(config.RUNTIME_CONFIG).toBe(false);
    await expect(config.loadBackendConfig()).resolves.toEqual({
      backend: "supabase",
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "publishable",
      vapidPublicKey: "vapid",
    });
    // Known at once, with no file to wait for.
    expect(config.knownConfig()?.backend).toBe("supabase");

    fake.client = {};
    await backend.getBackend();
    expect(fetchCalls).toEqual([]);
  });

  it("is device-only with no variables, still without asking", async () => {
    const { config, backend } = await load();
    await expect(config.loadBackendConfig()).resolves.toMatchObject({ backend: "none" });
    await expect(backend.getBackend()).resolves.toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  it("is the Supabase client, wrapped, whenever there is one", async () => {
    const { backend } = await load();
    fake.client = {};
    const first = await backend.getBackend();
    expect(first?.kind).toBe("supabase");
    expect(first?.auth.kind).toBe("magic-link");
    // One wrapper per client, so a session's many calls share it.
    expect(await backend.getBackend()).toBe(first);

    fake.client = null;
    await expect(backend.getBackend()).resolves.toBeNull();
  });
});

describe("a build that reads /config.json", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_RUNTIME_CONFIG", "1");
  });

  it("reads it once, after the shell, and names a spår server from it", async () => {
    answer(200, { backend: "spar-server", signup: "invite" });
    const { config, backend } = await load();
    expect(config.RUNTIME_CONFIG).toBe(true);
    expect(config.knownConfig()).toBeNull();

    const server = await backend.getBackend();
    expect(server?.kind).toBe("spar-server");
    expect(server?.auth.kind).toBe("password");
    await backend.getBackend();
    expect(fetchCalls).toEqual(["/config.json"]);
    expect(config.knownConfig()?.backend).toBe("spar-server");
    // The Supabase client is never started for it.
    expect(fake.asked).toBe(0);
  });

  it("reaches a spår server through one adapter for the session, on the page's own origin", async () => {
    answer(200, { backend: "spar-server", signup: "invite" });
    const { backend } = await load();
    const server = (await backend.getBackend())!;
    // One object: it holds who is signed in and the one event stream.
    expect(await backend.getBackend()).toBe(server);
    expect(server.account).toBeDefined();

    // Nobody signed in on this browser, so the server is asked, on its own API.
    answer(200, { user: null });
    await expect(server.session()).resolves.toBeNull();
    expect(fetchCalls).toEqual(["/config.json", "/api/auth/session"]);
    // Offline, the form still knows what the installation means to offer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    if (server.auth.kind !== "password") throw new Error("expected a password backend");
    await expect(server.auth.signupState()).resolves.toEqual({
      mode: "invite",
      firstAccount: false,
    });
  });

  it("uses the file's Supabase project over the build's", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://baked.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "baked");
    answer(200, {
      backend: "supabase",
      supabaseUrl: "https://file.supabase.co/",
      supabaseKey: "from-file",
      vapidPublicKey: "file-vapid",
    });
    const { config, backend } = await load();
    fake.client = {};
    expect((await backend.getBackend())?.kind).toBe("supabase");
    expect(config.knownConfig()).toEqual({
      backend: "supabase",
      supabaseUrl: "https://file.supabase.co",
      supabaseKey: "from-file",
      vapidPublicKey: "file-vapid",
    });
  });

  it("is no backend at all when the file says none", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://baked.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "baked");
    answer(200, { backend: "none" });
    const { backend } = await load();
    fake.client = {};
    await expect(backend.getBackend()).resolves.toBeNull();
    expect(fake.asked).toBe(0);
  });

  it("falls back to the build's variables when there is no file", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://baked.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "baked");
    answer(404, "not here");
    const { config } = await load();
    await expect(config.loadBackendConfig()).resolves.toMatchObject({
      backend: "supabase",
      supabaseUrl: "https://baked.supabase.co",
    });
  });

  it("falls back to the build's variables when the file names no backend it knows", async () => {
    answer(200, { backend: "firebase" });
    const { config } = await load();
    await expect(config.loadBackendConfig()).resolves.toMatchObject({ backend: "none" });
  });

  it("offline, uses the last file this browser read", async () => {
    answer(200, { backend: "spar-server", signup: "open" });
    let { config } = await load();
    await config.loadBackendConfig();

    // The next open, with no network.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    ({ config } = await load());
    await expect(config.loadBackendConfig()).resolves.toEqual({
      backend: "spar-server",
      signup: "open",
    });
  });
});

describe("ringing, on a build that reads /config.json", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_RUNTIME_CONFIG", "1");
    // Just enough of a browser that can ring; `push.test.ts` drives the rest.
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
    Object.defineProperty(window, "Notification", { configurable: true, value: class {} });
  });

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    delete (window as { PushManager?: unknown }).PushManager;
    delete (window as { Notification?: unknown }).Notification;
  });

  it("takes the signing key from the file, and cannot ring before it is read", async () => {
    answer(200, { backend: "spar-server", vapidPublicKey: "file-vapid" });
    const { config } = await load();
    const push = await import("../push");
    expect(push.pushSupported()).toBe(false);
    await config.loadBackendConfig();
    expect(push.pushSupported()).toBe(true);
  });

  it("falls back to the build's key when the file names none", async () => {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "baked-vapid");
    answer(200, { backend: "spar-server" });
    const { config } = await load();
    const push = await import("../push");
    await config.loadBackendConfig();
    expect(push.pushSupported()).toBe(true);
  });

  it("cannot ring with no backend to register with", async () => {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "baked-vapid");
    answer(200, { backend: "none" });
    const { config } = await load();
    const push = await import("../push");
    await config.loadBackendConfig();
    expect(push.pushSupported()).toBe(false);
  });
});

describe("reading the file", () => {
  it("drops what it does not understand, and a Supabase with nowhere to go", async () => {
    const { config } = await load();
    const none = { backend: "none" as const };
    expect(config.parseConfig(null, none)).toBeNull();
    expect(config.parseConfig({ backend: 3 }, none)).toBeNull();
    expect(config.parseConfig({ backend: "supabase" }, none)).toMatchObject({ backend: "none" });
    expect(
      config.parseConfig({ backend: "spar-server", signup: "sometimes", vapidPublicKey: " " }, none),
    ).toEqual({ backend: "spar-server" });
    expect(
      config.parseConfig({ backend: "spar-server" }, { backend: "none", vapidPublicKey: "baked" }),
    ).toEqual({ backend: "spar-server", vapidPublicKey: "baked" });
  });
});
