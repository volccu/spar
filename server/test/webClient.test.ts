/**
 * The web client's own adapter (`web/src/store/backend/sparServerBackend.ts`)
 * against the real server, booted in this process on a loopback port with a
 * throwaway data folder — the two halves of docs/server-api.md held to each
 * other. The adapter's unit tests (beside it in web/) hold each mapping
 * against a fetch that plays the server; this holds that the server really
 * answers the way that fetch pretends: sign-up and sign-in, upload and pull, a
 * row refusal read as the class-23 code the store bisects on, files, the
 * change stream, sign-out, and deleting the account.
 *
 * Two "devices" each get their own cookie jar and their own storage for the
 * session marker, which is all a browser would give them. Node's fetch keeps
 * no cookies, so the jar is a small wrapper here, in the test only.
 *
 * Not typechecked by `tsc -p server` (see server/tsconfig.json): the adapter's
 * types reach into the web app's modules, which are typechecked by the web
 * build against the DOM, not by the server's Node-only program.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sparServerBackend } from "../../web/src/store/backend/sparServerBackend";
import { SERVER_SESSION_KEY } from "../../web/src/store/backend/marker";
import { startServer, type Running } from "./helpers";

/** A fetch with a cookie jar of its own: one device's browser, as far as cookies go. */
function jarFetch(): typeof fetch {
  let cookie: string | null = null;
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(input, { ...init, headers });
    const set = response.headers.get("set-cookie");
    if (set) cookie = /Max-Age=0/i.test(set) ? null : set.split(";")[0];
    return response;
  }) as typeof fetch;
}

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

function device(base: string) {
  const storage = memory();
  const dates: (string | null)[] = [];
  const backend = sparServerBackend(
    {},
    { base, fetch: jarFetch(), storage, events: null, onDate: (d) => dates.push(d), backoff: { firstMs: 50, maxMs: 200 } },
  );
  if (backend.auth.kind !== "password") throw new Error("expected the password form");
  return { backend, auth: backend.auth, storage, dates };
}

/** A note row as the web client sends it (`toRow` in web/src/store/sync.ts): every column. */
function noteRow(text: string, over: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    raw_content: text,
    body: text,
    source: "web",
    created_at: now,
    updated_at: now,
    note_type: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    done: null,
    merged_from: null,
    keep_id: null,
    board_id: null,
    reminder_repeat: null,
    merged_into: null,
    field_updated_at: { body: now },
    attachments: [],
    link_previews: [],
    ...over,
  };
}

const EPOCH = { at: "1970-01-01T00:00:00.000Z", id: "" };
const PASSWORD = "correct horse battery";

let server: Running;

beforeAll(async () => {
  // Closed, as an instance is by default: only the first account may be made.
  server = await startServer({ signup: "closed" });
});

afterAll(async () => {
  await server.close();
});

describe("the web client's adapter against the spår server", () => {
  const email = `owner-${randomUUID()}@example.test`;
  let phone: ReturnType<typeof device>;
  let laptop: ReturnType<typeof device>;
  let owner = "";

  it("makes the first account, and a closed server makes no second", async () => {
    phone = device(server.url);
    laptop = device(server.url);
    await expect(phone.auth.signupState()).resolves.toEqual({ mode: "closed", firstAccount: true });
    await expect(phone.backend.session()).resolves.toBeNull();

    await expect(phone.auth.signUp({ email, password: PASSWORD })).resolves.toEqual({ error: null });
    const session = await phone.backend.session();
    owner = session!.user.id;
    expect(JSON.parse(phone.storage.getItem(SERVER_SESSION_KEY)!)).toEqual({ id: owner });

    await expect(laptop.auth.signupState()).resolves.toEqual({ mode: "closed", firstAccount: false });
    const refused = await laptop.auth.signUp({ email: `x-${email}`, password: PASSWORD });
    expect(refused.error?.message).toMatch(/not making new accounts/);
    const wrong = await laptop.auth.signIn(email, "not the password");
    expect(wrong.error?.message).toBe("That email and password do not match an account here.");

    await expect(laptop.auth.signIn(email, PASSWORD)).resolves.toEqual({ error: null });
    await expect(laptop.backend.session()).resolves.toEqual({ user: { id: owner } });
    // Every answer carried the server's clock.
    expect(phone.dates.length).toBeGreaterThan(0);
    expect(phone.dates.every((d) => d !== null && !Number.isNaN(Date.parse(d)))).toBe(true);
  });

  it("uploads on one device and pulls on the other, with a live signal between them", async () => {
    const signals: unknown[] = [];
    const stop = laptop.backend.subscribe("notes", (row) => signals.push(row));
    // The stream opens on its own; give it a moment to be live before writing.
    await new Promise((r) => setTimeout(r, 150));

    const row = noteRow("written on the phone");
    await expect(phone.backend.upsertNotes([row])).resolves.toEqual({ error: null });
    await expect.poll(() => signals.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(signals[0]).toMatchObject({ id: row.id, body: "written on the phone" });

    const { data: pulled, error } = await laptop.backend.pullNotes("*", EPOCH, 500);
    expect(error).toBeNull();
    expect(pulled!.map((n) => n.id)).toContain(row.id);
    const { data: byId } = await laptop.backend.notesById("*", [row.id, randomUUID()]);
    expect(byId).toHaveLength(1);
    await expect(laptop.backend.noteState(row.id)).resolves.toMatchObject({
      data: { id: row.id, status: "active" },
    });

    // An edit on the laptop reaches the phone's pull, and the phone's own
    // stream says so first.
    const phoneSignals: unknown[] = [];
    const stopPhone = phone.backend.subscribe("notes", (r) => phoneSignals.push(r));
    await new Promise((r) => setTimeout(r, 150));
    const later = new Date(Date.now() + 1000).toISOString();
    await expect(
      laptop.backend.patchNote(row.id, { body: "edited on the laptop", updated_at: later, field_updated_at: { body: later } }),
    ).resolves.toEqual({ error: null });
    await expect.poll(() => phoneSignals.length, { timeout: 5000 }).toBeGreaterThan(0);
    const { data: changes } = await phone.backend.pullChanges({ notes: EPOCH, tombstones: EPOCH, folders: EPOCH, limit: 100 });
    const notes = (changes!.notes as { id: string; body: string }[]).filter((n) => n.id === row.id);
    expect(notes).toEqual([expect.objectContaining({ body: "edited on the laptop" })]);
    stop();
    stopPhone();
  });

  it("reads a refused row as class 23, so the store charges the row and not the batch", async () => {
    const row = noteRow("original words");
    await phone.backend.upsertNotes([row]);
    const { error } = await phone.backend.upsertNotes([{ ...row, raw_content: "rewritten history" }]);
    expect(error?.code).toBe("23000");
    // `namesTheRow` in web/src/store/sync.ts.
    expect(/^2[23]/.test(error!.code!)).toBe(true);
    // A malformed request is the request's fault, with its status.
    const { error: bad } = await phone.backend.pullNotes("*", EPOCH, 5000);
    expect(bad?.code).toBe("400");
  });

  it("keeps canvases and preferences", async () => {
    const idea = noteRow("# Idea");
    await phone.backend.upsertNotes([idea]);
    const now = new Date().toISOString();
    await expect(
      phone.backend.upsertCanvases([{ id: idea.id, items: [], strokes: [], image_widths: {}, text_elements: [], created_at: now, updated_at: now }]),
    ).resolves.toEqual({ error: null });
    const { data: canvases } = await laptop.backend.pullCanvases("*", EPOCH, 100);
    expect(canvases!.map((c) => c.id)).toContain(idea.id);
    const orphan = await phone.backend.upsertCanvases([{ id: randomUUID(), items: [] }]);
    expect(orphan.error?.code).toBe("23000");

    await expect(
      phone.backend.upsertPrefs({ boards: [{ id: "b1", name: "Fishing", position: 0 }], updated_at: now }),
    ).resolves.toEqual({ error: null });
    await expect(laptop.backend.readPrefs("boards,inbox_since,updated_at")).resolves.toMatchObject({
      data: { boards: [{ id: "b1", name: "Fishing", position: 0 }] },
    });
  });

  it("stores a file under the owner's own path, and nowhere else", async () => {
    const note = noteRow("a picture");
    await phone.backend.upsertNotes([note]);
    const path = `${owner}/${note.id}/${randomUUID()}`;
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    await expect(phone.backend.uploadFile(path, new Blob([bytes]), "image/png")).resolves.toEqual({ error: null });

    const { data, error } = await laptop.backend.downloadFile(path);
    expect(error).toBeNull();
    expect(data!.type).toBe("image/png");
    expect([...new Uint8Array(await data!.arrayBuffer())]).toEqual([...bytes]);

    const foreign = await phone.backend.uploadFile(`${randomUUID()}/${note.id}/x`, new Blob([bytes]), "image/png");
    expect(foreign.error?.code).toBe("403");

    await expect(phone.backend.removeFiles([path])).resolves.toEqual({ error: null });
    await expect(laptop.backend.downloadFile(path)).resolves.toMatchObject({ data: null, error: { code: "404" } });
  });

  it("destroys a trashed note for good, and the other device hears of it", async () => {
    const note = noteRow("goes to the trash");
    await phone.backend.upsertNotes([note]);
    const stamp = new Date(Date.now() + 2000).toISOString();
    await phone.backend.patchNote(note.id, { status: "trashed", updated_at: stamp, field_updated_at: { status: stamp } });
    const { data: state } = await phone.backend.noteState(note.id);
    await expect(phone.backend.permanentlyDeleteNote(note.id, stamp)).resolves.toEqual({ data: true, error: null });
    expect(state).toMatchObject({ status: "trashed" });
    const { data: stones } = await laptop.backend.pullTombstones(EPOCH, 100);
    expect(stones!.map((t) => t.note_id)).toContain(note.id);
    await expect(laptop.backend.noteState(note.id)).resolves.toEqual({ data: null, error: null });
  });

  it("answers a link preview it refuses as answered, with the status", async () => {
    // A private address is refused before any request is made, so this needs
    // no network: it is the adapter's mapping of a refusal that is held here.
    const { data, error } = await phone.backend.linkPreview({ url: "http://127.0.0.1/" });
    expect(data).toBeNull();
    expect(error).toMatchObject({ answered: true, status: 400 });
  });

  it("registers a device for reminders, and lets it go", async () => {
    const endpoint = `https://push.example.com/${randomUUID()}`;
    const row = { endpoint, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg", user_agent: "test", seen_at: new Date().toISOString(), failed_at: null, owner_id: owner };
    await expect(phone.backend.upsertPushSubscription(row)).resolves.toEqual({ error: null });
    expect(server.app.push.all(owner).map((s) => s.endpoint)).toContain(endpoint);
    await expect(phone.backend.deletePushSubscription(endpoint)).resolves.toEqual({ error: null });
    expect(server.app.push.all(owner).map((s) => s.endpoint)).not.toContain(endpoint);
  });

  it("signs out: the session ends here, the stream closes, and the next call is refused", async () => {
    const heard: unknown[] = [];
    phone.backend.onSessionChange((s) => heard.push(s));
    const stop = phone.backend.subscribe("notes", () => {});
    await expect.poll(() => server.app.hub.count(owner), { timeout: 5000 }).toBeGreaterThan(0);
    const before = server.app.hub.count(owner);

    await expect(phone.backend.signOut()).resolves.toEqual({ error: null });
    expect(heard).toEqual([null]);
    expect(phone.storage.getItem(SERVER_SESSION_KEY)).toBeNull();
    await expect.poll(() => server.app.hub.count(owner), { timeout: 5000 }).toBeLessThan(before);
    const { error } = await phone.backend.pullNotes("*", EPOCH, 10);
    expect(error?.code).toBe("401");
    stop();
  });

  it("deletes the account with its password, after which it cannot sign in", async () => {
    const heard: unknown[] = [];
    laptop.backend.onSessionChange((s) => heard.push(s));
    const wrong = await laptop.backend.account!.delete("not the password");
    expect(wrong.error?.message).toMatch(/nothing was deleted/);
    await expect(laptop.backend.session()).resolves.toEqual({ user: { id: owner } });

    await expect(laptop.backend.account!.delete(PASSWORD)).resolves.toEqual({ error: null });
    expect(heard).toEqual([null]);
    expect(server.app.accounts.userCount()).toBe(0);
    const again = await laptop.auth.signIn(email, PASSWORD);
    expect(again.error?.message).toBe("That email and password do not match an account here.");
    // The instance is empty again, so the next account made is the first.
    await expect(laptop.auth.signupState()).resolves.toEqual({ mode: "closed", firstAccount: true });
  });
});
