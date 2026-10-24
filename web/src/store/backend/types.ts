import type { Cursor } from "../cursors";

/**
 * The backend, as the web client reaches it: every server call the store makes
 * goes through one of these methods, and nothing outside `store/backend/`
 * touches a server client directly (web/CLAUDE.md, "The backend adapter").
 *
 * It is `docs/sync-contract.md` §14 — the client-facing operations — in the
 * shape the store files already had, so that moving them here changed no
 * logic. Two things follow from that and are deliberate:
 *
 * - **Answers come back, failures are not thrown.** Every data method resolves
 *   `{ data, error }`, the way supabase-js always answered, because the sync
 *   code is written around reading `error` and deciding: bisect a batch, cache
 *   a capability, keep a delete queued. A network failure is an `error` too.
 * - **`error.code` speaks Postgres.** The store decides what a failure means
 *   by its code: a SQLSTATE in class 22 or 23, or `P0001`, is the server
 *   declining *this row* (`namesTheRow` in `sync.ts`); `42703`, `42P01`,
 *   `42883` and `PGRST202`/`204`/`205` are "not migrated yet" (`reallyMissing`
 *   in `capability.ts`); anything else is the request's fault. A backend that
 *   is not Postgres maps its own refusals onto those codes — a row refusal as
 *   `23000` — and never reports a capability missing, since it ships with the
 *   client (§14, "Capability").
 *
 * Rows are the wire rows of §3.1, §6, §8 and §9, untyped here as they are in
 * the store (`noteFromRow`, `canvasFromRow` read them).
 */

export type Row = Record<string, unknown>;

/** Why a call did not do what it was asked. */
export interface BackendFailure {
  message: string;
  /** A SQLSTATE or PostgREST code where there is one (see above). */
  code?: string | null;
}

/** What a data call resolves with. Exactly one side is meaningful. */
export interface Answer<T> {
  data: T | null;
  error: BackendFailure | null;
}

/** What a write resolves with. */
export interface Outcome {
  error: BackendFailure | null;
}

/** Who is signed in. Supabase's own session object satisfies it. */
export interface AuthSession {
  user: { id: string };
}

/** Supabase signs in by a link in an email (`signInWithOtp`). */
export interface MagicLinkAuth {
  kind: "magic-link";
  /** Mails a sign-in link that brings the reader back to `redirectTo`. Never
   *  creates an account, unless a `/config.json` says sign-up is open. */
  sendLink(email: string, redirectTo: string): Promise<Outcome>;
  /**
   * Signs in with the six-digit code the same email carries (audit UX-11): an
   * iPhone Home Screen app keeps its storage apart from Safari, so the link —
   * which opens in Safari — signs in Safari and not the app. Success is heard
   * through `onSessionChange`, as the link's is.
   */
  verifyCode(email: string, code: string): Promise<Outcome>;
}

export type SignupMode = "closed" | "invite" | "open";

/** What a spår server says about making accounts. */
export interface SignupState {
  mode: SignupMode;
  /** No account exists yet: the first one made is the owner's. */
  firstAccount: boolean;
}

export interface NewAccount {
  email: string;
  password: string;
  /** Required when the mode is `invite` (and not for the first account). */
  invite?: string;
}

/** The spår server signs in by email and password, on a session cookie. */
export interface PasswordAuth {
  kind: "password";
  signupState(): Promise<SignupState>;
  signIn(email: string, password: string): Promise<Outcome>;
  signUp(account: NewAccount): Promise<Outcome>;
}

export interface PullChangesArgs {
  notes: Cursor;
  tombstones: Cursor;
  folders: Cursor;
  limit: number;
}

export interface LinkPreviewRequest {
  url: string;
  /** A re-check: the verdict only, no picture (§13). */
  check?: true;
  /**
   * The link is on the Inspiration wall, so the answer may be a screenshot of
   * the page (`link-preview`'s wall rule). Never sent with `check`. A backend
   * that has no screenshots ignores it.
   */
  wall?: true;
}

/**
 * A link preview that did not come back as an answer.
 *
 * `answered` separates something replying (the function, or a gateway in
 * front of it) from the request never arriving; `status` is the reply's HTTP
 * status where it could be read. `useLinkUnfurl` decides from those two which
 * failures are a verdict on the page and which are a moment.
 */
export interface LinkPreviewFailure {
  message: string;
  answered: boolean;
  status: number | null;
}

export type RealtimeTable = "notes" | "folders" | "prefs";

/**
 * What a backend lets a person do to their whole account from the app. Only
 * the spår server has it: on Supabase an account is removed from the project's
 * dashboard, and the export the About page makes is built on the device for
 * every backend alike (`lib/exportArchive.ts`).
 */
export interface AccountControl {
  /** Removes the account and everything the server holds for it, then signs
   *  this device out. Asks for the password again; a wrong one deletes nothing. */
  delete(password: string): Promise<Outcome>;
}

export interface Backend {
  readonly kind: "supabase" | "spar-server";
  /** How a person signs in here, which decides the sign-in screen. */
  readonly auth: MagicLinkAuth | PasswordAuth;
  /** Account deletion, where the backend offers it from the app. */
  readonly account?: AccountControl;

  // ---- session ----------------------------------------------------------
  /** Read locally where the backend allows it; never the first-paint path. */
  session(): Promise<AuthSession | null>;
  /** Every session change, sign-in and sign-out, from here or another tab. */
  onSessionChange(listener: (session: AuthSession | null) => void): () => void;
  /** Ends the session. A failure leaves it in place and says so. */
  signOut(): Promise<Outcome>;

  // ---- capability -------------------------------------------------------
  /** One cheap read of one column, to ask whether the server has it yet. */
  probeColumn(table: string, column: string): Promise<Outcome>;

  // ---- notes ------------------------------------------------------------
  /** Full-row upsert keyed on `id`; one refused row refuses the batch. */
  upsertNotes(rows: Row[]): Promise<Outcome>;
  /** One keyset page after `after`, in `(updated_at, id)` order. `columns` is
   *  the comma-separated list this client knows the server has. */
  pullNotes(columns: string, after: Cursor, limit: number): Promise<Answer<Row[]>>;
  /** The caller's notes among `ids`. */
  notesById(columns: string, ids: string[]): Promise<Answer<Row[]>>;
  /** `{id, status, field_updated_at}` of one note, or null when there is none. */
  noteState(id: string): Promise<Answer<Row | null>>;
  /** A narrow update of an existing note; never creates one. */
  patchNote(id: string, patch: Row): Promise<Outcome>;
  /** `true` when the note was destroyed (§7.2); anything else is a refusal. */
  permanentlyDeleteNote(id: string, expectedUpdatedAt: string): Promise<Answer<unknown>>;
  /** One keyset page of `{note_id, deleted_at}` after `after`. */
  pullTombstones(after: Cursor, limit: number): Promise<Answer<Row[]>>;
  /** Notes, tombstones and canvases after three cursors, plus the prefs row (§6.3). */
  pullChanges(args: PullChangesArgs): Promise<Answer<Row>>;

  // ---- canvases ---------------------------------------------------------
  upsertCanvases(rows: Row[]): Promise<Outcome>;
  /** From `after.at` inclusive when `after.id` is empty (§6.1). */
  pullCanvases(columns: string, after: Cursor, limit: number): Promise<Answer<Row[]>>;

  // ---- preferences ------------------------------------------------------
  /** Writes only the fields present. */
  upsertPrefs(row: Row): Promise<Outcome>;
  /**
   * The same write, made only while the row's `updated_at` is still `readAt`
   * — the stamp read just before merging — or, with `readAt` null, only while
   * there is no row at all (§8, audit DATA-1). `true` when it wrote, `false`
   * when the row had moved on and nothing was written. A server without it
   * yet reports a missing capability (`reallyMissing`), and the caller falls
   * back to `upsertPrefs`.
   */
  writePrefsIf(row: Row, readAt: string | null): Promise<Answer<boolean>>;
  readPrefs(columns: string): Promise<Answer<Row | null>>;

  // ---- push subscriptions -----------------------------------------------
  upsertPushSubscription(row: Row): Promise<Outcome>;
  deletePushSubscription(endpoint: string): Promise<Outcome>;

  // ---- files ------------------------------------------------------------
  /** Stores bytes at `<userId>/<noteId>/<attachmentId>`, replacing what was there. */
  uploadFile(path: string, bytes: Blob, contentType: string): Promise<Outcome>;
  downloadFile(path: string): Promise<Answer<Blob>>;
  /**
   * An address the browser can play a film or a sound from directly, for
   * `seconds` — so it starts in a moment and is never downloaded whole or
   * cached (`streamFile` in `store/attachments.ts`). Optional: a backend
   * without it has its media fetched whole, as every file was before.
   */
  fileLink?(path: string, seconds: number): Promise<Answer<string>>;
  removeFiles(paths: string[]): Promise<Outcome>;
  /**
   * The names of the files stored directly under `folder` (`<userId>/<noteId>`),
   * so a destroyed note's whole folder can be removed, paths this device never
   * learned included (audit DATA-5). Optional: a backend that removes a
   * note's files itself when the note is destroyed (the spår server) has none.
   */
  filesUnder?(folder: string): Promise<Answer<string[]>>;

  // ---- link preview -----------------------------------------------------
  linkPreview<T>(
    request: LinkPreviewRequest,
  ): Promise<{ data: T | null; error: LinkPreviewFailure | null }>;

  // ---- live updates -----------------------------------------------------
  /**
   * "Something in this table changed." `onSignal` gets the new row where the
   * backend sends one, which the client reads only to recognise its own echo
   * (§15). The returned function ends the subscription.
   */
  subscribe(table: RealtimeTable, onSignal: (row: unknown) => void): () => void;
}
