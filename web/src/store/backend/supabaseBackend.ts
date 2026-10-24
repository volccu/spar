import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cursor } from "../cursors";
import { RUNTIME_CONFIG, knownConfig } from "./config";
import type { AuthSession, Backend, LinkPreviewFailure, LinkPreviewRequest, RealtimeTable, Row } from "./types";

/**
 * The Supabase backend: every call the store used to make on the client
 * itself, moved here unchanged (`store/backend/types.ts` says why the shape is
 * what it is).
 *
 * **This module is in the `supabase` chunk**, beside `@supabase/supabase-js`
 * (`codeSplitting` in `vite.config.ts`), and is reached only by a dynamic import
 * in `getBackend` once the client exists — so it adds no request of its own
 * and nothing to the first paint. Import it statically from anything on the
 * paint path and the whole client comes with it.
 */

/** The storage bucket files live in, one folder per user (§12). */
const BUCKET = "files";
/** Files listed per request when a note's folder is read (`filesUnder`). */
const LIST_PAGE = 100;

/** The channel each table's change signals arrive on. */
const CHANNELS: Record<RealtimeTable, string> = {
  notes: "notes-changes",
  folders: "folder-changes",
  prefs: "prefs-changes",
};

/** A keyset page after `cursor`, as a PostgREST `or` filter. */
function afterCursor(cursor: Cursor, timeColumn = "updated_at", idColumn = "id"): string {
  if (!cursor.id) return `${timeColumn}.gt.${cursor.at}`;
  return `${timeColumn}.gt.${cursor.at},and(${timeColumn}.eq.${cursor.at},${idColumn}.gt.${cursor.id})`;
}

function afterCanvasCursor(cursor: Cursor): string {
  // A cursor with no id yet is a device that has never completed a pull — a
  // fresh install, or one still holding the plain timestamp this key stored
  // before it became a keyset. The tiebreak clause cannot be written for it:
  // PostgREST passes `id.gt.` through verbatim and Postgres refuses to cast ""
  // to uuid, so the whole page request came back 400 — and because the throw
  // landed before the cursor was ever re-written, every later tick asked the
  // exact same broken question. Folder sync had therefore never finished a
  // first pull on a new device. The first page instead takes everything from
  // the stamp *inclusive*: re-pulling a row that shares the legacy stamp is
  // idempotent (`putCanvasesLocalOnly` overwrites), skipping one is not, and
  // every page after this carries a real id and pages by keyset as normal.
  // Every first page is read this way now: stepping the saved cursor back
  // over the repair window drops its id as well (`repairStart`).
  if (!cursor.id) return `updated_at.gte.${cursor.at}`;
  return `updated_at.gt.${cursor.at},and(updated_at.eq.${cursor.at},id.gt.${cursor.id})`;
}

/**
 * An invoke error, read into what `useLinkUnfurl` decides on.
 *
 * The status is read off `error.context`: supabase-js throws
 * `new FunctionsHttpError(response)`, so the context *is* the fetch `Response`
 * and `.status` is a plain number on it — no body is consumed, and the client
 * has already given up on the response by the time we see it. It is matched by
 * `name` rather than `instanceof FunctionsHttpError` because the class would
 * have to be imported for that, and matching the name keeps this module
 * honest about what it relies on.
 *
 * `FunctionsHttpError` is the one kind that means *something answered* — the
 * function, or the gateway in front of it — as opposed to the request never
 * arriving (offline, a dropped connection, a relay error). A status that
 * cannot be read is reported as null, which the caller counts as transient:
 * something upstream of the function changed the shape of the error, and
 * re-asking on the next open is the recoverable half of that.
 */
function linkFailure(error: unknown): LinkPreviewFailure {
  const answered = error instanceof Error && error.name === "FunctionsHttpError";
  const context: unknown = answered ? (error as { context?: unknown }).context : null;
  const status = (context as { status?: unknown } | null)?.status;
  return {
    message: error instanceof Error ? error.message : String(error),
    answered,
    status: answered && typeof status === "number" ? status : null,
  };
}

/**
 * A channel that fails to open fails silently otherwise: the 20-second
 * backstop keeps the app in step, so nothing on screen says live updates are
 * off. Written to the console, where a "why is the phone a tick behind"
 * question is at least answerable.
 */
const channelStatus = (table: string) => (status: string, error?: Error) => {
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
    console.error(`live ${table} updates not available (${status})`, error);
  }
};

function wrap(client: SupabaseClient): Backend {
  return {
    kind: "supabase",
    auth: {
      kind: "magic-link",
      sendLink: async (email, redirectTo) => {
        const { error } = await client.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: redirectTo,
            // This is a single-user app, so every sign-in is the same person
            // coming back — never someone new. Left on, a mistyped address is
            // accepted in silence: the server makes a second account, mails its
            // link to an address that does not exist, and the screen sits on
            // "check your email" forever. The second account then owns nothing,
            // so the notes are not lost but every board is empty, which is the
            // worse half of the failure — it looks like the archive is gone.
            // That is exactly what happened here, on a phone, to one transposed
            // pair of letters. Off, the typo comes back as an error while the
            // address is still on screen to be corrected.
            //
            // The one exception is an installation that says it takes new
            // people: a runtime-config build whose `/config.json` names
            // `"signup": "open"` (someone's own Supabase, docs/self-hosting.md).
            // `RUNTIME_CONFIG` is a literal `false` in every other build, the
            // owner's included, so there this is `false` exactly as before.
            shouldCreateUser: RUNTIME_CONFIG && knownConfig()?.signup === "open",
          },
        });
        return { error };
      },
      verifyCode: async (email, code) => {
        const { error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
        return { error };
      },
    },

    session: () =>
      client.auth.getSession().then(({ data }) => data.session as AuthSession | null),
    onSessionChange: (listener) => {
      const { data } = client.auth.onAuthStateChange((_event, session) => listener(session));
      return () => data.subscription.unsubscribe();
    },
    signOut: async () => {
      // This device only (audit 2026-10-10, SEC-7). The global default ended
      // every other device's session as well — signing out of a borrowed
      // computer signed the phone out too, without its own sign-out ever
      // running (so without releasing its push subscription first).
      const { error } = await client.auth.signOut({ scope: "local" });
      return { error };
    },

    // `async` rather than returning the builder directly: PostgREST's builder
    // is thenable but is not a Promise, and `probe` awaits it.
    probeColumn: async (table, column) => client.from(table).select(column).limit(1),

    upsertNotes: async (rows) => {
      const { error, status } = await client.from("notes").upsert(rows, { onConflict: "id" });
      // A request too large for the server or a proxy says so only in the
      // status; named as the code so `send` splits the batch (audit DATA-10).
      if (error && status === 413) return { error: { message: error.message, code: "413" } };
      return { error };
    },
    pullNotes: async (columns, after, limit) => {
      const { data, error } = await client
        .from("notes")
        .select(columns)
        .or(afterCursor(after))
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      return { data: data as unknown as Row[] | null, error };
    },
    notesById: async (columns, ids) => {
      const { data, error } = await client.from("notes").select(columns).in("id", ids);
      return { data: data as unknown as Row[] | null, error };
    },
    noteState: async (id) => {
      const { data, error } = await client
        .from("notes")
        .select("id,status,field_updated_at")
        .eq("id", id)
        .limit(1);
      return { data: (data as unknown as Row[] | null)?.[0] ?? null, error };
    },
    patchNote: async (id, patch) => client.from("notes").update(patch).eq("id", id),
    permanentlyDeleteNote: async (id, expectedUpdatedAt) =>
      client.rpc("permanently_delete_note", {
        p_note_id: id,
        p_expected_updated_at: expectedUpdatedAt,
      }),
    pullTombstones: async (after, limit) => {
      const { data, error } = await client
        .from("note_tombstones")
        .select("note_id,deleted_at")
        .or(afterCursor(after, "deleted_at", "note_id"))
        .order("deleted_at", { ascending: true })
        .order("note_id", { ascending: true })
        .limit(limit);
      return { data: data as unknown as Row[] | null, error };
    },
    pullChanges: async ({ notes, tombstones, folders, limit }) => {
      const { data, error } = await client.rpc("pull_changes", {
        p_notes_at: notes.at,
        p_notes_id: notes.id || null,
        p_tombstones_at: tombstones.at,
        p_tombstones_id: tombstones.id || null,
        p_folders_at: folders.at,
        p_folders_id: folders.id || null,
        p_limit: limit,
      });
      return { data: data as Row | null, error };
    },

    upsertCanvases: async (rows) => client.from("folders").upsert(rows, { onConflict: "id" }),
    pullCanvases: async (columns, after, limit) => {
      const { data, error } = await client
        .from("folders")
        .select(columns)
        .or(afterCanvasCursor(after))
        .order("updated_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      return { data: data as unknown as Row[] | null, error };
    },

    // The row has no id of its own — it is keyed by the owner, which the
    // client never writes.
    upsertPrefs: async (row) => client.from("prefs").upsert(row, { onConflict: "owner_id" }),
    // Migration 0028. Before it, PostgREST answers PGRST202 and the caller
    // falls back to the plain upsert above.
    writePrefsIf: async (row, readAt) => {
      const { data, error } = await client.rpc("write_prefs_if_unchanged", {
        p_expected_at: readAt,
        p_boards: row.boards,
        p_updated_at: row.updated_at,
        p_set_since: "inbox_since" in row,
        p_inbox_since: row.inbox_since ?? null,
      });
      if (error) return { data: null, error };
      if (typeof data !== "boolean") return { data: null, error: { message: "The server did not say whether it wrote" } };
      return { data, error: null };
    },
    readPrefs: async (columns) => {
      const { data, error } = await client.from("prefs").select(columns).limit(1);
      return { data: (data as unknown as Row[] | null)?.[0] ?? null, error };
    },

    upsertPushSubscription: async (row) =>
      client.from("push_subscriptions").upsert(row, { onConflict: "endpoint" }),
    deletePushSubscription: async (endpoint) =>
      client.from("push_subscriptions").delete().eq("endpoint", endpoint),

    // supabase-js answers a network failure as `error` too, never by throwing.
    uploadFile: async (path, bytes, contentType) => {
      const { error } = await client.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (!error) return { error: null };
      // The HTTP status as the code, where the storage server answered at all
      // (a `StorageApiError` carries it; a network failure does not), so a
      // refusal of the file can be told from a bad moment (`refusesTheFile`).
      const status = (error as { status?: unknown }).status;
      return { error: { message: error.message, code: typeof status === "number" ? String(status) : null } };
    },
    downloadFile: async (path) => client.storage.from(BUCKET).download(path),
    fileLink: async (path, seconds) => {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, seconds);
      return { data: data?.signedUrl ?? null, error };
    },
    removeFiles: async (paths) => {
      const { error } = await client.storage.from(BUCKET).remove(paths);
      return { error };
    },
    filesUnder: async (folder) => {
      const names: string[] = [];
      // A page at a time; a note's folder is a handful of files.
      for (let offset = 0; ; offset += LIST_PAGE) {
        const { data, error } = await client.storage
          .from(BUCKET)
          .list(folder, { limit: LIST_PAGE, offset });
        if (error) return { data: null, error };
        // A sub-folder is listed with no id; a note's folder has none, and
        // none is ever removed from here.
        for (const item of data ?? []) if (item.id) names.push(item.name);
        if (!data || data.length < LIST_PAGE) return { data: names, error: null };
      }
    },

    linkPreview: async <T>(body: LinkPreviewRequest) => {
      const { data, error } = await client.functions.invoke<T>("link-preview", { body });
      return { data: error ? null : data, error: error ? linkFailure(error) : null };
    },

    subscribe: (table, onSignal) => {
      const channel = client
        .channel(CHANNELS[table])
        .on("postgres_changes", { event: "*", schema: "public", table }, (payload) =>
          onSignal(payload.new),
        )
        .subscribe(channelStatus(table));
      return () => void client.removeChannel(channel);
    },
  } satisfies Backend;
}

/** One backend per client, so a session's many calls share one object. */
const wrapped = new WeakMap<SupabaseClient, Backend>();

export function supabaseBackend(client: SupabaseClient): Backend {
  let backend = wrapped.get(client);
  if (!backend) {
    backend = wrap(client);
    wrapped.set(client, backend);
  }
  return backend;
}

