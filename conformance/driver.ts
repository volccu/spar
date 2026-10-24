/**
 * The backend-neutral driver the conformance suite is written against.
 *
 * Every test in `conformance/` reaches a backend through this interface and
 * nothing else, so the same suite can be held against the Supabase backend
 * today and the spår server later. The operations mirror the client-facing
 * operations listed in `docs/sync-contract.md` ("The client-facing
 * operations"), one for one; the `ServerHooks` at the bottom are the few
 * server-internal things a test has to reach (the reminder sweep's queries,
 * the tombstone pruning job) and are not part of what a client may call.
 *
 * A driver translates, it does not interpret: it passes rows through as the
 * backend returns them, and it maps the backend's failures onto `BackendError`
 * kinds. Anything cleverer belongs in the backend under test.
 */

/** An RFC 3339 instant. Written by clients as `Date.prototype.toISOString()`
 *  (`2026-09-27T12:00:00.000Z`); returned by a server with an explicit offset
 *  and up to microsecond precision (`2026-09-27T12:00:00.123456+00:00`). */
export type Iso = string;

/** Per-field clocks: field name -> the instant that field was last written by
 *  a client. See "Per-field last-write-wins" in the contract. */
export type FieldClocks = Record<string, string | null>;

/** A note as a client sees it. The server may return more keys; clients
 *  ignore any they do not know. */
export interface NoteRow {
  id: string;
  raw_content: string;
  body: string;
  source: string;
  created_at: Iso;
  updated_at: Iso;
  note_type: string | null;
  board_id: string | null;
  status: string;
  priority: number;
  reminder_at: Iso | null;
  reminder_repeat: string | null;
  done: boolean | null;
  merged_from: string[] | null;
  merged_into: string | null;
  keep_id: string | null;
  attachments: unknown[];
  link_previews: unknown[];
  field_updated_at: FieldClocks;
}

/**
 * A note as a client uploads it: every column, always. `field_updated_at` is
 * `unknown` only so the suite can exercise what a server does with a malformed
 * clock map; a conforming client always sends an object.
 */
export type NoteWrite = Omit<NoteRow, "field_updated_at"> & { field_updated_at: unknown };

/** The narrow write a client makes to deliver a trashing it could not upsert
 *  (`deliverTrashing` in web/src/store/sync.ts). Never creates a row. */
export interface NotePatch {
  status?: string;
  body?: string;
  updated_at?: Iso;
  field_updated_at?: FieldClocks;
}

/** What `noteState` returns: the three columns a refused delete is judged by. */
export interface NoteState {
  id: string;
  status: string;
  field_updated_at: FieldClocks;
}

/**
 * A keyset position. `id` null means "no tiebreaker": notes and tombstones then
 * read strictly after `at`, canvases from `at` inclusive (see "Cursors").
 */
export interface Cursor {
  at: Iso;
  id: string | null;
}

export interface TombstoneRow {
  note_id: string;
  deleted_at: Iso;
}

/** A canvas (the Postgres table is still called `folders`): the arrangement of
 *  an idea note, keyed by that note's id. */
export interface CanvasRow {
  id: string;
  items: unknown[];
  strokes: unknown[];
  image_widths: Record<string, number>;
  text_elements: unknown[];
  created_at: Iso;
  updated_at: Iso;
}

/** A preferences upload: only the fields present are written. */
export interface PrefsWrite {
  boards?: unknown[];
  inbox_since?: Iso | null;
  updated_at: Iso;
}

export interface PrefsRow {
  boards: unknown[];
  inbox_since: Iso | null;
  updated_at: Iso;
}

export interface PushSubscriptionWrite {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  seen_at: Iso;
  failed_at: null;
}

export interface Changes {
  notes: NoteRow[];
  tombstones: TombstoneRow[];
  folders: CanvasRow[];
  prefs: PrefsRow | null;
}

export interface PullChangesArgs {
  notes: Cursor;
  tombstones: Cursor;
  folders: Cursor;
  limit: number;
}

/** The link-preview endpoint's answer: the HTTP status and the parsed JSON
 *  body (null when the body was not JSON). */
export interface LinkPreviewAnswer {
  status: number;
  body: Record<string, unknown> | null;
  /** The `access-control-allow-origin` header, if any. */
  allowOrigin: string | null;
}

export interface LinkPreviewRequest {
  /** Anything JSON can carry: the suite sends malformed values on purpose. */
  url: unknown;
  check?: unknown;
  /** Override the HTTP method (default POST). */
  method?: string;
  /** Send this raw text as the body instead of JSON. */
  rawBody?: string;
  /** Send the request with no session at all. */
  anonymous?: boolean;
  /** An `Origin` header to send. */
  origin?: string;
}

export type RealtimeTable = "notes" | "folders" | "prefs";

/** One change signal. Clients treat it as "something changed, sync now" and
 *  read only `new` (to recognise their own echo). */
export interface ChangeSignal {
  table: RealtimeTable;
  event: "INSERT" | "UPDATE" | "DELETE" | string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

/**
 * How an operation failed. The distinction the client acts on is
 * `row-refused` versus everything else: a refused row is bisected out of its
 * batch and charged to that note (`namesTheRow` in web/src/store/sync.ts),
 * while any other failure is a fact about the request and is retried whole.
 */
export type FailureKind =
  /** The server read this row and declined it (immutability, tombstone,
   *  constraint). Retrying the same row will fail the same way. */
  | "row-refused"
  /** Not allowed: the caller does not own the target, or has no privilege. */
  | "refused"
  /** No valid session. */
  | "unauthenticated"
  /** The target does not exist (files). */
  | "not-found"
  /** Over a size limit (files). */
  | "too-large"
  /** Anything else: network, gateway, server fault. */
  | "failed";

export class BackendError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    /** The backend's own code (a SQLSTATE, a PostgREST code, an HTTP status). */
    readonly code?: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** One signed-in user, holding one session. Every method throws
 *  `BackendError` on failure unless it says otherwise. */
export interface Session {
  readonly userId: string;

  // ---- notes ------------------------------------------------------------
  /** Full-row upsert keyed on `id`; the server merges per field. */
  upsertNotes(rows: NoteWrite[]): Promise<void>;
  /** Narrow update of an existing note; affects nothing if there is none. */
  patchNote(id: string, patch: NotePatch): Promise<void>;
  /** One keyset page of this user's notes in `(updated_at, id)` order. */
  pullNotes(after: Cursor, limit: number): Promise<NoteRow[]>;
  /** This user's notes among `ids`; unknown or foreign ids are simply absent. */
  notesById(ids: string[]): Promise<NoteRow[]>;
  /** `{id, status, field_updated_at}` of one of this user's notes, or null. */
  noteState(id: string): Promise<NoteState | null>;
  /** Destroys a trashed note if nothing newer was written; see the contract. */
  permanentlyDeleteNote(id: string, expectedUpdatedAt: Iso): Promise<boolean>;
  /** One keyset page of this user's tombstones in `(deleted_at, note_id)` order. */
  pullTombstones(after: Cursor, limit: number): Promise<TombstoneRow[]>;
  /** Notes, tombstones and canvases after three cursors, plus the prefs row. */
  pullChanges(args: PullChangesArgs): Promise<Changes>;

  // ---- canvases ---------------------------------------------------------
  upsertCanvases(rows: CanvasRow[]): Promise<void>;
  pullCanvases(after: Cursor, limit: number): Promise<CanvasRow[]>;

  // ---- preferences ------------------------------------------------------
  upsertPrefs(prefs: PrefsWrite): Promise<void>;
  /** The same write, made only while `updated_at` is still `readAt` (null: while there is no row).
   *  `true` when it wrote, `false` when the row had moved on (§8). */
  writePrefsIf(prefs: PrefsWrite, readAt: Iso | null): Promise<boolean>;
  readPrefs(): Promise<PrefsRow | null>;

  // ---- push subscriptions -----------------------------------------------
  upsertPushSubscription(row: PushSubscriptionWrite): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;

  // ---- files ------------------------------------------------------------
  /** Stores bytes at `path` (`<userId>/<noteId>/<attachmentId>`), replacing
   *  whatever was there. */
  uploadFile(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  downloadFile(path: string): Promise<Uint8Array>;
  /** Removes what exists at `paths` and is this user's; the rest is ignored. */
  removeFiles(paths: string[]): Promise<void>;

  // ---- link preview -----------------------------------------------------
  /** Never throws for an HTTP answer; throws only if no answer arrived. */
  linkPreview(request: LinkPreviewRequest): Promise<LinkPreviewAnswer>;

  // ---- live updates -----------------------------------------------------
  /** Resolves once the subscription is live; the returned function ends it. */
  subscribe(table: RealtimeTable, onSignal: (signal: ChangeSignal) => void): Promise<() => Promise<void>>;

  // ---- session ----------------------------------------------------------
  /** The server's clock as this client last read it, in epoch milliseconds,
   *  after making one request. */
  serverTime(): Promise<number>;
  /** Ends the session. Later calls act as a caller with no session. */
  signOut(): Promise<void>;
}

/** A reminder the sweep would send now. `reminder_at` is the occurrence. */
export interface DueReminder {
  note_id: string;
  owner_id: string;
  reminder_at: Iso;
  reminder_repeat: string | null;
  body: string;
}

export interface SubscriptionRecord {
  endpoint: string;
  owner_id: string;
  p256dh: string;
  auth: string;
  failed_at: Iso | null;
}

/**
 * Server-internal operations, reached with the backend's own privilege. None
 * of these is a client operation; they are how the suite observes and drives
 * the parts of the contract a client never calls directly.
 */
export interface ServerHooks {
  /** The occurrence projection (`reminder_occurrence`). */
  reminderOccurrence(anchor: Iso, repeat: string | null, now: Iso): Promise<Iso | null>;
  /** What the sweep would send at the server's current time (`due_reminders`). */
  dueReminders(): Promise<DueReminder[]>;
  /** What the sweep writes after a push service accepted a reminder. */
  recordDelivery(delivery: { note_id: string; owner_id: string; reminder_at: Iso }): Promise<void>;
  /** The daily job: forget tombstones older than a year. Returns how many went. */
  pruneTombstones(): Promise<number>;
  /** Test fixture: move a tombstone's `deleted_at`, to age it. */
  backdateTombstone(noteId: string, deletedAt: Iso): Promise<void>;
  /** The subscriptions the sweep would send to (live ones only). */
  liveSubscriptions(ownerIds: string[]): Promise<SubscriptionRecord[]>;
  /** Every subscription row of an owner, live or retired. */
  allSubscriptions(ownerId: string): Promise<SubscriptionRecord[]>;
  /** What the sweep does to an endpoint the push service answered 404/410. */
  retireSubscriptions(endpoints: string[]): Promise<void>;
  /** A note row as stored, whoever owns it, or null. */
  readNote(id: string): Promise<NoteRow | null>;
  /** Whether bytes exist at a storage path, whoever owns them. */
  fileExists(path: string): Promise<boolean>;
}

/**
 * Known, documented places where a backend does not meet the contract. A test
 * covering one of these is expected to fail on that backend (`it.fails`), so
 * the suite notices the day it starts passing. Every entry is described in
 * docs/sync-contract.md, "Known deviations of the Supabase backend".
 */
export type Deviation =
  /** DELETE change signals reach every subscriber of the table. */
  | "realtime-delete-reaches-other-users"
  /** An upsert that empties an existing note's body stores `raw_content`.
   *  Supabase before migration 0025 (D2). */
  | "upsert-cannot-empty-body"
  /** Re-sending the stored `updated_at` restamps it with the server's now,
   *  which is earlier when the stored stamp is ahead of the server clock.
   *  Supabase before migration 0025 (D3). */
  | "equal-stamp-restamp-can-go-backwards"
  /** `keep_id` is unique across every user rather than per user.
   *  Supabase before migration 0025 (D5). */
  | "keep-id-unique-across-users";

export interface ConformanceDriver {
  readonly name: string;
  readonly deviations: ReadonlySet<Deviation>;
  /** Parts of the contract this run can exercise. */
  readonly can: {
    /** The link-preview endpoint is reachable in this environment. */
    linkPreview: boolean;
    /** Outbound internet is allowed for link-preview tests that fetch real pages. */
    linkPreviewNetwork: boolean;
    /** The endpoint's own `access-control-allow-origin` reaches the client
     *  unaltered (no gateway in front rewriting it). */
    observeCors: boolean;
    /** Live change signals can be subscribed to. */
    realtime: boolean;
  };
  readonly server: ServerHooks;
  /** Connect; called once per test file. */
  start(): Promise<void>;
  /** A brand-new user with a live session. */
  createUser(): Promise<Session>;
  /** Remove every user this driver created, and everything they own. */
  cleanup(): Promise<void>;
}
