import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBackend } from "./supabaseBackend";

/**
 * The Supabase backend is the store's old calls, moved: what it asks the
 * client must be exactly what the store used to ask. The sync, board, canvas,
 * push, file and link-preview suites still speak to a scripted client through
 * it, so this file holds only what those do not reach by name — the keyset
 * filters, the two failures a link preview can be, the channels, and the
 * options a sign-in link is sent with.
 */

/** A query builder that records every step and answers `result`. */
function recorder(result: unknown = { data: [], error: null }) {
  const steps: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "or", "order", "limit", "eq", "in", "upsert", "update", "delete"]) {
    builder[name] = (...args: unknown[]) => {
      steps.push([name, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve(result);
  return { steps, builder };
}

function client(parts: Record<string, unknown>) {
  return parts as unknown as SupabaseClient;
}

describe("the Supabase backend", () => {
  it("pages notes by keyset, and asks for a first page by the stamp alone", async () => {
    const { steps, builder } = recorder();
    const backend = supabaseBackend(client({ from: () => builder }));
    await backend.pullNotes("id,body", { at: "2026-09-01T00:00:00Z", id: "n1" }, 500);
    await backend.pullNotes("id,body", { at: "2026-09-01T00:00:00Z", id: "" }, 500);
    expect(steps.filter((s) => s[0] === "or").map((s) => s[1])).toEqual([
      "updated_at.gt.2026-09-01T00:00:00Z,and(updated_at.eq.2026-09-01T00:00:00Z,id.gt.n1)",
      "updated_at.gt.2026-09-01T00:00:00Z",
    ]);
    expect(steps.slice(0, 5)).toEqual([
      ["select", "id,body"],
      ["or", expect.any(String)],
      ["order", "updated_at", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["limit", 500],
    ]);
  });

  it("reads a canvas first page from the stamp inclusive, and tombstones on their own keys", async () => {
    const { steps, builder } = recorder();
    const backend = supabaseBackend(client({ from: () => builder }));
    await backend.pullCanvases("id", { at: "2026-09-01T00:00:00Z", id: "" }, 200);
    await backend.pullTombstones({ at: "2026-09-01T00:00:00Z", id: "n1" }, 500);
    expect(steps.filter((s) => s[0] === "or").map((s) => s[1])).toEqual([
      "updated_at.gte.2026-09-01T00:00:00Z",
      "deleted_at.gt.2026-09-01T00:00:00Z,and(deleted_at.eq.2026-09-01T00:00:00Z,note_id.gt.n1)",
    ]);
  });

  it("answers one row or none for a note's state and the prefs row", async () => {
    const row = { id: "n1", status: "active" };
    const one = recorder({ data: [row], error: null });
    const none = recorder({ data: [], error: null });
    expect((await supabaseBackend(client({ from: () => one.builder })).noteState("n1")).data).toBe(
      row,
    );
    expect(one.steps).toEqual([
      ["select", "id,status,field_updated_at"],
      ["eq", "id", "n1"],
      ["limit", 1],
    ]);
    expect((await supabaseBackend(client({ from: () => none.builder })).readPrefs("boards")).data)
      .toBeNull();
  });

  it("tells a page's verdict from a moment when a link preview fails", async () => {
    const httpError = (status: unknown) =>
      Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        name: "FunctionsHttpError",
        context: { status },
      });
    const failures = [httpError(415), httpError(502), httpError(undefined), new Error("fetch failed")];
    const invoke = vi.fn(async () => ({ data: null, error: failures.shift() }));
    const backend = supabaseBackend(client({ functions: { invoke } }));

    const read = async () => (await backend.linkPreview({ url: "https://example.com" })).error;
    expect(await read()).toMatchObject({ answered: true, status: 415 });
    expect(await read()).toMatchObject({ answered: true, status: 502 });
    expect(await read()).toMatchObject({ answered: true, status: null });
    expect(await read()).toMatchObject({ answered: false, status: null });
    expect(invoke).toHaveBeenCalledWith("link-preview", { body: { url: "https://example.com" } });
  });

  it("opens one named channel per table and closes it through the client", () => {
    const opened: string[] = [];
    const tables: string[] = [];
    const removed: string[] = [];
    const handlers: ((payload: { new: unknown }) => void)[] = [];
    const channel = (name: string) => {
      const made = {
        name,
        on: (_event: string, filter: { table: string }, handler: (p: { new: unknown }) => void) => {
          tables.push(filter.table);
          handlers.push(handler);
          return made;
        },
        subscribe: () => {
          opened.push(name);
          return made;
        },
      };
      return made;
    };
    const backend = supabaseBackend(
      client({ channel, removeChannel: (ch: { name: string }) => removed.push(ch.name) }),
    );
    const seen: unknown[] = [];
    const stops = (["notes", "folders", "prefs"] as const).map((table) =>
      backend.subscribe(table, (row) => seen.push(row)),
    );
    expect(opened).toEqual(["notes-changes", "folder-changes", "prefs-changes"]);
    expect(tables).toEqual(["notes", "folders", "prefs"]);
    // The new row is handed on as it came, for the echo check to read.
    const row = { id: "n1", updated_at: "2026-09-01T00:00:00Z" };
    handlers[0]({ new: row });
    expect(seen).toEqual([row]);
    for (const stop of stops) stop();
    expect(removed).toEqual(opened);
  });

  it("sends a sign-in link that never creates an account", async () => {
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const backend = supabaseBackend(client({ auth: { signInWithOtp } }));
    if (backend.auth.kind !== "magic-link") throw new Error("expected a magic link");
    await backend.auth.sendLink("me@example.com", "https://notes.example");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "me@example.com",
      options: { emailRedirectTo: "https://notes.example", shouldCreateUser: false },
    });
  });

  it("checks a typed code as an email code (audit UX-11)", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    const backend = supabaseBackend(client({ auth: { verifyOtp } }));
    if (backend.auth.kind !== "magic-link") throw new Error("expected a magic link");
    expect(await backend.auth.verifyCode("me@example.com", "123456")).toEqual({ error: null });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "me@example.com", token: "123456", type: "email" });
  });

  // Signing out here ends this device's session only (audit 2026-10-10,
  // SEC-7): the global default signed every other device out as well.
  it("signs out this device only", async () => {
    const signOut = vi.fn<(options?: unknown) => Promise<{ error: null }>>(async () => ({ error: null }));
    const backend = supabaseBackend(client({ auth: { signOut } }));
    await backend.signOut();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

/**
 * Someone's own Supabase may take new people, and says so the way every
 * installation says what it is: `"signup": "open"` in the `/config.json` a
 * runtime-config build reads. Nothing else opens it — not another mode, not a
 * missing file, and never a build with its values baked in, which is the
 * owner's. Each case loads the modules afresh, because `RUNTIME_CONFIG` is
 * read once, when `config.ts` is first evaluated, as it is by the build.
 */
describe("who a sign-in link may make an account for", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function createsUser(runtime: boolean, file: unknown): Promise<unknown> {
    vi.stubEnv("VITE_RUNTIME_CONFIG", runtime ? "1" : "");
    vi.stubEnv("VITE_SUPABASE_URL", "https://baked.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "baked");
    const fetched = vi.fn(async () =>
      file === undefined
        ? new Response("", { status: 404 })
        : new Response(JSON.stringify(file), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetched);
    vi.resetModules();
    const config = await import("./config");
    await config.loadBackendConfig();
    const { supabaseBackend: wrap } = await import("./supabaseBackend");
    const signInWithOtp = vi.fn(async () => ({ error: null }));
    const backend = wrap(client({ auth: { signInWithOtp } }));
    if (backend.auth.kind !== "magic-link") throw new Error("expected a magic link");
    await backend.auth.sendLink("new@example.com", "https://notes.example");
    // A build with its values baked in never even asks for the file.
    if (!runtime) expect(fetched).not.toHaveBeenCalled();
    const [[call]] = signInWithOtp.mock.calls as unknown as [[{ options: { shouldCreateUser: unknown } }]];
    return call.options.shouldCreateUser;
  }

  const project = { backend: "supabase", supabaseUrl: "https://own.supabase.co", supabaseKey: "k" };

  it("makes one where the installation's config says sign-up is open", async () => {
    expect(await createsUser(true, { ...project, signup: "open" })).toBe(true);
  });

  it("makes none where it says anything else, or nothing", async () => {
    expect(await createsUser(true, { ...project, signup: "closed" })).toBe(false);
    expect(await createsUser(true, { ...project, signup: "invite" })).toBe(false);
    expect(await createsUser(true, { ...project, signup: "OPEN" })).toBe(false);
    expect(await createsUser(true, project)).toBe(false);
    expect(await createsUser(true, undefined)).toBe(false);
  });

  it("makes none, exactly as before, in a build with its values baked in", async () => {
    // Even with a server that would answer "open": this build never reads it.
    expect(await createsUser(false, { ...project, signup: "open" })).toBe(false);
  });
});
