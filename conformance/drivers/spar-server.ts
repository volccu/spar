/**
 * The conformance driver for the spår server (server/): it boots the server in
 * this process, on a random loopback port with a throwaway data folder, and
 * talks to it over HTTP exactly as a client does — the cookie, the JSON, the
 * event stream — following docs/server-api.md. No Docker and no Supabase.
 *
 * The server-internal hooks reach the running server's own objects directly
 * (the sweep's due list, the delivery records, the tombstone pruning), which
 * is the in-process equivalent of the Supabase driver's service-role client.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type App } from "../../server/src/app";
import { testConfig } from "../../server/src/config";
import { parseFilePath } from "../../server/src/files";
import { occurrence } from "../../server/src/push";
import { formatInstant, formatNullable, parseInstant } from "../../server/src/time";
import {
  BackendError,
  type CanvasRow,
  type Changes,
  type ChangeSignal,
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
} from "../driver";

function kindOf(status: number, code: string | undefined): FailureKind {
  if (status === 409 && code === "row_refused") return "row-refused";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "refused";
  if (status === 404) return "not-found";
  if (status === 413) return "too-large";
  return "failed";
}

function cursorQuery(prefix: string, cursor: Cursor): string {
  const parts = [`${prefix}at=${encodeURIComponent(cursor.at)}`];
  if (cursor.id) parts.push(`${prefix}id=${encodeURIComponent(cursor.id)}`);
  return parts.join("&");
}

function filePathUrl(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

class SparSession implements Session {
  private cookie: string | null = null;
  private lastDate: string | null = null;
  private streams = new Set<AbortController>();

  constructor(
    readonly userId: string,
    private readonly base: string,
    cookie: string,
  ) {
    this.cookie = cookie;
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    options: { raw?: Uint8Array; contentType?: string; anonymous?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.cookie && !options.anonymous) headers.cookie = this.cookie;
    let payload: string | Uint8Array | undefined;
    if (options.raw) {
      payload = options.raw;
      headers["content-type"] = options.contentType ?? "application/octet-stream";
      headers["x-spar-request"] = "1";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }
    const response = await fetch(`${this.base}${path}`, { method, headers, body: payload });
    const date = response.headers.get("date");
    if (date) this.lastDate = date;
    return response;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.call(method, path, body);
    return this.answer<T>(response);
  }

  private async answer<T>(response: Response): Promise<T> {
    const text = await response.text();
    let parsed: Record<string, unknown> | null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const code = typeof parsed?.code === "string" ? parsed.code : undefined;
      throw new BackendError(kindOf(response.status, code), String(parsed?.error ?? response.statusText), code ?? String(response.status));
    }
    return parsed as T;
  }

  async upsertNotes(rows: NoteWrite[]): Promise<void> {
    await this.json("POST", "/api/notes", { rows });
  }

  async patchNote(id: string, patch: NotePatch): Promise<void> {
    await this.json("PATCH", `/api/notes/${encodeURIComponent(id)}`, patch);
  }

  async pullNotes(after: Cursor, limit: number): Promise<NoteRow[]> {
    return (await this.json<{ notes: NoteRow[] }>("GET", `/api/notes?${cursorQuery("after_", after)}&limit=${limit}`)).notes;
  }

  async notesById(ids: string[]): Promise<NoteRow[]> {
    return (await this.json<{ notes: NoteRow[] }>("POST", "/api/notes/by-id", { ids })).notes;
  }

  async noteState(id: string): Promise<NoteState | null> {
    return (await this.json<{ state: NoteState | null }>("GET", `/api/notes/${encodeURIComponent(id)}/state`)).state;
  }

  async permanentlyDeleteNote(id: string, expectedUpdatedAt: Iso): Promise<boolean> {
    const answer = await this.json<{ deleted: boolean }>("POST", `/api/notes/${encodeURIComponent(id)}/destroy`, {
      expected_updated_at: expectedUpdatedAt,
    });
    return answer.deleted === true;
  }

  async pullTombstones(after: Cursor, limit: number): Promise<TombstoneRow[]> {
    return (await this.json<{ tombstones: TombstoneRow[] }>("GET", `/api/tombstones?${cursorQuery("after_", after)}&limit=${limit}`))
      .tombstones;
  }

  async pullChanges(args: PullChangesArgs): Promise<Changes> {
    const query = [
      cursorQuery("notes_", args.notes),
      cursorQuery("tombstones_", args.tombstones),
      cursorQuery("folders_", args.folders),
      `limit=${args.limit}`,
    ].join("&");
    return this.json<Changes>("GET", `/api/changes?${query}`);
  }

  async upsertCanvases(rows: CanvasRow[]): Promise<void> {
    await this.json("POST", "/api/canvases", { rows });
  }

  async pullCanvases(after: Cursor, limit: number): Promise<CanvasRow[]> {
    return (await this.json<{ canvases: CanvasRow[] }>("GET", `/api/canvases?${cursorQuery("after_", after)}&limit=${limit}`)).canvases;
  }

  async upsertPrefs(prefs: PrefsWrite): Promise<void> {
    await this.json("PUT", "/api/prefs", prefs);
  }

  async writePrefsIf(prefs: PrefsWrite, readAt: string | null): Promise<boolean> {
    const response = await this.call("PUT", "/api/prefs", { ...prefs, expected_updated_at: readAt });
    if (response.status === 412) {
      await response.text();
      return false;
    }
    await this.answer(response);
    return true;
  }

  async readPrefs(): Promise<PrefsRow | null> {
    return (await this.json<{ prefs: PrefsRow | null }>("GET", "/api/prefs")).prefs;
  }

  async upsertPushSubscription(row: PushSubscriptionWrite): Promise<void> {
    await this.json("POST", "/api/push/subscribe", row);
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await this.json("POST", "/api/push/unsubscribe", { endpoint });
  }

  async uploadFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.call("PUT", `/api/files/${filePathUrl(path)}`, undefined, { raw: bytes, contentType });
    await this.answer(response);
  }

  async downloadFile(path: string): Promise<Uint8Array> {
    const response = await this.call("GET", `/api/files/${filePathUrl(path)}`);
    if (!response.ok) return this.answer(response);
    return new Uint8Array(await response.arrayBuffer());
  }

  async removeFiles(paths: string[]): Promise<void> {
    await this.json("POST", "/api/files/remove", { paths });
  }

  async linkPreview(request: LinkPreviewRequest): Promise<LinkPreviewAnswer> {
    const method = request.method ?? "POST";
    const headers: Record<string, string> = {};
    if (!request.anonymous && this.cookie) headers.cookie = this.cookie;
    if (request.origin) headers.origin = request.origin;
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD") {
      headers["content-type"] = "application/json";
      body =
        request.rawBody ??
        JSON.stringify(request.check === undefined ? { url: request.url } : { url: request.url, check: request.check });
    }
    const response = await fetch(`${this.base}/api/link-preview`, { method, headers, body });
    const date = response.headers.get("date");
    if (date) this.lastDate = date;
    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object") parsed = value as Record<string, unknown>;
    } catch {
      // Not JSON: the body stays null.
    }
    return { status: response.status, body: parsed, allowOrigin: response.headers.get("access-control-allow-origin") };
  }

  async subscribe(table: RealtimeTable, onSignal: (signal: ChangeSignal) => void): Promise<() => Promise<void>> {
    const controller = new AbortController();
    const response = await fetch(`${this.base}/api/events`, {
      headers: { cookie: this.cookie ?? "", accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new BackendError(kindOf(response.status, undefined), `event stream answered ${response.status}`);
    }
    this.streams.add(controller);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => (resolveReady = resolve));
    const pump = async () => {
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            let event = "message";
            const data: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
            }
            if (event === "ready") resolveReady();
            if (event !== "change" || data.length === 0) continue;
            const signal = JSON.parse(data.join("\n")) as ChangeSignal;
            if (signal.table === table) onSignal(signal);
          }
        }
      } catch {
        // Aborted: the subscription was ended.
      }
    };
    void pump();
    await ready;
    return async () => {
      controller.abort();
      this.streams.delete(controller);
    };
  }

  async serverTime(): Promise<number> {
    await this.call("GET", "/api/health");
    if (!this.lastDate) throw new BackendError("failed", "the server sent no Date header");
    return Date.parse(this.lastDate);
  }

  async signOut(): Promise<void> {
    const response = await this.call("POST", "/api/auth/logout", {});
    if (!response.ok) throw new BackendError("failed", `sign-out answered ${response.status}`);
    this.cookie = null;
  }

  close(): void {
    for (const controller of this.streams) controller.abort();
    this.streams.clear();
  }
}

class SparHooks implements ServerHooks {
  constructor(private readonly app: () => App) {}

  async reminderOccurrence(anchor: Iso, repeat: string | null, now: Iso): Promise<Iso | null> {
    const a = parseInstant(anchor);
    const n = parseInstant(now);
    if (a === null || n === null) return null;
    return formatInstant(occurrence(a, repeat, n));
  }

  async dueReminders(): Promise<DueReminder[]> {
    return this.app()
      .push.due()
      .map((d) => ({ ...d, reminder_at: formatInstant(d.reminder_at) }));
  }

  async recordDelivery(delivery: { note_id: string; owner_id: string; reminder_at: Iso }): Promise<void> {
    const at = parseInstant(delivery.reminder_at);
    if (at === null) throw new Error(`not an instant: ${delivery.reminder_at}`);
    this.app().push.recordDelivery({ ...delivery, reminder_at: at });
  }

  async pruneTombstones(): Promise<number> {
    return this.app().notes.pruneTombstones();
  }

  async backdateTombstone(noteId: string, deletedAt: Iso): Promise<void> {
    this.app().db.prepare("update tombstones set deleted_at = ? where note_id = ?").run(parseInstant(deletedAt), noteId);
  }

  private record(row: { endpoint: string; owner_id: string; p256dh: string; auth: string; failed_at: number | null }): SubscriptionRecord {
    return { endpoint: row.endpoint, owner_id: row.owner_id, p256dh: row.p256dh, auth: row.auth, failed_at: formatNullable(row.failed_at) };
  }

  async liveSubscriptions(ownerIds: string[]): Promise<SubscriptionRecord[]> {
    return this.app().push.live(ownerIds).map((r) => this.record(r));
  }

  async allSubscriptions(ownerId: string): Promise<SubscriptionRecord[]> {
    return this.app().push.all(ownerId).map((r) => this.record(r));
  }

  async retireSubscriptions(endpoints: string[]): Promise<void> {
    this.app().push.retire(endpoints);
  }

  async readNote(id: string): Promise<NoteRow | null> {
    const note = this.app().notes.read(id);
    if (!note) return null;
    return {
      ...note,
      created_at: formatInstant(note.created_at),
      updated_at: formatInstant(note.updated_at),
      reminder_at: formatNullable(note.reminder_at),
      field_updated_at: note.field_updated_at as NoteRow["field_updated_at"],
    };
  }

  async fileExists(path: string): Promise<boolean> {
    const file = parseFilePath(path, false);
    return file ? this.app().files.exists(file) : false;
  }
}

export class SparServerDriver implements ConformanceDriver {
  readonly name = "spar-server";
  /** The spår server claims no deviation: it is held to the whole contract. */
  readonly deviations: ReadonlySet<Deviation> = new Set<Deviation>();
  readonly can = {
    linkPreview: process.env.SPAR_CONFORMANCE_LINK_PREVIEW !== "0",
    linkPreviewNetwork: process.env.SPAR_CONFORMANCE_INTERNET === "1",
    // Nothing stands between the endpoint and the client here.
    observeCors: true,
    realtime: process.env.SPAR_CONFORMANCE_REALTIME !== "0",
  };

  private app: App | null = null;
  private base = "";
  private dataDir: string | null = null;
  private sessions: SparSession[] = [];
  readonly server: ServerHooks = new SparHooks(() => {
    if (!this.app) throw new Error("driver not started");
    return this.app;
  });

  async start(): Promise<void> {
    if (this.app) return;
    this.dataDir = await mkdtemp(join(tmpdir(), "spar-conformance-"));
    this.app = await createApp(testConfig(this.dataDir));
    this.base = (await this.app.listen()).url;
  }

  async createUser(): Promise<Session> {
    if (!this.app) throw new Error("driver not started");
    const email = `conformance-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    const response = await fetch(`${this.base}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = (await response.json()) as { user?: { id: string }; error?: string };
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    if (!response.ok || !body.user || !cookie) throw new Error(`could not create a test user: ${body.error ?? response.status}`);
    const session = new SparSession(body.user.id, this.base, cookie);
    this.sessions.push(session);
    return session;
  }

  async cleanup(): Promise<void> {
    for (const session of this.sessions) session.close();
    this.sessions = [];
    if (this.app) await this.app.close();
    this.app = null;
    if (this.dataDir) await rm(this.dataDir, { recursive: true, force: true });
    this.dataDir = null;
  }
}
