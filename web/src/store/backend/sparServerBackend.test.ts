// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_SESSION_KEY, type MarkerStorage } from "./marker";
import { ROW_REFUSED_CODE, sparServerBackend, type SparServerOptions } from "./sparServerBackend";
import type { AuthSession, Backend, PasswordAuth } from "./types";

/**
 * The spår server backend, one method at a time, against a fetch that plays
 * the server: what each call puts on the wire (`docs/server-api.md`, "Mapping
 * the client's operations") and how each answer comes back in the shape the
 * store reads (`types.ts`). The same adapter is driven against the real server
 * in `server/test/webClient.test.ts`; this file holds the mapping itself —
 * above all the parts a real server does not produce on demand: a network
 * that is not there, a stream that drops, another tab signing out.
 */

const DATE = "Sun, 27 Sep 2026 12:00:00 GMT";
const USER = "c47c7b4b-4aa6-487e-80fb-8cc6efcc2764";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

type Route = (call: Call, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", date: DATE, ...headers },
  });
}

const empty = (status = 204) => new Response(null, { status, headers: { date: DATE } });

/** A fetch that answers from `routes` (keyed "METHOD /path") and records every call. */
function server(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = { ...((init.headers ?? {}) as Record<string, string>) };
    let body: unknown = init.body;
    if (typeof body === "string" && headers["content-type"] === "application/json") body = JSON.parse(body);
    const call: Call = { method, url, headers, body, credentials: init.credentials };
    calls.push(call);
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const route = routes[`${method} ${path}`];
    if (!route) return json(404, { error: "No such endpoint", code: "not_found" });
    return route(call, init);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function memory(initial: Record<string, string> = {}): MarkerStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const marked = () => memory({ [SERVER_SESSION_KEY]: JSON.stringify({ id: USER }) });

function make(routes: Record<string, Route>, options: Partial<SparServerOptions> = {}) {
  const wire = server(routes);
  const dates: (string | null)[] = [];
  const storage = options.storage === undefined ? memory() : options.storage;
  const events = new EventTarget();
  const backend = sparServerBackend(
    { signup: "invite" },
    {
      fetch: wire.fetch,
      storage,
      events,
      onDate: (date) => dates.push(date),
      backoff: { firstMs: 5, maxMs: 20 },
      ...options,
    },
  );
  const heard: (AuthSession | null)[] = [];
  backend.onSessionChange((session) => heard.push(session));
  return { backend, calls: wire.calls, dates, storage, events, heard };
}

const password = (backend: Backend) => backend.auth as PasswordAuth;
const offline: Route = () => {
  throw new TypeError("Failed to fetch");
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the wire, method by method", () => {
  const cursor = { at: "2026-09-27T12:00:00.123456+00:00", id: "0b5c2c8e-3c1b-4f39-9d1e-0c7f2d2f2e10" };

  it("pulls with the keyset in the query, the + of an instant encoded, and no id when there is none", async () => {
    const { backend, calls } = make({
      "GET /api/notes": () => json(200, { notes: [{ id: "a" }] }),
      "GET /api/tombstones": () => json(200, { tombstones: [{ note_id: "b", deleted_at: "x" }] }),
      "GET /api/canvases": () => json(200, { canvases: [] }),
    });
    await expect(backend.pullNotes("id,body", cursor, 500)).resolves.toEqual({ data: [{ id: "a" }], error: null });
    await backend.pullTombstones({ at: "1970-01-01T00:00:00.000Z", id: "" }, 100);
    await backend.pullCanvases("id", { at: cursor.at, id: "" }, 7);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/notes?after_at=2026-09-27T12%3A00%3A00.123456%2B00%3A00&after_id=0b5c2c8e-3c1b-4f39-9d1e-0c7f2d2f2e10&limit=500",
      "/api/tombstones?after_at=1970-01-01T00%3A00%3A00.000Z&limit=100",
      "/api/canvases?after_at=2026-09-27T12%3A00%3A00.123456%2B00%3A00&limit=7",
    ]);
    // Same origin: the cookie goes because it is the page's own.
    expect(calls.every((c) => c.credentials === "same-origin" && c.method === "GET")).toBe(true);
  });

  it("asks the combined pull with three cursors", async () => {
    const changes = { notes: [], tombstones: [], folders: [], prefs: null };
    const { backend, calls } = make({ "GET /api/changes": () => json(200, changes) });
    const result = await backend.pullChanges({
      notes: cursor,
      tombstones: { at: cursor.at, id: "" },
      folders: { at: "1970-01-01T00:00:00.000Z", id: "" },
      limit: 250,
    });
    expect(result).toEqual({ data: changes, error: null });
    const query = new URL(calls[0].url, "http://x").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      notes_at: cursor.at,
      notes_id: cursor.id,
      tombstones_at: cursor.at,
      folders_at: "1970-01-01T00:00:00.000Z",
      limit: "250",
    });
  });

  it("writes as JSON, and reads each answer's own key", async () => {
    const { backend, calls } = make({
      "POST /api/notes": () => json(200, { count: 1 }),
      "POST /api/notes/by-id": () => json(200, { notes: [{ id: "a" }] }),
      "GET /api/notes/a%2Fb/state": () => json(200, { state: null }),
      "GET /api/notes/n1/state": () => json(200, { state: { id: "n1", status: "trashed", field_updated_at: {} } }),
      "PATCH /api/notes/n1": () => empty(),
      "POST /api/notes/n1/destroy": () => json(200, { deleted: true }),
      "POST /api/canvases": () => json(200, { count: 1 }),
      "PUT /api/prefs": () => json(200, { prefs: { boards: [] } }),
      "GET /api/prefs": () => json(200, { prefs: null }),
    });
    const row = { id: "n1", raw_content: "x", body: "x", source: "web" };
    await expect(backend.upsertNotes([row])).resolves.toEqual({ error: null });
    await expect(backend.notesById("id", ["a"])).resolves.toEqual({ data: [{ id: "a" }], error: null });
    await expect(backend.noteState("a/b")).resolves.toEqual({ data: null, error: null });
    await expect(backend.noteState("n1")).resolves.toMatchObject({ data: { status: "trashed" } });
    await expect(backend.patchNote("n1", { status: "trashed" })).resolves.toEqual({ error: null });
    await expect(backend.permanentlyDeleteNote("n1", "2026-09-27T12:00:00.000Z")).resolves.toEqual({
      data: true,
      error: null,
    });
    await expect(backend.upsertCanvases([{ id: "n1", items: [] }])).resolves.toEqual({ error: null });
    await expect(backend.upsertPrefs({ boards: [], updated_at: "2026-09-27T12:00:00.000Z" })).resolves.toEqual({
      error: null,
    });
    await expect(backend.readPrefs("boards,updated_at")).resolves.toEqual({ data: null, error: null });

    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "/api/notes", { rows: [row] }],
      ["POST", "/api/notes/by-id", { ids: ["a"] }],
      ["PATCH", "/api/notes/n1", { status: "trashed" }],
      ["POST", "/api/notes/n1/destroy", { expected_updated_at: "2026-09-27T12:00:00.000Z" }],
      ["POST", "/api/canvases", { rows: [{ id: "n1", items: [] }] }],
      ["PUT", "/api/prefs", { boards: [], updated_at: "2026-09-27T12:00:00.000Z" }],
    ]);
    // JSON is what makes a change one a plain form cannot send (CSRF).
    expect(writes.every((c) => c.headers["content-type"] === "application/json")).toBe(true);
  });

  it("writes the folder list conditionally, and reads a 412 as \"the row moved on\" (audit DATA-1)", async () => {
    let moved = false;
    const { backend, calls } = make({
      "PUT /api/prefs": () =>
        moved ? json(412, { error: "The preferences changed since they were read", code: "prefs_moved" }) : json(200, { prefs: null }),
    });
    const row = { boards: [], updated_at: "2026-10-10T12:00:00.000Z" };
    await expect(backend.writePrefsIf(row, "2026-10-10T11:00:00.000Z")).resolves.toEqual({ data: true, error: null });
    expect(calls[calls.length - 1].body).toEqual({ ...row, expected_updated_at: "2026-10-10T11:00:00.000Z" });
    await expect(backend.writePrefsIf(row, null)).resolves.toEqual({ data: true, error: null });
    expect(calls[calls.length - 1].body).toEqual({ ...row, expected_updated_at: null });
    moved = true;
    await expect(backend.writePrefsIf(row, "2026-10-10T11:00:00.000Z")).resolves.toEqual({ data: false, error: null });
  });

  it("asks for at most a thousand ids at a time", async () => {
    const { backend, calls } = make({
      "POST /api/notes/by-id": (call) => json(200, { notes: (call.body as { ids: string[] }).ids.slice(0, 1).map((id) => ({ id })) }),
    });
    const ids = Array.from({ length: 2500 }, (_, i) => `id-${i}`);
    const { data } = await backend.notesById("id", ids);
    expect(calls.map((c) => (c.body as { ids: string[] }).ids.length)).toEqual([1000, 1000, 500]);
    expect(data).toEqual([{ id: "id-0" }, { id: "id-1000" }, { id: "id-2000" }]);
  });

  it("answers yes to every capability, without asking", async () => {
    const { backend, calls } = make({});
    await expect(backend.probeColumn("notes", "merged_into")).resolves.toEqual({ error: null });
    expect(calls).toEqual([]);
  });

  it("registers a device without naming its owner, which the cookie does", async () => {
    const { backend, calls } = make({
      "POST /api/push/subscribe": () => empty(),
      "POST /api/push/unsubscribe": () => empty(),
    });
    const row = { endpoint: "https://push.example/1", p256dh: "k", auth: "a", seen_at: "x", failed_at: null };
    await expect(backend.upsertPushSubscription({ ...row, owner_id: USER })).resolves.toEqual({ error: null });
    await expect(backend.deletePushSubscription(row.endpoint)).resolves.toEqual({ error: null });
    expect(calls.map((c) => c.body)).toEqual([row, { endpoint: row.endpoint }]);
  });
});

describe("failures, in the codes the store decides on", () => {
  it("reports a row refusal as class 23, so the batch is bisected down to the row", async () => {
    const { backend } = make({
      "POST /api/notes": () =>
        json(409, { error: "raw_content is immutable", code: "row_refused", reason: "raw_content_immutable", id: "n1" }),
      "POST /api/canvases": () => json(409, { error: "no such note", code: "row_refused", reason: "no_such_note" }),
      "PATCH /api/notes/n1": () => json(409, { error: "bad type", code: "row_refused", reason: "invalid" }),
    });
    const refused = await backend.upsertNotes([{ id: "n1" }]);
    expect(refused.error).toEqual({ message: "raw_content is immutable", code: ROW_REFUSED_CODE });
    expect(ROW_REFUSED_CODE).toMatch(/^23/);
    expect((await backend.upsertCanvases([{ id: "n1" }])).error?.code).toBe("23000");
    expect((await backend.patchNote("n1", { priority: "x" })).error?.code).toBe("23000");
  });

  it("reports every other failure as the request's, with its status, and never as a missing capability", async () => {
    const { backend } = make({
      "POST /api/notes": () => json(409, { error: "Sign-up with an address already in use", code: "email_taken" }),
      "GET /api/notes": () => json(400, { error: "limit must be an integer", code: "invalid_limit" }),
      "PUT /api/prefs": () => new Response("<html>bad gateway</html>", { status: 502, headers: { date: DATE } }),
      "GET /api/tombstones": offline,
    });
    expect((await backend.upsertNotes([])).error).toEqual({
      message: "Sign-up with an address already in use",
      code: "409",
    });
    expect((await backend.pullNotes("id", { at: "", id: "" }, 5000)).error?.code).toBe("400");
    expect((await backend.upsertPrefs({})).error).toEqual({ message: "The server answered 502", code: "502" });
    const offlineAnswer = await backend.pullTombstones({ at: "", id: "" }, 10);
    expect(offlineAnswer).toEqual({
      data: null,
      error: { message: "The server could not be reached: Failed to fetch", code: null },
    });
  });

  it("reads the server's clock off every answer, errors included", async () => {
    const { backend, dates } = make({
      "GET /api/prefs": () => json(200, { prefs: null }),
      "POST /api/notes": () => json(500, { error: "boom", code: "internal" }),
    });
    await backend.readPrefs("boards");
    await backend.upsertNotes([]);
    expect(dates).toEqual([DATE, DATE]);
  });
});

describe("files", () => {
  const path = `${USER}/0b5c2c8e-3c1b-4f39-9d1e-0c7f2d2f2e10/att ü#1`;
  const url = `/api/files/${USER}/0b5c2c8e-3c1b-4f39-9d1e-0c7f2d2f2e10/att%20%C3%BC%231`;

  it("puts the bytes at the path, each segment encoded on its own, with the header a form cannot send", async () => {
    const { backend, calls } = make({ [`PUT ${url}`]: () => empty() });
    const bytes = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    await expect(backend.uploadFile(path, bytes, "image/png")).resolves.toEqual({ error: null });
    expect(calls[0].url).toBe(url);
    expect(calls[0].headers).toEqual({ "content-type": "image/png", "x-spar-request": "1" });
    expect(calls[0].body).toBe(bytes);
  });

  it("says in words why a file was refused", async () => {
    let status = 413;
    const { backend } = make({
      [`PUT ${url}`]: () => json(status, { error: "x", code: status === 413 ? "too_large" : "storage_full" }),
    });
    const blob = new Blob(["x"]);
    expect((await backend.uploadFile(path, blob, "")).error).toMatchObject({ code: "413", message: expect.stringMatching(/too large/) });
    status = 507;
    expect((await backend.uploadFile(path, blob, "")).error).toMatchObject({ code: "507", message: expect.stringMatching(/no room/) });
  });

  it("brings the bytes back as a blob of the type they were stored as, and a missing one as not found", async () => {
    const { backend } = make({
      [`GET ${url}`]: () =>
        new Response(new Uint8Array([7, 8]), {
          status: 200,
          headers: { "content-type": "image/png", "content-disposition": "attachment", date: DATE },
        }),
      "GET /api/files/a/b/c": () => json(404, { error: "Object not found", code: "not_found" }),
    });
    const { data } = await backend.downloadFile(path);
    expect(data?.type).toBe("image/png");
    expect([...new Uint8Array(await data!.arrayBuffer())]).toEqual([7, 8]);
    await expect(backend.downloadFile("a/b/c")).resolves.toEqual({
      data: null,
      error: { message: "Object not found", code: "404" },
    });
  });

  it("removes paths a thousand at a time, and stops at the first failure", async () => {
    let answered = 0;
    const { backend, calls } = make({
      "POST /api/files/remove": () => (++answered === 2 ? json(500, { error: "boom" }) : empty()),
    });
    const paths = Array.from({ length: 2100 }, (_, i) => `${USER}/n/${i}`);
    expect((await backend.removeFiles(paths)).error?.code).toBe("500");
    expect(calls.map((c) => (c.body as { paths: string[] }).paths.length)).toEqual([1000, 1000]);
  });
});

describe("link previews", () => {
  it("hands back the answer, or says whether anything answered and with what", async () => {
    let reply: Route = () => json(200, { url: "https://example.com", title: "Example", description: null, image: null });
    const { backend, calls } = make({ "POST /api/link-preview": (c, i) => reply(c, i) });
    await expect(backend.linkPreview({ url: "https://example.com" })).resolves.toEqual({
      data: { url: "https://example.com", title: "Example", description: null, image: null },
      error: null,
    });
    await backend.linkPreview({ url: "https://example.com", check: true });
    expect(calls.map((c) => c.body)).toEqual([
      { url: "https://example.com" },
      { url: "https://example.com", check: true },
    ]);

    reply = () => json(415, { error: "Not an HTML page" });
    await expect(backend.linkPreview({ url: "https://example.com/a.pdf" })).resolves.toEqual({
      data: null,
      error: { message: "Not an HTML page", answered: true, status: 415 },
    });
    reply = offline;
    await expect(backend.linkPreview({ url: "https://example.com" })).resolves.toEqual({
      data: null,
      error: { message: "Failed to fetch", answered: false, status: null },
    });
  });
});

describe("the session", () => {
  it("answers from the marker at once, and lets the server correct it behind the grid", async () => {
    const { backend, storage, heard } = make(
      { "GET /api/auth/session": () => json(200, { user: null }) },
      { storage: marked() },
    );
    // The marker is who this browser last was: painted and synced as them.
    await expect(backend.session()).resolves.toEqual({ user: { id: USER } });
    // The server says the cookie is gone.
    await vi.waitFor(() => expect(heard).toEqual([null]));
    expect(storage!.getItem(SERVER_SESSION_KEY)).toBeNull();
    await expect(backend.session()).resolves.toBeNull();
  });

  it("waits for the server when there is no marker, and keeps what it says", async () => {
    const { backend, storage, heard } = make({
      "GET /api/auth/session": () => json(200, { user: { id: USER, email: "me@example.com" } }),
    });
    await expect(backend.session()).resolves.toEqual({ user: { id: USER } });
    expect(heard).toEqual([{ user: { id: USER } }]);
    expect(JSON.parse(storage!.getItem(SERVER_SESSION_KEY)!)).toEqual({ id: USER });
  });

  it("keeps the marker when the server cannot be reached — offline is not signed out", async () => {
    const { backend, storage, heard } = make({ "GET /api/auth/session": offline }, { storage: marked() });
    await expect(backend.session()).resolves.toEqual({ user: { id: USER } });
    await new Promise((r) => setTimeout(r, 10));
    expect(heard).toEqual([]);
    expect(storage!.getItem(SERVER_SESSION_KEY)).not.toBeNull();
  });

  it("does not let an answer asked before a sign-in undo the sign-in", async () => {
    let release: () => void = () => {};
    const { backend, heard } = make({
      "GET /api/auth/session": () => new Promise<Response>((r) => (release = () => r(json(200, { user: null })))),
      "POST /api/auth/login": () => json(200, { user: { id: USER } }),
    });
    const asked = backend.session();
    await password(backend).signIn("me@example.com", "long enough");
    release();
    await expect(asked).resolves.toEqual({ user: { id: USER } });
    expect(heard).toEqual([{ user: { id: USER } }]);
  });

  it("reports nobody after a sign-in and then a sign-out", async () => {
    const { backend } = make({
      "POST /api/auth/login": () => json(200, { user: { id: USER } }),
      "POST /api/auth/logout": () => empty(),
    });
    await password(backend).signIn("me@example.com", "long enough");
    await backend.signOut();
    await expect(backend.session()).resolves.toBeNull();
  });

  it("signs out on any 401, and clears the marker", async () => {
    const { backend, storage, heard } = make(
      { "GET /api/notes": () => json(401, { error: "Sign in first", code: "unauthenticated" }) },
      { storage: marked() },
    );
    const { error } = await backend.pullNotes("id", { at: "", id: "" }, 10);
    expect(error?.code).toBe("401");
    expect(heard).toEqual([null]);
    expect(storage!.getItem(SERVER_SESSION_KEY)).toBeNull();
  });

  it("hears another tab sign in and out through the marker", async () => {
    const { heard, events } = make({});
    const storageEvent = (newValue: string | null) =>
      Object.assign(new Event("storage"), { key: SERVER_SESSION_KEY, newValue });
    events.dispatchEvent(storageEvent(JSON.stringify({ id: USER })));
    events.dispatchEvent(storageEvent(null));
    events.dispatchEvent(Object.assign(new Event("storage"), { key: "spar.other", newValue: "1" }));
    expect(heard).toEqual([{ user: { id: USER } }, null]);
  });
});

describe("signing in, making an account, signing out", () => {
  it("signs in, keeps who it was, and tells the app", async () => {
    const { backend, calls, storage, heard } = make({
      "POST /api/auth/login": () => json(200, { user: { id: USER, email: "me@example.com" } }),
    });
    await expect(password(backend).signIn("me@example.com", "long enough")).resolves.toEqual({ error: null });
    expect(calls[0].body).toEqual({ email: "me@example.com", password: "long enough" });
    expect(heard).toEqual([{ user: { id: USER } }]);
    expect(JSON.parse(storage!.getItem(SERVER_SESSION_KEY)!)).toEqual({ id: USER });
    await expect(backend.session()).resolves.toEqual({ user: { id: USER } });
  });

  it("says why it would not, in the app's words, and a wrong password is not a sign-out", async () => {
    let reply: Route = () => json(401, { error: "no", code: "invalid_credentials" });
    const { backend, heard } = make({ "POST /api/auth/login": (c, i) => reply(c, i) }, { storage: marked() });
    const signIn = () => password(backend).signIn("me@example.com", "wrong");
    expect((await signIn()).error?.message).toBe("That email and password do not match an account here.");
    expect(heard).toEqual([]);
    reply = () => json(429, { error: "Too many", code: "rate_limited" }, { "retry-after": "600" });
    expect((await signIn()).error?.message).toBe("Too many tries. Wait 10 minutes and try again.");
    reply = offline;
    expect((await signIn()).error?.message).toMatch(/did not answer/);
  });

  it("makes an account with an invite only when there is one, and names each refusal", async () => {
    let reply: Route = () => json(201, { user: { id: USER } });
    const { backend, calls, heard } = make({ "POST /api/auth/signup": (c, i) => reply(c, i) });
    const auth = password(backend);
    await expect(auth.signUp({ email: "a@example.com", password: "long enough", invite: "ABC" })).resolves.toEqual({
      error: null,
    });
    expect(heard).toEqual([{ user: { id: USER } }]);
    const cases: [number, string, RegExp][] = [
      [403, "signup_closed", /not making new accounts/],
      [403, "invite_required", /invite code/],
      [409, "email_taken", /already an account/],
      [400, "weak_password", /8 characters/],
      [400, "invalid_email", /not an email address/],
    ];
    for (const [status, code, words] of cases) {
      reply = () => json(status, { error: "x", code });
      expect((await auth.signUp({ email: "a@example.com", password: "p" })).error?.message).toMatch(words);
    }
    expect(calls[0].body).toEqual({ email: "a@example.com", password: "long enough", invite: "ABC" });
    expect(calls[1].body).toEqual({ email: "a@example.com", password: "p" });
  });

  it("asks the server what it allows, and falls back to the configuration's word", async () => {
    let reply: Route = () => json(200, { backend: "spar-server", signup: "open", firstAccount: true });
    const { backend } = make({ "GET /api/config": (c, i) => reply(c, i) });
    await expect(password(backend).signupState()).resolves.toEqual({ mode: "open", firstAccount: true });
    reply = offline;
    await expect(password(backend).signupState()).resolves.toEqual({ mode: "invite", firstAccount: false });
  });

  it("signs out on the server's word, and stays signed in when it cannot be reached", async () => {
    let reply: Route = offline;
    const { backend, storage, heard, calls } = make(
      { "POST /api/auth/logout": (c, i) => reply(c, i) },
      { storage: marked() },
    );
    expect((await backend.signOut()).error).not.toBeNull();
    expect(heard).toEqual([]);
    expect(storage!.getItem(SERVER_SESSION_KEY)).not.toBeNull();
    reply = () => empty();
    await expect(backend.signOut()).resolves.toEqual({ error: null });
    expect(heard).toEqual([null]);
    expect(storage!.getItem(SERVER_SESSION_KEY)).toBeNull();
    expect(calls[1].body).toEqual({});
  });

  it("deletes the account with the password, and a wrong one deletes nothing", async () => {
    let reply: Route = () => json(403, { error: "The password is not right", code: "invalid_credentials" });
    const { backend, heard, calls } = make(
      { "POST /api/account/delete": (c, i) => reply(c, i) },
      { storage: marked() },
    );
    expect((await backend.account!.delete("wrong")).error?.message).toBe(
      "That password is not right, so nothing was deleted.",
    );
    expect(heard).toEqual([]);
    reply = () => empty();
    await expect(backend.account!.delete("long enough")).resolves.toEqual({ error: null });
    expect(heard).toEqual([null]);
    expect(calls[1].body).toEqual({ password: "long enough" });
  });
});

/** A server-sent event stream the test writes into. */
function eventStream() {
  const encoder = new TextEncoder();
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const opened: { signal: AbortSignal | null | undefined }[] = [];
  const route: Route = (_call, init) => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        control = c;
      },
    });
    opened.push({ signal: init.signal });
    init.signal?.addEventListener("abort", () => {
      try {
        control.error(new DOMException("The operation was aborted.", "AbortError"));
      } catch {
        // Already closed.
      }
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", date: DATE } });
  };
  return {
    route,
    opened,
    write: (text: string) => control.enqueue(encoder.encode(text)),
    end: () => control.close(),
  };
}

const change = (table: string, row: unknown, old: unknown = null) =>
  `event: change\ndata: ${JSON.stringify({ table, event: old ? "DELETE" : "UPDATE", new: row, old })}\n\n`;

describe("live updates", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shares one stream between every table, and hands each its own signals", async () => {
    const stream = eventStream();
    const { backend } = make({ "GET /api/events": stream.route }, { storage: marked() });
    const notes: unknown[] = [];
    const folders: unknown[] = [];
    const stopNotes = backend.subscribe("notes", (row) => notes.push(row));
    const stopFolders = backend.subscribe("folders", (row) => folders.push(row));
    await vi.waitFor(() => expect(stream.opened).toHaveLength(1));

    stream.write("retry: 3000\n\nevent: ready\ndata: {}\n\n");
    stream.write(change("notes", { id: "n1", updated_at: "t1" }));
    // Split mid-event, as a network may: the parser waits for the blank line.
    const tail = change("folders", null, { id: "f1" });
    stream.write(tail.slice(0, 20));
    stream.write(`${tail.slice(20)}: ping\n\n`);
    await vi.waitFor(() => expect(folders).toEqual([{ id: "f1" }]));
    expect(notes).toEqual([{ id: "n1", updated_at: "t1" }]);

    stopNotes();
    expect(stream.opened[0].signal?.aborted).toBe(false);
    stopFolders();
    // The last one out closes it.
    expect(stream.opened[0].signal?.aborted).toBe(true);
    expect(stream.opened).toHaveLength(1);
  });

  it("opens nothing while nobody is signed in, and opens once somebody is", async () => {
    const stream = eventStream();
    const { backend } = make({
      "GET /api/events": stream.route,
      "POST /api/auth/login": () => json(200, { user: { id: USER } }),
    });
    const stop = backend.subscribe("notes", () => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(stream.opened).toHaveLength(0);
    await password(backend).signIn("me@example.com", "long enough");
    await vi.waitFor(() => expect(stream.opened).toHaveLength(1));
    stop();
  });

  it("reopens a stream that dropped, waiting longer each time", async () => {
    const stream = eventStream();
    const { backend } = make({ "GET /api/events": stream.route }, { storage: marked() });
    const stop = backend.subscribe("notes", () => {});
    await vi.waitFor(() => expect(stream.opened).toHaveLength(1));
    stream.end();
    await vi.waitFor(() => expect(stream.opened).toHaveLength(2));
    stream.end();
    await vi.waitFor(() => expect(stream.opened).toHaveLength(3));
    stop();
    await new Promise((r) => setTimeout(r, 40));
    expect(stream.opened).toHaveLength(3);
  });

  it("takes a 401 on the stream as the session ending, and does not knock again", async () => {
    let opened = 0;
    const { backend, heard } = make(
      {
        "GET /api/events": () => {
          opened += 1;
          return json(401, { error: "Sign in first", code: "unauthenticated" });
        },
      },
      { storage: marked() },
    );
    backend.subscribe("notes", () => {});
    await vi.waitFor(() => expect(heard).toEqual([null]));
    await new Promise((r) => setTimeout(r, 40));
    expect(opened).toBe(1);
  });

  it("closes the stream on sign-out", async () => {
    const stream = eventStream();
    const { backend } = make(
      { "GET /api/events": stream.route, "POST /api/auth/logout": () => empty() },
      { storage: marked() },
    );
    backend.subscribe("notes", () => {});
    await vi.waitFor(() => expect(stream.opened).toHaveLength(1));
    await backend.signOut();
    expect(stream.opened[0].signal?.aborted).toBe(true);
  });
});

describe("another origin", () => {
  it("sends the cookie across when the API is elsewhere (SPAR_ALLOWED_ORIGINS)", async () => {
    const { backend, calls } = make(
      { "GET /api/prefs": () => json(200, { prefs: null }) },
      { base: "http://127.0.0.1:8080/" },
    );
    await backend.readPrefs("boards");
    expect(calls[0].url).toBe("http://127.0.0.1:8080/api/prefs");
    expect(calls[0].credentials).toBe("include");
  });
});
