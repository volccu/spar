/**
 * The conformance driver for the Supabase backend: supabase-js against a local
 * stack (`node scripts/conformance-stack.mjs start`), making its calls through
 * the web client's own adapter (`web/src/store/backend/supabaseBackend.ts`)
 * wherever the adapter has the operation, so the suite tests the queries the
 * app actually sends rather than a copy of them (audit CODE-4). Only the link
 * preview (which needs the raw HTTP answer), realtime (which needs to wait for
 * the channel to open) and the server-side hooks speak supabase-js directly.
 *
 * Connection details come from `SPAR_SUPABASE_URL`, `SPAR_SUPABASE_ANON_KEY` and
 * `SPAR_SUPABASE_SERVICE_ROLE_KEY` when set, and otherwise from the local
 * stack's own `supabase status`. Only ever a local stack: the service-role key
 * is used to create throwaway users (sign-up is closed in `supabase/config.toml`)
 * and to drive the server-internal hooks.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  BackendError,
  type CanvasRow,
  type Changes,
  type ConformanceDriver,
  type Cursor,
  type Deviation,
  type DueReminder,
  type FailureKind,
  type Iso,
  type LinkPreviewAnswer,
  type LinkPreviewRequest,
  type NotePatch,
  type NoteRow,
  type NoteState,
  type NoteWrite,
  type PrefsRow,
  type PrefsWrite,
  type PullChangesArgs,
  type PushSubscriptionWrite,
  type RealtimeTable,
  type ServerHooks,
  type Session,
  type SubscriptionRecord,
  type TombstoneRow,
  type ChangeSignal,
} from "../driver";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUCKET = "files";

/** The columns the web client selects when every capability is present
 *  (`columns()` in web/src/store/sync.ts). A copy, so `contract.test.ts`
 *  holds the two lists together and a new column cannot be missed here. */
const NOTE_COLUMNS = [
  "id",
  "raw_content",
  "body",
  "source",
  "created_at",
  "updated_at",
  "note_type",
  "status",
  "priority",
  "reminder_at",
  "done",
  "merged_from",
  "keep_id",
  "board_id",
  "reminder_repeat",
  "merged_into",
  "attachments",
  "link_previews",
  "field_updated_at",
].join(",");

const CANVAS_COLUMNS = "id,items,strokes,image_widths,text_elements,created_at,updated_at";

interface Connection {
  url: string;
  anonKey: string;
  serviceKey: string;
}

function connection(): Connection {
  const fromEnv = {
    url: process.env.SPAR_SUPABASE_URL,
    anonKey: process.env.SPAR_SUPABASE_ANON_KEY,
    serviceKey: process.env.SPAR_SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.url && fromEnv.anonKey && fromEnv.serviceKey) return fromEnv as Connection;
  let text: string;
  try {
    text = execFileSync(process.execPath, [resolve(ROOT, "scripts/conformance-stack.mjs"), "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      "No local Supabase stack answered. Start one with `node scripts/conformance-stack.mjs start`, " +
        "or set SPAR_SUPABASE_URL / SPAR_SUPABASE_ANON_KEY / SPAR_SUPABASE_SERVICE_ROLE_KEY.",
      { cause: error },
    );
  }
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match) env[match[1]] = match[2];
  }
  if (!env.API_URL || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    throw new Error(`supabase status did not name the API URL and keys:\n${text}`);
  }
  // Only a local stack: the service-role key must never be pointed at anything else.
  const host = new URL(env.API_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`refusing to run the conformance suite against ${env.API_URL}`);
  }
  return { url: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY };
}

interface ErrorLike {
  code?: string | null;
  message?: string;
  status?: number;
  statusCode?: string | number;
}

/**
 * The client's own rule (`namesTheRow` in web/src/store/sync.ts): SQLSTATE
 * class 22 or 23, or P0001, is the server having read the row and declined it.
 */
function kindOf(error: ErrorLike, status?: number): FailureKind {
  const code = error.code ?? "";
  if (/^2[23]/.test(code) || code === "P0001") return "row-refused";
  if (code === "42501" || status === 403) return "refused";
  if (code === "PGRST301" || code === "PGRST303" || status === 401) return "unauthenticated";
  return "failed";
}

function fail(error: ErrorLike, status?: number): BackendError {
  return new BackendError(kindOf(error, status), error.message ?? "unknown error", error.code ?? undefined);
}

function storageFail(error: ErrorLike): BackendError {
  const status = Number(error.statusCode ?? error.status ?? NaN);
  const message = error.message ?? "storage error";
  if (status === 413 || /maximum allowed size|too large/i.test(message)) {
    return new BackendError("too-large", message, String(status));
  }
  if (status === 404 || /not found/i.test(message)) return new BackendError("not-found", message, String(status));
  if (status === 403 || /row-level security|unauthori[sz]ed/i.test(message)) {
    return new BackendError("refused", message, String(status));
  }
  if (status === 401) return new BackendError("unauthenticated", message, String(status));
  return new BackendError("failed", message, String(status));
}

/*
 * The app's adapter, loaded by its file at run time rather than imported by
 * name: its modules reach into `import.meta.env` and the DOM, which the
 * server's Node-only typecheck (server/tsconfig.json, which covers this suite)
 * cannot follow. `npm run build:web` typechecks the adapter itself; `AppBackend`
 * is the slice of `Backend` (web/src/store/backend/types.ts) this driver calls.
 */
type Row = Record<string, unknown>;
type BackendFailure = { message: string; code?: string | null };
type Outcome = { error: BackendFailure | null };
type Answer<T> = { data: T | null; error: BackendFailure | null };
type AppCursor = { at: string; id: string };
interface AppBackend {
  signOut(): Promise<Outcome>;
  upsertNotes(rows: Row[]): Promise<Outcome>;
  pullNotes(columns: string, after: AppCursor, limit: number): Promise<Answer<Row[]>>;
  notesById(columns: string, ids: string[]): Promise<Answer<Row[]>>;
  noteState(id: string): Promise<Answer<Row | null>>;
  patchNote(id: string, patch: Row): Promise<Outcome>;
  permanentlyDeleteNote(id: string, expectedUpdatedAt: string): Promise<Answer<unknown>>;
  pullTombstones(after: AppCursor, limit: number): Promise<Answer<Row[]>>;
  pullChanges(args: { notes: AppCursor; tombstones: AppCursor; folders: AppCursor; limit: number }): Promise<Answer<Row>>;
  upsertCanvases(rows: Row[]): Promise<Outcome>;
  pullCanvases(columns: string, after: AppCursor, limit: number): Promise<Answer<Row[]>>;
  upsertPrefs(row: Row): Promise<Outcome>;
  readPrefs(columns: string): Promise<Answer<Row | null>>;
  upsertPushSubscription(row: Row): Promise<Outcome>;
  deletePushSubscription(endpoint: string): Promise<Outcome>;
  uploadFile(path: string, bytes: Blob, contentType: string): Promise<Outcome>;
  downloadFile(path: string): Promise<Answer<Blob>>;
  removeFiles(paths: string[]): Promise<Outcome>;
}
const ADAPTER = new URL("../../web/src/store/backend/supabaseBackend.ts", import.meta.url).href;
let adapter: Promise<(client: SupabaseClient) => AppBackend> | null = null;
function loadAdapter(): Promise<(client: SupabaseClient) => AppBackend> {
  adapter ??= (import(ADAPTER) as Promise<{ supabaseBackend: (client: SupabaseClient) => AppBackend }>).then(
    (module) => module.supabaseBackend,
  );
  return adapter;
}

/** The suite's cursor as the app writes one: no id is the empty string. */
function appCursor(cursor: Cursor): AppCursor {
  return { at: cursor.at, id: cursor.id ?? "" };
}

/**
 * An adapter answer, refused or passed through. The adapter hands supabase-js's
 * error back untouched, and a write hands back the whole PostgREST response,
 * so the HTTP status is there to read when the call had one.
 */
function check<T extends { error: BackendFailure | null }>(answer: T): T {
  if (answer.error) throw fail(answer.error, (answer as { status?: number }).status);
  return answer;
}

function prefsFrom(row: Record<string, unknown> | null | undefined): PrefsRow | null {
  if (!row) return null;
  return {
    boards: (row.boards as unknown[]) ?? [],
    inbox_since: (row.inbox_since as string | null) ?? null,
    updated_at: String(row.updated_at),
  };
}

class SupabaseSession implements Session {
  private lastDate: string | null = null;
  constructor(
    readonly userId: string,
    private readonly client: SupabaseClient,
    /** The app's own adapter over the same client. */
    private readonly backend: AppBackend,
    private readonly conn: Connection,
    private readonly dateSeen: (date: string) => void,
  ) {}

  noteDate(date: string | null) {
    if (date) {
      this.lastDate = date;
      this.dateSeen(date);
    }
  }

  async upsertNotes(rows: NoteWrite[]): Promise<void> {
    check(await this.backend.upsertNotes(rows as unknown as Row[]));
  }

  async patchNote(id: string, patch: NotePatch): Promise<void> {
    check(await this.backend.patchNote(id, patch as Row));
  }

  async pullNotes(after: Cursor, limit: number): Promise<NoteRow[]> {
    const { data } = check(await this.backend.pullNotes(NOTE_COLUMNS, appCursor(after), limit));
    return (data ?? []) as unknown as NoteRow[];
  }

  async notesById(ids: string[]): Promise<NoteRow[]> {
    const { data } = check(await this.backend.notesById(NOTE_COLUMNS, ids));
    return (data ?? []) as unknown as NoteRow[];
  }

  async noteState(id: string): Promise<NoteState | null> {
    const { data } = check(await this.backend.noteState(id));
    return (data as NoteState | null) ?? null;
  }

  async permanentlyDeleteNote(id: string, expectedUpdatedAt: Iso): Promise<boolean> {
    const { data } = check(await this.backend.permanentlyDeleteNote(id, expectedUpdatedAt));
    return data === true;
  }

  async pullTombstones(after: Cursor, limit: number): Promise<TombstoneRow[]> {
    const { data } = check(await this.backend.pullTombstones(appCursor(after), limit));
    return (data ?? []) as unknown as TombstoneRow[];
  }

  async pullChanges(args: PullChangesArgs): Promise<Changes> {
    const { data } = check(
      await this.backend.pullChanges({
        notes: appCursor(args.notes),
        tombstones: appCursor(args.tombstones),
        folders: appCursor(args.folders),
        limit: args.limit,
      }),
    );
    const answer = (data ?? {}) as Record<string, unknown>;
    return {
      notes: (answer.notes as NoteRow[]) ?? [],
      tombstones: (answer.tombstones as TombstoneRow[]) ?? [],
      folders: (answer.folders as CanvasRow[]) ?? [],
      prefs: prefsFrom(answer.prefs as Record<string, unknown> | null),
    };
  }

  async upsertCanvases(rows: CanvasRow[]): Promise<void> {
    check(await this.backend.upsertCanvases(rows as unknown as Row[]));
  }

  async pullCanvases(after: Cursor, limit: number): Promise<CanvasRow[]> {
    const { data } = check(await this.backend.pullCanvases(CANVAS_COLUMNS, appCursor(after), limit));
    return (data ?? []) as unknown as CanvasRow[];
  }

  async upsertPrefs(prefs: PrefsWrite): Promise<void> {
    check(await this.backend.upsertPrefs(prefs as unknown as Row));
  }

  async writePrefsIf(prefs: PrefsWrite, readAt: string | null): Promise<boolean> {
    const { data, error, status } = await this.client.rpc("write_prefs_if_unchanged", {
      p_expected_at: readAt,
      p_boards: prefs.boards ?? [],
      p_updated_at: prefs.updated_at,
      p_set_since: "inbox_since" in prefs,
      p_inbox_since: prefs.inbox_since ?? null,
    });
    if (error) throw fail(error, status);
    return data === true;
  }

  async readPrefs(): Promise<PrefsRow | null> {
    const { data } = check(await this.backend.readPrefs("boards,inbox_since,updated_at"));
    return prefsFrom(data);
  }

  async upsertPushSubscription(row: PushSubscriptionWrite): Promise<void> {
    // The client names the owner itself (store/push.ts); the policy vouches for it.
    check(await this.backend.upsertPushSubscription({ ...row, owner_id: this.userId }));
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    check(await this.backend.deletePushSubscription(endpoint));
  }

  async uploadFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.backend.uploadFile(path, new Blob([new Uint8Array(bytes)], { type: contentType }), contentType);
    if (error) throw storageFail(error as ErrorLike);
  }

  async downloadFile(path: string): Promise<Uint8Array> {
    const { data, error } = await this.backend.downloadFile(path);
    if (error || !data) throw storageFail((error ?? { message: "no data" }) as ErrorLike);
    return new Uint8Array(await data.arrayBuffer());
  }

  async removeFiles(paths: string[]): Promise<void> {
    const { error } = await this.backend.removeFiles(paths);
    if (error) throw storageFail(error as ErrorLike);
  }

  async linkPreview(request: LinkPreviewRequest): Promise<LinkPreviewAnswer> {
    const headers: Record<string, string> = { apikey: this.conn.anonKey };
    if (!request.anonymous) {
      const { data } = await this.client.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.authorization = `Bearer ${token}`;
    } else {
      // The gateway wants a JWT; the anon key is one, and the function must
      // still refuse it because it names no user.
      headers.authorization = `Bearer ${this.conn.anonKey}`;
    }
    if (request.origin) headers.origin = request.origin;
    const method = request.method ?? "POST";
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      headers["content-type"] = "application/json";
      body =
        request.rawBody ??
        JSON.stringify(request.check === undefined ? { url: request.url } : { url: request.url, check: request.check });
    }
    const response = await fetch(`${this.conn.url}/functions/v1/link-preview`, { method, headers, body });
    this.noteDate(response.headers.get("date"));
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object") parsed = value as Record<string, unknown>;
    } catch {
      // Not JSON: the body stays null.
    }
    return {
      status: response.status,
      body: parsed,
      allowOrigin: response.headers.get("access-control-allow-origin"),
    };
  }

  async subscribe(
    table: RealtimeTable,
    onSignal: (signal: ChangeSignal) => void,
  ): Promise<() => Promise<void>> {
    const channel = this.client.channel(`${table}-${randomUUID()}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        onSignal({
          table,
          event: payload.eventType,
          new: payload.new && Object.keys(payload.new).length > 0 ? (payload.new as Record<string, unknown>) : null,
          old: payload.old && Object.keys(payload.old).length > 0 ? (payload.old as Record<string, unknown>) : null,
        });
      },
    );
    await new Promise<void>((resolveLive, reject) => {
      const timer = setTimeout(() => reject(new BackendError("failed", `realtime ${table}: no SUBSCRIBED`)), 15_000);
      channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolveLive();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(new BackendError("failed", `realtime ${table}: ${status} ${error?.message ?? ""}`));
        }
      });
    });
    return async () => {
      await this.client.removeChannel(channel);
    };
  }

  async serverTime(): Promise<number> {
    // Any answer carries a `Date`; this one is cheap and needs no privilege.
    const response = await fetch(`${this.conn.url}/auth/v1/health`, { headers: { apikey: this.conn.anonKey } });
    this.noteDate(response.headers.get("date"));
    if (!this.lastDate) throw new BackendError("failed", "the server sent no Date header");
    return Date.parse(this.lastDate);
  }

  async signOut(): Promise<void> {
    const { error } = await this.backend.signOut();
    if (error) throw new BackendError("failed", error.message);
  }
}

class SupabaseHooks implements ServerHooks {
  constructor(private readonly admin: SupabaseClient) {}

  async reminderOccurrence(anchor: Iso, repeat: string | null, now: Iso): Promise<Iso | null> {
    const { data, error } = await this.admin.rpc("reminder_occurrence", {
      p_anchor: anchor,
      p_repeat: repeat,
      p_now: now,
    });
    if (error) throw fail(error);
    return (data as string | null) ?? null;
  }

  async dueReminders(): Promise<DueReminder[]> {
    const { data, error } = await this.admin.rpc("due_reminders");
    if (error) throw fail(error);
    return (data ?? []) as DueReminder[];
  }

  async recordDelivery(delivery: { note_id: string; owner_id: string; reminder_at: Iso }): Promise<void> {
    const { error } = await this.admin
      .from("reminder_deliveries")
      .upsert({ ...delivery, fired_at: new Date().toISOString() }, { onConflict: "note_id" });
    if (error) throw fail(error);
  }

  async pruneTombstones(): Promise<number> {
    const { data, error } = await this.admin.rpc("prune_note_tombstones");
    if (error) throw fail(error);
    return Number(data ?? 0);
  }

  async backdateTombstone(noteId: string, deletedAt: Iso): Promise<void> {
    const { error } = await this.admin.from("note_tombstones").update({ deleted_at: deletedAt }).eq("note_id", noteId);
    if (error) throw fail(error);
  }

  async liveSubscriptions(ownerIds: string[]): Promise<SubscriptionRecord[]> {
    // The sweep's own query (functions/send-reminders).
    const { data, error } = await this.admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, owner_id, failed_at")
      .in("owner_id", ownerIds)
      .is("failed_at", null);
    if (error) throw fail(error);
    return (data ?? []) as SubscriptionRecord[];
  }

  async allSubscriptions(ownerId: string): Promise<SubscriptionRecord[]> {
    const { data, error } = await this.admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth, owner_id, failed_at")
      .eq("owner_id", ownerId);
    if (error) throw fail(error);
    return (data ?? []) as SubscriptionRecord[];
  }

  async retireSubscriptions(endpoints: string[]): Promise<void> {
    const { error } = await this.admin
      .from("push_subscriptions")
      .update({ failed_at: new Date().toISOString() })
      .in("endpoint", endpoints);
    if (error) throw fail(error);
  }

  async readNote(id: string): Promise<NoteRow | null> {
    const { data, error } = await this.admin.from("notes").select(`${NOTE_COLUMNS},owner_id`).eq("id", id).limit(1);
    if (error) throw fail(error);
    return ((data ?? [])[0] as unknown as NoteRow | undefined) ?? null;
  }

  async fileExists(path: string): Promise<boolean> {
    const { data, error } = await this.admin.storage.from(BUCKET).download(path);
    return !error && Boolean(data);
  }
}

export class SupabaseDriver implements ConformanceDriver {
  readonly name = "supabase";
  /** SPAR_CONFORMANCE_STRICT=1 claims none, to see each one fail for its reason. */
  readonly deviations: ReadonlySet<Deviation> = new Set<Deviation>(
    process.env.SPAR_CONFORMANCE_STRICT === "1"
      ? []
      : // D2, D3 and D5 were fixed by migration 0025; D4 was never a test
        // deviation, and 0025 fixed it too. A hosted project that has not run
        // 0025 yet still carries all four.
        ["realtime-delete-reaches-other-users"],
  );
  readonly can = {
    linkPreview: process.env.SPAR_CONFORMANCE_LINK_PREVIEW !== "0",
    linkPreviewNetwork: process.env.SPAR_CONFORMANCE_INTERNET === "1",
    // The local stack's Kong gateway stamps `Access-Control-Allow-Origin: *` on
    // every function response, so the function's own allow-list cannot be
    // seen from outside it here. (The hosted gateway does not do this for a
    // POST, which is how a stale allow-list once broke every unfurl.)
    observeCors: false,
    realtime: process.env.SPAR_CONFORMANCE_REALTIME !== "0",
  };

  private conn: Connection | null = null;
  private admin: SupabaseClient | null = null;
  private users: { id: string; client: SupabaseClient }[] = [];
  private hooks: SupabaseHooks | null = null;

  get server(): ServerHooks {
    if (!this.hooks) throw new Error("driver not started");
    return this.hooks;
  }

  async start(): Promise<void> {
    if (this.admin) return;
    this.conn = connection();
    this.admin = createClient(this.conn.url, this.conn.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.hooks = new SupabaseHooks(this.admin);
  }

  async createUser(): Promise<Session> {
    if (!this.admin || !this.conn) throw new Error("driver not started");
    const email = `conformance-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    const created = await this.admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw new Error(`could not create a test user: ${created.error?.message}`);
    }
    let session: SupabaseSession | null = null;
    const conn = this.conn;
    const client = createClient(conn.url, conn.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        // What web/src/store/supabase.ts does: every answer is a clock reading.
        fetch: async (input, init) => {
          const answer = await fetch(input, init);
          session?.noteDate(answer.headers.get("date"));
          return answer;
        },
      },
    });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) {
      throw new Error(`could not sign the test user in: ${signedIn.error?.message}`);
    }
    const backend = (await loadAdapter())(client);
    session = new SupabaseSession(created.data.user.id, client, backend, conn, () => {});
    this.users.push({ id: created.data.user.id, client });
    return session;
  }

  async cleanup(): Promise<void> {
    const admin = this.admin;
    if (!admin) return;
    for (const { id, client } of this.users) {
      await client.removeAllChannels().catch(() => undefined);
      const { data: objects } = await admin.storage.from(BUCKET).list(id, { limit: 1000 });
      for (const folder of objects ?? []) {
        const { data: files } = await admin.storage.from(BUCKET).list(`${id}/${folder.name}`, { limit: 1000 });
        const paths = (files ?? []).map((file) => `${id}/${folder.name}/${file.name}`);
        if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
      }
      await admin.from("notes").delete().eq("owner_id", id);
      await admin.from("note_tombstones").delete().eq("owner_id", id);
      await admin.from("prefs").delete().eq("owner_id", id);
      await admin.from("push_subscriptions").delete().eq("owner_id", id);
      await admin.auth.admin.deleteUser(id);
    }
    this.users = [];
  }
}
