# The spår server's HTTP API

The spår server (`server/`) is the self-hosted backend: one Node process, one SQLite file, one port.
This document is its whole HTTP surface — every endpoint, what it takes, what it answers and how it
fails — written so a client backend adapter can be built from it alone. The *rules* the endpoints
keep (the merge, the clocks, the cursors, the tombstones) are the sync contract's and are not
restated here: each section points at the section of [`docs/sync-contract.md`](sync-contract.md)
it implements. The conformance suite holds this server to that contract in strict mode
(`npm run test:conformance:server`), and `npm run test:server` covers the rest of what is written
here.

Contents: [Conventions](#conventions) · [Configuration](#configuration) ·
[Accounts and sessions](#accounts-and-sessions) · [Notes](#notes) · [Tombstones](#tombstones) ·
[The combined pull](#the-combined-pull) · [Canvases](#canvases) · [Preferences](#preferences) ·
[Push subscriptions](#push-subscriptions) · [Files](#files) · [Link previews](#link-previews) ·
[Live updates](#live-updates) · [The account](#the-account) · [Mapping the client's operations](#mapping-the-clients-operations) ·
[Server settings](#server-settings)

---

## Conventions

**Base.** Every endpoint lives under `/api` on the server's own origin, except `/config.json`. When
the server also serves the web app (`SPAR_WEB_DIR`), the app and the API share one origin, which is
what makes the session cookie work with no CORS at all.

**JSON.** Request and answer bodies are JSON (`application/json; charset=utf-8`) unless an endpoint
says otherwise (files, the export, the event stream). Every answer carries `Cache-Control: no-store`
and `X-Content-Type-Options: nosniff`.

**Instants.** The server accepts either spelling the contract names (§1): a client stamp
(`2026-09-27T12:00:00.123Z`) or a server instant (`2026-09-27T12:00:00.123456+00:00`); also a space
for the `T`, an offset without a colon, and a bare date. It stores microseconds and **always answers
in the server spelling**: `YYYY-MM-DDTHH:MM:SS[.ffffff]+00:00`, fraction trimmed of trailing zeros
and absent when zero. Compare instants as instants, never as text (`cmpIso`). The accepted range is
about the years 1685 to 2255; anything outside it, or not an instant at all, is refused.

**The server's clock.** Every answer, errors included, carries an accurate `Date` header (§5). Read
it off any answer.

**Ids.** Note, canvas and board ids are UUIDs. The server lowercases every UUID it stores and
answers, and orders by the lowercase text (§1).

**Errors.** Every failure is an HTTP status and a JSON body:

```json
{ "error": "A sentence a person can read", "code": "machine_readable_code" }
```

Some carry more keys, named where they occur. The statuses:

| Status | `code` | Meaning | The client should |
|---|---|---|---|
| 400 | `bad_request`, `invalid_json`, `unknown_column`, `invalid_cursor`, `invalid_limit`, `batch_too_large`, `invalid_id`, `invalid_instant`, `invalid_endpoint`, `invalid_subscription`, `invalid_email`, `weak_password` | The request itself is malformed. | Treat as a request failure; do not retry the same request unchanged. |
| 401 | `unauthenticated`, `invalid_credentials` | No valid session (or, at sign-in, a wrong email/password). | Treat as signed out. |
| 403 | `csrf`, `forbidden_path`, `signup_closed`, `invite_required`, `invalid_credentials` | Not allowed. | Request failure / refusal. |
| 404 | `not_found` | No such endpoint, or (files) no such object. | — |
| 405 | `method_not_allowed` | Wrong method; `Allow` names the right ones. | — |
| **409** | **`row_refused`** | **A row refusal** (§3.5): the server read a row and declined it. Extra keys: `reason` and, when known, `id`. The whole batch was refused and nothing in it was stored. | **Charge it to the row**: bisect the batch as `send` in `web/src/store/sync.ts` does. |
| 409 | `email_taken` | Sign-up with an address already in use. | Show it. |
| 412 | `prefs_moved` | A conditional `PUT /api/prefs`: the row changed since it was read. | Read the row again, merge, send again. |
| 413 | `too_large` | A body or a file over its limit. | For a file: "too large", do not retry. |
| 415 | — | Link previews only: the page is not HTML. | See [Link previews](#link-previews). |
| 421 | `wrong_host` | The `Host` is not one of `SPAR_ALLOWED_HOSTS` (when that is set). | A misconfiguration; nothing to retry. |
| 429 | `rate_limited` | Too many attempts; `Retry-After` says how many seconds to wait. | Wait and ask again. |
| 500 | `internal` | The server failed. | Request failure; retry later. |
| 507 | `storage_full` | Files: the account's storage cap is reached. | Refused; retrying will not help until files are removed. |

A **row refusal** is exactly `409` with `code: "row_refused"`. Every other failure is about the
request, and the rows in it are blameless. `reason` is one of:

| `reason` | The row was refused because |
|---|---|
| `raw_content_immutable` | It names a `raw_content` different from the stored one (§3.3). |
| `tombstoned` | Its id was permanently deleted and the tombstone is still kept (§7.3). |
| `keep_id_taken` | Another of the caller's notes already carries that `keep_id` (§3.2). |
| `not_owner` | The id (a note, or a push endpoint) belongs to another account (I2, I7). |
| `no_such_note` | A canvas names an idea note that does not exist or is not the caller's (§9, I5). |
| `invalid` | A value has the wrong type (the message names the column): not a UUID, not an instant, not an integer, a NUL character in text, a missing `raw_content` or `source` on a new note, a `null` body on an existing one. |

**Request forgery.** Every request that changes something (any method but `GET`, `HEAD`,
`OPTIONS`) must carry **either** `Content-Type: application/json` **or** the header
`X-Spar-Request: 1` — something a plain HTML form cannot send — or it is refused with `403 csrf`.
File uploads use the header. When the browser sends an `Origin`, it must be the server's own host or
one listed in `SPAR_ALLOWED_ORIGINS`, or the request is refused with `403 csrf` (`Origin: null`
included). The session cookie is also `SameSite=Lax`.

**CORS.** None is needed when the app is served by the server itself. For a client on another
origin (a development server on another port), list that origin in `SPAR_ALLOWED_ORIGINS`: the API
then answers it with `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Credentials:
true` and `Vary: Origin`, and answers its preflight (`OPTIONS`, 204, allowing `content-type` and
`x-spar-request`). Send requests with `credentials: "include"`. The simpler way in development is to
proxy `/api` and `/config.json` through the development server. The link-preview endpoint has its
own rule ([below](#link-previews)).

**Limits.**

| What | Limit |
|---|---|
| Rows per upload (`rows`), paths per removal | 1000 |
| Rows per pull page (`limit`) | 1 to 1000, default 500; outside that, `400 invalid_limit` (never silently clamped) |
| Ids per `notes/by-id` | 1000 |
| Body of a notes upload / patch | 64 MiB |
| Body of a canvases upload | 16 MiB |
| Body of a preferences upload | 4 MiB |
| Body of `notes/by-id`, `files/remove` | 1 MiB |
| Body of a link-preview request | 64 KiB |
| Body of an account request (sign-up, sign-in, password, deletion, push) | 16 KiB |
| One file | 50 MiB (52 428 800 bytes) |
| All files of one account | `SPAR_STORAGE_CAP_MB` (0 = no cap) |
| Open event streams per account | 20 (the oldest is closed for a new one) |
| Push subscriptions per account | 50 (the one seen longest ago makes room) |

---

## Configuration

### `GET /config.json` · `GET /api/config`

Public, no session. The same answer at both addresses. `/config.json` is **the web client's own
runtime-configuration file** (`web/src/store/backend/config.ts`, `docs/self-hosting.md`): a build
made with `VITE_RUNTIME_CONFIG=1` reads it to learn its backend, and `parseConfig` takes `backend`,
`vapidPublicKey` and `signup` from it and ignores the rest. The server answers it itself — this
route wins over any `config.json` file in `SPAR_WEB_DIR` — so an app it serves needs no file
written for it. The keys are therefore camelCase, unlike the rows elsewhere in this API.

```json
{
  "backend": "spar-server",
  "signup": "closed",
  "vapidPublicKey": "BLU8bXwtDooVypXxgl1D6S4jgvzY…",
  "firstAccount": false,
  "api": "/api",
  "apiVersion": 1,
  "maxFileBytes": 52428800,
  "storageCapBytes": 0
}
```

| Key | Meaning |
|---|---|
| `backend` | Always `"spar-server"` here (see [App-only modes](#app-only-modes-supabase-and-none) for the others). |
| `signup` | `"closed"`, `"invite"` or `"open"` (`SPAR_SIGNUP`). |
| `vapidPublicKey` | The Web Push application server key (base64url, 65 bytes raw) to pass to `pushManager.subscribe({applicationServerKey})`. |
| `firstAccount` | `true` while the instance has no account at all: the next sign-up is allowed whatever `signup` says, and becomes the admin. It is what the password form's `SignupState.firstAccount` should be read from (ask `/api/config` when the form opens; `/config.json` may be a cached copy). |
| `api` | The API's base path. |
| `apiVersion` | `1`. Bumped only for a change a client must know about. Everything in this document is version 1. |
| `maxFileBytes` | The per-file limit. |
| `storageCapBytes` | The per-account cap, 0 for none. |

**Capabilities.** Version 1 supports everything in the contract: files, link previews, `merged_into`,
per-field clocks, boards, repeating reminders, tombstones, canvases, preferences, the Inbox date and
the combined pull. An adapter answers `supports(feature)` with **yes** for every feature (§14).

### `GET /api/health`

Public. `200 {"ok": true}`. For a container healthcheck, and a cheap way to read the `Date` header.
It is the one path answered **whatever the `Host`**, even with `SPAR_ALLOWED_HOSTS` set — it says
nothing, and a healthcheck asks by address — and it answers in every `SPAR_BACKEND` mode.

### App-only modes (`supabase` and `none`)

With `SPAR_BACKEND=supabase` or `none` the same process serves the app and nothing of this API:
`/config.json`, `/api/health` and the static app (with `SPAR_ALLOWED_HOSTS` applied as usual), and
`404 not_found` for every other `/api/…` path, `/api/config` included. `/config.json` is then the
client's format with no server keys:

```json
{
  "backend": "supabase",
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "sb_publishable_…",
  "vapidPublicKey": "B…",
  "signup": "closed"
}
```

`vapidPublicKey` is present only when `SPAR_VAPID_PUBLIC_KEY` is set. `signup` is `SPAR_SIGNUP`; only
`"open"` lets a sign-in link make an account for a new address, and the project's own dashboard
setting still decides whether Supabase allows it. With `none` the answer is
`{"backend": "none"}`, and the app keeps every note on its device.

---

## Accounts and sessions

A session is an **httpOnly cookie** set by sign-up and sign-in:

```
Set-Cookie: spar_session=<43 characters>; Path=/; HttpOnly; SameSite=Lax; Max-Age=34560000[; Secure]
```

`Secure` is added when the request arrived over HTTPS (see `SPAR_COOKIE_SECURE`). Script cannot read
the cookie, so **a client cannot know the user id from the cookie**: keep the `user` object an
answer below returns (its `id` above all) in the client's own storage, and confirm it with
`GET /api/auth/session` when it matters. That stored id is what `session()` and
`hasStoredSession()` read (§14); a `401` from any endpoint means the session is gone and the client
should treat itself as signed out.

A session unused for 180 days expires on the server. There is no email anywhere — no confirmation, no
reset link; a forgotten password is reset by the instance's admin with the command line
(`docs/self-hosting.md`).

The **user object** every endpoint here answers with:

```json
{ "id": "c47c7b4b-4aa6-487e-80fb-8cc6efcc2764", "email": "owner@example.com", "is_admin": true,
  "created_at": "2026-09-27T17:40:18.733+00:00" }
```

### `GET /api/auth/session`

No session needed. `200 {"user": <user>}` when the cookie is a live session, `200 {"user": null}`
otherwise.

### `POST /api/auth/signup`

```json
{ "email": "you@example.com", "password": "at least eight characters", "invite": "optional code" }
```

- `201 {"user": <user>}` and the session cookie. Any session the request already carried is ended.
- The first account of an instance is always allowed and is the admin. After that: `closed` refuses
  every sign-up (`403 signup_closed`); `invite` needs an unused, unexpired invite code
  (`403 invite_required`), made with the command line and single-use; `open` takes anyone.
- `400 invalid_email` (not `something@something`, or over 254 characters), `400 weak_password`
  (under 8 characters, or over 1024), `409 email_taken`. Emails are trimmed and lowercased.
- `429 rate_limited` after 20 sign-ups from one address in an hour.

### `POST /api/auth/login`

```json
{ "email": "you@example.com", "password": "…" }
```

- `200 {"user": <user>}` and the session cookie. Any session the request already carried is ended.
- `401 invalid_credentials` for an unknown email or a wrong password — the same answer, at the same
  cost, for both.
- `429 rate_limited` with `Retry-After` after 10 failures for one email, or 50 attempts from one
  address, within 15 minutes.

### `POST /api/auth/logout`

Body `{}` (it must still be JSON, or carry `X-Spar-Request: 1`). `204`; the session is ended on the
server, the cookie is cleared (`Max-Age=0`), and this session's event streams are closed. Answers
`204` with no session too.

### `POST /api/auth/password`

```json
{ "current_password": "…", "new_password": "…" }
```

`204`, and **every other session of the account is signed out** (this one stays). `401` with no
session, `403 invalid_credentials` for a wrong current password, `400 weak_password`.

---

## Notes

Rows are the contract's (§3.1). A note row, as every endpoint answers it — exactly these keys, and
never `owner_id`:

```json
{
  "id": "0b5c2c8e-3c1b-4f39-9d1e-0c7f2d2f2e10",
  "raw_content": "hello\nworld",
  "body": "hello\nworld",
  "source": "web",
  "created_at": "2026-09-27T17:40:19.093+00:00",
  "updated_at": "2026-09-27T17:40:19.093+00:00",
  "note_type": null,
  "board_id": null,
  "status": "active",
  "priority": 0,
  "reminder_at": null,
  "reminder_repeat": null,
  "done": null,
  "merged_from": null,
  "merged_into": null,
  "keep_id": null,
  "attachments": [],
  "link_previews": [],
  "field_updated_at": {}
}
```

What each column accepts on the way in (a wrong type is a `409 row_refused`, `reason: "invalid"`):

| Column | Accepts | On a new note, when absent |
|---|---|---|
| `id` | UUID | required |
| `raw_content` | string | required; immutable afterwards (§3.3) |
| `body` | string (`null` only on a new note) | `""`, `null` or absent → `raw_content` (§3.4) |
| `source` | string | required |
| `created_at` | instant | the server's clock |
| `updated_at` | instant or `null` | the server's clock; on an update see §5 |
| `note_type`, `reminder_repeat`, `keep_id` | string or `null` | `null` |
| `board_id`, `merged_into` | UUID or `null` | `null` |
| `status` | string | `"active"` |
| `priority` | integer (−32768…32767) | `0` |
| `reminder_at` | instant or `null` | `null` |
| `done` | boolean or `null` | `null` |
| `merged_from` | array of UUIDs, or `null` | `null` |
| `attachments`, `link_previews` | JSON array (opaque) | `[]` |
| `field_updated_at` | JSON object `{field: stamp}` (§4) | `{}` |

Any other key is `400 unknown_column` (the whole request). Strings may not contain NUL.

### `POST /api/notes` — upload (upsert)

```json
{ "rows": [ <note row>, … ] }
```

Up to 1000 rows. Each row is an insert (new id) or an update merged per field (§4) with the
`updated_at` floor (§5). **The batch is one transaction**: `200 {"count": <rows>}` when every row
was accepted, and on the first refusal `409 row_refused` naming that row's `id`, with **nothing** of
the batch stored. A row that repeats an id earlier in the same batch is applied as an update of it.
Send every column on every upload (`toRow`); a column left out of an update keeps its stored value,
and leaving `field_updated_at` out altogether is the contract's "client without clocks" case (§4.3).

### `GET /api/notes?after_at=&after_id=&limit=` — pull

`200 {"notes": [<note row>, …]}`: the caller's notes in `(updated_at, id)` order, strictly after
the cursor (§6.1). `after_at` is an instant (absent: from the beginning of time), `after_id` a UUID
(absent: no tiebreaker, strictly after `after_at`). Trashed and archived notes are included. Walk it
by passing the last row's `updated_at` and `id` until a page comes back shorter than `limit`.

### `POST /api/notes/by-id`

```json
{ "ids": [ "…", "…" ] }
```

`200 {"notes": [<note row>, …]}` — the caller's notes among `ids` (at most 1000). Unknown ids,
other users' ids and strings that are not UUIDs are simply absent.

### `GET /api/notes/{id}/state`

`200 {"state": {"id": "…", "status": "trashed", "field_updated_at": {…}}}` for one of the caller's
notes, `200 {"state": null}` for anything else (missing, destroyed, another user's, not a UUID).

### `PATCH /api/notes/{id}` — the narrow patch

A JSON object of note columns to change (any column but `id`), e.g. what `deliverTrashing` sends:

```json
{ "status": "trashed", "updated_at": "2026-09-27T12:00:00.000Z", "field_updated_at": { … } }
```

`204` whether or not anything changed: a missing, destroyed or foreign id changes nothing and **never
creates a note** (§3.2, I3). An existing note of the caller's goes through exactly the upload's update
rules (immutability, the merge when `field_updated_at` is sent, the `updated_at` floor — a patch that
names no `updated_at` still moves it strictly forward). `409 row_refused` for a different
`raw_content` or a wrongly typed value; `400` for an unknown column or an id that is not a UUID.

### `POST /api/notes/{id}/destroy` — permanent delete

```json
{ "expected_updated_at": "2026-09-27T12:00:00.000Z" }
```

`200 {"deleted": true}` when the note was destroyed, `200 {"deleted": false}` otherwise — the full
rule is §7.2 (the caller's, trashed, and nothing a client wrote is newer than the expected stamp). On
`true`, in one transaction, the tombstone is recorded, and the note, its canvas and its delivery
record are removed; then **the note's files are deleted** from disk (the server does what the
Supabase backend leaves to the client, D7 — a client may still send its own `files/remove`, which
then finds nothing). `400 invalid_instant` when `expected_updated_at` is not an instant.

---

## Tombstones

### `GET /api/tombstones?after_at=&after_id=&limit=`

`200 {"tombstones": [{"note_id": "…", "deleted_at": "…"}, …]}` in `(deleted_at, note_id)` order,
strictly after the cursor (§6.1, §7.3). While a tombstone exists, any upload of that id is
`409 row_refused`, `reason: "tombstoned"`. Tombstones are forgotten after 365 days (checked hourly).

---

## The combined pull

### `GET /api/changes?notes_at=&notes_id=&tombstones_at=&tombstones_id=&folders_at=&folders_id=&limit=`

The contract's `pullChanges` (§6.3), in one read transaction:

```json
{ "notes": [ <note row>, … ], "tombstones": [ <tombstone>, … ],
  "folders": [ <canvas row>, … ], "prefs": <prefs row> | null }
```

Each list follows its own keyset (notes and tombstones strictly after; **canvases from `folders_at`
inclusive when `folders_id` is absent**) and is limited to `limit` rows separately. Every cursor
parameter is optional (absent = from the beginning). The answer equals the three separate pulls
plus the preferences read.

---

## Canvases

The arrangement of an idea note, keyed by the note's own id (§9). The contract and the combined pull
call them `folders`; these endpoints call them canvases. A canvas row:

```json
{ "id": "<the idea note's id>", "items": [], "strokes": [], "image_widths": {}, "text_elements": [],
  "created_at": "…", "updated_at": "…" }
```

### `POST /api/canvases`

`{"rows": [<canvas row>, …]}` (≤ 1000). Every write replaces the whole row as sent, whatever its
stamp — no merge, no floor. `items`, `strokes` and `text_elements` must be arrays and `image_widths`
an object (absent: empty); `created_at`/`updated_at` instants (absent: the server's clock). One
transaction: `200 {"count": n}`, or `409 row_refused` with `reason: "no_such_note"` for a canvas
whose idea note does not exist or is not the caller's, storing nothing.

### `GET /api/canvases?after_at=&after_id=&limit=`

`200 {"canvases": [<canvas row>, …]}` in `(updated_at, id)` order: **from `after_at` inclusive when
`after_id` is absent**, strictly after `(after_at, after_id)` when it is present (§6.1).

---

## Preferences

One row per user (§8): `{"boards": [ … ], "inbox_since": "…" | null, "updated_at": "…"}`.

### `GET /api/prefs`

`200 {"prefs": <prefs row>}`, or `200 {"prefs": null}` before the first upload.

### `PUT /api/prefs`

```json
{ "boards": [ … ], "inbox_since": "1970-01-01T00:00:00.000Z", "updated_at": "…" }
```

Writes **only the keys present** (plus `updated_at`, which is the server's clock when absent) and
applies no conflict rule: an earlier stamp is taken as sent. `boards` must be an array (opaque),
`inbox_since` an instant or `null`, `updated_at` an instant; a wrongly typed value is
`409 row_refused` (`reason: "invalid"`). Any other key is `400 unknown_column`. Answers
`200 {"prefs": <the stored row>}`.

**History:** before a write changes what a lost shelf would need back — a folder's id, name, mark
(`icon`), tint (`color`) or kind — the list it replaces is copied into the `prefs_history` table
(schema version 2; the Supabase backend's migrations 0027 and 0028 keep the same history). A reorder,
a lens moved, the keep-awake switch or an Inbox date alone is not copied. No endpoint reads it and
nothing prunes it; it goes with the account when the account is deleted. To see a person's last
lists: `select replaced_at, boards from prefs_history where owner_id = '<user id>' order by id desc
limit 5` against `spar.db` (`replaced_at` is microseconds since the epoch). Audit DATA-9,
2026-10-10.

**Conditional:** with `"expected_updated_at": "<instant>"` the write is made only while the stored
row's `updated_at` is still that instant, and with `"expected_updated_at": null` only while there is
no row; otherwise it is `412 prefs_moved` and nothing is written. The web client sends every merged
folder list this way and, on a 412, reads the row again, merges again and sends again (audit
DATA-1, 2026-10-10; Supabase's equivalent is migration 0028's `write_prefs_if_unchanged`).

---

## Push subscriptions

### `POST /api/push/subscribe`

```json
{ "endpoint": "https://fcm.googleapis.com/fcm/send/…", "p256dh": "<base64url>", "auth": "<base64url>",
  "user_agent": "… or null", "seen_at": "…", "failed_at": null }
```

An upsert on `endpoint` for the signed-in user (§10): the same endpoint again updates the row in
place and clears `failed_at`. `seen_at` absent or `null` means now; `failed_at` is ignored (always
cleared). `204`. `409 row_refused`, `reason: "not_owner"` when another account registered that
endpoint (it is left as it was). `400 invalid_endpoint` unless the endpoint is a **public `https`
URL on port 443** (no credentials, no IP literal, no local or metadata name) — a push service's
address is something the server will later connect to, and every push service is there;
`400 invalid_subscription` for keys that are not base64url (1–256 characters).

### `POST /api/push/unsubscribe`

`{"endpoint": "…"}` → `204`. An endpoint not registered, or registered by another account, is
nothing to do.

**What arrives on the device** is unchanged from the Supabase backend: the sweep runs once a
minute, sends each due reminder (§11.3) to each live subscription of its owner as an encrypted Web
Push with `Urgency: high` and a TTL of what is left of the one-day grace window, signed with the
instance's VAPID key, and the payload is the one `web/public/push-sw.js` shows —
`{note_id, title, body, at, actions}`, with Later and Done on a one-off reminder and none on a
repeating one (`supabase/functions/_shared/notification.ts`, which the server imports). Later and
Done are applied by the app itself on its next open (`web/src/lib/reminderActions.ts`), so they need
nothing from this API. An endpoint the push service answers 404 or 410 is retired (`failed_at` set)
until the device registers again.

---

## Files

Bytes live at `<user id>/<note id>/<attachment id>` (§12). In a URL each of the three segments is
percent-encoded on its own; the note and attachment segments must match
`[A-Za-z0-9][A-Za-z0-9_-]{0,127}` (UUIDs do) and the first must be the caller's own id.

### `PUT /api/files/{user id}/{note id}/{attachment id}`

The raw bytes as the body, `Content-Type` the file's MIME type, **and `X-Spar-Request: 1`** (the
body is not JSON). Replaces whatever is at the path. `204`.

- `413 too_large` over 50 MiB — nothing is stored (an announced `Content-Length` over the limit is
  refused before a byte is read).
- `403 forbidden_path` for a path under another user's id, or not three safe segments.
- `507 storage_full` when the account's cap would be passed (a replaced file counts only its growth).

### `GET /api/files/{user id}/{note id}/{attachment id}`

`200` with the bytes, `Content-Type` as uploaded, `Content-Length`, and `Content-Disposition:
attachment` plus `Content-Security-Policy: default-src 'none'; sandbox` — a file is never rendered as
a page of the app's origin, whatever type it claims. Fetch it and make a `Blob` of it. **`404
not_found` for a missing file and for another user's file alike** (I8). `HEAD` answers the headers
only.

### `POST /api/files/remove`

`{"paths": ["<user>/<note>/<attachment>", …]}` (≤ 1000) → `204`. Removes the caller's own paths;
paths that hold nothing, and other users' paths, are ignored.

---

## Link previews

### `POST /api/link-preview`

The contract's §13, request and answers unchanged:

```json
{ "url": "https://example.com/article", "check": true }
```

| Status | Body |
|---|---|
| 200 | `{url, title, description, image}` — `image` a `data:` URL or `null` (always `null` with `check: true`) |
| 200 | `{url, title: "", description: null, image: null, gone: true, status}` — the page answered 404/410 |
| 400 | `{error}` — not JSON, or not a public http(s) address, or a redirect to one that is not |
| 401 | `{error}` — no session |
| 405 | `{error}` — not `POST` (`OPTIONS` answers the preflight with 200) |
| 413 | `{error, code}` — the request body is over 64 KiB |
| 415 | `{error}` — the page is not HTML |
| 429 | `{error, code: "rate_limited"}` with `Retry-After` — over the per-user rate (a burst of 30, then one every 2 seconds) |
| 502 | `{error}` — any other upstream answer, more than 3 redirects, a timeout, a network failure |

The request needs the session cookie and, like every change, JSON (it is JSON anyway). What is
refused before any request is made is §13's list, plus: **any port but 80 and 443** (a page, a
redirect or a picture on another port answers 400 — a public address can still be this machine,
where its other ports are not meant to be reachable); every address a name resolves to is checked
(not only the first), **the connection is made to the checked address itself** (no DNS rebinding
between the check and the fetch — every redirect and every picture is resolved, checked and pinned
again), and IPv6 is public only inside global unicast `2000::/3`, with NAT64 (`64:ff9b::/96`), 6to4
(`2002::/16`) and IPv4-mapped addresses judged by the IPv4 address inside them, and Teredo refused.

**CORS** follows the contract rather than the API's: `Access-Control-Allow-Origin` names the request's
origin only when it is in `SPAR_ALLOWED_ORIGINS` or is the local development server
(`http://localhost:5173`, `http://127.0.0.1:5173`); `Access-Control-Allow-Credentials: true` is added
only for the explicitly listed origins.

---

## Live updates

### `GET /api/events` — Server-Sent Events

One stream per signed-in session (`401` without one). Open it with `new EventSource("/api/events",
{withCredentials: true})` or a streaming `fetch`. The server writes:

```
retry: 3000

event: ready
data: {}

event: change
data: {"table":"notes","event":"UPDATE","new":{ <note row> },"old":null}

event: change
data: {"table":"notes","event":"DELETE","new":null,"old":{"id":"…"}}

: ping
```

- `ready` once, when the stream is live — the moment `subscribe()` may resolve.
- `change` for every write, **only to the writer's own sessions** (§15, I9: there is no channel
  another user can join, deletes included). `table` is `"notes"`, `"folders"` (canvases) or
  `"prefs"`; `event` is `"INSERT"`, `"UPDATE"` or `"DELETE"`. `new` is the row after the change, in
  exactly the shape its pull answers (so `new.id` and `new.updated_at` recognise an echo,
  `web/src/store/echo.ts`); for `prefs` it is the prefs row, which has no `id`. `old` is `{"id": …}`
  on a delete. A permanent delete sends a `notes` DELETE and, when the note had a canvas, a `folders`
  DELETE too. Every row of an upload batch gets its own signal, sent after the batch committed.
- `: ping` comments every 25 seconds keep proxies from closing the stream.

One stream carries all three tables; filter on `table` to serve `subscribe(table, …)`. The stream is
closed by the server when its session ends (sign-out immediately; a password change or a revoked
session within 25 seconds; account deletion immediately). A client treats a closed stream like a
failed channel: its 20-second backstop tick keeps it in step, and it may reopen the stream.

---

## The account

### `GET /api/account`

`200 {"user": <user>, "storage": {"used_bytes": 8, "cap_bytes": 0}}`.

### `GET /api/account/export`

`200` with `Content-Type: application/zip` and `Content-Disposition: attachment;
filename="spar-export.zip"; filename*=UTF-8''spår%20YYYY-MM-DD.zip`. The archive is the app's own
export format, built by the same code (`planArchive` / `writeArchive` in
`web/src/lib/exportArchive.ts`): every note a `.md` file in its place (Inbox, a folder, Archive,
Trash), a note's files in a folder beside it (read from the server's disk; a missing one goes out as
its preview and is named in `README.txt`), the original capture beside an edited note, and
everything again in `spår.json`. The archive is built in memory.

### `POST /api/account/delete`

`{"password": "…"}` → `204`, and the cookie is cleared. **Every row of the account** — notes,
tombstones, canvases, preferences, push subscriptions, delivery records, file records, sessions, the
user — is removed in one transaction, then its files folder, and its event streams are closed.
`403 invalid_credentials` for a wrong password. There is no undo; export first.

---

## Mapping the client's operations

The contract's §14, method by method of the web client's `Backend` interface
(`web/src/store/backend/types.ts`), which `sparServerBackend.ts` implements. That interface answers
`{data, error}` rather than throwing, and the store reads `error.code` **as Postgres would say it**
(`types.ts` explains why). So the adapter translates statuses into codes:

| This server answers | The adapter's `error.code` | What the store then does |
|---|---|---|
| `409` with `code: "row_refused"` | `"23000"` (any class-23 code) | Charges that row, bisecting a batch (`namesTheRow`). |
| anything else that is not 2xx, or no answer | the status as text, or `null` | Treats it as a request failure and retries whole. |

It never reports a capability missing (no `42703`/`PGRST20x`), because the server ships with the
client. Feed every answer's `Date` header to `noteServerDate` (`store/serverClock.ts`).

| `Backend` method | Request | Answer → result |
|---|---|---|
| `auth.signupState()` | `GET /api/config` | `{mode: signup, firstAccount}` |
| `auth.signIn(email, password)` | `POST /api/auth/login` `{email, password}` | `200` → signed in (keep `user`, set the local marker, notify `onSessionChange`); `401` → wrong email or password; `429` → wait `Retry-After` |
| `auth.signUp({email, password, invite?})` | `POST /api/auth/signup` | `201` → signed in, as above; `403 signup_closed` / `invite_required`, `409 email_taken`, `400 weak_password` / `invalid_email` → say so |
| `session()` | — the user kept at sign-in (the cookie cannot be read), confirmed with `GET /api/auth/session` once per load | `{user: {id}}` or `null` |
| `onSessionChange(cb)` | — fire on sign-in, sign-out and on any `401` (but `/api/auth/login`'s, which is a wrong password, not a lost session) | — |
| `signOut()` | `POST /api/auth/logout` `{}` | `204` → signed out; a network failure leaves the session in place |
| `account.delete(password)` | `POST /api/account/delete` `{password}` | `204` → signed out, as above; `403 invalid_credentials` → nothing was deleted |
| `probeColumn(table, column)` | — | `{error: null}`, always |
| `upsertNotes(rows)` | `POST /api/notes` `{rows}` | `200` ok · `409 row_refused` → `23000` |
| `pullNotes(columns, after, limit)` | `GET /api/notes?after_at&after_id&limit` (every column comes back; `columns` is not needed) | `.notes` |
| `notesById(columns, ids)` | `POST /api/notes/by-id` `{ids}` | `.notes` |
| `noteState(id)` | `GET /api/notes/{id}/state` | `.state` |
| `patchNote(id, patch)` | `PATCH /api/notes/{id}` | `204` ok · `409 row_refused` → `23000` |
| `permanentlyDeleteNote(id, expected)` | `POST /api/notes/{id}/destroy` `{expected_updated_at}` | `data: .deleted` |
| `pullTombstones(after, limit)` | `GET /api/tombstones?after_at&after_id&limit` | `.tombstones` |
| `pullChanges({notes, tombstones, folders, limit})` | `GET /api/changes?notes_at&notes_id&tombstones_at&tombstones_id&folders_at&folders_id&limit` | the object |
| `upsertCanvases(rows)` | `POST /api/canvases` `{rows}` | `200` ok · `409 row_refused` → `23000` |
| `pullCanvases(columns, after, limit)` | `GET /api/canvases?after_at&after_id&limit` | `.canvases` |
| `upsertPrefs(row)` | `PUT /api/prefs` | `200` ok |
| `writePrefsIf(row, readAt)` | `PUT /api/prefs` with `expected_updated_at: readAt` | `200` → `data: true` · `412` → `data: false` |
| `readPrefs(columns)` | `GET /api/prefs` | `.prefs` |
| `upsertPushSubscription(row)` | `POST /api/push/subscribe` | `204` ok; anything else is "cannot ring here yet" |
| `deletePushSubscription(endpoint)` | `POST /api/push/unsubscribe` `{endpoint}` | `204` |
| `uploadFile(path, blob, type)` | `PUT /api/files/{path}`, body the blob, `Content-Type: type`, `X-Spar-Request: 1` | `204` ok · `413` too large · `403`/`507` refused · else failed |
| `downloadFile(path)` | `GET /api/files/{path}` | `data: await response.blob()` · `404` not found · else failed |
| `removeFiles(paths)` | `POST /api/files/remove` `{paths}` | `204` ok · else failed |
| `linkPreview({url, check})` | `POST /api/link-preview` `{url, check?}` | `200` → `data: body`; any other status → `error: {message: body.error, answered: true, status}`; no answer → `answered: false, status: null` |
| `subscribe(table, onSignal)` | `GET /api/events` — one stream shared by every subscription, each filtering on `table` and calling `onSignal(signal.new ?? signal.old)` | the returned function ends that subscription (and the stream with the last one) |

A cursor with `id: null` is sent without its `…_id` parameter. Build query strings with
`URLSearchParams` (an instant's `+` must be percent-encoded). Send every request with
`credentials: "same-origin"` (or `"include"` from another origin listed in `SPAR_ALLOWED_ORIGINS`).

**The stored user.** The web client keeps it in `localStorage` under `spar.server-session`, as
`{"id": "<user id>"}` and nothing more (`web/src/store/backend/marker.ts`): written at sign-in and
sign-up, cleared on sign-out, on account deletion and on any `401` above, and read synchronously at
startup so a signed-in device paints its notes before the server has answered. It is a hint about
who this browser was, never a credential; the cookie is the session.

**The event stream** is read with a streaming `fetch` rather than `EventSource`, because only
`fetch` reports the status: a `401` there is the session ending (signed out, not retried), and any
other failure or a stream the server closes is reopened after a wait that grows from one second to
thirty.

---

## Server settings

Read once at start, from the environment. Every one is optional.

| Variable | Default | Effect |
|---|---|---|
| `SPAR_BACKEND` | `spar-server` | What the app this process serves syncs with. `spar-server`: this server's own API, everything in this document. `supabase` or `none`: the API, the database and the timers are **off** — the process serves only the app (`SPAR_WEB_DIR`, required), `/config.json` and `/api/health`, answers every other `/api/…` path `404`, and never touches `SPAR_DATA_DIR`. See [App-only modes](#app-only-modes-supabase-and-none). |
| `SPAR_SUPABASE_URL`, `SPAR_SUPABASE_KEY` | — | With `SPAR_BACKEND=supabase`, required: the project URL (a copied `/rest/v1` is trimmed) and its **publishable** key, handed to the app in `/config.json`. A secret key (`sb_secret…`, or a JWT whose role is `service_role`) is refused at start, because every visitor would receive it. Ignored in the other modes. |
| `SPAR_DATA_DIR` | `/data` | Holds `spar.db` (SQLite, WAL), `files/`, `vapid.json` and `session-secret`, all owner-only. Back this folder up. |
| `SPAR_HOST` | `127.0.0.1` | The address to listen on. A container sets `0.0.0.0`. |
| `SPAR_PORT` (or `PORT`) | `8080` | The port. |
| `SPAR_SIGNUP` | `closed` | `closed`, `invite` or `open`. The first account is always allowed. |
| `SPAR_STORAGE_CAP_MB` | `0` (no cap) | File storage per account, in MiB. |
| `SPAR_ALLOWED_ORIGINS` | — | Comma-separated origins given credentialed CORS and allowed to make changes (see Conventions). |
| `SPAR_ALLOWED_HOSTS` | — (any) | Comma-separated host names (optionally `name:port`) the server answers to; any other `Host` gets `421 wrong_host` (except `/api/health`). **Recommended**: without it, a web page can reach an instance on the visitor's own network through a DNS-rebound name of its own — and on a fresh instance, create the first account. |
| `SPAR_COOKIE_SECURE` | `auto` | `auto`: `Secure` when the request came over HTTPS; `true`/`false` to force. |
| `SPAR_TRUST_PROXY` | off | Believe `X-Forwarded-For`, `-Proto` and `-Host` (for the client address, `Secure`, and the same-origin check). Turn on only behind a proxy that sets them. |
| `SPAR_VAPID_SUBJECT` | `mailto:<the admin's email>` | The contact the push services see. |
| `SPAR_VAPID_PUBLIC_KEY`, `SPAR_VAPID_PRIVATE_KEY` | generated on first boot | A key pair to use instead (base64url), e.g. to keep devices subscribed when moving an instance. With `SPAR_BACKEND=supabase`, only the public key is read: the public half of the pair the project's `send-reminders` function signs with, passed to the app in `/config.json` (without it, reminders sync but do not ring). |
| `SPAR_WEB_DIR` | — | Serve the built app (`web/dist`) from this folder on the same port, with an SPA fallback. |
| `SPAR_SCRYPT_LOG_N` | `15` | Password hashing cost (log2 N, 10–20). |

**The container image** (`Dockerfile`) sets `SPAR_HOST=0.0.0.0`, `SPAR_PORT=8080`,
`SPAR_DATA_DIR=/data` and `SPAR_WEB_DIR=/app/web` (the app, built with `VITE_RUNTIME_CONFIG=1`), runs
as the unprivileged `node` user under `tini`, and checks its own health on `/api/health`. Everything
else above is left to the operator.
